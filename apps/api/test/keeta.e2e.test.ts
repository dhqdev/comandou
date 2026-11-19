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
import { FakeKeetaServer, KEETA_CLIENT_ID, KEETA_SECRET, keetaSample } from './fake-keeta';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Keeta de ponta a ponta (ADR 0015, Fase 10) contra uma Keeta falsa que confere a assinatura de
 * toda chamada: ligar a loja faz o cadastro (merchantOnboarding), o polling vai uma loja por vez,
 * o pedido entra com os valores da Keeta, aceitar/pronto/cancelar viram as chamadas da Order API,
 * o pedido de reembolso do cliente é respondido por uma pessoa e o CANCELLED cancela.
 */
const HOST_A = 'kt-a.comandou.test';
const HOST_B = 'kt-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE = '900100';
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let keeta: FakeKeetaServer;
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
      WHERE o.tenant_id = $1 AND c.channel = 'keeta' AND c.external_id = $2`,
    [fx.tenantA, externalId],
  );
  return o!;
};

const ev = (n: number, type: string, id = `kt-ev-${type.toLowerCase()}-${n}`, metadata?: string) =>
  keeta.push({
    eventId: id,
    eventType: type,
    orderId: `kt-${n}`,
    merchant: STORE,
    ...(metadata ? { metadata } : {}),
  });

beforeAll(async () => {
  keeta = new FakeKeetaServer();
  await keeta.start();
  fx = await seedTwoTenants('kt');
  const [{ id: adminId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('keeta@plataforma.test', 'Equipe', 'x', '\\x00') RETURNING id`,
  );
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      KEETA_API_URL: keeta.base,
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
    .save('keeta', { clientId: KEETA_CLIENT_ID, clientSecret: KEETA_SECRET }, { adminId });
  cookies.adminA = await login(HOST_A, 'admin@kt-a.test');
  cookies.adminB = await login(HOST_B, 'admin@kt-b.test');
});

afterAll(async () => {
  await app?.close();
  await keeta?.stop();
  // As lojas deste arquivo saem do polling: os outros arquivos contam as credenciais do banco todo.
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('Keeta: ligar a loja', () => {
  it('código só com números; a Keeta recusando vira um aviso simples', async () => {
    await send('post', 'adminA', '/channels/stores', { channel: 'keeta', storeId: 'abc' }).expect(
      400,
    );
    await send('post', 'adminA', '/channels/stores', { channel: 'aiqfome', storeId: '1' }).expect(
      400,
    );
    keeta.failNext.onboarding!.push(403);
    const r = await send('post', 'adminA', '/channels/stores', {
      channel: 'keeta',
      storeId: STORE,
    }).expect(422);
    expect(r.body.message).toMatch(/não autorizou o Comandou/);
    expect(keeta.onboarded.size).toBe(0);
  });

  it('liga a loja com o cadastro na Keeta (assinado); outro restaurante não pega a mesma loja', async () => {
    const r = await send('post', 'adminA', '/channels/stores', {
      channel: 'keeta',
      storeId: STORE,
      name: 'Loja Keeta Centro',
    }).expect(201);
    storeRef = r.body.id;
    expect(r.body).toMatchObject({ channel: 'keeta', store_id: STORE, receive_orders: false });
    expect(keeta.onboarded.get(STORE)).toBe(900100);
    expect(keeta.badSignatures).toBe(0);
    await send('post', 'adminB', '/channels/stores', { channel: 'keeta', storeId: STORE }).expect(
      409,
    );
    const list = await get('adminA', '/channels').expect(200);
    expect(JSON.stringify(list.body)).toContain('Loja Keeta Centro');
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, { receiveOrders: true }).expect(
      200,
    );
  });
});

describe('Keeta: pedidos', () => {
  it('o pedido entra com os valores da Keeta e o pago no app; ack só depois de gravar', async () => {
    keeta.orders.set('kt-1', keetaSample({ id: 'kt-1', displayId: '7781' }));
    ev(1, 'CREATED');
    await cycle();
    expect(keeta.polls).toContain(STORE);
    expect(keeta.acked('kt-ev-created-1')).toBe(true);
    expect(keeta.acks.flat()).toContainEqual({
      id: 'kt-ev-created-1',
      eventType: 'CREATED',
      orderId: 'kt-1',
    });
    const o = await orderOf('kt-1');
    // 50 de itens + 7 de entrega; o cupom da Keeta (5) não reduz o pedido: conta como pago no
    // app junto com os 52 do Pix (quem banca o cupom é a Keeta, no repasse).
    expect(o).toMatchObject({
      status: 'awaiting',
      total: '57.00',
      discount: '0.00',
      paid_amount: '57.00',
      external_code: '7781',
      app_channel: 'keeta',
    });
    expect(keeta.lookups.get('kt-1')).toBe(1);
    expect(keeta.badSignatures).toBe(0);
  });

  it('aceitar, pronto e saiu viram as chamadas da Keeta (assinadas, com o número do pedido)', async () => {
    const o = await orderOf('kt-1');
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'in_production' }).expect(201);
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await flush();
    const calls = keeta.actions.filter((a) => a.orderId === 'kt-1');
    // A Keeta não tem "em preparo": o Comandou não manda.
    expect(calls.map((a) => a.verb)).toEqual(['confirm', 'readyForPickup']);
    const [{ number }] = await ownerQuery<{ number: number }>(
      `SELECT number FROM orders WHERE id = $1`,
      [o.id],
    );
    expect(calls[0]!.body).toMatchObject({
      orderExternalCode: String(number),
      createdAt: expect.any(String),
    });
    expect(keeta.badSignatures).toBe(0);
    ev(1, 'CONFIRMED');
    ev(1, 'ORDER_COLLECTED');
    ev(1, 'CONCLUDED');
    await cycle();
    expect((await orderOf('kt-1')).status).toBe('completed');
    const [row] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
      [o.id],
    );
    expect(row!.status).toBe('confirmed');
  });

  it('cancelar pelo Comandou manda o código do padrão; o CANCELLED da Keeta cancela', async () => {
    keeta.orders.set('kt-2', keetaSample({ id: 'kt-2', displayId: '7782' }));
    ev(2, 'CREATED');
    await cycle();
    const o = await orderOf('kt-2');
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    const reasons = await get('adminA', `/channels/orders/${o.id}/cancel-reasons`).expect(200);
    expect(reasons.body.reasons).toContainEqual({
      code: 'UNAVAILABLE_ITEM',
      label: 'Item indisponível',
    });
    await send('post', 'adminA', `/orders/${o.id}/status`, {
      to: 'cancel_requested',
      reason: 'Acabou a massa',
      channelReason: 'UNAVAILABLE_ITEM',
    }).expect(201);
    await flush();
    const call = keeta.actions.find(
      (a) => a.orderId === 'kt-2' && a.verb === 'requestCancellation',
    );
    expect(call!.body).toEqual({
      reason: 'Acabou a massa',
      code: 'UNAVAILABLE_ITEM',
      mode: 'MANUAL',
    });
    ev(
      2,
      'CANCELLED',
      undefined,
      JSON.stringify({ reason: 'Pedido do restaurante', code: 'OTHERS' }),
    );
    await cycle();
    expect((await orderOf('kt-2')).status).toBe('cancelled');
  });

  it('pedido de reembolso do cliente: uma pessoa aceita e a Keeta recebe o acceptRefund', async () => {
    keeta.orders.set('kt-3', keetaSample({ id: 'kt-3', displayId: '7783' }));
    ev(3, 'CREATED');
    await cycle();
    const o = await orderOf('kt-3');
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    ev(
      3,
      'USER_REFUND_REQUEST',
      undefined,
      JSON.stringify({ reason: 'Veio errado', refundProducts: [{ count: 1, refundCount: 1 }] }),
    );
    await cycle();
    const [d] = await ownerQuery<{ id: string; kind: string; message: string; status: string }>(
      `SELECT id, kind, message, status FROM channel_disputes WHERE order_id = $1`,
      [o.id],
    );
    expect(d).toMatchObject({ kind: 'REFUND_REQUEST', status: 'open' });
    expect(d!.message).toContain('Veio errado');
    await send('post', 'adminA', `/channels/disputes/${d!.id}/decision`, {
      decision: 'accept',
    }).expect(200);
    await flush();
    expect(keeta.actions.filter((a) => a.orderId === 'kt-3').map((a) => a.verb)).toEqual([
      'confirm',
      'acceptRefund',
    ]);
    ev(3, 'REFUNDED');
    await cycle();
    const [after] = await ownerQuery<{ status: string }>(
      `SELECT status FROM channel_disputes WHERE id = $1`,
      [d!.id],
    );
    expect(after!.status).toBe('settled');
    expect(keeta.badSignatures).toBe(0);
  });

  it('token vencido: pede outro e segue; Keeta fora do ar não faz ack nem perde o evento', async () => {
    keeta.token = 'tok-keeta-2';
    keeta.orders.set('kt-4', keetaSample({ id: 'kt-4', displayId: '7784' }));
    ev(4, 'CREATED');
    keeta.failNext.poll!.push(503);
    const s = await poller.tick();
    expect(s.events).toBe(0);
    expect(keeta.acked('kt-ev-created-4')).toBe(false);
    await cycle();
    expect((await orderOf('kt-4')).status).toBe('awaiting');
    expect(keeta.acked('kt-ev-created-4')).toBe(true);
    expect(keeta.tokensIssued).toBeGreaterThanOrEqual(2);
  });
});
