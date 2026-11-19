import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { AiAgentService } from '../src/chat/ai-agent.service';
import { PLATFORM_WA_ID, WhatsAppInboundService } from '../src/messaging/whatsapp-inbound.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Super Admin › WhatsApp: o painel conecta o número dele na sessão reservada do gateway, recebe
 * mensagens (sem passar pela IA dos restaurantes) e responde.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const GW_TOKEN = 'token-interno-gateway-de-teste-456';

let app: INestApplication;
let http: ReturnType<typeof request>;
let gateway: Server;
let fx: Fixture;
let admin = '';
let gwStatus: 'disconnected' | 'qr' | 'connected' = 'disconnected';
const gwCalls: { session: string; path: string; body: Record<string, unknown> }[] = [];

const pget = (url: string) =>
  http.get(`/api/v1/platform/whatsapp${url}`).set('Host', ADMIN_HOST).set('Cookie', admin);
const ppost = (url: string, b: object = {}) =>
  http
    .post(`/api/v1/platform/whatsapp${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', admin)
    .send(b);

beforeAll(async () => {
  fx = await seedTwoTenants('pwa');
  // Telefone do cadastro do restaurante A (sem 55 e sem o 9): a conversa acha o restaurante.
  await ownerQuery(
    `INSERT INTO tenant_profiles (tenant_id, phone) VALUES ($1, '4733442219')
     ON CONFLICT (tenant_id) DO UPDATE SET phone = EXCLUDED.phone`,
    [fx.tenantA],
  );
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${GW_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const m = /^\/v1\/sessions\/([^/]+)(\/[a-z]+)?$/.exec(req.url ?? '');
      const session = m?.[1] ?? '';
      const path = m?.[2] ?? '';
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      gwCalls.push({ session, path, body });
      const json = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (path === '/start') gwStatus = 'qr';
      if (path === '/logout') gwStatus = 'disconnected';
      if (path === '' || path === '/start' || path === '/logout')
        return json(200, {
          status: gwStatus,
          ...(gwStatus === 'qr' ? { qr: 'codigo-qr' } : {}),
          ...(gwStatus === 'connected' ? { phone: '5511900000000' } : {}),
        });
      if (path === '/messages') {
        if (gwStatus !== 'connected') return json(409, { error: 'WhatsApp desconectado' });
        if (body.to === '5511999999999') return json(422, { error: 'número sem WhatsApp' });
        // Número novo: o gateway devolve a conversa de verdade (aqui, sem o 9).
        const jid =
          body.jid ?? `55${String(body.to).slice(2, 4)}${String(body.to).slice(5)}@s.whatsapp.net`;
        return json(200, { id: `OUT${gwCalls.length}`, jid });
      }
      return json(200, { ok: true });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));

  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('wa@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'wa@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  admin = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => gateway?.close(r));
});

const inbound = (over: Partial<Parameters<WhatsAppInboundService['receive']>[0]> = {}) =>
  app.get(WhatsAppInboundService).receive({
    tenantId: PLATFORM_WA_ID,
    id: 'IN1',
    jid: '554733442219@s.whatsapp.net',
    from: '554733442219',
    kind: 'text',
    text: 'Oi, quero saber do sistema',
    pushName: 'Maria',
    timestamp: new Date(),
    ...over,
  });

describe('WhatsApp do Super Admin', () => {
  it('só o painel entra', async () => {
    await http.get('/api/v1/platform/whatsapp/session').set('Host', ADMIN_HOST).expect(401);
    await http
      .get('/api/v1/platform/whatsapp/session')
      .set('Host', 'pwa-a.comandou.test')
      .set('Cookie', admin)
      .expect(404);
  });

  it('conecta pela sessão reservada e registra no histórico do painel', async () => {
    const s0 = await pget('/session').expect(200);
    expect(s0.body).toMatchObject({ configured: true, status: 'disconnected' });
    const s = await ppost('/session/connect').expect(200);
    expect(s.body).toMatchObject({ status: 'qr', qr: 'codigo-qr' });
    expect(gwCalls.at(-1)).toMatchObject({ session: PLATFORM_WA_ID, path: '/start' });
    const log = await ownerQuery<{ action: string }>(
      `SELECT action FROM platform_audit_log WHERE action LIKE 'whatsapp.%'`,
    );
    expect(log.map((l) => l.action)).toContain('whatsapp.connect');
  });

  it('desconectado: a resposta fica gravada como não enviada', async () => {
    await inbound();
    const r = await ppost('/messages', {
      jid: '554733442219@s.whatsapp.net',
      text: 'Olá!',
    }).expect(201);
    expect(r.body.message).toMatchObject({ status: 'failed', direction: 'out' });
  });

  it('mensagem recebida vai para o painel, não para a IA dos restaurantes', async () => {
    gwStatus = 'connected';
    const ai = vi.spyOn(app.get(AiAgentService), 'onWhatsApp');
    await inbound({ id: 'IN2', text: 'Ainda aí?' });
    await inbound({ id: 'IN2', text: 'Ainda aí?' }); // repetida: não entra de novo
    expect(ai).not.toHaveBeenCalled();
    const list = await pget('/chats').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      jid: '554733442219@s.whatsapp.net',
      name: 'Maria',
      unread: 2,
      lastPreview: 'Ainda aí?',
      lastDir: 'in',
      tenant: { id: fx.tenantA },
    });
    expect(await pget('/unread').expect(200)).toHaveProperty('body', { chats: 1, messages: 2 });
  });

  it('mesma pessoa por @lid cai na mesma conversa; foto vira "Foto"', async () => {
    await inbound({ id: 'IN3', jid: '123456789012345@lid', kind: 'image', text: '' });
    const list = await pget('/chats').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ unread: 3, lastPreview: 'Foto' });
  });

  it('abre, lê, responde e busca', async () => {
    const jid = '554733442219@s.whatsapp.net';
    const d = await pget(`/chats/${jid}`).expect(200);
    expect(d.body.messages.map((m: { body: string }) => m.body)).toEqual([
      'Oi, quero saber do sistema',
      'Olá!',
      'Ainda aí?',
      '',
    ]);
    await ppost(`/chats/${jid}/read`).expect(200);
    // A marca de lida vai ao gateway sem segurar a resposta.
    await vi.waitFor(() => expect(gwCalls.at(-1)?.path).toBe('/read'));
    expect(gwCalls.at(-1)).toMatchObject({ path: '/read', body: { jid, id: 'IN3' } });
    expect((await pget('/unread').expect(200)).body).toEqual({ chats: 0, messages: 0 });

    const r = await ppost('/messages', { jid, text: 'Oi Maria, tudo bem?' }).expect(201);
    expect(r.body.message).toMatchObject({ status: 'sent', authorName: 'David' });
    expect(gwCalls.at(-1)).toMatchObject({
      session: PLATFORM_WA_ID,
      path: '/messages',
      body: { jid, text: 'Oi Maria, tudo bem?' },
    });
    expect((await pget('/chats?q=maria').expect(200)).body).toHaveLength(1);
    expect((await pget('/chats?q=3344').expect(200)).body).toHaveLength(1);
    expect((await pget('/chats?q=joão').expect(200)).body).toHaveLength(0);
  });

  it('nova conversa por telefone usa a conversa que o WhatsApp achou', async () => {
    const r = await ppost('/messages', { phone: '(21) 97654-3210', text: 'Bem-vindo!' }).expect(
      201,
    );
    expect(r.body.chat.jid).toBe('552176543210@s.whatsapp.net');
    expect(gwCalls.at(-1)?.body).toMatchObject({ to: '5521976543210' });
    // Número sem WhatsApp: avisa e não cria conversa vazia.
    await ppost('/messages', { phone: '11 99999-9999', text: 'Oi' }).expect(422);
    await ppost('/messages', { phone: 'telefone-errado', text: 'Oi' }).expect(422);
    await ppost('/messages', { text: 'Oi' }).expect(400);
    expect((await pget('/chats').expect(200)).body).toHaveLength(2);
  });

  it('desconecta', async () => {
    const s = await ppost('/session/logout').expect(200);
    expect(s.body.status).toBe('disconnected');
  });
});
