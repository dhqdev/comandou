import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Controles que mexem com dinheiro no dia a dia: concluir só pago (ou "a receber" com motivo),
 * acerto do entregador no caixa, cancelar um item e taxa de serviço da comanda.
 */
const HOST_A = 'cx-a.comandou.test';
const HOST_B = 'cx-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `ct-key-${Date.now()}-${++seq}`;
let sessionId = '';

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
}
const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (
  method: 'post' | 'patch',
  w: string,
  url: string,
  body: object = {},
  idem?: string,
) => {
  const r = http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const post = (w: string, url: string, body: object = {}, idem?: string) =>
  send('post', w, url, body, idem);
const patch = (w: string, url: string, body: object) => send('patch', w, url, body);

async function addUser(email: string, role: string) {
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, role, await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
    fx.tenantA,
    u.id,
    role,
  ]);
}

const counterOrder = async (quantity = 1, extra: object = {}) =>
  (
    await post('adminA', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity }],
      ...extra,
    }).expect(201)
  ).body as {
    id: string;
    total: string;
    version: number;
    items: { id: string; status: string }[];
  };

beforeAll(async () => {
  fx = await seedTwoTenants('cx');
  await addUser('caixa@cx-a.test', 'cashier');
  await addUser('gerente@cx-a.test', 'manager');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@cx-a.test');
  cookies.adminB = await login(HOST_B, 'admin@cx-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@cx-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@cx-a.test');
  cookies.managerA = await login(HOST_A, 'gerente@cx-a.test');
  const reg = (await post('adminA', '/cash-registers', { name: 'Caixa CT' }).expect(201)).body;
  sessionId = (
    await post('cashierA', '/cash/sessions', { registerId: reg.id, openingAmount: '0.00' }).expect(
      201,
    )
  ).body.id;
});
afterAll(async () => {
  await app?.close();
});

describe('Concluir pedido sem pagamento', () => {
  it('recusa concluir com saldo; "a receber" só com motivo e com quem pode cancelar', async () => {
    const o = await counterOrder();
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const refused = await post('cashierA', `/orders/${o.id}/status`, { to: 'completed' });
    expect(refused.status).toBe(409);
    await post('cashierA', `/orders/${o.id}/status`, {
      to: 'completed',
      receivable: true,
      reason: 'Cliente da casa',
    }).expect(403);
    await post('managerA', `/orders/${o.id}/status`, {
      to: 'completed',
      receivable: true,
    }).expect(422);
    const done = (
      await post('managerA', `/orders/${o.id}/status`, {
        to: 'completed',
        receivable: true,
        reason: 'Cliente da casa',
      }).expect(201)
    ).body;
    expect(done).toMatchObject({ status: 'completed', receivableReason: 'Cliente da casa' });
    expect(done.receivableAt).toBeTruthy();
    const open = (await get('adminA', '/orders?openBalance=true').expect(200)).body as {
      id: string;
    }[];
    expect(open.map((x) => x.id)).toContain(o.id);
    // Pago antes, conclui normal.
    const p = await counterOrder();
    await post('adminA', `/orders/${p.id}/status`, { to: 'ready' }).expect(201);
    await post(
      'cashierA',
      `/orders/${p.id}/payments`,
      { cashSessionId: sessionId, method: 'pix', amount: p.total },
      key(),
    ).expect(201);
    const after = (await get('cashierA', `/orders/${p.id}`).expect(200)).body;
    if (after.status !== 'completed')
      await post('cashierA', `/orders/${p.id}/status`, { to: 'completed' }).expect(201);
  });
});

describe('Acerto do entregador', () => {
  it('entrega concluída com saldo vira acerto pendente; o caixa recebe uma vez só', async () => {
    const courier = (await post('adminA', '/couriers', { name: 'Moto CT' }).expect(201)).body;
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua CT, 1',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as { id: string; total: string };
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const d = (await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier.id })).body
      .delivery as { id: string };
    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d.id],
    );
    await post('adminA', `/deliveries/${d.id}/complete`, { code, method: 'cash' }).expect(201);
    const groups = (await get('cashierA', '/deliveries/collections').expect(200)).body as {
      courierId: string;
      total: string;
      deliveries: { id: string; collectAmount: string; collectMethod: string }[];
    }[];
    const g = groups.find((x) => x.courierId === courier.id)!;
    expect(g.total).toBe(o.total);
    expect(g.deliveries[0]).toMatchObject({
      id: d.id,
      collectAmount: o.total,
      collectMethod: 'cash',
    });
    await get('waiterA', '/deliveries/collections').expect(403);
    await get('adminB', '/deliveries/collections')
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));

    await post('cashierA', `/deliveries/${d.id}/settle`, { cashSessionId: sessionId }).expect(422);
    const k = key();
    await post('cashierA', `/deliveries/${d.id}/settle`, { cashSessionId: sessionId }, k).expect(
      201,
    );
    // Reenvio com a mesma chave não paga duas vezes; outra chave é recusada.
    await post('cashierA', `/deliveries/${d.id}/settle`, { cashSessionId: sessionId }, k).expect(
      201,
    );
    await post(
      'cashierA',
      `/deliveries/${d.id}/settle`,
      { cashSessionId: sessionId },
      key(),
    ).expect(409);
    const order = (await get('cashierA', `/orders/${o.id}`).expect(200)).body;
    expect(order).toMatchObject({ status: 'completed', paymentStatus: 'paid' });
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({ method: 'cash', amount: o.total });
    const left = (await get('cashierA', '/deliveries/collections').expect(200)).body as {
      courierId: string;
    }[];
    expect(left.find((x) => x.courierId === courier.id)).toBeUndefined();
  });
});

describe('Cancelar um item do pedido', () => {
  it('gerente cancela com motivo; total recalculado; último item não cancela', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [
          { productId: fx.prodA, quantity: 1 },
          { productId: fx.prodA, quantity: 2 },
        ],
      }).expect(201)
    ).body as { id: string; total: string; items: { id: string; total: string }[] };
    const [a, b] = o.items;
    await post('cashierA', `/orders/${o.id}/items/${a.id}/cancel`, {
      reason: 'Saiu errado',
    }).expect(403);
    await post('adminB', `/orders/${o.id}/items/${a.id}/cancel`, { reason: 'Outro' }).expect(404);
    const r = (
      await post('managerA', `/orders/${o.id}/items/${a.id}/cancel`, {
        reason: 'Cliente desistiu',
      }).expect(201)
    ).body;
    expect(r.total).toBe(b.total);
    const item = r.items.find((i: { id: string }) => i.id === a.id);
    expect(item).toMatchObject({ status: 'cancelled', cancelReason: 'Cliente desistiu' });
    await post('managerA', `/orders/${o.id}/items/${a.id}/cancel`, { reason: 'De novo' }).expect(
      409,
    );
    await post('managerA', `/orders/${o.id}/items/${b.id}/cancel`, { reason: 'Tudo' }).expect(409);
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'order.item_cancelled' AND entity_id = $1`,
      [o.id],
    );
    expect(audit.n).toBe(1);
  });

  it('não deixa o total ficar abaixo do que já foi pago', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [
          { productId: fx.prodA, quantity: 1 },
          { productId: fx.prodA, quantity: 1 },
        ],
      }).expect(201)
    ).body as { id: string; total: string; items: { id: string }[] };
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: sessionId, method: 'pix', amount: o.total },
      key(),
    ).expect(201);
    await post('managerA', `/orders/${o.id}/items/${o.items[0].id}/cancel`, {
      reason: 'Saiu errado',
    }).expect(409);
  });
});

describe('Editar pedido', () => {
  it('acrescenta, muda quantidade e tira itens numa vez só; total refeito', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [
          { productId: fx.prodA, quantity: 1 },
          { productId: fx.prodA, quantity: 2 },
        ],
      }).expect(201)
    ).body as {
      id: string;
      version: number;
      total: string;
      items: { id: string; unitPrice: string; quantity: string }[];
    };
    const a = o.items.find((i) => i.quantity === '1.000')!;
    const b = o.items.find((i) => i.quantity === '2.000')!;
    const unit = Number(a.unitPrice);
    // Garçom não edita; caixa acrescenta mas não tira; outro restaurante não enxerga.
    await patch('waiterA', `/orders/${o.id}/items`, {
      add: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(403);
    await patch('cashierA', `/orders/${o.id}/items`, { remove: [a.id] }).expect(403);
    await patch('cashierA', `/orders/${o.id}/items`, {
      change: [{ itemId: b.id, quantity: 1 }],
    }).expect(403);
    await patch('adminB', `/orders/${o.id}/items`, { remove: [a.id] }).expect(404);
    // Versão velha: recusa.
    await patch('managerA', `/orders/${o.id}/items`, {
      expectedVersion: o.version + 5,
      notes: 'x',
    }).expect(409);

    const r = (
      await patch('managerA', `/orders/${o.id}/items`, {
        expectedVersion: o.version,
        remove: [a.id],
        change: [{ itemId: b.id, quantity: 3, notes: 'bem passado' }],
        add: [{ productId: fx.prodA, quantity: 2, notes: 'para viagem' }],
        notes: 'Cliente pediu pressa',
      }).expect(200)
    ).body as {
      total: string;
      subtotal: string;
      notes: string;
      items: { id: string; status: string; quantity: string; notes: string | null }[];
    };
    expect(Number(r.subtotal)).toBeCloseTo(unit * 5, 2);
    expect(Number(r.total)).toBeCloseTo(unit * 5, 2);
    expect(r.notes).toBe('Cliente pediu pressa');
    expect(r.items.find((i) => i.id === a.id)?.status).toBe('cancelled');
    expect(r.items.find((i) => i.id === b.id)).toMatchObject({
      quantity: '3.000',
      notes: 'bem passado',
    });
    expect(r.items.filter((i) => i.status !== 'cancelled')).toHaveLength(2);

    // Não deixa o pedido sem itens.
    const live = r.items.filter((i) => i.status !== 'cancelled').map((i) => i.id);
    await patch('managerA', `/orders/${o.id}/items`, { remove: live }).expect(409);
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'order.edited' AND entity_id = $1`,
      [o.id],
    );
    expect(audit.n).toBe(1);
  });

  it('item que a cozinha já fez: aumentar vira item novo e o pedido volta para a produção', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as { id: string; items: { id: string }[] };
    const it0 = o.items[0];
    await post('adminA', `/kitchen/items/${it0.id}/ready`).expect(201);
    expect((await get('adminA', `/orders/${o.id}`).expect(200)).body.status).toBe('ready');
    const r = (
      await patch('cashierA', `/orders/${o.id}/items`, {
        change: [{ itemId: it0.id, quantity: 3 }],
      }).expect(200)
    ).body as { status: string; items: { id: string; quantity: string; status: string }[] };
    expect(r.status).toBe('in_production');
    expect(r.items.find((i) => i.id === it0.id)).toMatchObject({
      quantity: '1.000',
      status: 'ready',
    });
    const extra = r.items.find((i) => i.id !== it0.id);
    expect(extra).toMatchObject({ quantity: '2.000', status: 'pending' });
  });

  it('caixa acrescenta item; não edita pedido pago acima do novo total nem pedido concluído', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 2 }],
      }).expect(201)
    ).body as { id: string; total: string; items: { id: string }[] };
    const more = (
      await patch('cashierA', `/orders/${o.id}/items`, {
        add: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(200)
    ).body as { total: string; paymentStatus: string };
    expect(Number(more.total)).toBeCloseTo((Number(o.total) * 3) / 2, 2);
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: more.total },
      key(),
    ).expect(201);
    const item = o.items[0];
    await patch('managerA', `/orders/${o.id}/items`, {
      change: [{ itemId: item.id, quantity: 1 }],
    }).expect(409);
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await post('adminA', `/orders/${o.id}/status`, { to: 'completed' }).expect(201);
    await patch('managerA', `/orders/${o.id}/items`, {
      add: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(409);
  });
});

describe('Taxa de serviço', () => {
  it('padrão do salão entra na comanda nova; dá para tirar e recolocar', async () => {
    await patch('cashierA', '/salon/settings', { serviceFeePercent: '10' }).expect(403);
    await patch('adminA', '/salon/settings', { serviceFeePercent: '31' }).expect(400);
    await patch('adminA', '/salon/settings', { serviceFeePercent: '10' }).expect(200);
    expect((await get('waiterA', '/salon/settings').expect(200)).body.serviceFeePercent).toBe(
      '10.00',
    );
    const table = (await post('adminA', '/tables', { label: 'CT-1' }).expect(201)).body;
    const o = (
      await post('waiterA', '/orders', {
        channel: 'table',
        tableId: table.id,
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as { tabId: string; subtotal: string; surcharge: string; total: string };
    // 10% de 25,90 = 2,59
    expect(o.subtotal).toBe('25.90');
    expect(o.surcharge).toBe('2.59');
    expect(o.total).toBe('28.49');
    const tab = (await get('waiterA', `/tabs/${o.tabId}`).expect(200)).body;
    expect(tab).toMatchObject({ serviceFeePercent: '10.00', serviceFee: '2.59', total: '28.49' });

    await post('waiterA', `/tabs/${o.tabId}/service-fee`, { percent: null }).expect(403);
    const off = (
      await post('cashierA', `/tabs/${o.tabId}/service-fee`, { percent: null }).expect(201)
    ).body;
    expect(off).toMatchObject({ serviceFeePercent: null, total: '25.90' });
    const on = (
      await post('cashierA', `/tabs/${o.tabId}/service-fee`, { percent: '12.5' }).expect(201)
    ).body;
    expect(on).toMatchObject({ total: '29.14' }); // 25,90 + 3,24
    await patch('adminA', '/salon/settings', { serviceFeePercent: '0' }).expect(200);
  });
});
