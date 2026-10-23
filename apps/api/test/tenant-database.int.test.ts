import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRetention, JobContext, runBackup, runRestoreTest } from '../src/backup/jobs';
import { S3Client } from '../src/backup/s3-client';
import { DatabaseService } from '../src/database/database.service';
import {
  databaseUrl,
  TenantDatabaseUnavailable,
  tenantDatabaseName,
} from '../src/database/tenant-database';
import { PlanService } from '../src/plans/plan.service';
import { PlatformDb } from '../src/platform/platform-db.service';
import { PlatformDatabasesService } from '../src/platform/platform-databases.service';
import type { Actor } from '../src/platform/platform.service';
import { OWNER_URL, PLATFORM_URL, testEnv } from './env';
import { FakeS3, startFakeS3 } from './fake-s3';
import { Fixture, ownerQuery, PASSWORD, runQueuedDbJobs, seedTwoTenants } from './fixtures';

/**
 * Banco próprio por restaurante (ADR 0011): roteamento pelo registro, mudança de um restaurante
 * antigo do banco central para um banco só dele (cópia conferida), exclusão com backup final na
 * pasta do restaurante e backups organizados por pasta. Cria bancos de verdade (comandou_tst_*):
 * o papel dono precisa de CREATEDB e pg_signal_backend, como em produção.
 */
const PG_BIN =
  process.env.TEST_PG_BIN ??
  ['/usr/lib/postgresql/16/bin', '/usr/libexec/postgresql16'].find((d) =>
    existsSync(`${d}/pg_dump`),
  );
const KEY = randomBytes(32).toString('base64');
const S3 = { keyId: 'chave-b2', secret: 'segredo-b2', bucket: 'comandou-backups' };

const env = testEnv({ PLATFORM_DATABASE_URL: PLATFORM_URL, INTEGRATIONS_KEY: KEY });
const db = new DatabaseService(env);
const platformDb = new PlatformDb(env);
const dbs = new PlatformDatabasesService(env, platformDb);
let fx: Fixture;
let actor: Actor;
let s3: FakeS3;
let ownerPool: Pool;
let backupCtx: () => JobContext;

const inDb = async <R extends object>(dbName: string, q: string, p: unknown[] = []) => {
  const c = new Client({ connectionString: databaseUrl(OWNER_URL, dbName) });
  await c.connect();
  try {
    return (await c.query<R>(q, p)).rows;
  } finally {
    await c.end();
  }
};

beforeAll(async () => {
  fx = await seedTwoTenants('tst-mv');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('bancos@plataforma.test', 'Admin Bancos', 'x', '\\x00') RETURNING id`,
  );
  actor = { admin: { id, email: 'bancos@plataforma.test', name: 'Admin Bancos', sessionId: id } };
  s3 = await startFakeS3(S3);
  ownerPool = new Pool({ connectionString: OWNER_URL, max: 3 });
  const workDir = await mkdtemp(join(tmpdir(), 'cm-tdb-'));
  backupCtx = () => ({
    pool: ownerPool,
    ownerUrl: OWNER_URL,
    integrationsKey: KEY,
    store: new S3Client({ endpoint: s3.url, region: 'us-west-004', ...S3 }),
    prefix: 'comandou',
    retentionDays: 30,
    workDir,
    pgBin: PG_BIN,
    trigger: 'manual',
  });
});

afterAll(async () => {
  await db.onModuleDestroy();
  await platformDb.onModuleDestroy();
  await ownerPool?.end();
  await s3?.close();
});

describe('Banco de cada restaurante: roteamento', () => {
  it('sem registro, o restaurante usa o banco central', async () => {
    expect(await db.router.locationOf(fx.tenantA)).toEqual({ kind: 'shared' });
    expect(await db.router.poolFor(fx.tenantA)).toBe(db.pool);
  });

  it('nome do banco vem do endereço e só aceita o formato esperado', () => {
    expect(tenantDatabaseName('pizzaria-do-ze')).toBe('comandou_pizzaria_do_ze');
    expect(() => databaseUrl(OWNER_URL, 'outro; DROP')).toThrow();
  });
});

describe.skipIf(!PG_BIN)('Banco de cada restaurante: mudar, isolar e excluir', () => {
  const dbName = 'comandou_tst_mv_a';

  it('restaurante antigo vai para um banco só dele com todos os dados conferidos', async () => {
    await dbs.move(fx.tenantA, actor);
    const [t] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      fx.tenantA,
    ]);
    expect(t.status).toBe('moving');
    // Durante a mudança a API do restaurante não grava em lugar nenhum.
    db.router.forget();
    await expect(db.router.poolFor(fx.tenantA)).rejects.toBeInstanceOf(TenantDatabaseUnavailable);

    expect(await runQueuedDbJobs()).toEqual(['done']);
    db.router.forget();
    expect(await db.router.locationOf(fx.tenantA)).toEqual({ kind: 'dedicated', dbName });
    const [back] = await ownerQuery<{ status: string }>(
      `SELECT status FROM tenants WHERE id = $1`,
      [fx.tenantA],
    );
    expect(back.status).toBe('provisioned');

    // Os dados estão no banco novo, inclusive equipe e senha...
    const products = await inDb<{ name: string }>(dbName, `SELECT name FROM products`);
    expect(products.map((p) => p.name)).toEqual(['X-Burguer A']);
    const logins = await db.queryTenantDb<{ user_id: string }>(
      fx.tenantA,
      'SELECT user_id FROM app_find_login($1, $2)',
      [fx.tenantA, 'admin@tst-mv-a.test'],
    );
    expect(logins).toHaveLength(1);
    // ...e saíram do banco central (que segue com o cadastro e o B).
    expect(await ownerQuery(`SELECT 1 FROM products WHERE tenant_id = $1`, [fx.tenantA])).toEqual(
      [],
    );
    expect(await ownerQuery(`SELECT 1 FROM tenants WHERE id = $1`, [fx.tenantA])).toHaveLength(1);
    expect(
      await ownerQuery(`SELECT 1 FROM products WHERE tenant_id = $1`, [fx.tenantB]),
    ).toHaveLength(1);
    const [job] = await ownerQuery<{ result: { rows: number; copied: Record<string, number> } }>(
      `SELECT result FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'move'`,
      [fx.tenantA],
    );
    expect(job.result.copied.products).toBe(1);
    expect(job.result.copied.memberships).toBe(2);
  });

  it('cada restaurante só enxerga o próprio banco (e o RLS continua dentro dele)', async () => {
    const where = (id: string) =>
      db.withTenant({ tenantId: id }, async (tx) => {
        const r = await tx.execute(
          sql`SELECT current_database() AS d, (SELECT count(*)::int FROM products) AS n`,
        );
        return r.rows[0] as { d: string; n: number };
      });
    expect(await where(fx.tenantA)).toEqual({ d: dbName, n: 1 });
    expect(await where(fx.tenantB)).toEqual({ d: 'comandou_test', n: 1 });
    // Dentro do banco de A, outro tenant_id não vê nada.
    const pool = await db.router.poolFor(fx.tenantA);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [fx.tenantB]);
      expect((await c.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('plano e assinatura continuam no banco central para quem tem banco próprio', async () => {
    const [plan] = await ownerQuery<{ id: string }>(
      `INSERT INTO plans (code, name, price_monthly, max_products) VALUES ('tst-1', 'Teste 1', 10, 1) RETURNING id`,
    );
    await ownerQuery(
      `INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES ($1, $2, 'active')`,
      [fx.tenantA, plan.id],
    );
    const plans = new PlanService(db);
    const cur = await db.withTenant({ tenantId: fx.tenantA }, (tx) => plans.current(tx));
    expect(cur?.plan.code).toBe('tst-1');
    await expect(
      db.withTenant({ tenantId: fx.tenantA }, (tx) => plans.assertCanAdd(tx, 'products')),
    ).rejects.toThrow(/Limite do plano/);
    await ownerQuery(`DELETE FROM subscriptions WHERE tenant_id = $1`, [fx.tenantA]);
  });

  it('painel lê equipe e uso do banco do restaurante', async () => {
    const info = await dbs.info(fx.tenantA);
    expect(info).toMatchObject({ kind: 'dedicated', name: dbName, status: 'ready' });
    expect(info.backupFolder).toBe('comandou/restaurantes/tst-mv-a/');
    expect(info.sizeBytes).toBeGreaterThan(0);
    const h = await platformDb.tenantDb(fx.tenantA);
    const team = await h.query(`SELECT 1 FROM memberships WHERE tenant_id = $1`, [fx.tenantA]);
    expect(team).toHaveLength(2);
  });

  it('backup diário: banco central e cada restaurante na sua pasta', async () => {
    const r = await runBackup(backupCtx());
    expect(r.key).toMatch(/^comandou\/plataforma\/\d{4}\/\d{2}\/comandou-\d{8}T\d{6}Z\.dump\.enc$/);
    const mine = r.databases.find((d) => d.database === dbName);
    expect(mine?.status).toBe('ok');
    expect(mine?.key).toMatch(
      /^comandou\/restaurantes\/tst-mv-a\/\d{4}\/\d{2}\/tst-mv-a-\d{8}T\d{6}Z\.dump\.enc$/,
    );
    const [run] = await ownerQuery<{ tenant_id: string; database: string }>(
      `SELECT tenant_id, database FROM backup_runs WHERE object_key = $1`,
      [mine!.key],
    );
    expect(run).toEqual({ tenant_id: fx.tenantA, database: dbName });
  });

  // initdb não roda como root (no CI roda).
  it.skipIf(process.getuid?.() === 0)(
    'teste de restauração confere o banco central e o de cada restaurante',
    async () => {
      await runRestoreTest({ ...backupCtx(), port: 55434 });
      const runs = await ownerQuery<{ database: string; status: string }>(
        `SELECT database, status FROM backup_runs
          WHERE kind = 'restore_test' AND (database = $1 OR tenant_id IS NULL)
          ORDER BY id DESC LIMIT 2`,
        [dbName],
      );
      expect(runs).toEqual(
        expect.arrayContaining([
          { database: dbName, status: 'ok' },
          { database: expect.any(String), status: 'ok' },
        ]),
      );
    },
  );

  it('excluir exige restaurante suspenso, o endereço digitado e backup ligado', async () => {
    await expect(
      dbs.remove(fx.tenantA, { confirm: 'tst-mv-a', reason: 'teste' }, actor),
    ).rejects.toThrow(/Suspenda/);
    await ownerQuery(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [fx.tenantA]);
    await ownerQuery(`UPDATE platform_backup_settings SET enabled = false WHERE id`);
    await expect(
      dbs.remove(fx.tenantA, { confirm: 'outro', reason: 'teste' }, actor),
    ).rejects.toThrow(/endereço/);
    await expect(
      dbs.remove(fx.tenantA, { confirm: 'tst-mv-a', reason: 'teste' }, actor),
    ).rejects.toThrow(/backup/);
  });

  it('exclusão: backup final na pasta do restaurante, banco apagado, histórico mantido', async () => {
    await ownerQuery(
      `UPDATE platform_backup_settings SET enabled = true, endpoint = 'https://s3.test', bucket = 'b',
              key_id = 'k', secret_enc = '\\x01' WHERE id`,
    );
    await dbs.remove(fx.tenantA, { confirm: 'tst-mv-a', reason: 'cliente encerrou' }, actor);
    expect(await runQueuedDbJobs({ backup: backupCtx })).toEqual(['done']);

    const [job] = await ownerQuery<{ result: { finalBackupKey: string }; tenant_slug: string }>(
      `SELECT result, tenant_slug FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'delete'`,
      [fx.tenantA],
    );
    expect(job.result.finalBackupKey).toMatch(
      /^comandou\/restaurantes\/tst-mv-a\/final\/tst-mv-a-\d{8}T\d{6}Z-final\.dump\.enc$/,
    );
    expect(s3.objects.has(job.result.finalBackupKey)).toBe(true);
    expect(await ownerQuery(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName])).toEqual([]);
    expect(await ownerQuery(`SELECT 1 FROM tenants WHERE id = $1`, [fx.tenantA])).toEqual([]);
    const audit = await ownerQuery<{ action: string; tenant_id: string | null }>(
      `SELECT action, tenant_id FROM platform_audit_log WHERE entity_id = $1 ORDER BY id`,
      [fx.tenantA],
    );
    expect(audit.map((a) => a.action)).toContain('platform.tenant.deleted');
    expect(audit.every((a) => a.tenant_id === null)).toBe(true);
    // A retenção nunca apaga o backup final.
    await applyRetention({ ...backupCtx(), retentionDays: 1 });
    expect(s3.objects.has(job.result.finalBackupKey)).toBe(true);
  });

  it('restaurante no banco central também pode ser excluído (vai antes para um banco só dele)', async () => {
    await ownerQuery(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [fx.tenantB]);
    await dbs.remove(fx.tenantB, { confirm: 'tst-mv-b', reason: 'teste' }, actor);
    expect(await runQueuedDbJobs({ backup: backupCtx })).toEqual(['done']);
    const [job] = await ownerQuery<{ result: { finalBackupKey: string } }>(
      `SELECT result FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'delete'`,
      [fx.tenantB],
    );
    expect(job.result.finalBackupKey).toContain('comandou/restaurantes/tst-mv-b/final/');
    expect(await ownerQuery(`SELECT 1 FROM products WHERE tenant_id = $1`, [fx.tenantB])).toEqual(
      [],
    );
    expect(await ownerQuery(`SELECT 1 FROM tenants WHERE id = $1`, [fx.tenantB])).toEqual([]);
    expect(
      await ownerQuery(`SELECT 1 FROM pg_database WHERE datname = 'comandou_tst_mv_b'`),
    ).toEqual([]);
    await ownerQuery(
      `UPDATE platform_backup_settings SET enabled = false, endpoint = '', bucket = '', key_id = '',
              secret_enc = NULL WHERE id`,
    );
  });

  it('criação que falha fica registrada e pode ser excluída sem backup', async () => {
    const [plan] = await ownerQuery<{ n: number }>(`SELECT count(*)::int AS n FROM plans`);
    expect(plan.n).toBeGreaterThan(0);
    const id = await dbs.create(
      {
        slug: 'tst-falha',
        name: 'Falha',
        adminEmail: 'a@falha.test',
        adminName: 'A',
        adminPassword: PASSWORD,
      },
      actor,
    );
    // Simula falha: o pedido perde os dados do administrador.
    await ownerQuery(`UPDATE tenant_db_jobs SET payload = '{}' WHERE tenant_id = $1`, [id]);
    expect(await runQueuedDbJobs()).toEqual(['failed']);
    const [t] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      id,
    ]);
    expect(t.status).toBe('failed');
    const info = await dbs.info(id);
    expect(info.status).toBe('failed');
    expect(info.lastError).toMatch(/administrador/);
    await dbs.remove(id, { confirm: 'tst-falha', reason: 'criação falhou' }, actor);
    expect(await runQueuedDbJobs()).toEqual(['done']);
    expect(await ownerQuery(`SELECT 1 FROM tenants WHERE id = $1`, [id])).toEqual([]);
    expect(
      await ownerQuery(`SELECT 1 FROM pg_database WHERE datname = 'comandou_tst_falha'`),
    ).toEqual([]);
  });
});

describe('retenção por pasta', () => {
  it('guarda os 3 últimos de CADA pasta (plataforma e cada restaurante)', async () => {
    const r = await startFakeS3({ ...S3, bucket: 'ret2' });
    const c = new S3Client({ endpoint: r.url, region: 'x', ...S3, bucket: 'ret2' });
    const old = (days: number) => new Date(Date.now() - days * 86_400_000);
    const put = (key: string, days: number) =>
      r.objects.set(key, { body: Buffer.from('x'), meta: {}, modified: old(days) });
    for (const d of [90, 80, 70, 60]) {
      put(`cm/plataforma/2026/01/comandou-202601${d}T030000Z.dump.enc`, d);
      put(`cm/restaurantes/ze/2026/01/ze-202601${d}T030000Z.dump.enc`, d);
    }
    put('cm/restaurantes/ze/final/ze-20260101T030000Z-final.dump.enc', 400);
    expect(await applyRetention({ store: c, prefix: 'cm', retentionDays: 30 })).toEqual({
      deleted: 2,
      kept: 6,
    });
    expect(r.objects.has('cm/restaurantes/ze/final/ze-20260101T030000Z-final.dump.enc')).toBe(true);
    expect([...r.objects.keys()].filter((k) => k.includes('/ze/2026'))).toHaveLength(3);
    await r.close();
  });
});
