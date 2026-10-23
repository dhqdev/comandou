import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { purgeTenantRows } from '../src/backup/tenant-copy';
import { demoMode, ensureDemoRestaurant } from '../src/demo/demo';
import { OWNER_URL } from './env';
import { ownerQuery } from './fixtures';

const slug = 'demo-teste';
const opts = {
  ownerUrl: OWNER_URL,
  slug,
  emailDomain: 'demo-teste.comandou.test',
  databaseMode: 'shared' as const,
  log: () => undefined,
};

async function tenantId() {
  const r = await ownerQuery<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  return r[0]?.id;
}

describe('Restaurante de demonstração', () => {
  afterAll(async () => {
    const id = await tenantId();
    if (!id) return;
    const c = new Client({ connectionString: OWNER_URL });
    await c.connect();
    await purgeTenantRows(c, id, true);
    await c.end();
  });

  it('lê a variável COMANDOU_DEMO', () => {
    expect(demoMode(undefined)).toBe('off');
    expect(demoMode('false')).toBe('off');
    expect(demoMode('true')).toBe('on');
    expect(demoMode('SIM')).toBe('on');
    expect(demoMode('reset')).toBe('reset');
  });

  it('cria uma vez com dados consistentes e não duplica ao subir de novo', async () => {
    expect(await ensureDemoRestaurant({ ...opts, mode: 'on' })).toBe('created');
    const id = (await tenantId())!;
    const [n] = await ownerQuery<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM orders WHERE tenant_id = $1) AS orders,
              (SELECT count(DISTINCT status)::int FROM orders WHERE tenant_id = $1) AS statuses,
              (SELECT count(DISTINCT m.role)::int FROM memberships m WHERE m.tenant_id = $1) AS roles,
              (SELECT count(*)::int FROM products WHERE tenant_id = $1 AND image_id IS NULL) AS no_photo,
              (SELECT count(*)::int FROM stock_items WHERE tenant_id = $1 AND quantity < min_quantity) AS low,
              (SELECT count(*)::int FROM orders WHERE tenant_id = $1 AND status = 'completed' AND paid_amount <> total) AS unpaid,
              (SELECT count(*)::int FROM cash_sessions WHERE tenant_id = $1 AND status = 'open') AS open_cash,
              (SELECT count(*)::int FROM delivery_zones WHERE tenant_id = $1) AS zones,
              (SELECT value::int FROM tenant_counters WHERE tenant_id = $1 AND name = 'order') AS counter,
              (SELECT max(number) FROM orders WHERE tenant_id = $1) AS max_number`,
      [id],
    );
    expect(n!.orders).toBeGreaterThan(500);
    expect(n!.statuses).toBe(8); // todas as situações de pedido aparecem
    expect(n!.roles).toBe(10); // um usuário para cada papel
    expect(n!.no_photo).toBe(0);
    expect(n!.low).toBe(3);
    expect(n!.unpaid).toBe(0);
    expect(n!.open_cash).toBe(1);
    expect(n!.zones).toBe(3);
    expect(n!.counter).toBe(n!.max_number);
    // Fechamento de caixa confere com o livro-razão.
    const wrong = await ownerQuery(
      `SELECT s.id FROM cash_sessions s
        WHERE s.tenant_id = $1 AND s.status = 'closed'
          AND (s.expected->>'cash')::numeric <> (SELECT COALESCE(sum(amount), 0) FROM cash_movements m
                                                WHERE m.cash_session_id = s.id AND m.method = 'cash')`,
      [id],
    );
    expect(wrong).toHaveLength(0);

    expect(await ensureDemoRestaurant({ ...opts, mode: 'on' })).toBe('exists');
    const [again] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1`,
      [id],
    );
    expect(again!.n).toBe(n!.orders);
  }, 120_000);

  it('reset recria do zero e nunca mexe num restaurante que não é de demonstração', async () => {
    const before = await tenantId();
    expect(await ensureDemoRestaurant({ ...opts, mode: 'reset' })).toBe('created');
    const after = await tenantId();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    await ownerQuery(
      `INSERT INTO tenants (slug, name, status) VALUES ('nao-demo', 'Cliente', 'provisioned')`,
    );
    try {
      expect(await ensureDemoRestaurant({ ...opts, slug: 'nao-demo', mode: 'reset' })).toBe(
        'skipped',
      );
      const [t] = await ownerQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM orders o JOIN tenants t ON t.id = o.tenant_id WHERE t.slug = 'nao-demo'`,
      );
      expect(t!.n).toBe(0);
    } finally {
      await ownerQuery(`DELETE FROM tenants WHERE slug = 'nao-demo'`);
    }
  }, 120_000);
});
