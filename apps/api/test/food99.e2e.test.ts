import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ChannelCredentials } from '../src/integrations/channels/channel-credentials.service';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelOutboxService } from '../src/integrations/channels/channel-outbox.service';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
import { PLATFORM_URL, testEnv } from './env';
import { FOOD99_APP_ID, FOOD99_SECRET, Fake99FoodServer, food99Sample } from './fake-99food';
import { approveChannelStores, Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * 99Food de ponta a ponta (ADR 0015, Fase 11) pela camada Open Delivery da Plataforma Aberta,
 * contra uma 99Food falsa: token POR LOJA (`<App ID>_<loja>`), ligar a loja confere o vínculo,
 * polling com eventType/fromTime, pedido com dinheiro e troco, entrega própria (dispatch e
 * delivered), retirada no balcão (pickedUp) e o pedido de cancelamento do cliente respondido por
 * uma pessoa (acceptCancellation/denyCancellation).
 */
const HOST_A = 'nn-a.comandou.test';
const HOST_B = 'nn-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE = '1152921645439779073';
const OTHER = '1152921645439779999';
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let food: Fake99FoodServer;
let poller: ChannelPoller;
let inbox: ChannelInboxService;
let outbox: ChannelOutboxService;
let storeRef = '';
const cookies: Record<string, string> = {};

const hostOf = (who: string) => (who.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (method: 'post' | 'patch', w: string, url: string, body?: object) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body ?? {});

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

async function waitFor(check: () => Promise<boolean> | boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function cycle() {
  const s = await poller.tick();
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
  return s;
}

async function flush() {
  await waitFor(async () => {
    await outbox.deliver(fx.tenantA);
    const [r] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_outbox WHERE tenant_id = $1 AND status IN ('pending','sending')`,
      [fx.tenantA],
    );
    return r!.n === 0;
  });
}

const orderOf = async (externalId: string) => {
  const [o] = await ownerQuery<{
    id: string;
    status: string;
    total: string;
    discount: string;
    paid_amount: string;
    external_code: string;
    app_channel: string;
  }>(
    `SELECT o.id, o.status, o.total::text, o.discount::text, o.paid_amount::text, o.external_code,
            o.app_channel
       FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE o.tenant_id = $1 AND c.channel = '99food' AND c.external_id = $2`,
    [fx.tenantA, externalId],
  );
  return o!;
};

const ev = (n: number, type: string) =>
  food.push({
    eventId: `nn-ev-${type.toLowerCase()}-${n}`,
    eventType: type,
    orderId: `nn-${n}`,
    shop: STORE,
  });
const acked = (id: string) => food.events.filter((e) => e.eventId === id).every((e) => e.acked);
const verbs = (n: number) => food.actions.filter((a) => a.orderId === `nn-${n}`).map((a) => a.verb);
const status = (w: string, id: string, to: string) =>
  send('post', w, `/orders/${id}/status`, { to }).then((r) => {
    if (r.status !== 201) throw new Error(`${to}: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  });

async function newOrder(n: number, over: Parameters<typeof food99Sample>[0]) {
  food.orders.set(`nn-${n}`, food99Sample(over));
  ev(n, 'CREATED');
  await cycle();
  return orderOf(`nn-${n}`);
}

async function disputeOf(orderId: string) {
  const [d] = await ownerQuery<{ id: string; kind: string; status: string }>(
    `SELECT id, kind, status FROM channel_disputes WHERE order_id = $1`,
    [orderId],
  );
  return d!;
}

beforeAll(async () => {
  food = new Fake99FoodServer();
  await food.start();
  fx = await seedTwoTenants('nn');
  const [{ id: adminId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('food99@plataforma.test', 'Equipe', 'x', '\\x00') RETURNING id`,
  );
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      FOOD99_API_URL: food.base,
      INTEGRATIONS_KEY: KEY,
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      CHANNELS_POLL_MIN_SECONDS: '0',
      CHANNELS_LEASE_SECONDS: '5',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  poller = app.get(ChannelPoller);
  inbox = app.get(ChannelInboxService);
  outbox = app.get(ChannelOutboxService);
  await app
    .get(ChannelCredentials)
    .save('99food', { clientId: FOOD99_APP_ID, clientSecret: FOOD99_SECRET }, { adminId });
  cookies.adminA = await login(HOST_A, 'admin@nn-a.test');
  cookies.adminB = await login(HOST_B, 'admin@nn-b.test');
});

afterAll(async () => {
  await app?.close();
  await food?.stop();
  // As lojas deste arquivo saem do polling: os outros arquivos contam as credenciais do banco todo.
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('99Food: ligar a loja', () => {
  it('código só com números; loja sem vínculo com o app do Comandou vira um aviso simples', async () => {
    await send('post', 'adminA', '/channels/stores', { channel: '99food', storeId: 'abc' }).expect(
      400,
    );
    const r = await send('post', 'adminA', '/channels/stores', {
      channel: '99food',
      storeId: OTHER,
    }).expect(422);
    expect(r.body.message).toMatch(/não está vinculada ao Comandou na 99Food/);
  });

  it('loja vinculada liga (token da própria loja); outro restaurante não pega a mesma loja', async () => {
    food.bound.add(STORE);
    const r = await send('post', 'adminA', '/channels/stores', {
      channel: '99food',
      storeId: STORE,
      name: 'Loja 99 Centro',
    }).expect(201);
    await approveChannelStores();
    storeRef = r.body.id;
    expect(r.body).toMatchObject({ channel: '99food', store_id: STORE, receive_orders: false });
    await send('post', 'adminB', '/channels/stores', { channel: '99food', storeId: STORE }).expect(
      409,
    );
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, { receiveOrders: true }).expect(
      200,
    );
  });
});

describe('99Food: pedidos', () => {
  it('polling com tipos e janela; o pedido entra com dinheiro, troco e o localizador; ack depois de gravar', async () => {
    const o = await newOrder(1, { id: 'nn-1' });
    const poll = food.polls.at(-1)!;
    expect(poll.shop).toBe(STORE);
    expect(poll.query.getAll('eventType')).toContain('ORDER_CANCELLATION_REQUEST');
    expect(poll.query.get('fromTime')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(acked('nn-ev-created-1')).toBe(true);
    expect(food.acks.at(-1)).toEqual({
      shop: STORE,
      body: [{ id: 'nn-ev-created-1', eventType: 'CREATED', orderId: 'nn-1' }],
    });
    // 40 de itens + 6 de entrega + 2 de gorjeta − 3 do cupom da loja = 45. O cupom da 99 (5)
    // conta como pago no app; os 40 em dinheiro o entregador da loja recebe.
    expect(o).toMatchObject({
      status: 'awaiting',
      total: '45.00',
      discount: '3.00',
      paid_amount: '5.00',
      external_code: '4521',
      app_channel: '99food',
    });
    const d = await get('adminA', `/orders/${o.id}`).expect(200);
    expect(JSON.stringify(d.body)).toContain('12345678');
  });

  it('aceitar e pronto viram as chamadas da 99Food, com o token da loja', async () => {
    const o = await orderOf('nn-1');
    await status('adminA', o.id, 'new');
    await status('adminA', o.id, 'in_production');
    await status('adminA', o.id, 'ready');
    await flush();
    // Sem "em preparo" na 99Food: o Comandou não manda.
    expect(verbs(1)).toEqual(['confirm', 'readyForPickup']);
    const confirm = food.actions.find((a) => a.orderId === 'nn-1' && a.verb === 'confirm')!;
    expect(confirm.shop).toBe(STORE);
    expect(confirm.body).toMatchObject({ orderExternalCode: expect.any(String) });
  });

  it('retirada no balcão: concluir avisa a 99Food com o pickedUp', async () => {
    const o = await newOrder(2, {
      id: 'nn-2',
      displayId: '4522',
      type: 'TAKEOUT',
      delivery: undefined,
      takeout: { takeoutDateTime: new Date().toISOString() },
      extraInfo: 'código de retirada: 6795',
      payments: { methods: [{ value: 40, type: 'PREPAID', method: 'PIX' }] },
    });
    await status('adminA', o.id, 'new');
    await status('adminA', o.id, 'ready');
    await status('adminA', o.id, 'completed');
    await flush();
    expect(verbs(2)).toEqual(['confirm', 'readyForPickup', 'pickedUp']);
  });

  it('o cliente pede para cancelar: uma pessoa nega (saiu para entrega) e a 99Food encerra', async () => {
    const o = await newOrder(3, { id: 'nn-3', displayId: '4523' });
    await status('adminA', o.id, 'new');
    ev(3, 'ORDER_CANCELLATION_REQUEST');
    await cycle();
    const d = await disputeOf(o.id);
    expect(d).toMatchObject({ kind: 'CANCELLATION', status: 'open' });
    await send('post', 'adminA', `/channels/disputes/${d.id}/decision`, {
      decision: 'reject',
      reason: 'O pedido já saiu para entrega',
    }).expect(200);
    await flush();
    const deny = food.actions.find((a) => a.orderId === 'nn-3' && a.verb === 'denyCancellation');
    expect(deny!.body).toEqual({
      reason: 'O pedido já saiu para entrega',
      code: 'OUT_FOR_DELIVERY',
    });
    ev(3, 'CANCELLED_DENIED');
    await cycle();
    expect((await disputeOf(o.id)).status).toBe('settled');
    expect((await orderOf('nn-3')).status).toBe('new');
  });

  it('o cliente pede para cancelar: aceitar manda o acceptCancellation e o CANCELLED cancela', async () => {
    const o = await newOrder(4, { id: 'nn-4', displayId: '4524' });
    await status('adminA', o.id, 'new');
    ev(4, 'ORDER_CANCELLATION_REQUEST');
    await cycle();
    const d = await disputeOf(o.id);
    await send('post', 'adminA', `/channels/disputes/${d.id}/decision`, {
      decision: 'accept',
    }).expect(200);
    await flush();
    expect(verbs(4)).toEqual(['confirm', 'acceptCancellation']);
    ev(4, 'CANCELLED');
    await cycle();
    expect((await orderOf('nn-4')).status).toBe('cancelled');
  });

  it('token da loja vencido: pede outro e segue; 99Food fora do ar não faz ack nem perde o evento', async () => {
    food.expireTokens();
    const before = food.tokensIssued;
    food.orders.set('nn-5', food99Sample({ id: 'nn-5', displayId: '4525' }));
    ev(5, 'CREATED');
    food.failNext.poll!.push(503);
    const s = await poller.tick();
    expect(s.events).toBe(0);
    expect(acked('nn-ev-created-5')).toBe(false);
    await cycle();
    expect((await orderOf('nn-5')).status).toBe('awaiting');
    expect(acked('nn-ev-created-5')).toBe(true);
    expect(food.tokensIssued).toBeGreaterThan(before);
  });
});
