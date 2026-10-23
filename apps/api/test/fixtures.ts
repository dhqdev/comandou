import { Client } from 'pg';
import { hashPassword } from '../src/auth/password';
import { provisionTenant } from '../src/provisioning/provision';
import { OWNER_URL } from './env';

export interface Fixture {
  tenantA: string;
  tenantB: string;
  catA: string;
  catB: string;
  prodA: string;
  prodB: string;
}

export const PASSWORD = 'senha-de-teste-123';

/** Cria dois restaurantes com usuários, categorias e produtos. Usa a conexão do dono. */
export async function seedTwoTenants(prefix: string): Promise<Fixture> {
  const a = await provisionTenant(OWNER_URL, {
    slug: `${prefix}-a`,
    name: `Restaurante A ${prefix}`,
    adminEmail: `admin@${prefix}-a.test`,
    adminName: 'Admin A',
    adminPassword: PASSWORD,
  });
  const b = await provisionTenant(OWNER_URL, {
    slug: `${prefix}-b`,
    name: `Restaurante B ${prefix}`,
    adminEmail: `admin@${prefix}-b.test`,
    adminName: 'Admin B',
    adminPassword: PASSWORD,
  });
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    const q = async (sql: string, p: unknown[]) =>
      (await c.query<{ id: string }>(sql, p)).rows[0].id;
    const catA = await q(`SELECT id FROM categories WHERE tenant_id = $1 LIMIT 1`, [a.tenantId]);
    const catB = await q(`SELECT id FROM categories WHERE tenant_id = $1 LIMIT 1`, [b.tenantId]);
    const prodA = await q(
      `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,'X-Burguer A','25.90') RETURNING id`,
      [a.tenantId, catA],
    );
    const prodB = await q(
      `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,'Pizza B','45.00') RETURNING id`,
      [b.tenantId, catB],
    );
    // Garçom no restaurante A (sem permissão de escrita no cardápio).
    const waiter = await q(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Garçom A', $2) RETURNING id`,
      [`garcom@${prefix}-a.test`, await hashPassword(PASSWORD)],
    );
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'waiter')`, [
      a.tenantId,
      waiter,
    ]);
    return { tenantA: a.tenantId, tenantB: b.tenantId, catA, catB, prodA, prodB };
  } finally {
    await c.end();
  }
}

export async function ownerQuery<R extends object = Record<string, unknown>>(
  sql: string,
  p: unknown[] = [],
) {
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return (await c.query<R>(sql, p)).rows;
  } finally {
    await c.end();
  }
}

/**
 * Executa agora os trabalhos de banco na fila (o que o serviço de backup faria), sem a espera
 * de segurança. Bancos de restaurante criados em teste usam endereços "tst-..." (o setup apaga
 * os que sobrarem de execuções anteriores).
 */
export async function runQueuedDbJobs(
  extra: Partial<import('../src/backup/db-jobs').DbJobContext> = {},
): Promise<('done' | 'failed')[]> {
  const { Pool } = await import('pg');
  const { claimJob, runDbJob } = await import('../src/backup/db-jobs');
  const pool = new Pool({ connectionString: OWNER_URL, max: 3 });
  const out: ('done' | 'failed')[] = [];
  try {
    for (let job = await claimJob(pool); job; job = await claimJob(pool))
      out.push(
        await runDbJob(
          { pool, ownerUrl: OWNER_URL, log: () => undefined, settleMs: 0, ...extra },
          job,
        ),
      );
  } finally {
    await pool.end();
  }
  return out;
}
