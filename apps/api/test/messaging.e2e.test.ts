import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { normalizePhone } from '../src/messaging/messaging.service';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 5: avisos ao cliente pelo WhatsApp (API oficial da Meta), com um servidor falso no
 * lugar da Graph API. O aviso é gravado junto com a mudança do pedido e enviado pela fila.
 */
const HOST_A = 'wa-a.pedemais.test';
const HOST_B = 'wa-b.pedemais.test';
const CSRF = { 'X-PedeMais-Request': '1' };
const TOKEN = 'EAAG-token-de-teste-da-meta-9876';

let metaMode: 'ok' | 'bad-template' | 'down' = 'ok';
const sent: { url: string; auth?: string; body: Record<string, unknown> }[] = [];

const GW_TOKEN = 'token-interno-gateway-de-teste-123';
let gwConnected = true;
const gwSent: { tenant: string; to: string; text: string }[] = [];
const gwStarted = new Set<string>();

let app: INestApplication;
let meta: Server;
let gateway: Server;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const post = (w: string, url: string, body: object = {}) =>
  http
    .post(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const put = (w: string, url: string, body: object) =>
  http
    .put(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

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

async function waitMessages(w: string, n: number, until: (m: { status: string }[]) => boolean) {
  const end = Date.now() + 15_000;
  for (;;) {
    const list = (await get(w, '/messaging/messages').expect(200)).body as { status: string }[];
    if (list.length >= n && until(list)) return list;
    if (Date.now() > end) throw new Error(`mensagens: ${JSON.stringify(list)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

beforeAll(async () => {
  meta = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (metaMode === 'down') return send(503, {});
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      sent.push({ url: req.url!, auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Bearer ${TOKEN}`)
        return send(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
      if (metaMode === 'bad-template')
        return send(404, {
          error: { message: 'Template name does not exist in the translation', code: 132001 },
        });
      send(200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: body.to, wa_id: body.to }],
        messages: [{ id: `wamid.${sent.length}` }],
      });
    });
  });
  await new Promise<void>((r) => meta.listen(0, '127.0.0.1', r));
  // Serviço de WhatsApp (Baileys) falso: mesmas rotas e token do whatsapp-gateway.
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (req.headers.authorization !== `Bearer ${GW_TOKEN}`)
        return send(401, { error: 'não autorizado' });
      const m = /^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(start|logout|messages))?$/.exec(req.url!);
      if (!m) return send(404, {});
      const [, tenant, action] = m;
      const state = () =>
        gwStarted.has(tenant)
          ? gwConnected
            ? { status: 'connected', phone: '5511999990000' }
            : { status: 'qr', qr: 'QR-FALSO-123' }
          : { status: 'disconnected' };
      if (!action) return send(200, state());
      if (action === 'start') {
        gwStarted.add(tenant);
        return send(200, state());
      }
      if (action === 'logout') {
        gwStarted.delete(tenant);
        return send(200, { status: 'logged_out' });
      }
      const body = JSON.parse(raw || '{}') as { to: string; text: string };
      if (!gwStarted.has(tenant) || !gwConnected)
        return send(409, { error: 'WhatsApp do restaurante não está conectado' });
      gwSent.push({ tenant, ...body });
      send(200, { id: `BAE${gwSent.length}` });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  fx = await seedTwoTenants('wa');
  const redis = process.env.TEST_REDIS_URL;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      INTEGRATIONS_KEY: randomBytes(32).toString('base64'),
      WHATSAPP_GRAPH_URL: `http://127.0.0.1:${(meta.address() as AddressInfo).port}/v25.0`,
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
      ...(redis ? { REDIS_URL: redis, QUEUE_PREFIX: `w${Date.now()}` } : {}),
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@wa-a.test');
  cookies.adminB = await login(HOST_B, 'admin@wa-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@wa-a.test');
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => meta?.close(r));
  await new Promise((r) => gateway?.close(r));
});

describe('normalizePhone', () => {
  it('aceita DDD + número e formato internacional; recusa o resto', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('+55 21 3333-4444')).toBe('552133334444');
    expect(normalizePhone('011 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('WhatsApp pela API oficial da Meta (alternativa)', () => {
  it('configuração: só quem gerencia; token cifrado e nunca devolvido', async () => {
    await get('waiterA', '/messaging/settings').expect(403);
    await put('adminA', '/messaging/settings', { provider: 'meta_cloud', enabled: true }).expect(
      422,
    );
    await put('adminA', '/messaging/settings', { templateReady: 'Pedido Pronto' }).expect(400);
    const s = (
      await put('adminA', '/messaging/settings', {
        provider: 'meta_cloud',
        enabled: true,
        phoneNumberId: '106540352242922',
        token: TOKEN,
        templateReady: 'pedido_pronto',
        templateDispatched: 'pedido_saiu',
      }).expect(200)
    ).body;
    expect(s).toMatchObject({
      enabled: true,
      hasToken: true,
      tokenLast4: '9876',
      language: 'pt_BR',
    });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    const audit = await ownerQuery(
      `SELECT data FROM audit_log WHERE tenant_id = $1 AND action = 'messaging.settings_updated'`,
      [fx.tenantA],
    );
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect((await get('adminB', '/messaging/settings').expect(200)).body.enabled).toBe(false);
  });

  it('pedido de retirada pronto avisa o cliente uma única vez', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'pickup',
        customerName: 'Ana',
        customerPhone: '(11) 98765-4321',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    // Reabrir e marcar pronto de novo não manda outro aviso.
    await post('adminA', `/orders/${o.id}/status`, { to: 'in_production' }).expect(201);
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const list = await waitMessages('adminA', 1, (l) => l[0].status === 'sent');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      event: 'order.ready',
      toPhone: '5511987654321',
      template: 'pedido_pronto',
    });
    const call = sent.at(-1)!;
    expect(call.url).toBe('/v25.0/106540352242922/messages');
    expect(call.auth).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511987654321',
      type: 'template',
      template: {
        name: 'pedido_pronto',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ana' },
              { type: 'text', text: String(o.number) },
              { type: 'text', text: 'Restaurante A wa' },
            ],
          },
        ],
      },
    });
  });

  it('sem telefone ou com aviso desligado, nada é enviado', async () => {
    const before = sent.length;
    const o = (
      await post('adminA', '/orders', {
        channel: 'pickup',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await put('adminA', '/messaging/settings', { notifyReady: false }).expect(200);
    const o2 = (
      await post('adminA', '/orders', {
        channel: 'pickup',
        customerPhone: '11987654321',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o2.id}/status`, { to: 'ready' }).expect(201);
    await new Promise((r) => setTimeout(r, 1500));
    expect(sent.length).toBe(before);
    expect((await get('adminA', '/messaging/messages').expect(200)).body).toHaveLength(1);
    await put('adminA', '/messaging/settings', { notifyReady: true }).expect(200);
  });

  it('delivery que sai para entrega avisa; modelo recusado fica como falha e pode ser reenviado', async () => {
    metaMode = 'bad-template';
    const courier = (await post('adminA', '/couriers', { name: 'Moto WA' }).expect(201)).body;
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua B, 2',
        customerPhone: '21 99876-5432',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201); // delivery pronto: sem aviso
    await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier.id }).expect(201);
    let list = await waitMessages('adminA', 2, (l) => l[0].status === 'failed');
    expect(list[0]).toMatchObject({ event: 'order.dispatched', toPhone: '5521998765432' });
    expect((list[0] as unknown as { lastError: string }).lastError).toContain('132001');
    metaMode = 'ok';
    const id = (list[0] as unknown as { id: string }).id;
    await post('adminA', `/messaging/messages/${id}/retry`).expect(202);
    list = await waitMessages('adminA', 2, (l) => l[0].status === 'sent');
    await post('adminA', `/messaging/messages/${id}/retry`).expect(409);
    // Outro restaurante não vê nem reenvia.
    expect((await get('adminB', '/messaging/messages').expect(200)).body).toEqual([]);
    await post('adminB', `/messaging/messages/${id}/retry`).expect(404);
  });

  it('mensagem de teste usa o modelo hello_world (só com WhatsApp ativo)', async () => {
    await post('adminA', '/messaging/test', { phone: '12345678' }).expect(422);
    const m = (await post('adminA', '/messaging/test', { phone: '11 91234-5678' }).expect(202))
      .body;
    expect(m).toMatchObject({ event: 'test', template: 'hello_world', toPhone: '5511912345678' });
    await waitMessages('adminA', 3, (l) => l[0].status === 'sent');
    expect(sent.at(-1)!.body).toMatchObject({
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
    await post('adminB', '/messaging/test', { phone: '11 91234-5678' }).expect(409);
  });

  it('a aplicação não reescreve o conteúdo de uma mensagem', async () => {
    const [m] = (await get('adminA', '/messaging/messages').expect(200)).body;
    const { Client } = await import('pg');
    const c = new Client({ connectionString: testEnv().DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(`UPDATE message_outbox SET to_phone = '5511000000000' WHERE id = $1`, [m.id]),
      ).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});

describe('WhatsApp por QR Code (Baileys, padrão)', () => {
  it('troca para Baileys sem token; conecta pelo QR Code; outro restaurante não vê', async () => {
    const s = (await put('adminA', '/messaging/settings', { provider: 'baileys' }).expect(200))
      .body;
    expect(s).toMatchObject({ provider: 'baileys', enabled: true, gatewayConfigured: true });
    expect(s.textReady).toContain('{pedido}');
    gwConnected = false;
    await get('waiterA', '/messaging/session').expect(403);
    expect((await get('adminA', '/messaging/session').expect(200)).body.status).toBe(
      'disconnected',
    );
    expect((await post('adminA', '/messaging/session/connect').expect(200)).body).toEqual({
      status: 'qr',
      qr: 'QR-FALSO-123',
    });
    gwConnected = true;
    expect((await get('adminA', '/messaging/session').expect(200)).body.status).toBe('connected');
    // A sessão de B é outra (o restaurante vem do Host, nunca do navegador).
    expect((await get('adminB', '/messaging/session').expect(200)).body.status).toBe(
      'disconnected',
    );
  });

  it('pedido pronto envia o texto do restaurante com as variáveis trocadas', async () => {
    await put('adminA', '/messaging/settings', {
      textReady: 'Oi {cliente}, o pedido {pedido} do {restaurante} ficou pronto!',
    }).expect(200);
    const before = gwSent.length;
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        customerName: 'Bia',
        customerPhone: '11 97777-6666',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const list = await waitMessages('adminA', 1, (l) => l[0].status === 'sent');
    expect(list[0]).toMatchObject({
      provider: 'baileys',
      event: 'order.ready',
      toPhone: '5511977776666',
    });
    expect(gwSent.length).toBe(before + 1);
    expect(gwSent.at(-1)).toEqual({
      tenant: fx.tenantA,
      to: '5511977776666',
      text: `Oi Bia, o pedido ${o.number} do Restaurante A wa ficou pronto!`,
    });
  });

  it('WhatsApp desconectado: tenta de novo e, sem sucesso, fica como falha para reenviar', async () => {
    gwConnected = false;
    const o = (
      await post('adminA', '/orders', {
        channel: 'pickup',
        customerPhone: '11 95555-4444',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    // 4 tentativas com espera crescente (1s + 2s + 4s + 8s no modo sem Redis).
    const list = await waitMessagesLong('adminA', (l) => l[0].status === 'failed');
    const m = list[0] as unknown as { id: string; lastError: string };
    expect(m.lastError).toContain('não está conectado');
    gwConnected = true;
    await post('adminA', `/messaging/messages/${m.id}/retry`).expect(202);
    await waitMessages('adminA', 1, (l) => l[0].status === 'sent');
  }, 40_000);

  it('desconectar encerra a sessão do restaurante', async () => {
    expect((await post('adminA', '/messaging/session/logout').expect(200)).body.status).toBe(
      'logged_out',
    );
    expect((await get('adminA', '/messaging/session').expect(200)).body.status).toBe(
      'disconnected',
    );
  });
});

async function waitMessagesLong(w: string, until: (m: { status: string }[]) => boolean) {
  const end = Date.now() + 35_000;
  for (;;) {
    const list = (await get(w, '/messaging/messages').expect(200)).body as { status: string }[];
    if (list.length && until(list)) return list;
    if (Date.now() > end) throw new Error(`mensagens: ${JSON.stringify(list.slice(0, 2))}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
