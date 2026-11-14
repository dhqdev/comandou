import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { purgeTenantRows } from '../src/backup/tenant-copy';
import { demoMode, ensureDemoRestaurant, removeDemoRestaurant } from '../src/demo/demo';
import { FUMACA } from '../src/demo/fumaca';
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
    expect(n!.roles).toBe(7); // um usuário para cada papel
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

  it('Fumaça Burger: um ano de uso com tudo preenchido, WhatsApp ligado e sem item sem foto', async () => {
    const o = { ...opts, slug: 'fumaca-teste', emailDomain: 'fumaca-teste.comandou.test' };
    try {
      expect(
        await ensureDemoRestaurant({
          ...o,
          mode: 'reset',
          catalog: FUMACA,
          baseDomain: 'comandou.test',
        }),
      ).toBe('created');
      const [t] = await ownerQuery<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE slug = 'fumaca-teste'`,
      );
      expect(t!.name).toBe(FUMACA.name);
      const [n] = await ownerQuery<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM orders WHERE tenant_id = $1) AS orders,
                (SELECT count(DISTINCT status)::int FROM orders WHERE tenant_id = $1) AS statuses,
                (SELECT (max(created_at) - min(created_at)) > interval '360 days' FROM orders WHERE tenant_id = $1)::int AS year,
                (SELECT count(*)::int FROM products WHERE tenant_id = $1) AS products,
                (SELECT count(*)::int FROM products WHERE tenant_id = $1 AND image_id IS NULL) AS no_photo,
                (SELECT count(*)::int FROM stock_items WHERE tenant_id = $1 AND quantity < min_quantity) AS low,
                (SELECT count(*)::int FROM stock_items WHERE tenant_id = $1 AND quantity < 0) AS negative,
                (SELECT count(*)::int FROM orders WHERE tenant_id = $1 AND status = 'completed' AND paid_amount <> total) AS unpaid,
                (SELECT count(*)::int FROM cash_sessions WHERE tenant_id = $1 AND status = 'open') AS open_cash,
                (SELECT count(*)::int FROM product_reviews WHERE tenant_id = $1) AS reviews,
                (SELECT count(*)::int FROM product_photos WHERE tenant_id = $1) AS photos,
                (SELECT count(*)::int FROM store_chats WHERE tenant_id = $1) AS store_chats,
                (SELECT count(*)::int FROM message_outbox WHERE tenant_id = $1 AND status = 'sent') AS whatsapp_sent,
                (SELECT enabled::int FROM tenant_messaging_settings WHERE tenant_id = $1) AS whatsapp_on,
                (SELECT whatsapp_enabled::int FROM ai_agent_settings WHERE tenant_id = $1) AS agent_on,
                (SELECT count(*)::int FROM ai_customer_chats WHERE tenant_id = $1) AS agent_chats,
                (SELECT count(DISTINCT to_char(due_date, 'YYYY-MM'))::int FROM finance_entries WHERE tenant_id = $1) AS finance_months,
                (SELECT count(*)::int FROM loyalty_entries WHERE tenant_id = $1) AS loyalty,
                (SELECT count(*)::int FROM reservations WHERE tenant_id = $1) AS reservations,
                (SELECT count(*)::int FROM billing_invoices WHERE tenant_id = $1 AND status = 'paid') AS invoices,
                (SELECT count(*)::int FROM platform_tickets WHERE tenant_id = $1 AND state <> 'done') AS open_tickets,
                (SELECT count(*)::int FROM platform_support_messages WHERE tenant_id = $1) AS support`,
        [t!.id],
      );
      expect(n!.orders).toBeGreaterThan(10000);
      expect(n!.statuses).toBe(8);
      expect(n!.year).toBe(1);
      expect(n!.products).toBe(FUMACA.products.length);
      expect(n!.no_photo).toBe(0);
      expect(n!.low).toBe(FUMACA.lowStock.length);
      expect(n!.negative).toBe(0);
      expect(n!.unpaid).toBe(0);
      expect(n!.open_cash).toBe(1);
      expect(n!.reviews).toBeGreaterThan(200);
      expect(n!.photos).toBeGreaterThan(0);
      expect(n!.store_chats).toBeGreaterThan(0);
      expect(n!.whatsapp_sent).toBeGreaterThan(1000);
      expect(n!.whatsapp_on).toBe(1);
      expect(n!.agent_on).toBe(1);
      expect(n!.agent_chats).toBeGreaterThan(0);
      expect(n!.finance_months).toBeGreaterThanOrEqual(13);
      expect(n!.loyalty).toBeGreaterThan(0);
      expect(n!.reservations).toBeGreaterThan(0);
      expect(n!.invoices).toBe(12);
      expect(n!.open_tickets).toBe(0); // a esteira dos agentes nunca pega chamado da demonstração
      expect(n!.support).toBeGreaterThan(0);

      // Demonstração antiga sai; restaurante de verdade no mesmo endereço fica.
      expect(
        await removeDemoRestaurant({
          ownerUrl: OWNER_URL,
          slug: 'fumaca-teste',
          log: () => undefined,
        }),
      ).toBe('removed');
      expect(await ownerQuery(`SELECT 1 FROM tenants WHERE slug = 'fumaca-teste'`)).toHaveLength(0);
      await ownerQuery(
        `INSERT INTO tenants (slug, name, status) VALUES ('nao-demo-2', 'Cliente', 'provisioned')`,
      );
      expect(
        await removeDemoRestaurant({
          ownerUrl: OWNER_URL,
          slug: 'nao-demo-2',
          log: () => undefined,
        }),
      ).toBe('skipped');
      expect(
        await removeDemoRestaurant({
          ownerUrl: OWNER_URL,
          slug: 'nao-existe',
          log: () => undefined,
        }),
      ).toBe('absent');
    } finally {
      await ownerQuery(`DELETE FROM tenants WHERE slug = 'nao-demo-2'`);
      const [t] = await ownerQuery<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = 'fumaca-teste'`,
      );
      if (t) {
        const c = new Client({ connectionString: OWNER_URL });
        await c.connect();
        await purgeTenantRows(c, t.id, true);
        await c.end();
      }
    }
  }, 600_000);
  it('Casa Brasa antiga sem a marca de demonstração também sai; outro nome em "exemplo" fica', async () => {
    await ownerQuery(
      `INSERT INTO tenants (slug, name, status) VALUES ('exemplo', 'Casa Brasa', 'provisioned')`,
    );
    expect(
      await removeDemoRestaurant({ ownerUrl: OWNER_URL, slug: 'exemplo', log: () => undefined }),
    ).toBe('removed');
    await ownerQuery(
      `INSERT INTO tenants (slug, name, status) VALUES ('exemplo', 'Cliente de verdade', 'provisioned')`,
    );
    try {
      expect(
        await removeDemoRestaurant({ ownerUrl: OWNER_URL, slug: 'exemplo', log: () => undefined }),
      ).toBe('skipped');
    } finally {
      await ownerQuery(`DELETE FROM tenants WHERE slug = 'exemplo'`);
    }
  });
});
