import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { fromCents, splitCents, toCents } from '@pedemais/shared';
import type { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 3: adicionais, pedidos, cozinha, salão, caixa, pagamentos, estornos, relatórios e
 * tempo real — sempre pela API HTTP real, com dois restaurantes para checar isolamento.
 */
const HOST_A = 'ops-a.pedemais.test';
const HOST_B = 'ops-b.pedemais.test';
const CSRF = { 'X-PedeMais-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let port: number;
const cookies: Record<string, string> = {};
let keySeq = 0;
const key = () => `test-key-${Date.now()}-${++keySeq}`;

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('pm_sid='))!.split(';')[0];
}

type Who = 'adminA' | 'adminB' | 'waiterA' | 'kitchenA' | 'cashierA';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]);
const post = (w: Who, url: string, body: object = {}, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const patch = (w: Who, url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);
const put = (w: Who, url: string, body: object) =>
  http.put(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);

// Cadastros compartilhados entre os testes (restaurante A).
let sector: { id: string };
let sizeGroup: { id: string; options: { id: string; name: string; priceDelta: string }[] };
let extrasGroup: { id: string; options: { id: string; name: string; priceDelta: string }[] };
let table1: { id: string };
let table2: { id: string };
let register: { id: string };
let session: { id: string };
let sessionB: { id: string };

async function addUser(tenantId: string, email: string, role: string) {
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, role, await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
    tenantId,
    u.id,
    role,
  ]);
}

beforeAll(async () => {
  fx = await seedTwoTenants('ops');
  await addUser(fx.tenantA, 'cozinha@ops-a.test', 'kitchen');
  await addUser(fx.tenantA, 'caixa@ops-a.test', 'cashier');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@ops-a.test');
  cookies.adminB = await login(HOST_B, 'admin@ops-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@ops-a.test');
  cookies.kitchenA = await login(HOST_A, 'cozinha@ops-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@ops-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Cadastros operacionais e adicionais', () => {
  it('cria setor, mesas e terminal de caixa (garçom não pode)', async () => {
    await post('waiterA', '/sectors', { name: 'Chapa' }).expect(403);
    sector = (
      await post('adminA', '/sectors', { name: 'Chapa', warnAfterMin: 5, lateAfterMin: 10 }).expect(
        201,
      )
    ).body;
    table1 = (await post('adminA', '/tables', { label: '1' }).expect(201)).body;
    table2 = (await post('adminA', '/tables', { label: '2' }).expect(201)).body;
    register = (await post('adminA', '/cash-registers', { name: 'Caixa 1' }).expect(201)).body;
    await post('adminA', '/tables', { label: '1' }).expect(409);
    await patch('adminA', `/products/${fx.prodA}`, { sectorId: sector.id }).expect(200);
  });

  it('cria variação (1 obrigatória) e adicionais (0 a 2) e vincula ao produto', async () => {
    sizeGroup = (
      await post('adminA', '/option-groups', {
        name: 'Tamanho',
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'Simples' }, { name: 'Duplo', priceDelta: '8.00' }],
      }).expect(201)
    ).body;
    extrasGroup = (
      await post('adminA', '/option-groups', {
        name: 'Adicionais',
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: 'Bacon', priceDelta: '4.50' },
          { name: 'Ovo', priceDelta: '2.00' },
          { name: 'Queijo', priceDelta: '3.00' },
        ],
      }).expect(201)
    ).body;
    await post('adminA', '/option-groups', { name: 'X', minSelect: 3, maxSelect: 1 }).expect(400);
    await put('adminA', `/products/${fx.prodA}/option-groups`, {
      groupIds: [sizeGroup.id, extrasGroup.id],
    }).expect(200);
    const menu = (await get('waiterA', '/menu').expect(200)).body as {
      products: { id: string; optionGroups: unknown[] }[];
    }[];
    const p = menu.flatMap((c) => c.products).find((x) => x.id === fx.prodA)!;
    expect(p.optionGroups).toHaveLength(2);
  });

  it('restaurante B não vê nem vincula grupos de A', async () => {
    const groupsB = (await get('adminB', '/option-groups').expect(200)).body as unknown[];
    expect(groupsB).toHaveLength(0);
    await put('adminB', `/products/${fx.prodB}/option-groups`, { groupIds: [sizeGroup.id] }).expect(
      422,
    );
    await put('adminB', `/products/${fx.prodA}/option-groups`, { groupIds: [] }).expect(404);
  });
});

const byName = (g: typeof sizeGroup, n: string) => g.options.find((o) => o.name === n)!.id;

describe('Pedidos', () => {
  it('preço vem do banco: produto + opções × quantidade; ignora preço enviado', async () => {
    const r = await post('waiterA', '/orders', {
      channel: 'counter',
      items: [
        {
          productId: fx.prodA,
          quantity: 2,
          optionIds: [byName(sizeGroup, 'Duplo'), byName(extrasGroup, 'Bacon')],
          unitPrice: '0.01',
        },
      ],
    }).expect(201);
    // (25.90 + 8.00 + 4.50) × 2 = 76.80
    expect(r.body.subtotal).toBe('76.80');
    expect(r.body.total).toBe('76.80');
    expect(r.body.status).toBe('new');
    expect(r.body.paymentStatus).toBe('unpaid');
    expect(r.body.items[0].options).toHaveLength(2);
    expect(r.body.items[0].sectorId).toBe(sector.id);
    expect(r.body.history[0].to).toBe('new');
  });

  it('valida mínimo/máximo e opções de outro produto', async () => {
    await post('waiterA', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(422);
    await post('waiterA', '/orders', {
      channel: 'counter',
      items: [
        {
          productId: fx.prodA,
          quantity: 1,
          optionIds: [byName(sizeGroup, 'Simples'), ...extrasGroup.options.map((o) => o.id)],
        },
      ],
    }).expect(422);
    await post('adminB', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodB, quantity: 1, optionIds: [byName(extrasGroup, 'Ovo')] }],
    }).expect(422);
    await post('adminB', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(422);
  });

  it('Idempotency-Key: repetir devolve o mesmo pedido; corpo diferente → 422; concorrência cria um só', async () => {
    const body = {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
    };
    const k = key();
    const a = await post('waiterA', '/orders', body, k).expect(201);
    const b = await post('waiterA', '/orders', body, k).expect(201);
    expect(b.body.id).toBe(a.body.id);
    await post('waiterA', '/orders', { ...body, notes: 'outro' }, k).expect(422);

    const k2 = key();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('waiterA', '/orders', body, k2)),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
    const [{ n }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM idempotency_keys WHERE key = $1`,
      [k2],
    );
    expect(n).toBe(1);
  });

  it('desconto acima de 10% exige gerente; total nunca abaixo do pago', async () => {
    const items = [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }];
    await post('waiterA', '/orders', { channel: 'counter', discount: '5.00', items }).expect(403);
    const okW = await post('waiterA', '/orders', {
      channel: 'counter',
      discount: '2.59',
      items,
    }).expect(201);
    expect(okW.body.total).toBe('23.31');
    const r = await post('adminA', '/orders', {
      channel: 'counter',
      discount: '5.90',
      surcharge: '1.00',
      items,
    }).expect(201);
    expect(r.body.total).toBe('21.00');
    await patch('waiterA', `/orders/${r.body.id}/adjustments`, {
      discount: '20.00',
      reason: 'cortesia',
    }).expect(403);
    const adj = await patch('adminA', `/orders/${r.body.id}/adjustments`, {
      discount: '0.00',
      surcharge: '0.00',
      reason: 'revisão',
    }).expect(200);
    expect(adj.body.total).toBe('25.90');
  });

  it('máquina de estados: transição inválida → 409; versão desatualizada → 409; dispatched só delivery', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    await post('waiterA', `/orders/${o.id}/status`, { to: 'completed' }).expect(409);
    await post('waiterA', `/orders/${o.id}/status`, {
      to: 'ready',
      expectedVersion: o.version + 5,
    }).expect(409);
    await post('waiterA', `/orders/${o.id}/status`, {
      to: 'ready',
      expectedVersion: o.version,
    }).expect(201);
    await post('waiterA', `/orders/${o.id}/status`, { to: 'dispatched' }).expect(409);
    await post('waiterA', `/orders/${o.id}/status`, { to: 'cancelled', reason: 'teste' }).expect(
      403,
    );
    await post('adminA', `/orders/${o.id}/status`, { to: 'cancelled' }).expect(422);
    const c = await post('adminA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'cliente desistiu',
    }).expect(201);
    expect(c.body.status).toBe('cancelled');
    expect(c.body.items.every((i: { status: string }) => i.status === 'cancelled')).toBe(true);
    expect(c.body.history.map((h: { to: string }) => h.to)).toEqual(['new', 'ready', 'cancelled']);
  });

  it('B não lê nem altera pedido de A', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    await get('adminB', `/orders/${o.id}`).expect(404);
    await post('adminB', `/orders/${o.id}/status`, { to: 'ready' }).expect(404);
    const listB = (await get('adminB', '/orders').expect(200)).body as unknown[];
    expect(listB).toHaveLength(0);
  });
});

describe('Cozinha (KDS)', () => {
  it('itens avançam o pedido automaticamente; reabrir exige permissão e motivo', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [
          { productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] },
          { productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Duplo')] },
        ],
      }).expect(201)
    ).body;
    const board = (await get('kitchenA', `/kitchen?sectorId=${sector.id}`).expect(200)).body;
    expect(board.lateAfterMin).toBe(10);
    expect(board.orders.some((x: { id: string }) => x.id === o.id)).toBe(true);
    const [i1, i2] = o.items as { id: string }[];
    await post('waiterA', `/kitchen/items/${i1.id}/start`).expect(403);
    expect(
      (await post('kitchenA', `/kitchen/items/${i1.id}/start`).expect(201)).body.orderStatus,
    ).toBe('in_production');
    await post('kitchenA', `/kitchen/items/${i1.id}/start`).expect(409);
    await post('kitchenA', `/kitchen/items/${i1.id}/ready`).expect(201);
    expect(
      (await post('kitchenA', `/kitchen/items/${i2.id}/ready`).expect(201)).body.orderStatus,
    ).toBe('ready');
    await post('kitchenA', `/kitchen/items/${i2.id}/reopen`, { reason: 'refazer' }).expect(403);
    await post('adminA', `/kitchen/items/${i2.id}/reopen`).expect(422);
    expect(
      (
        await post('adminA', `/kitchen/items/${i2.id}/reopen`, { reason: 'ponto errado' }).expect(
          201,
        )
      ).body.orderStatus,
    ).toBe('in_production');
    const bump = await post('kitchenA', `/kitchen/orders/${o.id}/bump`, {
      to: 'ready',
      sectorId: sector.id,
    }).expect(201);
    expect(bump.body.orderStatus).toBe('ready');
  });

  it('kitchen de B não mexe em item de A', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    await post('adminB', `/kitchen/items/${o.items[0].id}/start`).expect(404);
    await post('adminB', `/kitchen/orders/${o.id}/bump`, { to: 'ready' }).expect(404);
  });
});

describe('Caixa e pagamentos', () => {
  it('pagamento sem caixa aberto ou sem Idempotency-Key é recusado', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: register.id, method: 'pix', amount: '1.00' },
      key(),
    ).expect(404);
    session = (
      await post('cashierA', '/cash/sessions', {
        registerId: register.id,
        openingAmount: '100.00',
      }).expect(201)
    ).body;
    await post('cashierA', '/cash/sessions', {
      registerId: register.id,
      openingAmount: '0.00',
    }).expect(409);
    await post('cashierA', `/orders/${o.id}/payments`, {
      cashSessionId: session.id,
      method: 'pix',
      amount: '1.00',
    }).expect(422);
    await post(
      'waiterA',
      `/orders/${o.id}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '1.00' },
      key(),
    ).expect(403);
  });

  it('pagamento parcial, troco, saldo e status financeiro separado do operacional', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 2, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    expect(o.total).toBe('51.80');
    const p1 = await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: session.id, method: 'cash', amount: '20.00', tendered: '50.00' },
      key(),
    ).expect(201);
    expect(p1.body.change).toBe('30.00');
    expect(p1.body.order.paymentStatus).toBe('partial');
    expect(p1.body.order.status).toBe('new');
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '31.81' },
      key(),
    ).expect(409);
    const p2 = await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '31.80' },
      key(),
    ).expect(201);
    expect(p2.body.order.paymentStatus).toBe('paid');
    expect(p2.body.order.balance).toBe('0.00');
    // Com pagamento, cancelar exige estorno antes.
    await post('adminA', `/orders/${o.id}/status`, { to: 'cancelled', reason: 'teste' }).expect(
      409,
    );
  });

  it('concorrência: dois pagamentos simultâneos do saldo inteiro → só um passa', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    const body = { cashSessionId: session.id, method: 'pix', amount: o.total };
    const rs = await Promise.all([
      post('cashierA', `/orders/${o.id}/payments`, body, key()),
      post('cashierA', `/orders/${o.id}/payments`, body, key()),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const [{ paid, n }] = await ownerQuery<{ paid: string; n: number }>(
      `SELECT o.paid_amount::text AS paid, (SELECT count(*)::int FROM payments p WHERE p.order_id = o.id) AS n FROM orders o WHERE o.id = $1`,
      [o.id],
    );
    expect(paid).toBe(o.total);
    expect(n).toBe(1);
  });

  it('concorrência: mesma chave repetida em paralelo → um único pagamento', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    const k = key();
    const body = { cashSessionId: session.id, method: 'debit', amount: '10.00' };
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => post('cashierA', `/orders/${o.id}/payments`, body, k)),
    );
    const ok = rs.filter((r) => r.status === 201);
    expect(new Set(ok.map((r) => r.body.payment.id)).size).toBe(1);
    const [{ n }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM payments WHERE order_id = $1`,
      [o.id],
    );
    expect(n).toBe(1);
  });

  it('estorno: exige permissão, limita ao disponível, gera movimento negativo e reabre saldo', async () => {
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    const pay = (
      await post(
        'cashierA',
        `/orders/${o.id}/payments`,
        { cashSessionId: session.id, method: 'credit', amount: '25.90' },
        key(),
      ).expect(201)
    ).body.payment;
    await post(
      'cashierA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: session.id, amount: '5.00', reason: 'erro' },
      key(),
    ).expect(403);
    await post(
      'adminA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: session.id, amount: '30.00', reason: 'erro' },
      key(),
    ).expect(409);
    const r1 = await post(
      'adminA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: session.id, amount: '10.00', reason: 'item errado' },
      key(),
    ).expect(201);
    expect(r1.body.order.paidAmount).toBe('15.90');
    expect(r1.body.order.paymentStatus).toBe('partial');
    await post(
      'adminA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: session.id, amount: '15.91', reason: 'resto' },
      key(),
    ).expect(409);
    await post(
      'adminA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: session.id, amount: '15.90', reason: 'resto' },
      key(),
    ).expect(201);
    const c = await post('adminA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'estornado',
    }).expect(201);
    expect(c.body.payments[0].refundedAmount).toBe('25.90');
    // Pagamento original continua registrado (nada é apagado).
    const [{ amount }] = await ownerQuery<{ amount: string }>(
      `SELECT amount::text FROM payments WHERE id = $1`,
      [pay.id],
    );
    expect(amount).toBe('25.90');
    // B não estorna pagamento de A.
    sessionB = { id: (await ownerQuery<{ id: string }>(`SELECT gen_random_uuid() AS id`))[0].id };
    await post(
      'adminB',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: sessionB.id, amount: '1.00', reason: 'invasão' },
      key(),
    ).expect(404);
  });

  it('aplicação não altera nem apaga registros financeiros', async () => {
    const { Client } = await import('pg');
    const { APP_URL } = await import('./env');
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(c.query(`UPDATE payments SET amount = 1`)).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
      for (const sql of [
        `DELETE FROM payments`,
        `UPDATE cash_movements SET amount = 1`,
        `DELETE FROM cash_movements`,
        `DELETE FROM payment_refunds`,
        `UPDATE order_items SET unit_price = 0`,
        `DELETE FROM order_status_history`,
      ]) {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
        await expect(c.query(sql)).rejects.toThrow(/permission denied/);
        await c.query('ROLLBACK');
      }
    } finally {
      await c.end();
    }
  });
});

describe('Salão: mesas, comandas, transferência e divisão de conta', () => {
  let tabId = '';
  it('pedido de mesa abre a comanda; segundo pedido entra na mesma', async () => {
    const o1 = (
      await post('waiterA', '/orders', {
        channel: 'table',
        tableId: table1.id,
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    const o2 = (
      await post('waiterA', '/orders', {
        channel: 'table',
        tableId: table1.id,
        items: [{ productId: fx.prodA, quantity: 2, optionIds: [byName(sizeGroup, 'Duplo')] }],
      }).expect(201)
    ).body;
    expect(o1.tabId).toBeTruthy();
    expect(o2.tabId).toBe(o1.tabId);
    tabId = o1.tabId;
    const tables = (await get('waiterA', '/tables').expect(200)).body as {
      id: string;
      tabId: string;
      tabTotal: string;
    }[];
    const t1 = tables.find((t) => t.id === table1.id)!;
    expect(t1.tabId).toBe(tabId);
    expect(t1.tabTotal).toBe('93.70'); // 25.90 + 2 × 33.90
    await post('waiterA', '/tabs', { tableId: table1.id }).expect(409);
    await post('waiterA', '/orders', {
      channel: 'table',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(422);
  });

  it('transferência de mesa: destino ocupado → 409; livre → ok', async () => {
    const other = (await post('waiterA', '/tabs', { tableId: table2.id }).expect(201)).body;
    await post('waiterA', `/tabs/${tabId}/transfer`, { tableId: table2.id }).expect(409);
    // Junta: move o pedido da comanda da mesa 2 (vazia) não se aplica; move um pedido da mesa 1 para a 2 e volta.
    const tab = (await get('waiterA', `/tabs/${tabId}`).expect(200)).body;
    const moved = await post('waiterA', `/orders/${tab.orders[0].id}/move`, {
      tabId: other.id,
    }).expect(201);
    expect(moved.body.tabId).toBe(other.id);
    await post('waiterA', `/orders/${tab.orders[0].id}/move`, { tabId }).expect(201);
    const [t3] = await ownerQuery<{ id: string }>(
      `INSERT INTO dining_tables (tenant_id, label) VALUES ($1,'3') RETURNING id`,
      [fx.tenantA],
    );
    const tr = await post('waiterA', `/tabs/${tabId}/transfer`, { tableId: t3.id }).expect(201);
    expect(tr.body.tableLabel).toBe('3');
    await post('adminA', `/tabs/${other.id}/close`).expect(201); // comanda vazia fecha
  });

  it('divide a conta em 3 partes, fecha só depois de pago e pronto', async () => {
    const tab = (await get('cashierA', `/tabs/${tabId}`).expect(200)).body;
    expect(tab.balance).toBe('93.70');
    const parts = splitCents(toCents(tab.balance), 3).map(fromCents);
    expect(parts).toEqual(['31.24', '31.23', '31.23']);
    await post(
      'cashierA',
      `/tabs/${tabId}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '93.71' },
      key(),
    ).expect(409);
    for (const [i, amount] of parts.entries()) {
      const r = await post(
        'cashierA',
        `/tabs/${tabId}/payments`,
        {
          cashSessionId: session.id,
          method: i === 0 ? 'cash' : 'credit',
          amount,
          ...(i === 0 ? { tendered: '40.00' } : {}),
        },
        key(),
      ).expect(201);
      if (i === 0) expect(r.body.change).toBe('8.76');
    }
    const paid = (await get('cashierA', `/tabs/${tabId}`).expect(200)).body;
    expect(paid.balance).toBe('0.00');
    expect(paid.paid).toBe('93.70');
    // Pedidos ainda na cozinha → não fecha.
    await post('cashierA', `/tabs/${tabId}/close`).expect(409);
    for (const o of paid.orders)
      await post('kitchenA', `/kitchen/orders/${o.id}/bump`, { to: 'ready' }).expect(201);
    const closed = await post('cashierA', `/tabs/${tabId}/close`).expect(201);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.orders.every((o: { status: string }) => o.status === 'completed')).toBe(
      true,
    );
    const tables = (await get('waiterA', '/tables').expect(200)).body as {
      label: string;
      tabId: string | null;
    }[];
    expect(tables.find((t) => t.label === '3')!.tabId).toBeNull();
  });

  it('pagamento de comanda por pedidos escolhidos', async () => {
    const o1 = (
      await post('waiterA', '/orders', {
        channel: 'table',
        tableId: table1.id,
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    const o2 = (
      await post('waiterA', '/orders', {
        channel: 'table',
        tableId: table1.id,
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Duplo')] }],
      }).expect(201)
    ).body;
    const r = await post(
      'cashierA',
      `/tabs/${o1.tabId}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '33.90', orderIds: [o2.id] },
      key(),
    ).expect(201);
    expect(r.body.payments).toHaveLength(1);
    expect(r.body.payments[0].orderId).toBe(o2.id);
    await post(
      'cashierA',
      `/tabs/${o1.tabId}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '1.00', orderIds: [o2.id] },
      key(),
    ).expect(422);
  });
});

describe('Fechamento de caixa', () => {
  it('sangria acima do dinheiro → 409; suprimento e sangria entram no esperado', async () => {
    const s = (await get('cashierA', `/cash/sessions/${session.id}`).expect(200)).body;
    const cash = toCents(s.expected.cash);
    await post(
      'cashierA',
      `/cash/sessions/${session.id}/movements`,
      { kind: 'withdrawal', amount: fromCents(cash + 1), note: 'sangria' },
      key(),
    ).expect(409);
    await post(
      'cashierA',
      `/cash/sessions/${session.id}/movements`,
      { kind: 'supply', amount: '50.00', note: 'troco' },
      key(),
    ).expect(201);
    await post(
      'cashierA',
      `/cash/sessions/${session.id}/movements`,
      { kind: 'withdrawal', amount: '30.00', note: 'cofre' },
      key(),
    ).expect(201);
    const s2 = (await get('cashierA', `/cash/sessions/${session.id}`).expect(200)).body;
    expect(toCents(s2.expected.cash)).toBe(cash + 2000);
    // 100 abertura + 20 + 31.24 + 50 − 30
    expect(s2.expected.cash).toBe('171.24');
  });

  it('fechamento: diferença exige observação; idempotente; caixa fechado recusa pagamentos', async () => {
    const s = (await get('cashierA', `/cash/sessions/${session.id}`).expect(200)).body;
    const counted = { ...s.expected, cash: fromCents(toCents(s.expected.cash) - 100) };
    await post('waiterA', `/cash/sessions/${session.id}/close`, { counted }, key()).expect(403);
    await post('cashierA', `/cash/sessions/${session.id}/close`, { counted }).expect(422);
    await post('cashierA', `/cash/sessions/${session.id}/close`, { counted }, key()).expect(422);
    const k = key();
    const [c1, c2] = await Promise.all([
      post('cashierA', `/cash/sessions/${session.id}/close`, { counted, note: 'faltou 1 real' }, k),
      post('cashierA', `/cash/sessions/${session.id}/close`, { counted, note: 'faltou 1 real' }, k),
    ]);
    expect([c1.status, c2.status]).toContain(201);
    const ok = [c1, c2].find((r) => r.status === 201)!;
    expect(ok.body.status).toBe('closed');
    expect(ok.body.difference).toBe('-1.00');
    await post(
      'cashierA',
      `/cash/sessions/${session.id}/close`,
      { counted, note: 'de novo' },
      key(),
    ).expect(409);
    const o = (
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
      }).expect(201)
    ).body;
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: session.id, method: 'pix', amount: '1.00' },
      key(),
    ).expect(409);
    await post(
      'cashierA',
      `/cash/sessions/${session.id}/movements`,
      { kind: 'supply', amount: '1.00', note: 'tarde' },
      key(),
    ).expect(409);
  });

  it('relatório separa faturamento de recebimentos', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    await get('waiterA', `/reports/sales?from=${from}&to=${to}`).expect(403);
    const r = (
      await get(
        'adminA',
        `/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ).expect(200)
    ).body;
    expect(Number(r.totals.revenue)).toBeGreaterThan(0);
    const credit = r.received.find((x: { method: string }) => x.method === 'credit');
    expect(credit.refunded).toBe('25.90');
    const rb = (
      await get(
        'adminB',
        `/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ).expect(200)
    ).body;
    expect(rb.totals.orders).toBe(0);
    expect(rb.received).toHaveLength(0);
  });
});

describe('Tempo real (WebSocket)', () => {
  const connect = (host: string, cookie?: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(`http://127.0.0.1:${port}`, {
        path: '/api/ws',
        transports: ['websocket'],
        extraHeaders: { Host: host, ...(cookie ? { Cookie: cookie } : {}) },
        reconnection: false,
        timeout: 3000,
      });
      s.on('ready', () => resolve(s));
      s.on('connect_error', (e) => reject(e));
    });

  it('sem sessão é recusado; sessão de A no host de B é recusada', async () => {
    await expect(connect(HOST_A)).rejects.toThrow(/unauthorized/);
    await expect(connect(HOST_B, cookies.adminA)).rejects.toThrow(/unauthorized/);
  });

  it('cada restaurante recebe só os próprios eventos, depois do commit', async () => {
    const sa = await connect(HOST_A, cookies.waiterA);
    const sb = await connect(HOST_B, cookies.adminB);
    const gotA: { type: string; orderId?: string }[] = [];
    const gotB: { type: string }[] = [];
    sa.on('event', (e) => gotA.push(e));
    sb.on('event', (e) => gotB.push(e));
    try {
      const o = (
        await post('waiterA', '/orders', {
          channel: 'counter',
          items: [{ productId: fx.prodA, quantity: 1, optionIds: [byName(sizeGroup, 'Simples')] }],
        }).expect(201)
      ).body;
      await new Promise((r) => setTimeout(r, 300));
      expect(gotA.some((e) => e.type === 'order.changed' && e.orderId === o.id)).toBe(true);
      expect(gotB).toHaveLength(0);
      // Pedido inválido (rollback) não gera evento.
      const before = gotA.length;
      await post('waiterA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(422);
      await new Promise((r) => setTimeout(r, 200));
      expect(gotA.length).toBe(before);
    } finally {
      sa.close();
      sb.close();
    }
  });
});
