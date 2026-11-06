import { afterAll, describe, expect, it } from 'vitest';
import { isDatabaseBusy } from '../src/common/http-exception.filter';
import { DatabaseService } from '../src/database/database.service';
import { TenantBusy } from '../src/database/tenant-limiter';
import { testEnv } from './env';

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';

/** Falha ou lentidão de um restaurante não pode travar o banco para os outros. */
const db = new DatabaseService(
  testEnv({
    DATABASE_POOL_MAX: '4',
    DATABASE_STATEMENT_TIMEOUT_MS: '300',
    DATABASE_CONNECT_TIMEOUT_MS: '1500',
    TENANT_MAX_CONCURRENT_TX: '2',
  }),
);
afterAll(() => db.onModuleDestroy());

describe('isolamento entre restaurantes no banco', () => {
  it('consulta lenta é cancelada pelo tempo limite e vira erro passageiro (503)', async () => {
    const err = await db
      .withTenant({ tenantId: T1 }, (tx) => tx.$client.query('SELECT pg_sleep(2)'))
      .catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('57014');
    expect(isDatabaseBusy(err)).toBe(true);
  });

  it('restaurante com consultas presas não ocupa as conexões do outro', async () => {
    const slow = Array.from({ length: 4 }, () =>
      db
        .withTenant({ tenantId: T1 }, (tx) => tx.$client.query('SELECT pg_sleep(0.25)'))
        .catch((e: unknown) => e),
    );
    // Pool de 4, mas T1 só pega 2: o T2 entra sem esperar o T1 terminar.
    const started = Date.now();
    const rows = await db.withTenant({ tenantId: T2 }, async (tx) => {
      const r = await tx.$client.query<{ t: string }>(
        "SELECT current_setting('app.tenant_id') AS t",
      );
      return r.rows;
    });
    expect(rows[0].t).toBe(T2);
    expect(Date.now() - started).toBeLessThan(200);
    const results = await Promise.all(slow);
    expect(results.every((r) => !(r instanceof Error))).toBe(true);
  });

  it('fila cheia de um restaurante desiste com 503 em vez de travar', async () => {
    const quick = new DatabaseService(
      testEnv({ DATABASE_CONNECT_TIMEOUT_MS: '100', TENANT_MAX_CONCURRENT_TX: '1' }),
    );
    try {
      const held = quick.withTenant({ tenantId: T1 }, (tx) =>
        tx.$client.query('SELECT pg_sleep(0.4)'),
      );
      await expect(quick.withTenant({ tenantId: T1 }, async () => 1)).rejects.toBeInstanceOf(
        TenantBusy,
      );
      await held;
    } finally {
      await quick.onModuleDestroy();
    }
  });

  it('teste de saúde responde mesmo com o pool principal cheio', async () => {
    const tiny = new DatabaseService(
      testEnv({ DATABASE_POOL_MAX: '1', TENANT_MAX_CONCURRENT_TX: '0' }),
    );
    try {
      const held = tiny.withTenant({ tenantId: T1 }, (tx) =>
        tx.$client.query('SELECT pg_sleep(0.5)'),
      );
      const started = Date.now();
      await expect(tiny.ping()).resolves.toBe(true);
      expect(Date.now() - started).toBeLessThan(400);
      await held;
    } finally {
      await tiny.onModuleDestroy();
    }
  });
});
