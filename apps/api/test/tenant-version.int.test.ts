import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, tenantDatabaseName } from '../src/database/tenant-database';
import { PlatformDb } from '../src/platform/platform-db.service';
import { PlatformDatabasesService } from '../src/platform/platform-databases.service';
import type { Actor } from '../src/platform/platform.service';
import { PlatformVersionsService } from '../src/platform/platform-versions.service';
import type { ServerAgentClient } from '../src/platform/server-agent.service';
import { APP_URL, OWNER_URL, PLATFORM_URL, testEnv } from './env';
import { ownerQuery, PASSWORD, runQueuedDbJobs } from './fixtures';

/**
 * Versão por restaurante (docs/versao-por-cliente.md): o restaurante fica na versão dele quando o
 * sistema principal atualiza, só muda pelo painel (na hora ou agendado), o trabalho "upgrade"
 * migra só o banco dele, e o provider do Traefik sabe a versão de cada endereço.
 */
const env = testEnv({ PLATFORM_DATABASE_URL: PLATFORM_URL, COMANDOU_VERSION: 'v0.200.0' });
const platformDb = new PlatformDb(env);
const dbs = new PlatformDatabasesService(env, platformDb);

/** Agente de mentira: guarda as versões que pediram para manter no ar. */
const agentCalls: string[] = [];
let agentFails = false;
const agent = {
  enabled: true,
  async call(method: string, path: string) {
    agentCalls.push(`${method} ${path}`);
    if (agentFails) throw new Error('agente fora');
    if (method === 'GET') return { versions: [{ version: 'v0.199.0', ready: true, services: [] }] };
    return {};
  },
} as unknown as ServerAgentClient;
const versions = new PlatformVersionsService(env, platformDb, agent);
let actor: Actor;
let tenantId: string;

const appRoutes = async () => {
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  try {
    return (
      await c.query<{ hostname: string; app_version: string | null; custom: boolean }>(
        `SELECT * FROM app_tenant_routes() WHERE hostname = 'tst-versao'`,
      )
    ).rows;
  } finally {
    await c.end();
  }
};

beforeAll(async () => {
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('versao@plataforma.test', 'Admin Versão', 'x', '\\x00') RETURNING id`,
  );
  actor = { admin: { id, email: 'versao@plataforma.test', name: 'Admin Versão', sessionId: id } };
  tenantId = await dbs.create(
    {
      slug: 'tst-versao',
      name: 'Versão',
      adminEmail: 'a@versao.test',
      adminName: 'A',
      adminPassword: PASSWORD,
    },
    actor,
  );
  expect(await runQueuedDbJobs()).toEqual(['done']);
});

afterAll(async () => {
  await platformDb.onModuleDestroy();
});

describe('Versão por restaurante', () => {
  it('restaurante novo acompanha o sistema principal', async () => {
    const v = await versions.info(tenantId);
    expect(v).toMatchObject({ version: 'v0.200.0', main: 'v0.200.0', separable: true });
    expect(await appRoutes()).toEqual([
      { hostname: 'tst-versao', app_version: null, custom: false },
    ]);
  });

  it('antes de o sistema atualizar, quem acompanha fica preso na versão atual', async () => {
    agentFails = true;
    await expect(versions.holdBeforeSystemUpdate('v0.201.0', actor)).rejects.toThrow(
      'Não consegui manter a v0.200.0',
    );
    // Falhou ao subir a cópia: desfaz e o restaurante segue acompanhando.
    expect((await versions.info(tenantId)).version).toBe('v0.200.0');
    expect((await appRoutes())[0]!.app_version).toBeNull();

    agentFails = false;
    agentCalls.length = 0;
    const r = await versions.holdBeforeSystemUpdate('v0.201.0', actor);
    expect(r.held).toBeGreaterThanOrEqual(1);
    expect(agentCalls).toContain('POST /v1/versions/v0.200.0');
    expect((await appRoutes())[0]!.app_version).toBe('v0.200.0');
  });

  it('com o principal mais novo, mostra a versão anterior e atualiza só pelo painel', async () => {
    // Simula o restaurante numa versão anterior à principal.
    await ownerQuery(`UPDATE tenants SET app_version = 'v0.199.0' WHERE id = $1`, [tenantId]);
    expect(await versions.info(tenantId)).toMatchObject({
      version: 'v0.199.0',
      main: 'v0.200.0',
      scheduled: null,
    });
    const s = await versions.schedule(
      tenantId,
      new Date(Date.now() + 3600_000).toISOString(),
      actor,
    );
    expect(s.scheduled).toMatchObject({ to: 'v0.200.0' });
    // Ainda não venceu: nada acontece.
    await versions.runDue();
    expect(await runQueuedDbJobs()).toEqual([]);
    // Vence: vira um trabalho de atualização, executado pelo serviço de backup.
    await ownerQuery(
      `UPDATE tenants SET app_update_at = now() - interval '1 minute' WHERE id = $1`,
      [tenantId],
    );
    await versions.runDue();
    expect(await runQueuedDbJobs()).toEqual(['done']);
    const v = await versions.info(tenantId);
    expect(v).toMatchObject({ version: 'v0.200.0', scheduled: null });
    expect(v.lastUpgrade).toMatchObject({ status: 'done' });
    await expect(versions.upgrade(tenantId, actor)).rejects.toThrow('já está na v0.200.0');
    // O banco dele segue com todas as migrações (e funcionando).
    const c = new Client({
      connectionString: databaseUrl(OWNER_URL, tenantDatabaseName('tst-versao')),
    });
    await c.connect();
    const { rows } = await c.query(
      `SELECT 1 FROM schema_migrations WHERE version = '0062_versao_por_cliente.sql'`,
    );
    await c.end();
    expect(rows.length).toBe(1);
  });

  it('atualizar agora cria o trabalho e audita; agendamento pode ser cancelado', async () => {
    await ownerQuery(`UPDATE tenants SET app_version = 'v0.199.0' WHERE id = $1`, [tenantId]);
    await versions.schedule(tenantId, new Date(Date.now() + 3600_000).toISOString(), actor);
    expect((await versions.schedule(tenantId, null, actor)).scheduled).toBeNull();
    const v = await versions.upgrade(tenantId, actor);
    expect(v.lastUpgrade).toMatchObject({ status: 'queued' });
    await expect(versions.upgrade(tenantId, actor)).rejects.toThrow('trabalho em andamento');
    expect(await runQueuedDbJobs()).toEqual(['done']);
    expect((await versions.info(tenantId)).version).toBe('v0.200.0');
    const audit = await ownerQuery<{ action: string }>(
      `SELECT action FROM platform_audit_log WHERE tenant_id = $1 AND action LIKE 'platform.tenant_version.%'`,
      [tenantId],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'platform.tenant_version.scheduled',
        'platform.tenant_version.unscheduled',
        'platform.tenant_version.upgrade',
      ]),
    );
  });

  it('a versão anterior sai do ar quando nenhum restaurante usa mais', async () => {
    agentCalls.length = 0;
    await versions.prune();
    // O agente informou v0.199.0 no ar e ninguém está nela.
    expect(agentCalls).toContain('DELETE /v1/versions/v0.199.0');
  });

  it('restaurante no banco central não é separado', async () => {
    const [t] = await ownerQuery<{ id: string }>(
      `SELECT t.id FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_databases d WHERE d.tenant_id = t.id) LIMIT 1`,
    );
    if (!t) return;
    const v = await versions.info(t.id);
    expect(v.separable).toBe(false);
    expect(v.reason).toContain('banco central');
  });
});
