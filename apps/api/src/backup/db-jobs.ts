import { readdirSync } from 'node:fs';
import { Client, type Pool, type PoolClient } from 'pg';
import { migrate, MIGRATIONS_DIR } from '../database/migrator';
import { databaseUrl, TENANT_DB_NAME_RE } from '../database/tenant-database';
import { backupDatabase, backupKey, JobContext } from './jobs';
import { copyTenant, purgeTenantRows } from './tenant-copy';

/**
 * Trabalhos de banco pedidos pelo painel Super Admin (tabela tenant_db_jobs), executados pelo
 * serviço de backup com a conexão do dono:
 *  - create: cria o banco do restaurante, aplica as migrações e cadastra o administrador;
 *  - move:   copia um restaurante do banco central para um banco só dele e troca o apontamento;
 *  - delete: backup final na pasta do restaurante, apaga o banco e o cadastro.
 * Cada etapa aparece no painel (coluna step). Nada aqui grava senhas ou URLs no log.
 */
export interface DbJob {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  kind: 'create' | 'move' | 'delete';
  payload: Record<string, unknown>;
}

export interface DbJobContext {
  pool: Pool; // dono, banco central
  ownerUrl: string;
  log: (m: string) => void;
  /** Contexto de backup (bucket), só quando configurado: usado no backup final. */
  backup?: () => JobContext;
  /** Espera antes de copiar/apagar, para as réplicas da API esquecerem o banco antigo. */
  settleMs?: number;
  migrationsDir?: string;
}

const APP_ROLES = ['comandou_app', 'comandou_platform'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pega o próximo trabalho da fila (um por vez). */
export async function claimJob(pool: Pool): Promise<DbJob | null> {
  const { rows } = await pool.query<DbJob>(
    `UPDATE tenant_db_jobs SET status = 'running', started_at = now(), error = NULL
      WHERE id = (SELECT id FROM tenant_db_jobs WHERE status = 'queued'
                   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id::text, tenant_id, tenant_slug, tenant_name, kind, payload`,
  );
  return rows[0] ?? null;
}

/** Devolve à fila (ex.: um backup está rodando e a mudança precisa esperar). */
export async function requeueJob(pool: Pool, id: string, step: string) {
  await pool.query(
    `UPDATE tenant_db_jobs SET status = 'queued', started_at = NULL, step = $2 WHERE id = $1`,
    [id, step],
  );
}

async function step(ctx: DbJobContext, job: DbJob, text: string) {
  ctx.log(`banco ${job.tenant_slug}: ${text}`);
  await ctx.pool.query(`UPDATE tenant_db_jobs SET step = $2 WHERE id = $1`, [job.id, text]);
}

async function provisioningStep(
  ctx: DbJobContext,
  tenantId: string,
  name: string,
  status: 'done' | 'failed',
  error?: string,
) {
  await ctx.pool.query(
    `INSERT INTO tenant_provisioning_steps (tenant_id, step, status, attempts, last_error)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (tenant_id, step) DO UPDATE
       SET status = $3, attempts = tenant_provisioning_steps.attempts + 1, last_error = $4, updated_at = now()`,
    [tenantId, name, status, error?.slice(0, 500) ?? null],
  );
}

/** Com o que o dono consegue mexer: criar bancos e encerrar conexões (ver 01-roles.sh). */
export async function databasePrivileges(pool: Pool) {
  const { rows } = await pool.query<{ createdb: boolean; signal: boolean }>(
    `SELECT rolcreatedb AS createdb, pg_has_role(current_user, 'pg_signal_backend', 'MEMBER') AS signal
       FROM pg_roles WHERE rolname = current_user`,
  );
  return { canCreateDatabases: !!rows[0]?.createdb, canTerminate: !!rows[0]?.signal };
}

/**
 * Com a conexão de superusuário (DATABASE_ADMIN_URL, opcional), dá ao dono o que ele precisa
 * para criar e excluir bancos de restaurantes. Idempotente; roda quando o serviço sobe.
 */
export async function grantDatabasePrivileges(adminUrl: string, owner: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(owner)) throw new Error('papel dono inválido');
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`ALTER ROLE ${owner} CREATEDB`);
    await c.query(`GRANT pg_signal_backend TO ${owner}`);
  } finally {
    await c.end();
  }
}

/** A imagem do serviço precisa ter todas as migrações que o banco central já tem. */
async function checkMigrationsUpToDate(ctx: DbJobContext) {
  const files = new Set(
    readdirSync(ctx.migrationsDir ?? MIGRATIONS_DIR).filter((f) =>
      /^\d{4}_[a-z0-9_]+\.sql$/.test(f),
    ),
  );
  const { rows } = await ctx.pool.query<{ version: string }>(
    `SELECT version FROM schema_migrations`,
  );
  const missing = rows.map((r) => r.version).filter((v) => !files.has(v));
  if (missing.length)
    throw new Error(
      `O serviço de backup está numa versão mais antiga que o banco central (falta ${missing[0]}). Atualize o sistema e tente de novo.`,
    );
}

async function databaseExists(pool: Pool, name: string) {
  const { rowCount } = await pool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
  return !!rowCount;
}

/** Cria (se ainda não existe) o banco do restaurante, fecha para o público e aplica as migrações. */
async function ensureDatabase(ctx: DbJobContext, job: DbJob, dbName: string) {
  if (!TENANT_DB_NAME_RE.test(dbName)) throw new Error('nome de banco inválido');
  await checkMigrationsUpToDate(ctx);
  await step(ctx, job, `Criando o banco ${dbName}`);
  if (!(await databaseExists(ctx.pool, dbName))) {
    const priv = await databasePrivileges(ctx.pool);
    if (!priv.canCreateDatabases)
      throw new Error(
        'O papel dono do banco não pode criar bancos. Rode uma vez no contêiner do Postgres: ' +
          'psql -U postgres -c "ALTER ROLE comandou_owner CREATEDB" -c "GRANT pg_signal_backend TO comandou_owner" ' +
          '(ou informe DATABASE_ADMIN_URL ao serviço de backup).',
      );
    await ctx.pool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  }
  await ctx.pool.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
  for (const r of APP_ROLES) await ctx.pool.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${r}`);
  await step(ctx, job, 'Aplicando as migrações');
  await migrate(databaseUrl(ctx.ownerUrl, dbName), ctx.migrationsDir, () => undefined);
}

/** Apaga um banco de restaurante. Fecha a porta antes e derruba quem ainda estiver conectado. */
export async function dropDatabase(pool: Pool, dbName: string) {
  if (!TENANT_DB_NAME_RE.test(dbName)) throw new Error('nome de banco inválido');
  if (!(await databaseExists(pool, dbName))) return;
  for (const r of APP_ROLES)
    await pool.query(`REVOKE CONNECT ON DATABASE "${dbName}" FROM ${r}`).catch(() => undefined);
  const { canTerminate } = await databasePrivileges(pool);
  if (canTerminate) {
    await pool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    return;
  }
  // Sem permissão de derrubar conexões: as da API fecham sozinhas quando ficam paradas.
  let last: unknown;
  for (let i = 0; i < 24; i++) {
    try {
      await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      return;
    } catch (e) {
      last = e;
      await sleep(5_000);
    }
  }
  throw last;
}

/** Transação numa conexão só do pool (BEGIN/COMMIT direto no pool cairiam em conexões diferentes). */
async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Limpa as linhas do restaurante no banco central (conexão própria: purge abre transação). */
async function purgeCentral(ctx: DbJobContext, tenantId: string, everything = false) {
  return withClient(ctx.ownerUrl, (c) => purgeTenantRows(c, tenantId, everything));
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Dados do restaurante (cadastro, administrador e padrões) dentro do banco novo. */
async function seedTenant(ctx: DbJobContext, job: DbJob, dbName: string) {
  let payload = job.payload as {
    adminEmail?: string;
    adminName?: string;
    passwordHash?: string;
    storeWhatsapp?: string;
    retryOf?: string;
  };
  if (payload.retryOf) {
    const { rows } = await ctx.pool.query<{ payload: typeof payload }>(
      `SELECT payload FROM tenant_db_jobs WHERE id = $1 AND tenant_id = $2`,
      [payload.retryOf, job.tenant_id],
    );
    payload = rows[0]?.payload ?? {};
  }
  if (!payload.adminEmail || !payload.passwordHash)
    throw new Error('Dados do administrador não encontrados no pedido');
  const { rows: t } = await ctx.pool.query<{
    slug: string;
    name: string;
    timezone: string;
    currency: string;
  }>(`SELECT slug, name, timezone, currency FROM tenants WHERE id = $1`, [job.tenant_id]);
  if (!t[0]) throw new Error('Restaurante não encontrado no banco central');
  await step(ctx, job, 'Cadastrando o administrador');
  await withClient(databaseUrl(ctx.ownerUrl, dbName), async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(
        `INSERT INTO tenants (id, slug, name, status, timezone, currency)
         VALUES ($1, $2, $3, 'provisioned', $4, $5) ON CONFLICT (id) DO NOTHING`,
        [job.tenant_id, t[0]!.slug, t[0]!.name, t[0]!.timezone, t[0]!.currency],
      );
      await c.query(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
        [
          payload.adminEmail!.toLowerCase(),
          payload.adminName ?? payload.adminEmail,
          payload.passwordHash,
        ],
      );
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         SELECT $1, id, 'owner' FROM users WHERE email = $2
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [job.tenant_id, payload.adminEmail!.toLowerCase()],
      );
      await c.query(
        `INSERT INTO categories (tenant_id, name, position)
         SELECT $1, 'Mais pedidos', 0 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE tenant_id = $1)`,
        [job.tenant_id],
      );
      if (payload.storeWhatsapp)
        await c.query(
          `INSERT INTO tenant_store_settings (tenant_id, whatsapp) VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO NOTHING`,
          [job.tenant_id, payload.storeWhatsapp],
        );
      await c.query(
        `INSERT INTO audit_log (tenant_id, action, entity, entity_id, data)
         SELECT $1::uuid, 'tenant.provisioned', 'tenant', $1::text, jsonb_build_object('slug', $2::text, 'database', $3::text)
          WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE tenant_id = $1::uuid AND action = 'tenant.provisioned')`,
        [job.tenant_id, t[0]!.slug, dbName],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}

async function finishJob(ctx: DbJobContext, job: DbJob, result: Record<string, unknown>) {
  await ctx.pool.query(
    `UPDATE tenant_db_jobs SET status = 'done', finished_at = now(), step = 'Concluído',
            result = result || $2::jsonb, payload = '{}'::jsonb WHERE id = $1`,
    [job.id, result],
  );
}

async function failJob(ctx: DbJobContext, job: DbJob, error: string) {
  await ctx.pool.query(
    `UPDATE tenant_db_jobs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
    [job.id, error.replace(/postgres(ql)?:\/\/[^\s"']+/g, '<banco>').slice(0, 1000)],
  );
}

async function registry(ctx: DbJobContext, tenantId: string) {
  const { rows } = await ctx.pool.query<{ db_name: string; status: string }>(
    `SELECT db_name, status FROM tenant_databases WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------- criar
async function runCreate(ctx: DbJobContext, job: DbJob) {
  const reg = await registry(ctx, job.tenant_id);
  if (!reg) throw new Error('Registro do banco não encontrado');
  let current = 'database';
  try {
    await ensureDatabase(ctx, job, reg.db_name);
    await provisioningStep(ctx, job.tenant_id, 'database', 'done');
    current = 'admin_user';
    await seedTenant(ctx, job, reg.db_name);
    await provisioningStep(ctx, job.tenant_id, 'admin_user', 'done');
    current = 'activate';
    await step(ctx, job, 'Liberando o acesso');
    await tx(ctx.pool, async (c) => {
      await c.query(
        `UPDATE tenant_databases SET status = 'ready', ready_at = now(), last_error = NULL
          WHERE tenant_id = $1`,
        [job.tenant_id],
      );
      await c.query(`UPDATE tenants SET status = 'provisioned' WHERE id = $1`, [job.tenant_id]);
    });
    await provisioningStep(ctx, job.tenant_id, 'activate', 'done');
    const retryOf = (job.payload as { retryOf?: string }).retryOf;
    if (retryOf)
      await ctx.pool.query(`UPDATE tenant_db_jobs SET payload = '{}'::jsonb WHERE id = $1`, [
        retryOf,
      ]);
    await finishJob(ctx, job, { database: reg.db_name });
  } catch (e) {
    const msg = (e as Error).message;
    await provisioningStep(ctx, job.tenant_id, current, 'failed', msg).catch(() => undefined);
    await ctx.pool
      .query(
        `UPDATE tenant_databases SET status = 'failed', last_error = $2 WHERE tenant_id = $1`,
        [job.tenant_id, msg.slice(0, 1000)],
      )
      .catch(() => undefined);
    await ctx.pool
      .query(`UPDATE tenants SET status = 'failed' WHERE id = $1`, [job.tenant_id])
      .catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------------- mover
/** Copia do central para o banco novo; só troca o apontamento depois de conferir as contagens. */
async function moveIntoOwnDatabase(ctx: DbJobContext, job: DbJob, dbName: string, status: string) {
  await ensureDatabase(ctx, job, dbName);
  await step(ctx, job, 'Copiando os dados');
  const dbUrl = databaseUrl(ctx.ownerUrl, dbName);
  const report = await withClient(ctx.ownerUrl, (src) =>
    withClient(dbUrl, (dst) => copyTenant(src, dst, job.tenant_id, ctx.log)),
  );
  await withClient(dbUrl, (c) =>
    c.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [job.tenant_id, status]),
  );
  return report;
}

async function runMove(ctx: DbJobContext, job: DbJob) {
  const previous = String(
    (job.payload as { previousStatus?: string }).previousStatus ?? 'provisioned',
  );
  const reg = await registry(ctx, job.tenant_id);
  if (!reg || reg.status !== 'moving') throw new Error('Registro da mudança não encontrado');
  let switched = false;
  try {
    await step(ctx, job, 'Esperando as conexões em uso terminarem');
    await sleep(ctx.settleMs ?? 15_000);
    const report = await moveIntoOwnDatabase(ctx, job, reg.db_name, previous);
    await step(ctx, job, 'Trocando para o banco novo');
    await tx(ctx.pool, async (c) => {
      await c.query(
        `UPDATE tenant_databases SET status = 'ready', ready_at = now(), last_error = NULL WHERE tenant_id = $1`,
        [job.tenant_id],
      );
      await c.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [job.tenant_id, previous]);
    });
    switched = true;
    await step(ctx, job, 'Limpando a cópia antiga no banco central');
    let cleanup: Record<string, unknown>;
    try {
      cleanup = { removed: await purgeCentral(ctx, job.tenant_id) };
    } catch (e) {
      cleanup = { warning: `Cópia antiga não foi limpa: ${(e as Error).message}` };
    }
    await finishJob(ctx, job, {
      database: reg.db_name,
      copied: report.tables,
      rows: report.rows,
      ...cleanup,
    });
  } catch (e) {
    if (!switched) {
      // Volta tudo como era: o restaurante segue no banco central.
      await dropDatabase(ctx.pool, reg.db_name).catch(() => undefined);
      await ctx.pool
        .query(`DELETE FROM tenant_databases WHERE tenant_id = $1 AND status = 'moving'`, [
          job.tenant_id,
        ])
        .catch(() => undefined);
      await ctx.pool
        .query(`UPDATE tenants SET status = $2 WHERE id = $1 AND status = 'moving'`, [
          job.tenant_id,
          previous,
        ])
        .catch(() => undefined);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------- excluir
async function runDelete(ctx: DbJobContext, job: DbJob) {
  const p = job.payload as { previousStatus?: string; finalBackup?: boolean };
  const previous = p.previousStatus ?? 'suspended';
  let reg = await registry(ctx, job.tenant_id);
  let dropped = false;
  let createdForDelete = false;
  let purgedCentral = false;
  try {
    await step(ctx, job, 'Esperando as conexões em uso terminarem');
    await sleep(ctx.settleMs ?? 15_000);
    const result: Record<string, unknown> = {};
    if (p.finalBackup) {
      if (!ctx.backup)
        throw new Error('Backup não configurado: a exclusão precisa do backup final');
      const bctx = ctx.backup();
      if (!reg) {
        // Restaurante no banco central: vai antes para um banco só dele (vira um backup
        // restaurável sozinho) e depois segue a exclusão normal.
        await ctx.pool.query(
          `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES ($1, $2, 'deleting')`,
          [job.tenant_id, `comandou_${job.tenant_slug.replace(/-/g, '_')}`],
        );
        createdForDelete = true;
        reg = await registry(ctx, job.tenant_id);
        await moveIntoOwnDatabase(ctx, job, reg!.db_name, 'suspended');
        await purgeCentral(ctx, job.tenant_id);
        purgedCentral = true;
      }
      await step(ctx, job, 'Fazendo o backup final');
      const target = {
        database: reg!.db_name,
        tenantId: job.tenant_id,
        slug: job.tenant_slug,
        url: databaseUrl(ctx.ownerUrl, reg!.db_name),
      };
      const b = await backupDatabase(
        { ...bctx, trigger: 'painel' },
        target,
        backupKey(bctx.prefix, target, new Date(), true),
        { final: true, jobId: job.id },
      );
      Object.assign(result, {
        finalBackupKey: b.key,
        finalBackupSize: b.size,
        finalBackupSha256: b.sha,
      });
    }
    if (reg) {
      await step(ctx, job, `Apagando o banco ${reg.db_name}`);
      await dropDatabase(ctx.pool, reg.db_name);
      dropped = true;
      result.database = reg.db_name;
    }
    await step(ctx, job, 'Apagando o cadastro');
    result.removed = await purgeCentral(ctx, job.tenant_id, true);
    await ctx.pool.query(
      `INSERT INTO platform_audit_log (admin_id, action, entity, entity_id, data)
       SELECT a.id, 'platform.tenant.deleted', 'tenant', $1::text,
              jsonb_build_object('slug', $2::text, 'name', $3::text, 'finalBackupKey', $4::text, 'jobId', $5::text)
         FROM (SELECT $6::uuid AS id) x LEFT JOIN platform_admins a ON a.id = x.id`,
      [
        job.tenant_id,
        job.tenant_slug,
        job.tenant_name,
        (result.finalBackupKey as string | undefined) ?? null,
        job.id,
        (
          await ctx.pool.query<{ by: string | null }>(
            `SELECT requested_by AS by FROM tenant_db_jobs WHERE id = $1`,
            [job.id],
          )
        ).rows[0]?.by ?? null,
      ],
    );
    await finishJob(ctx, job, result);
  } catch (e) {
    if (createdForDelete && !purgedCentral && reg) {
      // Os dados continuam no banco central: desfaz o banco temporário.
      await dropDatabase(ctx.pool, reg.db_name).catch(() => undefined);
      await ctx.pool
        .query(`DELETE FROM tenant_databases WHERE tenant_id = $1`, [job.tenant_id])
        .catch(() => undefined);
      await ctx.pool
        .query(`UPDATE tenants SET status = $2 WHERE id = $1`, [job.tenant_id, previous])
        .catch(() => undefined);
      throw e;
    }
    // Banco ainda existe: volta para suspenso (dá para tentar de novo). Já apagado: fica como
    // falha, e a nova tentativa só apaga o cadastro.
    await ctx.pool
      .query(`UPDATE tenants SET status = $2 WHERE id = $1`, [
        job.tenant_id,
        dropped ? 'failed' : previous,
      ])
      .catch(() => undefined);
    await ctx.pool
      .query(`UPDATE tenant_databases SET status = $2, last_error = $3 WHERE tenant_id = $1`, [
        job.tenant_id,
        dropped ? 'failed' : 'ready',
        (e as Error).message.slice(0, 1000),
      ])
      .catch(() => undefined);
    throw e;
  }
}

/** Executa um trabalho já reservado e registra o resultado. Nunca lança. */
export async function runDbJob(ctx: DbJobContext, job: DbJob): Promise<'done' | 'failed'> {
  try {
    if (job.kind === 'create') await runCreate(ctx, job);
    else if (job.kind === 'move') await runMove(ctx, job);
    else await runDelete(ctx, job);
    ctx.log(`banco ${job.tenant_slug}: ${job.kind} concluído`);
    return 'done';
  } catch (e) {
    const msg = (e as Error).message;
    ctx.log(`banco ${job.tenant_slug}: ${job.kind} FALHOU: ${msg}`);
    await failJob(ctx, job, msg).catch(() => undefined);
    return 'failed';
  }
}
