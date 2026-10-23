import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Client, type Pool } from 'pg';
import { databaseUrl } from '../database/tenant-database';
import { decryptFile, encryptFile } from './backup-crypto';
import type { BackupStore } from './store';

/**
 * Trabalhos do serviço de backup:
 *  - backup: pg_dump (formato custom) → cifra (AES-256-GCM) → envia ao bucket (ou grava na pasta
 *    local do servidor, sem bucket configurado) → confere tamanho → apaga os backups mais velhos
 *    que a retenção (guardando sempre os 3 últimos);
 *  - teste de restauração: baixa o último backup bom, confere o sha256, decifra e restaura num
 *    Postgres TEMPORÁRIO dentro do contêiner (nunca toca o banco de produção), conferindo
 *    migrações e contagens contra as anotadas na hora do backup.
 * Cada execução vira uma linha em backup_runs (painel Super Admin). Nada aqui imprime segredos.
 *
 * O banco inteiro é salvo: todos os restaurantes, pedidos, clientes, cadastros e as fotos
 * (a tabela media guarda as imagens no próprio banco).
 */
export interface JobContext {
  pool: Pool; // papel dono
  ownerUrl: string;
  integrationsKey: string;
  /** Destino dos arquivos: o bucket (Backblaze B2 / S3) ou a pasta local do servidor. */
  store: BackupStore;
  prefix: string;
  retentionDays: number;
  workDir: string;
  pgBin?: string;
  trigger: 'agendado' | 'painel' | 'deploy' | 'manual';
  log?: (msg: string) => void;
}

/** Backup diário (central ou de restaurante). Backups finais (-final) não entram. */
export const BACKUP_KEY_RE = /(?:^|\/)[a-z0-9-]+-\d{8}T\d{6}Z\.dump\.(enc|age)$/;
const KEEP_AT_LEAST = 3;

const STATS_SQL = `SELECT json_build_object(
  'tenants', (SELECT count(*) FROM tenants),
  'orders', (SELECT count(*) FROM orders),
  'payments', (SELECT count(*) FROM payments),
  'media', (SELECT count(*) FROM media),
  'migrations', (SELECT count(*) FROM schema_migrations),
  'lastMigration', (SELECT max(version) FROM schema_migrations)) AS s`;

type Stats = Record<'tenants' | 'orders' | 'payments' | 'media' | 'migrations', number> & {
  lastMigration: string;
};

function bin(ctx: Pick<JobContext, 'pgBin'>, name: string) {
  return ctx.pgBin ? join(ctx.pgBin, name) : name;
}

/** Roda um programa; em erro, devolve as últimas linhas da saída de erro (sem a URL do banco). */
function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out = (out + d).slice(-20_000)));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4_000)));
    p.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `${cmd.split('/').pop()} saiu com código ${code}: ${err
                .replace(/postgres(ql)?:\/\/[^\s"']+/g, '<banco>')
                .trim()
                .split('\n')
                .slice(-3)
                .join(' ')}`,
            ),
          ),
    );
  });
}

async function sha256File(file: string) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/** Um banco a salvar: o central ou o de um restaurante. */
export interface BackupTarget {
  /** Nome do banco (comandou, comandou_<endereço>). */
  database: string;
  tenantId: string | null;
  slug: string | null;
  /** Conexão do dono para este banco. */
  url: string;
}

async function stats(url: string): Promise<Stats> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query<{ s: Stats }>(STATS_SQL);
    return rows[0].s;
  } finally {
    await c.end();
  }
}

async function startRun(
  pool: Pool,
  kind: 'backup' | 'restore_test',
  trigger: string,
  target: Pick<BackupTarget, 'database' | 'tenantId'>,
  extra: Record<string, unknown> = {},
) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO backup_runs (kind, status, details, tenant_id, database)
     VALUES ($1, 'running', $2, $3, $4) RETURNING id`,
    [kind, { trigger, ...extra }, target.tenantId, target.database],
  );
  return rows[0].id;
}

async function finishRun(
  pool: Pool,
  id: string,
  r: {
    status: 'ok' | 'failed';
    details?: Record<string, unknown>;
    error?: string;
    key?: string;
    size?: number;
    sha?: string;
  },
) {
  await pool.query(
    `UPDATE backup_runs SET status = $2, finished_at = now(), details = details || $3::jsonb,
            error = $4, object_key = coalesce($5, object_key),
            size_bytes = coalesce($6, size_bytes), sha256 = coalesce($7, sha256)
      WHERE id = $1`,
    [
      id,
      r.status,
      r.details ?? {},
      r.error?.slice(0, 1000) ?? null,
      r.key ?? null,
      r.size ?? null,
      r.sha ?? null,
    ],
  );
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Onde cada arquivo fica no bucket (organizado em pastas):
 *   <prefixo>/plataforma/AAAA/MM/comandou-<data>.dump.enc                 banco central
 *   <prefixo>/restaurantes/<endereço>/AAAA/MM/<endereço>-<data>.dump.enc  banco de cada restaurante
 *   <prefixo>/restaurantes/<endereço>/final/<endereço>-<data>-final.dump.enc  backup antes de excluir
 */
export function backupKey(prefix: string, t: Pick<BackupTarget, 'slug'>, now: Date, final = false) {
  const iso = now.toISOString();
  if (!t.slug)
    return `${prefix}/plataforma/${iso.slice(0, 4)}/${iso.slice(5, 7)}/comandou-${stamp(now)}.dump.enc`;
  if (final) return `${prefix}/restaurantes/${t.slug}/final/${t.slug}-${stamp(now)}-final.dump.enc`;
  return `${prefix}/restaurantes/${t.slug}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${t.slug}-${stamp(now)}.dump.enc`;
}

/** Bancos a salvar: o central e cada banco próprio pronto. */
export async function backupTargets(ctx: Pick<JobContext, 'pool' | 'ownerUrl'>) {
  const central = decodeURIComponent(new URL(ctx.ownerUrl).pathname.slice(1));
  const { rows } = await ctx.pool.query<{ tenant_id: string; db_name: string; slug: string }>(
    `SELECT d.tenant_id, d.db_name, t.slug FROM tenant_databases d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.status = 'ready' ORDER BY t.slug`,
  );
  const targets: BackupTarget[] = [
    { database: central, tenantId: null, slug: null, url: ctx.ownerUrl },
  ];
  for (const r of rows)
    targets.push({
      database: r.db_name,
      tenantId: r.tenant_id,
      slug: r.slug,
      url: databaseUrl(ctx.ownerUrl, r.db_name),
    });
  return targets;
}

/** pg_dump de um banco → cifra → envia → confere no bucket. Registra em backup_runs. */
export async function backupDatabase(
  ctx: JobContext,
  target: BackupTarget,
  key: string,
  extra: Record<string, unknown> = {},
): Promise<{ key: string; size: number; sha: string }> {
  const log = ctx.log ?? (() => undefined);
  const id = await startRun(ctx.pool, 'backup', ctx.trigger, target, {
    destination: ctx.store.kind,
    ...extra,
  });
  const tmp = await mkdtemp(join(ctx.workDir, 'cm-backup-'));
  try {
    log(`backup: ${target.database} (registro ${id})`);
    const before = await stats(target.url);
    const dump = join(tmp, 'db.dump');
    await run(bin(ctx, 'pg_dump'), [
      '--format=custom',
      '--compress=6',
      '--no-comments',
      `--file=${dump}`,
      `--dbname=${target.url}`,
    ]);
    const after = await stats(target.url);
    await run(bin(ctx, 'pg_restore'), ['--list', dump]);
    const enc = join(tmp, 'db.dump.enc');
    await encryptFile(ctx.integrationsKey, dump, enc);
    await unlink(dump);
    const { size } = await stat(enc);
    const sha = await sha256File(enc);
    await ctx.store.putFile(key, enc, { sha256: sha });
    const remote = await ctx.store.head(key);
    const where = ctx.store.kind === 'local' ? 'na pasta do servidor' : 'no bucket';
    if (!remote) throw new Error(`O arquivo não apareceu ${where} depois de gravado`);
    if (remote.size !== size)
      throw new Error(`Tamanho ${where} (${remote.size}) difere do gerado (${size})`);
    await finishRun(ctx.pool, id, { status: 'ok', details: { before, after }, key, size, sha });
    log(`backup: ok ${key} (${size} bytes)`);
    return { key, size, sha };
  } catch (e) {
    const msg = (e as Error).message;
    log(`backup: ERRO em ${target.database}: ${msg}`);
    await finishRun(ctx.pool, id, { status: 'failed', error: msg }).catch(() => undefined);
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Backup de tudo: primeiro o banco central, depois o de cada restaurante, cada um na sua pasta.
 * Falha no central interrompe e é erro; falha num restaurante fica registrada (aparece no painel)
 * e os outros seguem. A retenção roda no fim, pasta por pasta.
 */
export async function runBackup(ctx: JobContext): Promise<{
  key: string;
  size: number;
  databases: { database: string; status: 'ok' | 'failed'; key?: string; error?: string }[];
}> {
  const now = new Date();
  const [central, ...tenants] = await backupTargets(ctx);
  const first = await backupDatabase(ctx, central!, backupKey(ctx.prefix, central!, now));
  const databases: { database: string; status: 'ok' | 'failed'; key?: string; error?: string }[] = [
    { database: central!.database, status: 'ok', key: first.key },
  ];
  for (const t of tenants) {
    try {
      const r = await backupDatabase(ctx, t, backupKey(ctx.prefix, t, now));
      databases.push({ database: t.database, status: 'ok', key: r.key });
    } catch (e) {
      databases.push({ database: t.database, status: 'failed', error: (e as Error).message });
    }
  }
  const retention = await applyRetention(ctx).catch((e: Error) => ({ error: e.message }));
  await ctx.pool
    .query(
      `UPDATE backup_runs SET details = details || $2::jsonb WHERE object_key = $1 AND kind = 'backup'`,
      [first.key, { retention, databases: databases.length }],
    )
    .catch(() => undefined);
  return { key: first.key, size: first.size, databases };
}

/** Pasta de cada backup para a retenção: o endereço do restaurante ou "plataforma". */
export function retentionGroup(prefix: string, key: string): string {
  const base = `${prefix}/restaurantes/`;
  if (!key.startsWith(base)) return 'plataforma';
  return key.slice(base.length).split('/')[0] || 'plataforma';
}

/**
 * Apaga do bucket os backups com mais de N dias, pasta por pasta (plataforma e cada
 * restaurante). Guarda sempre os 3 mais novos de cada pasta, mesmo velhos (se o backup parar de
 * rodar, os últimos bons não somem). Backups finais (antes de excluir) nunca são apagados.
 * retention 0 = nunca apaga.
 */
export async function applyRetention(ctx: Pick<JobContext, 'store' | 'prefix' | 'retentionDays'>) {
  if (ctx.retentionDays <= 0) return { deleted: 0 };
  const all = (await ctx.store.list(`${ctx.prefix}/`))
    .filter((o) => BACKUP_KEY_RE.test(o.key))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  const limit = Date.now() - ctx.retentionDays * 86_400_000;
  const groups = new Map<string, typeof all>();
  for (const o of all) {
    const g = retentionGroup(ctx.prefix, o.key);
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }
  const old = [...groups.values()].flatMap((list) =>
    list.slice(KEEP_AT_LEAST).filter((o) => o.lastModified.getTime() < limit),
  );
  for (const o of old) await ctx.store.delete(o.key);
  return { deleted: old.length, kept: all.length - old.length };
}

interface RestoreCandidate {
  object_key: string;
  sha256: string;
  details: { before: Stats; after: Stats };
  tenant_id: string | null;
  database: string | null;
}

/**
 * Teste de restauração num Postgres TEMPORÁRIO dentro do contêiner: o último backup bom do banco
 * central e o de cada restaurante com banco próprio (ou só o arquivo pedido). Cada um vira uma
 * linha em backup_runs. Devolve as contagens do banco central (ou do arquivo pedido).
 */
export async function runRestoreTest(ctx: JobContext & { key?: string; port?: number }) {
  const log = ctx.log ?? (() => undefined);
  // Só backups do destino atual (os da pasta local não estão no bucket e vice-versa).
  const dest = `coalesce(details->>'destination', 'b2') = $1`;
  const { rows: candidates } = await ctx.pool.query<RestoreCandidate>(
    ctx.key
      ? `SELECT object_key, sha256, details, tenant_id, database FROM backup_runs
          WHERE kind = 'backup' AND status = 'ok' AND object_key = $2 AND ${dest}
          ORDER BY finished_at DESC LIMIT 1`
      : `(SELECT object_key, sha256, details, tenant_id, database FROM backup_runs
           WHERE kind = 'backup' AND status = 'ok' AND tenant_id IS NULL AND object_key LIKE '%.dump.enc'
             AND ${dest}
           ORDER BY finished_at DESC LIMIT 1)
         UNION ALL
         (SELECT DISTINCT ON (b.tenant_id) b.object_key, b.sha256, b.details, b.tenant_id, b.database
            FROM backup_runs b JOIN tenant_databases d ON d.tenant_id = b.tenant_id AND d.status = 'ready'
           WHERE b.kind = 'backup' AND b.status = 'ok' AND b.object_key LIKE '%.dump.enc'
             AND NOT coalesce((b.details->>'final')::boolean, false)
             AND coalesce(b.details->>'destination', 'b2') = $1
           ORDER BY b.tenant_id, b.finished_at DESC)`,
    ctx.key ? [ctx.store.kind, ctx.key] : [ctx.store.kind],
  );
  if (!candidates.length) {
    const id = await startRun(ctx.pool, 'restore_test', ctx.trigger, {
      database: 'comandou',
      tenantId: null,
    });
    const msg = 'Nenhum backup bem-sucedido registrado';
    await finishRun(ctx.pool, id, { status: 'failed', error: msg });
    throw new Error(msg);
  }

  const tmp = await mkdtemp(join(ctx.workDir, 'cm-restore-'));
  const pgdata = join(tmp, 'pg');
  const port = String(ctx.port ?? 55432);
  let started = false;
  const psql = (db: string, sql: string) =>
    run(bin(ctx, 'psql'), [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-h',
      tmp,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      db,
      '-c',
      sql,
    ]);
  let cluster: Promise<void> | null = null;
  const startCluster = async () => {
    await run(bin(ctx, 'initdb'), [
      '-D',
      pgdata,
      '-U',
      'postgres',
      '--auth=trust',
      '-E',
      'UTF8',
      '--no-instructions',
    ]);
    await run(bin(ctx, 'pg_ctl'), [
      '-D',
      pgdata,
      '-o',
      `-p ${port} -k ${tmp} -c listen_addresses=''`,
      '-w',
      '-l',
      join(tmp, 'pg.log'),
      'start',
    ]).catch(async (e: Error) => {
      // A causa fica no log do Postgres temporário (porta ocupada, caminho longo demais...).
      const last = (await readFile(join(tmp, 'pg.log'), 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .slice(-2)
        .join(' ');
      throw new Error(last ? `${e.message} (${last})` : e.message);
    });
    started = true;
    for (const sql of [
      'CREATE ROLE comandou_owner NOLOGIN',
      'CREATE ROLE comandou_app NOLOGIN',
      'CREATE ROLE comandou_platform NOLOGIN',
    ])
      await psql('postgres', sql);
  };
  let firstResult: (Stats & { policies: number }) | null = null;
  const failures: string[] = [];
  try {
    for (const [n, c] of candidates.entries()) {
      const target = { database: c.database ?? 'comandou', tenantId: c.tenant_id };
      const id = await startRun(ctx.pool, 'restore_test', ctx.trigger, target, {
        destination: ctx.store.kind,
      });
      const t0 = Date.now();
      try {
        log(`restauração: testando ${c.object_key}`);
        const enc = join(tmp, 'db.dump.enc');
        await ctx.store.getToFile(c.object_key, enc);
        if ((await sha256File(enc)) !== c.sha256)
          throw new Error('sha256 do arquivo baixado não confere');
        const dump = join(tmp, 'db.dump');
        await decryptFile(ctx.integrationsKey, enc, dump);
        await unlink(enc);
        // Um Postgres temporário para todos; se ele não sobe, nenhum banco pode ser testado.
        await (cluster ??= startCluster());
        const db = `restore_test_${n}`;
        await psql('postgres', `CREATE DATABASE ${db}`);
        await run(bin(ctx, 'pg_restore'), [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '-h',
          tmp,
          '-p',
          port,
          '-U',
          'postgres',
          '-d',
          db,
          dump,
        ]);
        await unlink(dump);
        const got = JSON.parse(
          (
            await psql(
              db,
              `${STATS_SQL.replace(/ AS s$/, '')}::jsonb || jsonb_build_object('policies', (SELECT count(*) FROM pg_policies))`,
            )
          ).trim(),
        ) as Stats & { policies: number };
        await psql('postgres', `DROP DATABASE ${db}`);
        const details = c.details;
        const wrong = (['tenants', 'orders', 'payments', 'media', 'migrations'] as const).filter(
          (k) => {
            const lo = details.before?.[k];
            const hi = details.after?.[k];
            if (lo === undefined || hi === undefined) return false; // backup antigo sem essa contagem
            return got[k] < lo || got[k] > hi;
          },
        );
        if (wrong.length) throw new Error(`Contagens fora do esperado: ${wrong.join(', ')}`);
        if (!(got.policies > 0)) throw new Error('Nenhuma política de RLS restaurada');
        const seconds = Math.round((Date.now() - t0) / 1000);
        await finishRun(ctx.pool, id, {
          status: 'ok',
          details: { restored: got, seconds },
          key: c.object_key,
        });
        log(`restauração: ok ${target.database} em ${seconds}s`);
        firstResult ??= got;
      } catch (e) {
        const msg = (e as Error).message;
        log(`restauração: ERRO ${target.database}: ${msg}`);
        await finishRun(ctx.pool, id, { status: 'failed', error: msg, key: c.object_key }).catch(
          () => undefined,
        );
        failures.push(n === 0 ? msg : `${target.database}: ${msg}`);
      }
    }
  } finally {
    if (started)
      await run(bin(ctx, 'pg_ctl'), ['-D', pgdata, '-m', 'immediate', 'stop']).catch(
        () => undefined,
      );
    await rm(tmp, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(failures.join('; '));
  return firstResult!;
}
