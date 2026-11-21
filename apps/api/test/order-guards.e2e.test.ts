import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Travas do dia a dia que a auditoria pediu: não cobrar duas vezes o Pix que espera conferência,
 * comanda com pedido "a receber" que fecha, pedido de mesa que volta para a cozinha e precisa ser
 * levado de novo, taxa de serviço ao mover o pedido, dois estornos em dinheiro juntos, o garçom só
 * imprime o que enxerga, troco da conferência depois de estorno, dois primeiros pedidos na mesma
 * mesa livre e produto de categoria desligada.
 */
const HOST_A = 'og-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `og-key-${Date.now()}-${++seq}`;
/** Caixa P (sem troco inicial) e caixa R (com R$ 30,00 de troco). */
let sessionP = '';
let sessionR = '';

async function login(email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}
const get = (w: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookies[w]!);
const send = (
  method: 'post' | 'patch',
  w: string,
  url: string,
  body: object = {},
  idem?: string,
) => {
  const r = http[method](`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookies[w]!).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const post = (w: string, url: string, body: object = {}, idem?: string) =>
  send('post', w, url, body, idem);

type Order = { id: string; number: number; total: string; tabId: string | null };
const counterOrder = async () =>
  (
    await post('adminA', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(201)
  ).body as Order;
const pay = (o: Order, session: string, extra: object = {}) =>
  post(
    'adminA',
    `/orders/${o.id}/payments`,
    { cashSessionId: session, method: 'cash', amount: o.total, ...extra },
    key(),
  );
const newTable = async (label: string) =>
  (await post('adminA', '/tables', { label }).expect(201)).body.id as string;

beforeAll(async () => {
  fx = await seedTwoTenants('og');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login('admin@og-a.test');
  cookies.waiterA = await login('garcom@og-a.test');
  const open = async (name: string, openingAmount: string) => {
    const reg = (await post('adminA', '/cash-registers', { name }).expect(201)).body;
    return (
      await post('adminA', '/cash/sessions', { registerId: reg.id, openingAmount }).expect(201)
    ).body.id as string;
  };
  sessionP = await open('Caixa P', '0.00');
  sessionR = await open('Caixa R', '30.00');
});
afterAll(async () => {
  await app?.close();
});

describe('Pix do cardápio esperando conferência', () => {
  it('não recebe o pedido direto no caixa enquanto o comprovante espera', async () => {
    const o = await counterOrder();
    await ownerQuery(`UPDATE orders SET pix_status = 'submitted' WHERE id = $1`, [o.id]);
    const r = await pay(o, sessionP).expect(409);
    expect(r.body.message).toMatch(new RegExp(`pedido #${o.number} pelo Pix`));
    const after = (await get('adminA', `/orders/${o.id}`).expect(200)).body;
    expect(after.payments).toHaveLength(0);
  });

  it('não acerta com o entregador enquanto o comprovante espera', async () => {
    const courier = (await post('adminA', '/couriers', { name: 'Moto OG' }).expect(201)).body;
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua OG, 1',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as Order;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const d = (
      await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier.id }).expect(201)
    ).body.delivery as { id: string };
    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d.id],
    );
    await post('adminA', `/deliveries/${d.id}/complete`, { code, method: 'cash' }).expect(201);
    await ownerQuery(`UPDATE orders SET pix_status = 'submitted' WHERE id = $1`, [o.id]);
    const r = await post(
      'adminA',
      `/deliveries/${d.id}/settle`,
      { cashSessionId: sessionP },
      key(),
    ).expect(409);
    expect(r.body.message).toMatch(/pelo Pix/);
    expect((await get('adminA', `/orders/${o.id}`).expect(200)).body.payments).toHaveLength(0);
  });

  it('comprovante de pedido que já está pago: recusa aprovar (e explica o que fazer)', async () => {
    const o = await counterOrder();
    await pay(o, sessionP).expect(201);
    await ownerQuery(`UPDATE orders SET pix_status = 'submitted' WHERE id = $1`, [o.id]);
    const [r] = await ownerQuery<{ id: string }>(
      `INSERT INTO pix_receipts (tenant_id, order_id, content_type, bytes, size, amount)
       VALUES ($1, $2, 'image/png', '\\x00'::bytea, 1, $3) RETURNING id`,
      [fx.tenantA, o.id, o.total],
    );
    const res = await post(
      'adminA',
      `/orders/${o.id}/pix-receipts/${r!.id}/approve`,
      { cashSessionId: sessionP },
      key(),
    ).expect(409);
    expect(res.body.message).toMatch(/já está pago/);
    const after = (await get('adminA', `/orders/${o.id}`).expect(200)).body;
    expect(after.pixStatus).toBe('submitted');
  });
});

describe('Comanda com pedido "a receber"', () => {
  it('o "a receber" fica fora do saldo da mesa e a conta fecha', async () => {
    const tableId = await newTable('OG1');
    const tab = (await post('adminA', '/tabs', { tableId }).expect(201)).body;
    const order = async () =>
      (
        await post('adminA', '/orders', {
          channel: 'table',
          tabId: tab.id,
          items: [{ productId: fx.prodA, quantity: 1 }],
        }).expect(201)
      ).body as Order;
    const owed = await order();
    const paid = await order();
    for (const o of [owed, paid])
      await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await post('adminA', `/orders/${owed.id}/status`, {
      to: 'completed',
      receivable: true,
      reason: 'Cliente da casa',
    }).expect(201);
    const t = (await get('adminA', `/tabs/${tab.id}`).expect(200)).body;
    expect(t.balance).toBe(paid.total);
    await post(
      'adminA',
      `/tabs/${tab.id}/payments`,
      { cashSessionId: sessionP, method: 'pix', amount: t.balance },
      key(),
    ).expect(201);
    const closed = (await post('adminA', `/tabs/${tab.id}/close`).expect(201)).body;
    expect(closed.status).toBe('closed');
    // A dívida segue no pedido.
    const o = (await get('adminA', `/orders/${owed.id}`).expect(200)).body;
    expect(o).toMatchObject({ status: 'completed', paymentStatus: 'unpaid' });
  });

  it('pedido marcado como fiado não segura a conta e conclui como "a receber" ao fechar', async () => {
    const tableId = await newTable('OG1F');
    const tab = (await post('adminA', '/tabs', { tableId }).expect(201)).body;
    const fiado = (
      await post('adminA', '/orders', {
        channel: 'table',
        tabId: tab.id,
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as Order;
    await post('adminA', `/orders/${fiado.id}/status`, { to: 'ready' }).expect(201);
    await post('adminA', `/orders/${fiado.id}/fiado`, {
      name: 'Cliente da casa',
      phone: '11988887777',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }).expect(200);
    const t = (await get('adminA', `/tabs/${tab.id}`).expect(200)).body;
    expect(Number(t.balance)).toBe(0);
    const closed = (await post('adminA', `/tabs/${tab.id}/close`).expect(201)).body;
    expect(closed.status).toBe('closed');
    const o = (await get('adminA', `/orders/${fiado.id}`).expect(200)).body;
    expect(o).toMatchObject({ status: 'completed', paymentStatus: 'unpaid' });
    expect(o.receivableAt).toBeTruthy();
  });
});

describe('Pedido de mesa que volta para a cozinha', () => {
  it('item novo num pedido já entregue: ele volta para a lista de levar', async () => {
    const tableId = await newTable('OG2');
    const o = (
      await post('adminA', '/orders', {
        channel: 'table',
        tableId,
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body as Order;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const served = (await post('waiterA', `/orders/${o.id}/served`).expect(200)).body;
    expect(served.servedAt).toBeTruthy();
    const edited = (
      await send('patch', 'adminA', `/orders/${o.id}/items`, {
        add: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(200)
    ).body;
    expect(edited).toMatchObject({ status: 'in_production', servedAt: null });
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const toServe = (await get('waiterA', '/orders?toServe=true').expect(200)).body as {
      id: string;
    }[];
    expect(toServe.map((x) => x.id)).toContain(o.id);
  });
});

describe('Mover pedido entre comandas', () => {
  it('a taxa de serviço passa a ser a da comanda de destino', async () => {
    const withFee = (await post('adminA', '/tabs', {}).expect(201)).body;
    await post('adminA', `/tabs/${withFee.id}/service-fee`, { percent: '10' }).expect(201);
    const noFee = (await post('adminA', '/tabs', {}).expect(201)).body;
    const o = (
      await post('adminA', '/orders', {
        channel: 'table',
        tabId: noFee.id,
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    expect(o).toMatchObject({ surcharge: '0.00', total: '25.90' });
    const moved = (await post('adminA', `/orders/${o.id}/move`, { tabId: withFee.id }).expect(201))
      .body;
    expect(moved).toMatchObject({ surcharge: '2.59', total: '28.49' });
    const back = (await post('adminA', `/orders/${o.id}/move`, { tabId: noFee.id }).expect(201))
      .body;
    expect(back).toMatchObject({ surcharge: '0.00', total: '25.90' });
  });
});

describe('Estorno em dinheiro', () => {
  it('dois estornos juntos não tiram da gaveta mais do que ela tem', async () => {
    const payments: string[] = [];
    for (let i = 0; i < 2; i++) {
      const o = await counterOrder();
      payments.push((await pay(o, sessionP).expect(201)).body.payment.id);
    }
    // O caixa R tem só R$ 30,00: cabe um estorno de R$ 25,90, não dois.
    const res = await Promise.all(
      payments.map((id) =>
        post(
          'adminA',
          `/payments/${id}/refunds`,
          { cashSessionId: sessionR, amount: '25.90', reason: 'Cliente desistiu' },
          key(),
        ),
      ),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('Garçom e impressão', () => {
  it('conferência, via de entrega e reimpressão só dos pedidos que ele enxerga', async () => {
    const o = await counterOrder();
    await get('waiterA', `/orders/${o.id}`).expect(404);
    await get('waiterA', `/orders/${o.id}/receipt`).expect(404);
    await get('waiterA', `/orders/${o.id}/delivery-slip`).expect(404);
    await post('waiterA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(404);
    await get('adminA', `/orders/${o.id}/receipt`).expect(200);
  });
});

describe('Conferência depois de estorno', () => {
  it('o troco impresso é o do pagamento, não muda com o estorno', async () => {
    const o = await counterOrder();
    const p = (await pay(o, sessionP, { tendered: '50.00' }).expect(201)).body;
    expect(p.change).toBe('24.10');
    await post(
      'adminA',
      `/payments/${p.payment.id}/refunds`,
      { cashSessionId: sessionP, amount: '5.00', reason: 'Item faltou' },
      key(),
    ).expect(201);
    const text = (await get('adminA', `/orders/${o.id}/receipt`).expect(200)).body.text as string;
    const troco = text.split('\n').find((l) => l.includes('Troco'));
    expect(troco).toContain('24,10');
  });
});

describe('Mesa livre', () => {
  it('dois primeiros pedidos juntos na mesma mesa entram na mesma comanda', async () => {
    for (let i = 0; i < 4; i++) {
      const tableId = await newTable(`OGM${i}`);
      const res = await Promise.all(
        [1, 2].map(() =>
          post('adminA', '/orders', {
            channel: 'table',
            tableId,
            items: [{ productId: fx.prodA, quantity: 1 }],
          }),
        ),
      );
      expect(res.map((r) => r.status)).toEqual([201, 201]);
      expect(res[0]!.body.tabId).toBe(res[1]!.body.tabId);
    }
  });
});

describe('Categoria desligada', () => {
  it('produto de categoria desligada não entra no pedido', async () => {
    const [c] = await ownerQuery<{ id: string }>(
      `INSERT INTO categories (tenant_id, name, active) VALUES ($1, 'Sazonal', false) RETURNING id`,
      [fx.tenantA],
    );
    const [p] = await ownerQuery<{ id: string }>(
      `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1, $2, 'Quentão', '9.00') RETURNING id`,
      [fx.tenantA, c!.id],
    );
    const r = await post('adminA', '/orders', {
      channel: 'counter',
      items: [{ productId: p!.id, quantity: 1 }],
    }).expect(422);
    expect(r.body.message).toMatch(/saiu do cardápio/);
  });
});
