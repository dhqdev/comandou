import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimJob, DbJobContext, runDbJob } from '../src/backup/db-jobs';
import { createApp } from '../src/bootstrap';
import { knownMigrations } from '../src/migration/protocol';
import { migrate } from '../src/database/migrator';
import type { RemoteStack } from '../src/migration/stack-client';
import { PlatformDb } from '../src/platform/platform-db.service';
import { PlatformDatabasesService } from '../src/platform/platform-databases.service';
import { PlatformMigrationsService } from '../src/platform/platform-migrations.service';
import { PlatformReceiveService } from '../src/platform/platform-receive.service';
import type { Actor } from '../src/platform/platform.service';
import { APP_URL, OWNER_URL, PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, runQueuedDbJobs, seedTwoTenants } from './fixtures';

/**
 * Migrar cliente entre duas instalações (ADR 0011, nível 3). A "outra instalação" é um segundo
 * banco central no mesmo Postgres (comandou_destino_test), com o serviço de recebimento de
 * verdade; a conversa entre as duas pula só o HTTP. O restaurante vai com outro endereço lá,
 * porque aqui os dois bancos centrais dividem o mesmo servidor.
 */
const PG_BIN =
  process.env.TEST_PG_BIN ??
  ['/usr/lib/postgresql/16/bin', '/usr/libexec/postgresql16'].find((d) =>
    existsSync(`${d}/pg_dump`),
  );
const KEY = randomBytes(32).toString('base64');
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const DEST = 'comandou_destino_test';
const DEST_OWNER = withDb(OWNER_URL, DEST);
const DEST_PLATFORM = withDb(PLATFORM_URL, DEST);

const origin = testEnv({ PLATFORM_DATABASE_URL: PLATFORM_URL, INTEGRATIONS_KEY: KEY });
const originDb = new PlatformDb(origin);
const originDbs = new PlatformDatabasesService(origin, originDb);
const migrations = new PlatformMigrationsService(origin, originDb, originDbs);

const dest = testEnv({
  PLATFORM_DATABASE_URL: DEST_PLATFORM,
  DATABASE_OWNER_URL: DEST_OWNER,
  INTEGRATIONS_KEY: KEY,
  COMANDOU_BASE_DOMAIN: 'destino.test',
});
const destDb = new PlatformDb(dest);
const destDbs = new PlatformDatabasesService(dest, destDb);
const receiver = new PlatformReceiveService(dest, destDb, destDbs);

let fx: Fixture;
let actor: Actor;
let destActor: Actor;
let work = '';
let destPool: Pool;

async function q<R extends object>(url: string, sql: string, p: unknown[] = []) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<R>(sql, p)).rows;
  } finally {
    await c.end();
  }
}

/** Serviço de backup do destino: roda o que estiver na fila de lá. */
async function destJobs() {
  for (let job = await claimJob(destPool); job; job = await claimJob(destPool))
    await runDbJob(
      {
        pool: destPool,
        ownerUrl: DEST_OWNER,
        log: () => undefined,
        settleMs: 0,
        workDir: work,
        pgBin: PG_BIN,
      },
      job,
    );
}

/** O destino visto pela origem, sem HTTP. `fail` faz uma etapa falhar de propósito. */
function remote(fail?: 'install'): RemoteStack {
  const msg = (e: unknown) => {
    const r = (e as { getResponse?: () => { message?: string } }).getResponse?.();
    return new Error(`Destino respondeu 409: ${r?.message ?? (e as Error).message}`);
  };
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      try {
        return await fn(...a);
      } catch (e) {
        throw msg(e);
      }
    };
  return {
    hello: wrap(() => receiver.hello()),
    slugCheck: wrap((s: string, id: string) => receiver.slugCheck(s, id)),
    open: wrap((m) => receiver.open(m)),
    putChunk: wrap((id: string, i: number, d: Buffer) => receiver.putChunk(id, i, d)),
    view: wrap(async (id: string) => {
      await destJobs();
      return receiver.view(id);
    }),
    install: wrap(async (id: string) => {
      if (fail === 'install') throw new Error('falha de propósito');
      return receiver.install(id);
    }),
    activate: wrap((id: string) => receiver.activate(id)),
    discard: wrap((id: string) => receiver.discard(id)),
  };
}

const originJobs = (fail?: 'install') =>
  runQueuedDbJobs({
    integrationsKey: KEY,
    workDir: work,
    pgBin: PG_BIN,
    pollMs: 5,
    remote: () => remote(fail),
  } as Partial<DbJobContext>);

describe.skipIf(!PG_BIN)('Migrar cliente para outra instalação', () => {
  let stackId = '';

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'cm-mig-'));
    await ownerQuery(`DROP DATABASE IF EXISTS ${DEST} WITH (FORCE)`);
    await ownerQuery(`CREATE DATABASE ${DEST}`);
    await ownerQuery(`GRANT CONNECT ON DATABASE ${DEST} TO comandou_app, comandou_platform`);
    await migrate(DEST_OWNER, undefined, () => undefined);
    destPool = new Pool({ connectionString: DEST_OWNER, max: 3 });
    // Serviço de backup de lá "vivo" (é ele que instala o restaurante).
    await q(
      DEST_OWNER,
      `UPDATE platform_backup_settings SET worker_seen_at = now(), worker_info = '{"canCreateDatabases": true}'`,
    );

    fx = await seedTwoTenants('tst-mig');
    const [{ id }] = await ownerQuery<{ id: string }>(
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ('migracao@plataforma.test', 'Admin Migração', 'x', '\\x00') RETURNING id`,
    );
    actor = { admin: { id, email: 'migracao@plataforma.test', name: 'Admin', sessionId: id } };
    const [dst] = await q<{ id: string }>(
      DEST_OWNER,
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ('destino@plataforma.test', 'Admin Destino', 'x', '\\x00') RETURNING id`,
    );
    destActor = {
      admin: { id: dst!.id, email: 'destino@plataforma.test', name: 'D', sessionId: dst!.id },
    };
    await originDbs.move(fx.tenantA, actor);
    await originDbs.move(fx.tenantB, actor);
    expect(await runQueuedDbJobs()).toEqual(['done', 'done']);
  });

  afterAll(async () => {
    await originDb.onModuleDestroy();
    await destDb.onModuleDestroy();
    await destPool?.end();
    if (fx) {
      for (const t of [fx.tenantA, fx.tenantB]) {
        await ownerQuery(`DELETE FROM backup_runs WHERE tenant_id = $1`, [t]);
        await ownerQuery(`DELETE FROM tenant_databases WHERE tenant_id = $1`, [t]);
        await ownerQuery(
          `UPDATE tenants SET status = 'provisioned', moved_to = NULL, app_version = NULL,
                  app_update_to = NULL, app_update_at = NULL WHERE id = $1`,
          [t],
        );
      }
      await ownerQuery(`DELETE FROM tenant_migrations`);
      await ownerQuery(`DELETE FROM platform_stacks`);
    }
    for (const db of [
      'comandou_tst_mig_a',
      'comandou_tst_mig_b',
      'comandou_tst_mig_a_novo',
      'comandou_tst_mig_b_novo',
      DEST,
    ])
      await ownerQuery(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('o destino gera o token e a origem cadastra a stack (token guardado cifrado)', async () => {
    const on = await receiver.configure(true, destActor);
    expect(on.token).toMatch(/^cmr_/);
    await expect(receiver.authorize(`Bearer ${on.token}`)).resolves.toBeUndefined();
    await expect(receiver.authorize('Bearer errado')).rejects.toThrow(/inválido/);

    const list = await migrations.createStack(
      { name: 'Servidor novo', url: 'https://admin.destino.test', token: on.token!, note: null },
      actor,
    );
    stackId = list.stacks[0]!.id;
    expect(list.stacks[0]!.tokenHint).toBe(`…${on.token!.slice(-4)}`);
    const [row] = await ownerQuery<{ token_enc: Buffer }>(
      `SELECT token_enc FROM platform_stacks WHERE id = $1`,
      [stackId],
    );
    expect(row!.token_enc.toString('latin1')).not.toContain(on.token!.slice(4, 20));
    expect(list.tenants.find((t) => t.id === fx.tenantA)?.ready).toBe(true);
  });

  it('migra o restaurante inteiro: seis fases, dados conferidos e o site antigo aponta o novo', async () => {
    await ownerQuery(
      `INSERT INTO tenant_domains (tenant_id, hostname, verified_at) VALUES ($1, 'pedidos.tst-mig-a.test', now())`,
      [fx.tenantA],
    ).catch(() => undefined);
    const before = await q<{ n: string }>(
      withDb(OWNER_URL, 'comandou_tst_mig_a'),
      `SELECT count(*)::text AS n FROM products`,
    );
    // Aqui o restaurante estava preso a uma versão (Versão por restaurante).
    await ownerQuery(
      `UPDATE tenants SET app_version = 'v0.1.0', app_update_to = 'v0.2.0', app_update_at = now() + interval '1 day' WHERE id = $1`,
      [fx.tenantA],
    );
    const m = (await migrations.create(
      {
        tenantId: fx.tenantA,
        stackId,
        mode: 'move',
        targetSlug: 'tst-mig-a-novo',
        backupBefore: false,
        keepSuspended: false,
        dropAtOrigin: true,
        ignoreKeyMismatch: false,
      },
      actor,
    )) as { id: string; code: string };
    expect(m.code).toMatch(/^MOV-\d{4}-00001$/);

    expect(await originJobs()).toEqual(['done']);
    const done = (await migrations.get(m.id)) as {
      status: string;
      phases: { name: string; status: string }[];
      package: { sha256: string; chunks: number; sent: number };
      remoteUrl: string;
    };
    expect(done.status).toBe('done');
    expect(done.phases.map((p) => `${p.name}:${p.status}`)).toEqual([
      'preparar:ok',
      'enviar:ok',
      'criar:ok',
      'restaurar:ok',
      'virar:ok',
      'encerrar:ok',
    ]);
    expect(done.package.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(done.package.sent).toBe(done.package.chunks);
    expect(done.remoteUrl).toBe('https://tst-mig-a-novo.destino.test');

    // Origem: o restaurante saiu; o site antigo sabe para onde mandar.
    const [t] = await ownerQuery<{ status: string; moved_to: string }>(
      `SELECT status, moved_to FROM tenants WHERE id = $1`,
      [fx.tenantA],
    );
    expect(t).toEqual({ status: 'migrated', moved_to: 'https://tst-mig-a-novo.destino.test' });
    const [moved] = await ownerQuery<{ url: string }>(`SELECT app_tenant_moved_to($1) AS url`, [
      fx.tenantA,
    ]);
    expect(moved!.url).toBe('https://tst-mig-a-novo.destino.test');
    // Banco daqui apagado (pedido), registro removido.
    expect(
      await ownerQuery(`SELECT 1 FROM pg_database WHERE datname = 'comandou_tst_mig_a'`),
    ).toHaveLength(0);

    // Destino: cadastro, domínio, assinatura e banco com os mesmos dados, em uso.
    const [d] = await q<{ slug: string; status: string; db: string; dbs: string }>(
      DEST_OWNER,
      `SELECT t.slug, t.status, d.db_name AS db, d.status AS dbs
         FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1`,
      [fx.tenantA],
    );
    expect(d).toEqual({
      slug: 'tst-mig-a-novo',
      status: 'provisioned',
      db: 'comandou_tst_mig_a_novo',
      dbs: 'ready',
    });
    // Lá o banco chegou com todas as migrações de lá: acompanha o sistema de lá (sem a versão
    // presa da origem, que faria o migrate de lá pular este banco nas próximas atualizações).
    const [v] = await q<{ v: string | null; to: string | null; at: string | null }>(
      DEST_OWNER,
      `SELECT app_version AS v, app_update_to AS "to", app_update_at::text AS at FROM tenants WHERE id = $1`,
      [fx.tenantA],
    );
    expect(v).toEqual({ v: null, to: null, at: null });
    expect(
      await q(DEST_OWNER, `SELECT 1 FROM tenant_domains WHERE hostname = 'pedidos.tst-mig-a.test'`),
    ).toHaveLength(1);
    const after = await q<{ n: string; slug: string }>(
      withDb(OWNER_URL, 'comandou_tst_mig_a_novo'),
      `SELECT (SELECT count(*)::text FROM products) AS n, (SELECT slug FROM tenants) AS slug`,
    );
    expect(after[0]).toEqual({ n: before[0]!.n, slug: 'tst-mig-a-novo' });
    // A aplicação de lá entra no banco novo e o RLS veio junto.
    const [pol] = await q<{ n: string }>(
      withDb(OWNER_URL, 'comandou_tst_mig_a_novo'),
      `SELECT count(*)::text AS n FROM pg_policies`,
    );
    expect(Number(pol!.n)).toBeGreaterThan(10);
    const [r] = await q<{ status: string; chunks: string }>(
      DEST_OWNER,
      `SELECT status, (SELECT count(*)::text FROM tenant_reception_chunks) AS chunks FROM tenant_receptions`,
    );
    expect(r).toEqual({ status: 'active', chunks: '0' });
  });

  it('falha no meio: o destino desfaz e o restaurante volta a funcionar aqui', async () => {
    const m = (await migrations.create(
      {
        tenantId: fx.tenantB,
        stackId,
        mode: 'move',
        targetSlug: 'tst-mig-b-novo',
        backupBefore: false,
        keepSuspended: false,
        dropAtOrigin: false,
        ignoreKeyMismatch: false,
      },
      actor,
    )) as { id: string };
    expect(await originJobs('install')).toEqual(['failed']);
    const failed = (await migrations.get(m.id)) as {
      status: string;
      error: string;
      phases: { name: string; status: string }[];
    };
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/falha de propósito/);
    expect(failed.phases.find((p) => p.name === 'criar')?.status).toBe('falhou');
    expect(failed.phases.find((p) => p.name === 'enviar')?.status).toBe('desfeita');
    const [t] = await ownerQuery<{ status: string; db: string }>(
      `SELECT t.status, d.status AS db FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1`,
      [fx.tenantB],
    );
    expect(t).toEqual({ status: 'provisioned', db: 'ready' });
    expect(await q(DEST_OWNER, `SELECT 1 FROM tenants WHERE id = $1`, [fx.tenantB])).toHaveLength(
      0,
    );
    const recs = await q<{ status: string }>(
      DEST_OWNER,
      `SELECT status FROM tenant_receptions WHERE tenant_id = $1`,
      [fx.tenantB],
    );
    expect(recs.map((x) => x.status)).toEqual(['discarded']);
  });

  it('cópia: o restaurante segue aqui e fica uma cópia suspensa lá', async () => {
    const m = (await migrations.create(
      {
        tenantId: fx.tenantB,
        stackId,
        mode: 'copy',
        targetSlug: 'tst-mig-b-novo',
        backupBefore: false,
        keepSuspended: false,
        dropAtOrigin: false,
        ignoreKeyMismatch: false,
      },
      actor,
    )) as { id: string };
    expect(await originJobs()).toEqual(['done']);
    const done = (await migrations.get(m.id)) as { phases: { name: string; status: string }[] };
    expect(done.phases.find((p) => p.name === 'virar')?.status).toBe('pulada');
    const [here] = await ownerQuery<{ status: string }>(
      `SELECT status FROM tenants WHERE id = $1`,
      [fx.tenantB],
    );
    expect(here!.status).toBe('provisioned');
    const [there] = await q<{ status: string }>(
      DEST_OWNER,
      `SELECT status FROM tenants WHERE id = $1`,
      [fx.tenantB],
    );
    expect(there!.status).toBe('suspended');
  });

  it('recusa um destino com a INTEGRATIONS_KEY diferente (sem mexer no restaurante)', async () => {
    const other = new PlatformReceiveService(
      testEnv({
        PLATFORM_DATABASE_URL: DEST_PLATFORM,
        INTEGRATIONS_KEY: randomBytes(32).toString('base64'),
      }),
      destDb,
      destDbs,
    );
    const h = await other.hello();
    expect(h.keyFingerprint).not.toBe((await receiver.hello()).keyFingerprint);
    const m = (await migrations.create(
      {
        tenantId: fx.tenantB,
        stackId,
        mode: 'move',
        targetSlug: 'outro-endereco',
        backupBefore: false,
        keepSuspended: false,
        dropAtOrigin: false,
        ignoreKeyMismatch: false,
      },
      actor,
    )) as { id: string };
    const run = await runQueuedDbJobs({
      integrationsKey: KEY,
      workDir: work,
      pgBin: PG_BIN,
      pollMs: 5,
      remote: () => ({ ...remote(), hello: () => other.hello() }),
    } as Partial<DbJobContext>);
    expect(run).toEqual(['failed']);
    const failed = (await migrations.get(m.id)) as { error: string };
    expect(failed.error).toMatch(/INTEGRATIONS_KEY/);
    const [t] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      fx.tenantB,
    ]);
    expect(t!.status).toBe('provisioned');
  });

  it('rotas de recebimento: só com o token, em admin.<domínio>, e o bloco chega cru', async () => {
    const app: INestApplication = await createApp(
      testEnv({
        DATABASE_URL: APP_URL,
        PLATFORM_DATABASE_URL: DEST_PLATFORM,
        INTEGRATIONS_KEY: KEY,
        COMANDOU_BASE_DOMAIN: 'destino.test',
      }),
      { logger: false },
    );
    await app.init();
    try {
      const http = request(app.getHttpServer());
      const { token } = await receiver.configure(true, destActor);
      const host = 'admin.destino.test';
      const auth = { Authorization: `Bearer ${token}`, 'X-Comandou-Request': '1' };
      await http.get('/api/v1/platform/receive/hello').set('Host', host).expect(403);
      await http
        .get('/api/v1/platform/receive/hello')
        .set('Host', 'loja.destino.test')
        .set(auth)
        .expect(404);
      const hello = await http
        .get('/api/v1/platform/receive/hello')
        .set('Host', host)
        .set(auth)
        .expect(200);
      expect(hello.body).toMatchObject({ ok: true, baseDomain: 'destino.test' });

      const data = Buffer.from('0123456789');
      const opened = await http
        .post('/api/v1/platform/receive')
        .set('Host', host)
        .set(auth)
        .send({
          code: 'MOV-2026-09999',
          tenantId: '7b0f5a8e-1111-4c2b-9a51-0d6f0a1b2c3d',
          slug: 'teste-http',
          name: 'Teste HTTP',
          targetSlug: 'teste-http',
          mode: 'copy',
          keepSuspended: true,
          previousStatus: 'provisioned',
          size: data.length,
          sha256: 'a'.repeat(64),
          chunkSize: 4 * 1024 * 1024,
          chunks: 1,
          migrations: knownMigrations().slice(0, 3),
          counts: {},
          central: {},
          source: { url: null, version: 'teste' },
        })
        .expect(201);
      await http
        .put(`/api/v1/platform/receive/${opened.body.id}/chunks/0`)
        .set('Host', host)
        .set(auth)
        .set('Content-Type', 'application/octet-stream')
        .send(data)
        .expect(200);
      const v = await http
        .get(`/api/v1/platform/receive/${opened.body.id}`)
        .set('Host', host)
        .set(auth)
        .expect(200);
      expect(v.body).toMatchObject({ status: 'receiving', received: [0] });
      await http
        .post(`/api/v1/platform/receive/${opened.body.id}/discard`)
        .set('Host', host)
        .set(auth)
        .expect(200);
    } finally {
      await app.close();
    }
  });
});
