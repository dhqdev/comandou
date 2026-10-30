import { sql } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBackup } from '../src/backup/jobs';
import { S3Client } from '../src/backup/s3-client';
import { DatabaseService } from '../src/database/database.service';
import { databaseUrl, TenantDatabaseUnavailable } from '../src/database/tenant-database';
import { PlatformDb } from '../src/platform/platform-db.service';
import { PlatformDatabasesService } from '../src/platform/platform-databases.service';
import { PlatformDbServersService } from '../src/platform/platform-db-servers.service';
import type { Actor } from '../src/platform/platform.service';
import { OWNER_URL, PLATFORM_URL, testEnv } from './env';
import { FakeS3, startFakeS3 } from './fake-s3';
import { Fixture, ownerQuery, runQueuedDbJobs, seedTwoTenants } from './fixtures';

/**
 * Servidores de banco (ADR 0011, nível 2): um segundo Postgres de verdade (initdb num diretório
 * temporário), cadastro no painel, mudança de um restaurante para lá e de volta, "mover todos" e
 * a proteção contra cadastrar o mesmo servidor com outro endereço. initdb não roda como root.
 */
const PG_BIN =
  process.env.TEST_PG_BIN ??
  ['/usr/lib/postgresql/16/bin', '/usr/libexec/postgresql16'].find((d) =>
    existsSync(`${d}/initdb`),
  );
const ROOT = process.getuid?.() === 0;
const PORT = 55441;
const KEY = randomBytes(32).toString('base64');
const S3 = { keyId: 'chave-b2', secret: 'segredo-b2', bucket: 'comandou-backups' };

const env = testEnv({ PLATFORM_DATABASE_URL: PLATFORM_URL, INTEGRATIONS_KEY: KEY });
const db = new DatabaseService(env);
const platformDb = new PlatformDb(env);
const dbs = new PlatformDatabasesService(env, platformDb);
const servers = new PlatformDbServersService(env, platformDb, dbs);
const dbName = 'comandou_tst_sv_a';
const second = { host: '127.0.0.1', port: PORT, ssl: 'disable' as const };
let fx: Fixture;
let actor: Actor;
let dir = '';
let s3: FakeS3;

const pg = (cmd: string, args: string[]) => {
  const r = spawnSync(join(PG_BIN!, cmd), args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`);
  return r.stdout;
};

async function query<R extends object>(url: string, q: string, p: unknown[] = []) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<R>(q, p)).rows;
  } finally {
    await c.end();
  }
}
const onSecond = (q: string) =>
  query<{ datname: string }>(`postgres://postgres@127.0.0.1:${PORT}/postgres`, q);

describe.skipIf(!PG_BIN || ROOT)('Servidores de banco: trocar um restaurante de servidor', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-sv-'));
    pg('initdb', ['-D', join(dir, 'pg'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
    pg('pg_ctl', [
      '-D',
      join(dir, 'pg'),
      '-o',
      `-p ${PORT} -k ${dir} -c listen_addresses=127.0.0.1`,
      '-w',
      '-l',
      join(dir, 'pg.log'),
      'start',
    ]);
    // Os mesmos papéis do servidor principal (a stack db-server.yml faz isso com as mesmas senhas).
    for (const q of [
      'CREATE ROLE comandou_owner LOGIN CREATEDB',
      'GRANT pg_signal_backend TO comandou_owner',
      'CREATE ROLE comandou_app LOGIN NOBYPASSRLS',
      'CREATE ROLE comandou_platform LOGIN NOBYPASSRLS',
    ])
      await onSecond(q);

    fx = await seedTwoTenants('tst-sv');
    const [{ id }] = await ownerQuery<{ id: string }>(
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ('servidores@plataforma.test', 'Admin Servidores', 'x', '\\x00') RETURNING id`,
    );
    actor = {
      admin: { id, email: 'servidores@plataforma.test', name: 'Admin', sessionId: id },
    };
    // Restaurante A ganha banco próprio no servidor principal.
    await dbs.move(fx.tenantA, actor);
    expect(await runQueuedDbJobs()).toEqual(['done']);
    s3 = await startFakeS3(S3);
  });

  afterAll(async () => {
    await db.onModuleDestroy();
    await platformDb.onModuleDestroy();
    await s3?.close();
    // Não deixa o restaurante nem os backups dele para os outros testes (o bucket falso fecha).
    if (fx) {
      await ownerQuery(`DELETE FROM backup_runs WHERE tenant_id = $1`, [fx.tenantA]);
      await ownerQuery(`DELETE FROM tenant_databases WHERE tenant_id = $1`, [fx.tenantA]);
      await ownerQuery(`DELETE FROM platform_db_servers`);
    }
    await ownerQuery(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    if (dir) {
      try {
        pg('pg_ctl', ['-D', join(dir, 'pg'), '-m', 'immediate', 'stop']);
      } catch {
        // já parado
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  let serverId = '';

  it('cadastra o servidor e confere que os papéis entram com as mesmas senhas', async () => {
    const list = await servers.create(
      {
        name: 'Banco 2',
        host: second.host,
        port: PORT,
        ssl: 'disable',
        acceptsNew: false,
        note: null,
      },
      actor,
    );
    const s = list.servers.find((x) => x.host === second.host)!;
    serverId = s.id;
    expect(s.apiCheck).toMatchObject({ ok: true });
    expect(list.main.restaurants.map((r) => r.slug)).toContain('tst-sv-a');
    // O servidor principal não pode ser cadastrado de novo.
    await expect(
      servers.create(
        {
          name: 'Principal',
          host: 'localhost',
          port: 5432,
          ssl: 'disable',
          acceptsNew: false,
          note: null,
        },
        actor,
      ),
    ).rejects.toThrow(/servidor principal/);
  });

  it('leva o restaurante para o outro servidor com tudo conferido, sem acesso durante a cópia', async () => {
    await servers.transfer(fx.tenantA, serverId, actor);
    db.router.forget();
    await expect(db.router.poolFor(fx.tenantA)).rejects.toBeInstanceOf(TenantDatabaseUnavailable);
    // O painel continua lendo do servidor de origem durante a cópia.
    const h = await platformDb.tenantDb(fx.tenantA);
    expect(
      await h.query(`SELECT 1 FROM memberships WHERE tenant_id = $1`, [fx.tenantA]),
    ).toHaveLength(2);

    expect(await runQueuedDbJobs()).toEqual(['done']);
    db.router.forget();
    expect(await db.router.locationOf(fx.tenantA)).toEqual({
      kind: 'dedicated',
      dbName,
      server: second,
    });
    const r = await db.withTenant({ tenantId: fx.tenantA }, async (tx) => {
      const x = await tx.execute(
        sql`SELECT inet_server_port() AS port, (SELECT count(*)::int FROM products) AS n`,
      );
      return x.rows[0] as { port: number; n: number };
    });
    expect(r).toEqual({ port: PORT, n: 1 });
    // Login da equipe funciona no servidor novo.
    const logins = await db.queryTenantDb<{ user_id: string }>(
      fx.tenantA,
      'SELECT user_id FROM app_find_login($1, $2)',
      [fx.tenantA, 'admin@tst-sv-a.test'],
    );
    expect(logins).toHaveLength(1);
    // O banco antigo saiu do servidor principal; o B segue no central.
    expect(await ownerQuery(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName])).toEqual([]);
    const [t] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      fx.tenantA,
    ]);
    expect(t.status).toBe('provisioned');
    const [job] = await ownerQuery<{ result: { rows: number; copied: Record<string, number> } }>(
      `SELECT result FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'transfer'`,
      [fx.tenantA],
    );
    expect(job.result.copied.products).toBe(1);
    expect(job.result.copied.users).toBe(2);
    const info = await dbs.info(fx.tenantA);
    expect(info.server).toMatchObject({ id: serverId, host: second.host });
    expect(info.sizeBytes).toBeGreaterThan(0);
  });

  it('o backup diário salva o banco que está no outro servidor', async () => {
    const pool = new Pool({ connectionString: OWNER_URL, max: 2 });
    try {
      const r = await runBackup({
        pool,
        ownerUrl: OWNER_URL,
        integrationsKey: KEY,
        store: new S3Client({ endpoint: s3.url, region: 'us-west-004', ...S3 }),
        prefix: 'comandou',
        retentionDays: 30,
        workDir: dir,
        pgBin: PG_BIN,
        trigger: 'manual',
      });
      expect(r.databases.find((d) => d.database === dbName)?.status).toBe('ok');
    } finally {
      await pool.end();
    }
  });

  it('mesmo servidor com outro endereço: recusa sem estragar nada', async () => {
    // 127.0.0.1:5432 é o principal (localhost:5432) com outro nome.
    const list = await servers.create(
      {
        name: 'Disfarçado',
        host: '127.0.0.1',
        port: 5432,
        ssl: 'disable',
        acceptsNew: false,
        note: null,
      },
      actor,
    );
    const fake = list.servers.find((x) => x.name === 'Disfarçado')!;
    // Leva o A de volta para o principal e tenta "mudar" para o disfarçado.
    await servers.transfer(fx.tenantA, 'main', actor);
    expect(await runQueuedDbJobs()).toEqual(['done']);
    await servers.transfer(fx.tenantA, fake.id, actor);
    expect(await runQueuedDbJobs()).toEqual(['failed']);
    db.router.forget();
    expect(await db.router.locationOf(fx.tenantA)).toEqual({ kind: 'dedicated', dbName });
    const n = await db.withTenant({ tenantId: fx.tenantA }, async (tx) => {
      const x = await tx.execute(sql`SELECT count(*)::int AS n FROM products`);
      return (x.rows[0] as { n: number }).n;
    });
    expect(n).toBe(1);
    await servers.remove(fake.id, actor);
  });

  it('mover todos: esvazia o servidor, um restaurante por vez, e aí dá para remover', async () => {
    await servers.transfer(fx.tenantA, serverId, actor);
    expect(await runQueuedDbJobs()).toEqual(['done']);
    // Servidor com restaurantes não pode ser removido.
    await expect(servers.remove(serverId, actor)).rejects.toThrow(/mova todos/);
    const r = await servers.transferAll(serverId, 'main', actor);
    expect(r).toEqual({ queued: 1, skipped: [] });
    // Com backup configurado, a mudança guarda um backup do banco antes de copiar.
    const pool = new Pool({ connectionString: OWNER_URL, max: 2 });
    try {
      const backup = () => ({
        pool,
        ownerUrl: OWNER_URL,
        integrationsKey: KEY,
        store: new S3Client({ endpoint: s3.url, region: 'us-west-004', ...S3 }),
        prefix: 'comandou',
        retentionDays: 30,
        workDir: dir,
        pgBin: PG_BIN,
        trigger: 'painel' as const,
      });
      expect(await runQueuedDbJobs({ backup })).toEqual(['done']);
    } finally {
      await pool.end();
    }
    const [last] = await ownerQuery<{ result: { backupKey?: string } }>(
      `SELECT result FROM tenant_db_jobs WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
      [fx.tenantA],
    );
    expect(last.result.backupKey).toMatch(/^comandou\/restaurantes\/tst-sv-a\//);
    db.router.forget();
    expect(await db.router.locationOf(fx.tenantA)).toEqual({ kind: 'dedicated', dbName });
    expect(await onSecond(`SELECT datname FROM pg_database WHERE datname = '${dbName}'`)).toEqual(
      [],
    );
    await servers.remove(serverId, actor);
    expect(await query(databaseUrl(OWNER_URL, dbName), `SELECT 1 FROM products`)).toHaveLength(1);
  });
});
