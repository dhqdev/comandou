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
import {
  AIQFOME_CLIENT_ID,
  AIQFOME_SECRET,
  FakeAiqfomeServer,
  aiqfomeSample,
} from './fake-aiqfome';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * aiqfome de ponta a ponta (ADR 0015, Fase 13) pela camada Open Delivery dele, contra um aiqfome
 * falso: a loja autoriza no ID Magalu (state de uso único, deste restaurante e de quem começou),
 * o Comandou cadastra a loja no modo polling, busca com o token DA LOJA, dá ack com id + pedido +
 * tipo e manda aceitar, pronto (só na retirada), saiu e entregue. Token de acesso vencido renova
 * com trava (o de renovação vale uma vez); autorização tirada para de buscar e avisa.
 */
const HOST_A = 'aq-a.comandou.test';
const HOST_B = 'aq-b.comandou.test';
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE = '96493';
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let aiq: FakeAiqfomeServer;
let poller: ChannelPoller;
let inbox: ChannelInboxService;
let outbox: ChannelOutboxService;
let storeRef = '';
let courierId = '';
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
  const [o] = await ownerQuery<{ id: string; status: string; total: string; paid_amount: string }>(
    `SELECT o.id, o.status, o.total::text, o.paid_amount::text
       FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE o.tenant_id = $1 AND c.channel = 'aiqfome' AND c.external_id = $2`,
    [fx.tenantA, externalId],
  );
  return o!;
};

const verbs = (id: string) => aiq.actions.filter((a) => a.orderId === id).map((a) => a.verb);
const status = (w: string, id: string, to: string) =>
  send('post', w, `/orders/${id}/status`, { to }).then((r) => {
    if (r.status !== 201) throw new Error(`${to}: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  });

async function newOrder(id: string, over: Partial<Parameters<typeof aiqfomeSample>[0]> = {}) {
  aiq.orders.set(id, aiqfomeSample({ id, ...over }));
  aiq.push({ eventId: `aq-ev-${id}`, eventType: 'CREATED', orderId: id, store: STORE });
  await cycle();
  return orderOf(id);
}

/** Começa a autorização como a tela faz e devolve o state que foi para o ID Magalu. */
async function start(w: string, storeId = STORE) {
  const r = await send('post', w, '/channels/aiqfome/authorize', {
    storeId,
    name: 'Pastelaria do Centro',
  }).expect(200);
  return { url: new URL(r.body.url), state: new URL(r.body.url).searchParams.get('state')! };
}

/** Volta do ID Magalu no painel e depois no endereço do restaurante (com a sessão de `w`). */
async function finishAs(w: string, state: string, code: string) {
  const back = await http
    .get(
      `/api/v1/platform/channels/oauth/aiqfome/callback?code=${code}&state=${encodeURIComponent(state)}`,
    )
    .set('Host', ADMIN_HOST)
    .expect(302);
  const finish = new URL(back.headers.location!);
  const r = await http
    .get(`${finish.pathname}${finish.search}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .expect(302);
  return { finish, location: String(r.headers.location) };
}

beforeAll(async () => {
  aiq = new FakeAiqfomeServer();
  await aiq.start();
  fx = await seedTwoTenants('aq');
  const [{ id: adminId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('aiqfome@plataforma.test', 'Equipe', 'x', '\\x00') RETURNING id`,
  );
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      AIQFOME_API_URL: aiq.apiBase,
      AIQFOME_AUTH_URL: aiq.authBase,
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
    .save('aiqfome', { clientId: AIQFOME_CLIENT_ID, clientSecret: AIQFOME_SECRET }, { adminId });
  cookies.adminA = await login(HOST_A, 'admin@aq-a.test');
  cookies.adminB = await login(HOST_B, 'admin@aq-b.test');
});

afterAll(async () => {
  await app?.close();
  await aiq?.stop();
  // As lojas deste arquivo saem do polling: os outros arquivos contam as credenciais do banco todo.
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('aiqfome: ligar a loja pelo ID Magalu', () => {
  it('o endereço do ID Magalu leva o app do Comandou, a volta fixa no painel e os escopos', async () => {
    await send('post', 'adminA', '/channels/aiqfome/authorize', { storeId: 'abc' }).expect(400);
    const { url, state } = await start('adminA');
    expect(`${url.origin}${url.pathname}`).toBe(`${aiq.authBase}/login`);
    expect(url.searchParams.get('client_id')).toBe(AIQFOME_CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://admin.comandou.test/api/v1/platform/channels/oauth/aiqfome/callback',
    );
    expect(url.searchParams.get('scope')).toContain('aqf:order:read');
    expect(url.searchParams.get('choose_tenants')).toBe('true');
    // O state não diz a loja nem o restaurante por extenso; no banco fica só o hash.
    expect(state).not.toContain(STORE);
    const [row] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM channel_oauth_states WHERE tenant_id = $1 AND store_id = $2`,
      [fx.tenantA, STORE],
    );
    expect(row!.n).toBeGreaterThan(0);
  });

  it('state inválido ou vencido não passa da volta no painel', async () => {
    await http
      .get('/api/v1/platform/channels/oauth/aiqfome/callback?code=x&state=abc')
      .set('Host', ADMIN_HOST)
      .expect(400);
    // A volta só existe no painel da equipe.
    await http
      .get('/api/v1/platform/channels/oauth/aiqfome/callback?code=x&state=abc')
      .set('Host', HOST_A)
      .expect(404);
  });

  it('o state de A não serve na sessão de B; cancelar no ID Magalu volta sem ligar nada', async () => {
    const { state } = await start('adminA');
    const { location } = await finishAs('adminB', state, aiq.authorize(STORE));
    expect(location).toContain('aiqfome=erro');
    const cancel = await http
      .get(
        `/api/v1/platform/channels/oauth/aiqfome/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      )
      .set('Host', ADMIN_HOST)
      .expect(302);
    expect(cancel.headers.location).toBe(`http://${HOST_A}/integracoes?aiqfome=cancelado`);
  });

  it('autorizou: troca o código, cadastra a loja no modo polling e liga (tokens cifrados)', async () => {
    const { state } = await start('adminA');
    const { finish, location } = await finishAs('adminA', state, aiq.authorize(STORE));
    expect(finish.host).toBe(HOST_A);
    expect(finish.pathname).toBe('/api/v1/channels/aiqfome/finish');
    expect(location).toBe('/integracoes?aiqfome=ok');
    expect(aiq.onboardings.at(-1)).toEqual({
      id: STORE,
      body: { orderingAppMerchantId: STORE },
      store: STORE,
    });
    expect(aiq.redirects.at(-1)).toBe(
      'https://admin.comandou.test/api/v1/platform/channels/oauth/aiqfome/callback',
    );
    const [s] = await ownerQuery<{
      id: string;
      name: string;
      status: string;
      token_enc: Buffer;
      access_enc: Buffer;
    }>(
      `SELECT id, name, status, token_enc, access_enc FROM channel_stores
        WHERE tenant_id = $1 AND channel = 'aiqfome' AND store_id = $2`,
      [fx.tenantA, STORE],
    );
    expect(s).toMatchObject({ name: 'Pastelaria do Centro', status: 'connected' });
    // Nada do token aparece em texto no banco.
    expect(s!.token_enc.toString('latin1')).not.toContain('rfr-');
    expect(s!.access_enc.toString('latin1')).not.toContain('acc-');
    storeRef = s!.id;
    // O state é de uso único.
    const again = await http
      .get(`${finish.pathname}${finish.search}`)
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA!)
      .expect(302);
    expect(again.headers.location).toContain('aiqfome=erro');
    const ov = await get('adminA', '/channels').expect(200);
    const card = ov.body.channels.find((c: { id: string }) => c.id === 'aiqfome');
    expect(card).toMatchObject({ available: true, configured: true });
    expect(card.stores).toHaveLength(1);
  });

  it('a mesma loja do aiqfome não liga em outro restaurante', async () => {
    const { state } = await start('adminB');
    const { location } = await finishAs('adminB', state, aiq.authorize(STORE));
    expect(decodeURIComponent(location)).toMatch(/já está ligada a outro restaurante/);
  });
});

describe('aiqfome: pedidos', () => {
  beforeAll(async () => {
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, { receiveOrders: true }).expect(
      200,
    );
    courierId = (await send('post', 'adminA', '/couriers', { name: 'Moto do aiqfome' }).expect(201))
      .body.id;
  });

  it('busca com o token da loja; o pedido entra pago no app; ack com id, pedido e tipo', async () => {
    const o = await newOrder('68689245');
    expect(o).toMatchObject({ status: 'awaiting', total: '29.00', paid_amount: '29.00' });
    expect(aiq.acks.at(-1)).toEqual({
      store: STORE,
      body: [{ id: 'aq-ev-68689245', eventType: 'CREATED', orderId: '68689245' }],
    });
  });

  it('entrega própria: aceitar, saiu e entregue; "pronto" não vai (só existe na retirada)', async () => {
    const o = await orderOf('68689245');
    await status('adminA', o.id, 'new');
    await status('adminA', o.id, 'in_production');
    await status('adminA', o.id, 'ready');
    await send('post', 'adminA', `/orders/${o.id}/dispatch`, { courierId }).expect(201);
    await status('adminA', o.id, 'completed');
    await flush();
    expect(verbs('68689245')).toEqual(['confirm', 'dispatch', 'delivered']);
    // Nem entra na caixa de saída: a tela não mostra "Pronto: enviado" sem ter ido.
    const [r] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_outbox WHERE order_id = $1 AND action = 'ready'`,
      [o.id],
    );
    expect(r!.n).toBe(0);
    const confirm = aiq.actions.find((a) => a.orderId === '68689245' && a.verb === 'confirm')!;
    expect(confirm.body).toMatchObject({
      orderExternalCode: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it('retirada: aceitar e "pronto para retirar" (ready-for-pickup)', async () => {
    const o = await newOrder('68689246', {
      type: 'TAKEOUT',
      delivery: undefined,
      takeout: { takeoutDateTime: new Date().toISOString() },
    } as never);
    await status('adminA', o.id, 'new');
    await status('adminA', o.id, 'ready');
    await flush();
    expect(verbs('68689246')).toEqual(['confirm', 'ready-for-pickup']);
  });

  it('cancelado no gestor do aiqfome: o CANCELLED cancela no Comandou', async () => {
    const o = await newOrder('68689247');
    await status('adminA', o.id, 'new');
    aiq.push({
      eventId: 'aq-ev-68689247-c',
      eventType: 'CANCELLED',
      orderId: '68689247',
      store: STORE,
    });
    await cycle();
    expect((await orderOf('68689247')).status).toBe('cancelled');
  });

  it('token de acesso vencido: renova uma vez (o de renovação troca) e segue sem perder evento', async () => {
    aiq.expireAccess();
    const before = aiq.refreshes;
    const [old] = await ownerQuery<{ t: Buffer }>(
      `SELECT token_enc AS t FROM channel_stores WHERE id = $1`,
      [storeRef],
    );
    const o = await newOrder('68689248');
    expect(o.status).toBe('awaiting');
    expect(aiq.refreshes).toBe(before + 1);
    const [now] = await ownerQuery<{ t: Buffer }>(
      `SELECT token_enc AS t FROM channel_stores WHERE id = $1`,
      [storeRef],
    );
    expect(now!.t.equals(old!.t)).toBe(false);
    // aiqfome fora do ar: sem ack, o evento volta na próxima busca.
    aiq.push({ eventId: 'aq-ev-x', eventType: 'CREATED', orderId: '68689249', store: STORE });
    aiq.orders.set('68689249', aiqfomeSample({ id: '68689249' }));
    aiq.failNext.poll!.push(503);
    const s = await poller.tick();
    expect(s.events).toBe(0);
    await cycle();
    expect((await orderOf('68689249')).status).toBe('awaiting');
  });

  it('a loja tirou a autorização: para de buscar e a tela pede para ligar de novo', async () => {
    aiq.revokeAll();
    await poller.tick();
    const [s] = await ownerQuery<{ status: string; last_error: string; token_enc: Buffer | null }>(
      `SELECT status, last_error, token_enc FROM channel_stores WHERE id = $1`,
      [storeRef],
    );
    expect(s).toMatchObject({ status: 'revoked', token_enc: null });
    expect(s!.last_error).toMatch(/Ligue a loja de novo/);
    const [claim] = await ownerQuery<{ receive_orders: boolean }>(
      `SELECT receive_orders FROM channel_store_claims WHERE channel = 'aiqfome' AND store_id = $1`,
      [STORE],
    );
    expect(claim!.receive_orders).toBe(false);
  });
});
