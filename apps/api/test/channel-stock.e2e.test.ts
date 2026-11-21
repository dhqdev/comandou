import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ChannelRegistry } from '../src/integrations/channels/channel-adapter';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelMetrics } from '../src/integrations/channels/channel-metrics';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
import { ChannelStoresService } from '../src/integrations/channels/channel-stores.service';
import { testEnv } from './env';
import { FAKE_CHANNEL, FakeChannelAdapter, FakeChannelServer, sampleOrder } from './fake-channel';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Pedido de aplicativo com a ficha técnica sem estoque: entra do mesmo jeito (o cliente já pediu e
 * pagou no aplicativo), sem a baixa, e os gerentes recebem o aviso. E pedido de aplicativo não
 * rende pontos no programa de fidelidade da loja.
 */
const HOST_A = 'chs-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE = 'loja-estoque';
const PHONE = '11955551234';

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let fake: FakeChannelServer;
let poller: ChannelPoller;
let inbox: ChannelInboxService;
let storeId = '';
let stockItem = '';
let cookie = '';

const get = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie);
const send = (method: 'post' | 'patch', url: string, body: object = {}) =>
  http[method](`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie).set(CSRF).send(body);

async function waitFor(check: () => Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Polling + tratamento até não sobrar evento pendente (o que a varredura faria). */
async function cycle() {
  await poller.tick();
  await waitFor(async () => {
    await inbox.process(fx.tenantA);
    const [r] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM channel_inbox
        WHERE tenant_id = $1 AND status = 'pending'
          AND (next_attempt_at <= now() OR last_error IS NULL)`,
      [fx.tenantA],
    );
    return r!.n === 0;
  });
}

/** Pedido do aplicativo (retirada, com o X-Burguer da loja) e o id dele no Comandou. */
async function arrive(id: string) {
  fake.orders.set(
    id,
    sampleOrder(id, STORE, {
      linkedProductId: fx.prodA,
      fulfillment: 'takeout',
      customer: { name: 'Cliente do App', phone: PHONE, phoneLocator: '87654321' },
    }),
  );
  fake.push({ id: `ev-${id}`, kind: 'order.created', storeId: STORE, orderId: id });
  await cycle();
  const [o] = await ownerQuery<{ id: string; number: number; status: string }>(
    `SELECT o.id, o.number, o.status FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE c.external_id = $1`,
    [id],
  );
  return o;
}

beforeAll(async () => {
  fake = new FakeChannelServer();
  await fake.start();
  fx = await seedTwoTenants('chs');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      CHANNELS_POLL_MIN_SECONDS: '0',
      CHANNELS_LEASE_SECONDS: '5',
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  app.get(ChannelRegistry).register(new FakeChannelAdapter(fake, app.get(ChannelMetrics)));
  poller = app.get(ChannelPoller);
  inbox = app.get(ChannelInboxService);
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email: 'admin@chs-a.test', password: PASSWORD })
    .expect(200);
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  storeId = (
    await app.get(ChannelStoresService).connect(fx.tenantA, null, {
      channel: FAKE_CHANNEL,
      storeId: STORE,
      name: 'Loja do estoque',
      credential: `${FAKE_CHANNEL}:central`,
    })
  ).id;
  await send('patch', `/channels/stores/${storeId}`, {
    receiveOrders: true,
    autoAccept: true,
  }).expect(200);
  // Ficha técnica do X-Burguer: um pão por lanche, e o estoque zerado.
  const [s] = await ownerQuery<{ id: string }>(
    `INSERT INTO stock_items (tenant_id, name, unit, quantity) VALUES ($1, 'Pão de hambúrguer', 'un', 0)
     RETURNING id`,
    [fx.tenantA],
  );
  stockItem = s!.id;
  await ownerQuery(
    `INSERT INTO product_recipes (tenant_id, product_id, stock_item_id, quantity) VALUES ($1,$2,$3,1)`,
    [fx.tenantA, fx.prodA, stockItem],
  );
});
afterAll(async () => {
  await app?.close();
  await fake?.stop();
});

describe('Pedido de aplicativo sem estoque', () => {
  it('entra sem a baixa e os gerentes recebem o aviso', async () => {
    const o = await arrive('EST-1');
    expect(o).toMatchObject({ status: 'new' });
    expect(fake.acked('ev-EST-1')).toBe(true);
    const moves = await ownerQuery(`SELECT 1 FROM stock_movements WHERE order_id = $1`, [o!.id]);
    expect(moves).toHaveLength(0);
    const [item] = await ownerQuery<{ q: string }>(
      `SELECT quantity::text AS q FROM stock_items WHERE id = $1`,
      [stockItem],
    );
    expect(Number(item!.q)).toBe(0);
    const audit = await ownerQuery(
      `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'order.stock_short'`,
      [o!.id],
    );
    expect(audit).toHaveLength(1);
    const notices = await ownerQuery<{ title: string; body: string }>(
      `SELECT title, body FROM chat_notices WHERE tenant_id = $1 AND title LIKE $2`,
      [fx.tenantA, `Pedido #${o!.number} do aplicativo%`],
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toMatch(/Pão de hambúrguer/);
  });

  it('pedido em análise: o aceite também não trava por estoque', async () => {
    await send('patch', `/channels/stores/${storeId}`, { autoAccept: false }).expect(200);
    const o = await arrive('EST-2');
    expect(o).toMatchObject({ status: 'awaiting' });
    await send('post', `/orders/${o!.id}/status`, { to: 'new' }).expect(201);
    await send('patch', `/channels/stores/${storeId}`, { autoAccept: true }).expect(200);
  });

  it('com estoque, baixa normalmente', async () => {
    await ownerQuery(`UPDATE stock_items SET quantity = 10 WHERE id = $1`, [stockItem]);
    const o = await arrive('EST-3');
    const moves = await ownerQuery(`SELECT 1 FROM stock_movements WHERE order_id = $1`, [o!.id]);
    expect(moves).toHaveLength(1);
  });
});

describe('Fidelidade e pedido de aplicativo', () => {
  it('pedido de aplicativo com o celular de um cliente da loja não rende pontos', async () => {
    await send('patch', '/loyalty', {
      enabled: true,
      mode: 'points',
      pointsPerReal: '1.00',
      countStaffOrders: true,
    }).expect(200);
    const [c] = await ownerQuery<{ id: string }>(
      `INSERT INTO customers (tenant_id, name, phone, password_hash) VALUES ($1, 'Cliente do App', $2, 'x')
       RETURNING id`,
      [fx.tenantA, PHONE],
    );
    const o = await arrive('FID-1');
    for (const to of ['ready', 'completed'])
      await send('post', `/orders/${o!.id}/status`, { to }).expect(201);
    expect((await get(`/orders/${o!.id}`).expect(200)).body.status).toBe('completed');
    const earned = await ownerQuery(
      `SELECT 1 FROM loyalty_entries WHERE customer_id = $1 AND kind = 'earn'`,
      [c!.id],
    );
    expect(earned).toHaveLength(0);
  });
});
