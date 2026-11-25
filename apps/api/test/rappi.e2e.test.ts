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
import { RappiService } from '../src/integrations/rappi/rappi.service';
import { rappiSign } from '../src/integrations/rappi/rappi-order';
import {
  FakeRappiServer,
  RAPPI_CLIENT_ID,
  RAPPI_HOOK_SECRET,
  RAPPI_SECRET,
  rappiSample,
} from './fake-rappi';
import { approveChannelStores, Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Rappi de ponta a ponta (ADR 0015, Fase 12) contra uma Rappi falsa: o pedido novo só vem UMA vez
 * na busca (e volta pela lista dos SENT se o Comandou perdeu a memória), aceitar vira take,
 * recusar vira reject com cancel_type, pronto vira ready-for-pickup, e o cancelamento chega por
 * webhook assinado (Rappi-Signature) no endereço do painel.
 */
const HOST_A = 'rp-a.comandou.test';
const HOST_B = 'rp-b.comandou.test';
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE = '900200300';
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let rappi: FakeRappiServer;
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
  }>(
    `SELECT o.id, o.status, o.total::text, o.discount::text, o.paid_amount::text, o.external_code
       FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE o.tenant_id = $1 AND c.channel = 'rappi' AND c.external_id = $2`,
    [fx.tenantA, externalId],
  );
  return o;
};
const status = (w: string, id: string, to: string, extra: object = {}) =>
  send('post', w, `/orders/${id}/status`, { to, ...extra }).then((r) => {
    if (r.status !== 201) throw new Error(`${to}: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  });
const verbs = (id: string) => rappi.actions.filter((a) => a.orderId === id).map((a) => a.verb);

/** Webhook assinado como a Rappi faz: HMAC-SHA256 de "t.corpo" com o segredo. */
function hook(
  name: string,
  body: object,
  opts: { t?: number; secret?: string; host?: string } = {},
) {
  const raw = JSON.stringify(body);
  const t = String(opts.t ?? Math.floor(Date.now() / 1000));
  const sign = rappiSign(opts.secret ?? RAPPI_HOOK_SECRET, t, raw);
  return http
    .post(`/api/v1/platform/channels/webhooks/rappi/${name}`)
    .set('Host', opts.host ?? ADMIN_HOST)
    .set('Content-Type', 'application/json')
    .set('Rappi-Signature', `t=${t},sign=${sign}`)
    .send(raw);
}

beforeAll(async () => {
  rappi = new FakeRappiServer();
  await rappi.start();
  fx = await seedTwoTenants('rp');
  const [{ id: adminId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('rappi@plataforma.test', 'Equipe', 'x', '\\x00') RETURNING id`,
  );
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      RAPPI_API_URL: rappi.url,
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
    .save(
      'rappi',
      { clientId: RAPPI_CLIENT_ID, clientSecret: RAPPI_SECRET, webhookSecret: RAPPI_HOOK_SECRET },
      { adminId },
    );
  cookies.adminA = await login(HOST_A, 'admin@rp-a.test');
  cookies.adminB = await login(HOST_B, 'admin@rp-b.test');
});

afterAll(async () => {
  await app?.close();
  await rappi?.stop();
  // As lojas deste arquivo saem do polling: os outros arquivos contam as credenciais do banco todo.
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('Rappi: ligar a loja', () => {
  it('código só com números; liga sem chamar a Rappi; outro restaurante não pega a mesma loja', async () => {
    await send('post', 'adminA', '/channels/stores', { channel: 'rappi', storeId: 'abc' }).expect(
      400,
    );
    const r = await send('post', 'adminA', '/channels/stores', {
      channel: 'rappi',
      storeId: STORE,
      name: 'Loja Rappi Centro',
    }).expect(201);
    await approveChannelStores();
    storeRef = r.body.id;
    expect(r.body).toMatchObject({ channel: 'rappi', store_id: STORE, receive_orders: false });
    // Ligar não busca pedidos: a busca da Rappi é única e marcaria os pedidos como lidos.
    expect(rappi.gets).toEqual([]);
    await send('post', 'adminB', '/channels/stores', { channel: 'rappi', storeId: STORE }).expect(
      409,
    );
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, { receiveOrders: true }).expect(
      200,
    );
  });
});

describe('Rappi: pedidos', () => {
  it('o pedido entra com os valores da Rappi (cupom dividido, complemento, taxas)', async () => {
    rappi.add(STORE, rappiSample('rp-1', STORE));
    await cycle();
    expect(rappi.status('rp-1')).toBe('SENT');
    const o = await orderOf('rp-1');
    // 64,80 de itens + 7,99 de entrega + 0,99 de serviço − 4 do cupom da loja = 69,78; os 6 da
    // Rappi contam como pagos no app junto com os 63,78 do cartão.
    expect(o).toMatchObject({
      status: 'awaiting',
      total: '69.78',
      discount: '4.00',
      paid_amount: '69.78',
      external_code: 'rp-1',
    });
  });

  it('busca única: sem a memória do pedido, ele volta pela lista dos SENT', async () => {
    rappi.add(STORE, rappiSample('rp-2', STORE, { delivery_method: 'pickup' }));
    await poller.tick();
    // Outra réplica (ou um reinício) trata o evento: o pedido não está mais na memória.
    (app.get(RappiService).adapter as unknown as { cache: Map<string, unknown> }).cache.clear();
    await cycle();
    expect((await orderOf('rp-2'))?.status).toBe('awaiting');
    expect(rappi.gets).toContain('GET /restaurants/orders/v1/orders/status/sent');
  });

  it('aceitar vira take e pronto vira ready-for-pickup', async () => {
    const o = await orderOf('rp-1');
    await status('adminA', o!.id, 'new');
    await status('adminA', o!.id, 'in_production');
    await status('adminA', o!.id, 'ready');
    await flush();
    expect(verbs('rp-1')).toEqual(['take', 'ready']);
    expect(rappi.status('rp-1')).toBe('TAKEN');
  });

  it('recusar manda o reject com o motivo da Rappi', async () => {
    const o = await orderOf('rp-2');
    const reasons = await get('adminA', `/channels/orders/${o!.id}/cancel-reasons`).expect(200);
    expect(reasons.body.reasons).toContainEqual({
      code: 'ITEM_STOCKOUT',
      label: 'Item sem estoque',
    });
    await status('adminA', o!.id, 'cancelled', {
      reason: 'Acabou a massa',
      channelReason: 'ITEM_STOCKOUT',
    });
    await flush();
    const call = rappi.actions.find((a) => a.orderId === 'rp-2')!;
    expect(call).toMatchObject({
      verb: 'reject',
      path: 'cancel_type/ITEM_STOCKOUT/reject',
      body: { description: 'Acabou a massa', additional_info: {} },
    });
  });
});

describe('Rappi: webhooks', () => {
  it('só entra com a assinatura certa, recente e no endereço do painel', async () => {
    const body = { event: 'canceled_with_charge', order_id: 'rp-1', store_id: STORE };
    await hook('cancel', body, { secret: 'outro-segredo' }).expect(401);
    await hook('cancel', body, { t: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await hook('cancel', body, { host: HOST_A }).expect(404);
    await http
      .post('/api/v1/platform/channels/webhooks/rappi/cancel')
      .set('Host', ADMIN_HOST)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(401);
    await hook('desconhecido', body).expect(404);
    expect((await orderOf('rp-1'))!.status).toBe('ready');
  });

  it('cancelamento da Rappi cancela o pedido; loja de fora e ping respondem 200', async () => {
    await hook('cancel', {
      event: 'canceled_with_charge',
      order_id: 'rp-1',
      store_id: STORE,
    }).expect(200);
    await waitFor(async () => {
      await inbox.process(fx.tenantA);
      return (await orderOf('rp-1'))!.status === 'cancelled';
    });
    await hook('cancel', { event: 'canceled_by_user', order_id: 'x', store_id: '1' }).expect(200);
    await hook('ping', { store_id: 999 }).expect(200);
    await hook('other', { event: 'taken_visible_order', order_id: 'rp-1', store_id: STORE }).expect(
      200,
    );
  });

  it('pedido novo por webhook entra uma vez só, mesmo vindo também na busca', async () => {
    const d = rappiSample('rp-3', STORE);
    rappi.add(STORE, d);
    await hook('new-order', { order_detail: d }).expect(200);
    await cycle();
    const [{ n }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM channel_orders WHERE tenant_id = $1 AND external_id = 'rp-3'`,
      [fx.tenantA],
    );
    expect(n).toBe(1);
    expect((await orderOf('rp-3'))!.status).toBe('awaiting');
  });
});
