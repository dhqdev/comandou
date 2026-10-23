import { Client, Pool } from 'pg';
import { validateTenantSlug } from '@comandou/shared';
import { dropDatabase } from '../backup/db-jobs';
import { purgeTenantRows } from '../backup/tenant-copy';
import { migrate } from '../database/migrator';
import { databaseUrl, tenantDatabaseName } from '../database/tenant-database';
import { DEMO_NAME } from './catalog';
import { DEMO_MARKER, seedDemoData } from './seed';

export type DemoMode = 'off' | 'on' | 'reset';

export interface DemoOptions {
  ownerUrl: string;
  slug: string;
  /** Domínio dos e-mails da equipe (dono@<domínio>). */
  emailDomain: string;
  mode: DemoMode;
  /** "dedicated" cria o banco comandou_<endereço>; "shared" usa o banco central. */
  databaseMode: 'dedicated' | 'shared';
  log: (m: string) => void;
  now?: Date;
}

/** COMANDOU_DEMO: true/1/sim → cria uma vez; reset/recriar → apaga e cria de novo; resto → desligado. */
export function demoMode(raw: string | undefined): DemoMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (['reset', 'recriar', 'resetar'].includes(v)) return 'reset';
  if (['1', 'true', 'sim', 'yes', 'on'].includes(v)) return 'on';
  return 'off';
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

async function tx<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    const r = await fn();
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/**
 * Garante o restaurante de demonstração (idempotente). Chamado na subida da stack (serviço
 * migrate) com COMANDOU_DEMO ligado:
 *  - não existe → cria (banco próprio, se der) e preenche com ~30 dias de operação;
 *  - já existe e foi preenchido → não mexe em nada (o que você testar fica lá);
 *  - "reset" → apaga o restaurante e o banco dele e cria tudo de novo, com datas de hoje.
 * Um restaurante com o mesmo endereço que NÃO foi criado aqui nunca é tocado.
 */
export async function ensureDemoRestaurant(
  o: DemoOptions,
): Promise<'created' | 'exists' | 'skipped'> {
  if (o.mode === 'off') return 'skipped';
  const v = validateTenantSlug(o.slug);
  if (!v.ok) throw new Error(`endereço do restaurante de demonstração inválido: ${v.reason}`);
  const pool = new Pool({ connectionString: o.ownerUrl, max: 2 });
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [`demo:${o.slug}`]);
    let t = await tenantRow(pool, o.slug);
    if (t && !t.demo) {
      o.log(
        `demonstração: já existe um restaurante "${o.slug}" que não é de demonstração; nada feito`,
      );
      return 'skipped';
    }
    if (t && o.mode === 'reset') {
      o.log('demonstração: apagando a versão anterior para recriar');
      if (t.dbName) await dropDatabase(pool, t.dbName);
      await withClient(o.ownerUrl, (c) => purgeTenantRows(c, t!.id, true));
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [t.id]).catch(() => undefined);
      t = null;
    }
    if (t?.seeded) return 'exists';

    // Cadastro no banco central (marcado como demonstração na auditoria da plataforma).
    if (!t) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'provisioning') RETURNING id`,
        [o.slug, DEMO_NAME],
      );
      await pool.query(
        `INSERT INTO platform_audit_log (action, entity, entity_id, tenant_id, data)
         VALUES ('platform.demo_created', 'tenant', $1, $2, jsonb_build_object('slug', $3::text))`,
        [rows[0]!.id, rows[0]!.id, o.slug],
      );
      t = { id: rows[0]!.id, demo: true, seeded: false, dbName: null, dbStatus: null };
    }

    let target = o.ownerUrl;
    let dbName = t.dbName;
    if (!dbName && o.databaseMode === 'dedicated') {
      const priv = await pool.query<{ ok: boolean }>(
        `SELECT rolcreatedb AS ok FROM pg_roles WHERE rolname = current_user`,
      );
      if (priv.rows[0]?.ok) {
        dbName = tenantDatabaseName(o.slug);
        await pool.query(
          `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES ($1, $2, 'creating')
           ON CONFLICT (tenant_id) DO NOTHING`,
          [t.id, dbName],
        );
      } else {
        o.log('demonstração: o papel dono não pode criar bancos; usando o banco central');
      }
    }
    if (dbName) {
      const exists = await pool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
      if (!exists.rowCount)
        await pool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
      await pool.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
      for (const r of ['comandou_app', 'comandou_platform'])
        await pool.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${r}`).catch(() => undefined);
      target = databaseUrl(o.ownerUrl, dbName);
      await migrate(target, undefined, () => undefined);
    }

    const result = await withClient(target, (c) =>
      tx(c, async () => {
        if (dbName)
          await c.query(
            `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'provisioned')
             ON CONFLICT (id) DO NOTHING`,
            [t!.id, o.slug, DEMO_NAME],
          );
        const done = await c.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = $2`, [
          t!.id,
          DEMO_MARKER,
        ]);
        if (done.rowCount) return null;
        return seedDemoData(c, t!.id, { emailDomain: o.emailDomain, log: o.log, now: o.now });
      }),
    );

    await pool.query(
      `UPDATE tenant_databases SET status = 'ready', ready_at = now(), last_error = NULL WHERE tenant_id = $1`,
      [t.id],
    );
    await pool.query(`UPDATE tenants SET status = 'provisioned' WHERE id = $1`, [t.id]);
    for (const step of ['database', 'admin_user', 'activate'])
      await pool.query(
        `INSERT INTO tenant_provisioning_steps (tenant_id, step, status, attempts) VALUES ($1, $2, 'done', 1)
         ON CONFLICT (tenant_id, step) DO UPDATE SET status = 'done', last_error = NULL, updated_at = now()`,
        [t.id, step],
      );
    await pool.query(
      `UPDATE platform_audit_log SET data = data || '{"seeded": true}'::jsonb
        WHERE tenant_id = $1 AND action = 'platform.demo_created'`,
      [t.id],
    );
    if (result) {
      o.log(
        `demonstração pronta: ${o.slug} (${dbName ?? 'banco central'}), ${result.orders} pedidos. ` +
          `Login: ${result.users[0]} / senha da documentação. Link do entregador freelancer: /entregador/${result.courierLink}`,
      );
    }
    return 'created';
  } finally {
    await lock
      .query('SELECT pg_advisory_unlock(hashtext($1))', [`demo:${o.slug}`])
      .catch(() => undefined);
    lock.release();
    await pool.end();
  }
}

/** Situação do restaurante de demonstração no banco central. */
async function tenantRow(pool: Pool, slug: string) {
  const { rows } = await pool.query<{
    id: string;
    demo: boolean;
    seeded: boolean;
    db_name: string | null;
    db_status: string | null;
  }>(
    `SELECT t.id, d.db_name, d.status AS db_status,
            EXISTS (SELECT 1 FROM platform_audit_log a WHERE a.tenant_id = t.id AND a.action = 'platform.demo_created') AS demo,
            EXISTS (SELECT 1 FROM platform_audit_log a WHERE a.tenant_id = t.id AND a.action = 'platform.demo_created'
                       AND (a.data->>'seeded')::boolean) AS seeded
       FROM tenants t LEFT JOIN tenant_databases d ON d.tenant_id = t.id
      WHERE t.slug = $1`,
    [slug],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, demo: r.demo, seeded: r.seeded, dbName: r.db_name, dbStatus: r.db_status };
}
