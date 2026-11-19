import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ChannelRegistry } from '../src/integrations/channels/channel-adapter';
import { ChannelCredentials } from '../src/integrations/channels/channel-credentials.service';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelOutboxService } from '../src/integrations/channels/channel-outbox.service';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
import { OpenDeliveryService } from '../src/integrations/opendelivery/opendelivery.service';
import { PLATFORM_URL, testEnv } from './env';
import { aiqfomeSample } from './fake-aiqfome';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Outros aplicativos Open Delivery (ADR 0015, Fase 13): um aplicativo cadastrado no Super Admin
 * (nome, endereço da API, client id e secret) vira um canal `od-<nome>` sem código novo. Mesmo
 * polling por loja (x-polling-merchants), ack e ações do padrão; apagado, sai do sistema.
 */
const HOST_A = 'od-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const API = 'https://api.anota.exemplo.com.br/opendelivery';
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let server: Server;
let url = '';
let adminId = '';
let cookie = '';
const events: {
  eventId: string;
  eventType: string;
  orderId: string;
  merchant: string;
  acked?: boolean;
}[] = [];
const actions: { orderId: string; verb: string }[] = [];
const polls: string[] = [];

const send = (method: 'post' | 'patch', path: string, body?: object) =>
  http[method](`/api/v1${path}`)
    .set('Host', HOST_A)
    .set('Cookie', cookie)
    .set(CSRF)
    .send(body ?? {});

/** Aplicativo Open Delivery V1 falso: client_credentials, polling por loja, ack, pedido e ações. */
function startFake() {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const out = (code: number, b?: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(b === undefined ? '' : JSON.stringify(b));
      };
      const path = new URL(req.url!, url).pathname.replace(/^\/opendelivery/, '');
      if (path === '/oauth/token') {
        const f = new URLSearchParams(raw);
        return f.get('client_id') === 'comandou' && f.get('client_secret') === 'segredo-anota-123'
          ? out(200, { access_token: 'tok-od', expires_in: 3600 })
          : out(401, { title: 'credencial', status: 401 });
      }
      if (req.headers.authorization !== 'Bearer tok-od') return out(401, { status: 401 });
      if (path === '/v1/events:polling') {
        const m = String(req.headers['x-polling-merchants'] ?? '');
        polls.push(m);
        const list = events.filter((e) => !e.acked && e.merchant === m);
        return list.length
          ? out(
              200,
              list.map(({ acked: _a, merchant: _m, ...e }) => e),
            )
          : out(204);
      }
      if (path === '/v1/events/acknowledgment') {
        for (const x of JSON.parse(raw) as { id: string }[])
          for (const e of events) if (e.eventId === x.id) e.acked = true;
        return out(202);
      }
      const order = /^\/v1\/orders\/([^/]+)$/.exec(path);
      if (order) return out(200, aiqfomeSample({ id: order[1]!, displayId: 'A1' }));
      const act = /^\/v1\/orders\/([^/]+)\/([A-Za-z]+)$/.exec(path);
      if (act) {
        actions.push({ orderId: act[1]!, verb: act[2]! });
        return out(202);
      }
      out(404, { status: 404 });
    });
  });
  return new Promise<void>((r) =>
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      r();
    }),
  );
}

beforeAll(async () => {
  await startFake();
  fx = await seedTwoTenants('od');
  [{ id: adminId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('od-apps@plataforma.test', 'Equipe', 'x', '\\x00') RETURNING id`,
  );
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      INTEGRATIONS_KEY: KEY,
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      CHANNELS_POLL_MIN_SECONDS: '0',
      CHANNELS_LEASE_SECONDS: '5',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  // O endereço cadastrado é https com nome de servidor; nos testes ele cai no servidor falso.
  app.get(OpenDeliveryService).fetcher = (input, init) =>
    fetch(String(input).replace('https://api.anota.exemplo.com.br', url), init);
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email: 'admin@od-a.test', password: PASSWORD })
    .expect(200);
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => server?.close(r));
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('Outros aplicativos Open Delivery', () => {
  it('cadastro precisa do nome e do endereço da API; o canal aparece com o nome dado', async () => {
    const creds = app.get(ChannelCredentials);
    await expect(
      creds.save(
        'od-anotaai',
        { clientId: 'comandou', clientSecret: 'segredo-anota-123' },
        { adminId },
      ),
    ).rejects.toThrow(/nome e do endereço/);
    await creds.save(
      'od-anotaai',
      { clientId: 'comandou', clientSecret: 'segredo-anota-123', name: 'Anota AI', baseUrl: API },
      { adminId },
    );
    expect(await creds.customOd()).toEqual([
      expect.objectContaining({
        channel: 'od-anotaai',
        name: 'Anota AI',
        host: 'api.anota.exemplo.com.br',
      }),
    ]);
    await app.get(OpenDeliveryService).syncCustom();
    const ov = await http
      .get('/api/v1/channels')
      .set('Host', HOST_A)
      .set('Cookie', cookie)
      .expect(200);
    const card = ov.body.channels.find((c: { id: string }) => c.id === 'od-anotaai');
    expect(card).toMatchObject({ label: 'Anota AI', available: true, configured: true });
    expect(card.capabilities.find((c: { id: string }) => c.id === 'confirm').on).toBe(true);
  });

  it('liga a loja, recebe o pedido pelo polling do padrão e manda o aceite', async () => {
    await send('post', '/channels/stores', { channel: 'od-zzz', storeId: 'loja-1' }).expect(400);
    const s = await send('post', '/channels/stores', {
      channel: 'od-anotaai',
      storeId: 'loja-anota-1',
      name: 'Loja no Anota AI',
    }).expect(201);
    await send('patch', `/channels/stores/${s.body.id}`, { receiveOrders: true }).expect(200);
    events.push({
      eventId: 'od-ev-1',
      eventType: 'CREATED',
      orderId: 'od-1',
      merchant: 'loja-anota-1',
    });
    await app.get(ChannelPoller).tick();
    const inbox = app.get(ChannelInboxService);
    let order: { id: string; status: string; app_channel: string } | undefined;
    for (let i = 0; i < 50 && !order; i++) {
      await inbox.process(fx.tenantA);
      [order] = await ownerQuery<{ id: string; status: string; app_channel: string }>(
        `SELECT o.id, o.status, o.app_channel FROM orders o JOIN channel_orders c ON c.order_id = o.id
          WHERE o.tenant_id = $1 AND c.external_id = 'od-1'`,
        [fx.tenantA],
      );
      if (!order) await new Promise((r) => setTimeout(r, 100));
    }
    expect(order).toMatchObject({ status: 'awaiting', app_channel: 'od-anotaai' });
    expect(polls).toContain('loja-anota-1');
    expect(events[0]!.acked).toBe(true);
    await send('post', `/orders/${order!.id}/status`, { to: 'new' }).expect(201);
    await app.get(ChannelOutboxService).deliver(fx.tenantA);
    expect(actions).toEqual([{ orderId: 'od-1', verb: 'confirm' }]);
  });

  it('apagado no Super Admin: sai do sistema na próxima releitura', async () => {
    await app.get(ChannelCredentials).remove('od-anotaai', { adminId });
    await app.get(OpenDeliveryService).syncCustom();
    expect(app.get(ChannelRegistry).get('od-anotaai')).toBeUndefined();
  });
});
