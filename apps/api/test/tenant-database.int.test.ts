import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { SharedDatabaseRouter, TenantDatabaseRouter } from '../src/database/tenant-database';
import { testEnv } from './env';
import { Fixture, seedTwoTenants } from './fixtures';

let fx: Fixture;
const db = new DatabaseService(testEnv());

beforeAll(async () => {
  fx = await seedTwoTenants('tdb');
});
afterAll(async () => {
  await db.onModuleDestroy();
});

describe('Banco de cada restaurante (ponto único)', () => {
  it('hoje todo restaurante usa o banco compartilhado', () => {
    expect(db.router).toBeInstanceOf(SharedDatabaseRouter);
    expect(db.router.poolFor(fx.tenantA)).toBe(db.pool);
    expect(db.router.poolFor(fx.tenantB)).toBe(db.pool);
    expect(db.router.locationOf(fx.tenantA)).toBe('shared');
  });

  it('withTenant pede o pool ao roteador com o restaurante da transação', async () => {
    const spy = vi.spyOn(db.router, 'poolFor');
    const tenant = await db.withTenant({ tenantId: fx.tenantA }, async (tx) => {
      const r = await tx.execute(sql`SELECT current_setting('app.tenant_id', true) AS t`);
      return (r.rows[0] as { t: string }).t;
    });
    expect(spy).toHaveBeenCalledWith(fx.tenantA);
    expect(tenant).toBe(fx.tenantA);
    spy.mockRestore();
  });

  it('um roteador com pool próprio por restaurante isola as conexões', async () => {
    // Simula o futuro banco dedicado: o restaurante A ganha um pool separado (mesmo banco de
    // teste, conexão diferente). O B segue no compartilhado.
    const dedicated = new Pool({ connectionString: testEnv().DATABASE_URL, max: 1 });
    const router: TenantDatabaseRouter = {
      poolFor: (id) => (id === fx.tenantA ? dedicated : db.pool),
      locationOf: (id) => (id === fx.tenantA ? 'dedicated' : 'shared'),
    };
    const routed = Object.assign(Object.create(DatabaseService.prototype) as DatabaseService, {
      pool: db.pool,
      router,
    });
    const pid = (id: string) =>
      routed.withTenant({ tenantId: id }, async (tx) => {
        const r = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        return (r.rows[0] as { pid: number }).pid;
      });
    try {
      const a1 = await pid(fx.tenantA);
      const a2 = await pid(fx.tenantA);
      expect(a1).toBe(a2); // pool dedicado de 1 conexão: sempre a mesma
      expect(dedicated.totalCount).toBe(1);
      await pid(fx.tenantB);
      expect(dedicated.totalCount).toBe(1); // B não tocou no pool de A
    } finally {
      await dedicated.end();
    }
  });
});
