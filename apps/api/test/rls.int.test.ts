import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { APP_URL } from './env';
import { Fixture, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Testes de isolamento DIRETAMENTE no banco, com o papel da aplicação (pedemais_app).
 * Provam que o isolamento não depende só do código da API.
 */
let fx: Fixture;
const pool = new Pool({ connectionString: APP_URL, max: 1 }); // max 1: força reutilização da mesma conexão

async function asTenant<T>(tenantId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  fx = await seedTwoTenants('rls');
});
afterAll(async () => {
  await pool.end();
});

describe('RLS — papel da aplicação', () => {
  it('papel da aplicação não é superusuário, não tem BYPASSRLS e não é dono das tabelas', async () => {
    const [role] = await ownerQuery<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pedemais_app'`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await ownerQuery(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'pedemais_app'`,
    );
    expect(owned).toEqual([]);
  });

  it('todas as tabelas com tenant_id têm RLS habilitado', async () => {
    const rows = await ownerQuery<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
         JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'tenant_id'
        WHERE c.relkind = 'r' AND col.table_schema = 'public'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it('sem contexto de tenant, nenhuma linha é visível', async () => {
    await asTenant(null, async (c) => {
      for (const t of [
        'tenants',
        'users',
        'memberships',
        'sessions',
        'categories',
        'products',
        'audit_log',
      ]) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
        expect(rows[0].n, t).toBe(0);
      }
    });
  });

  it('com contexto A, só enxerga dados de A', async () => {
    const names = await asTenant(
      fx.tenantA,
      async (c) =>
        (await c.query<{ name: string; tenant_id: string }>('SELECT name, tenant_id FROM products'))
          .rows,
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((r) => r.tenant_id === fx.tenantA)).toBe(true);
    const tenants = await asTenant(
      fx.tenantA,
      async (c) => (await c.query('SELECT id FROM tenants')).rows,
    );
    expect(tenants).toEqual([{ id: fx.tenantA }]);
  });

  it('consulta direta por ID de outro tenant retorna vazio', async () => {
    const rows = await asTenant(
      fx.tenantA,
      async (c) => (await c.query('SELECT id FROM products WHERE id = $1', [fx.prodB])).rows,
    );
    expect(rows).toEqual([]);
  });

  it('não insere linha com tenant_id de outro restaurante (WITH CHECK)', async () => {
    await expect(
      asTenant(fx.tenantA, (c) =>
        c.query(`INSERT INTO categories (tenant_id, name) VALUES ($1, 'invasão')`, [fx.tenantB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('não altera nem move linhas de outro tenant', async () => {
    const res = await asTenant(fx.tenantA, (c) =>
      c.query(`UPDATE products SET price = 0 WHERE id = $1`, [fx.prodB]),
    );
    expect(res.rowCount).toBe(0);
    await expect(
      asTenant(fx.tenantA, (c) =>
        c.query(`UPDATE products SET tenant_id = $1 WHERE id = $2`, [fx.tenantB, fx.prodA]),
      ),
    ).rejects.toThrow(/row-level security/);
    const [b] = await ownerQuery<{ price: string }>('SELECT price FROM products WHERE id = $1', [
      fx.prodB,
    ]);
    expect(b.price).toBe('45.00');
  });

  it('desligar row_security não contorna as políticas', async () => {
    await expect(
      asTenant(fx.tenantA, async (c) => {
        await c.query('SET LOCAL row_security = off');
        await c.query('SELECT * FROM products');
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('aplicação não pode apagar nem alterar auditoria, nem excluir dados', async () => {
    await expect(asTenant(fx.tenantA, (c) => c.query('DELETE FROM audit_log'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant(fx.tenantA, (c) => c.query(`UPDATE audit_log SET action = 'x'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asTenant(fx.tenantA, (c) => c.query('DELETE FROM products'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('aplicação não acessa a tabela de provisionamento para escrita', async () => {
    await expect(
      asTenant(fx.tenantA, (c) =>
        c.query(
          `INSERT INTO tenant_provisioning_steps (tenant_id, step, status) VALUES ($1,'x','done')`,
          [fx.tenantA],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('Integridade entre tenants (FKs compostas)', () => {
  it('item de pedido de A não referencia produto de B, mesmo com tenant_id correto', async () => {
    await expect(
      asTenant(fx.tenantA, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO orders (tenant_id, number, channel) VALUES ($1, 1, 'counter') RETURNING id`,
          [fx.tenantA],
        );
        await c.query(
          `INSERT INTO order_items (tenant_id, order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,1,'45.00')`,
          [fx.tenantA, rows[0].id, fx.prodB],
        );
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it('nem o dono (que ignora RLS) consegue ligar produto de A a categoria de B', async () => {
    await expect(
      ownerQuery(
        `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,'x','1.00')`,
        [fx.tenantA, fx.catB],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('item de pedido válido dentro do mesmo tenant é aceito', async () => {
    await asTenant(fx.tenantA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO orders (tenant_id, number, channel) VALUES ($1, 2, 'counter') RETURNING id`,
        [fx.tenantA],
      );
      await c.query(
        `INSERT INTO order_items (tenant_id, order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,2,'25.90')`,
        [fx.tenantA, rows[0].id, fx.prodA],
      );
    });
  });
});

describe('Pool de conexões', () => {
  it('conexão reutilizada não preserva o contexto da transação anterior', async () => {
    const pidA = await asTenant(fx.tenantA, async (c) => {
      const n = (await c.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
      expect(n).toBeGreaterThan(0);
      return (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    });
    const c = await pool.connect();
    try {
      const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect(pid).toBe(pidA); // mesma conexão física
      const setting = (await c.query(`SELECT current_setting('app.tenant_id', true) AS s`)).rows[0]
        .s;
      expect(setting ?? '').toBe('');
      const n = (await c.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
      expect(n).toBe(0);
    } finally {
      c.release();
    }
  });
});

describe('Funções pré-autenticação', () => {
  it('app_find_login só retorna membros do tenant informado', async () => {
    const c = await pool.connect();
    try {
      const ok = await c.query('SELECT user_id FROM app_find_login($1, $2)', [
        fx.tenantA,
        'admin@rls-a.test',
      ]);
      expect(ok.rowCount).toBe(1);
      const cross = await c.query('SELECT user_id FROM app_find_login($1, $2)', [
        fx.tenantA,
        'admin@rls-b.test',
      ]);
      expect(cross.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });

  it('app_resolve_tenant não aceita domínio personalizado não verificado', async () => {
    await ownerQuery(
      `INSERT INTO tenant_domains (tenant_id, hostname) VALUES ($1, 'pedidos.rls-a.com.br')`,
      [fx.tenantA],
    );
    const c = await pool.connect();
    try {
      const r1 = await c.query('SELECT id FROM app_resolve_tenant(NULL, $1)', [
        'pedidos.rls-a.com.br',
      ]);
      expect(r1.rowCount).toBe(0);
      await ownerQuery(
        `UPDATE tenant_domains SET verified_at = now() WHERE hostname = 'pedidos.rls-a.com.br'`,
      );
      const r2 = await c.query('SELECT id FROM app_resolve_tenant(NULL, $1)', [
        'pedidos.rls-a.com.br',
      ]);
      expect(r2.rows).toEqual([{ id: fx.tenantA }]);
    } finally {
      c.release();
    }
  });
});
