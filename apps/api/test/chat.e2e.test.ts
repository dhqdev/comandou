import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Chat interno da equipe (conversas, grupos, canais, mural, avisos) e o assistente de IA com um
 * OpenRouter falso. Sempre pela API HTTP real, com dois restaurantes isolados.
 */
const HOST_A = 'chat-a.comandou.test';
const HOST_B = 'chat-b.comandou.test';
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let orSrv: Server;
const orCalls: { path: string; auth?: string; body?: Record<string, unknown> }[] = [];
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let adminCookie = '';

type Who = 'adminA' | 'waiterA' | 'adminB';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]);
const send = (w: Who, method: 'post' | 'patch' | 'delete', url: string, body: object = {}) =>
  http[method](`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);
const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', adminCookie);
const psend = (method: 'post' | 'put', url: string, body: object) =>
  http[method](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', adminCookie)
    .send(body);

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

/** OpenRouter falso: responde em pedaços (SSE) com o uso no fim, como o real. */
function fakeOpenRouter() {
  return createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      orCalls.push({ path: req.url!, auth: req.headers.authorization, body });
      if (req.headers.authorization !== 'Bearer sk-or-teste') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'No auth' } }));
        return;
      }
      if (req.url === '/key') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: { label: 'teste', limit: 10, limit_remaining: 7.5, usage: 2.5, usage_monthly: 1 },
          }),
        );
        return;
      }
      if (req.url === '/credits') {
        res.writeHead(403);
        res.end('{}');
        return;
      }
      if (req.url === '/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': OPENROUTER PROCESSING\n\n');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Para abrir o caixa, ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'vá em **Caixa**.' } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 600, completion_tokens: 60, cost: 0.00012 } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
}

/** Lê o text/event-stream da resposta do assistente. */
function parseSse(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const ev = /event: (.*)/.exec(block)?.[1];
      const data = /data: (.*)/.exec(block)?.[1];
      return { event: ev, data: data ? JSON.parse(data) : null };
    });
}

beforeAll(async () => {
  fx = await seedTwoTenants('chat');
  orSrv = fakeOpenRouter();
  await new Promise<void>((r) => orSrv.listen(0, '127.0.0.1', r));
  const port = (orSrv.address() as AddressInfo).port;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      INTEGRATIONS_KEY: KEY,
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      OPENROUTER_BASE_URL: `http://127.0.0.1:${port}`,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@chat-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@chat-a.test');
  cookies.adminB = await login(HOST_B, 'admin@chat-b.test');
  const people = (await get('adminA', '/chat/people').expect(200)).body as { id: string; name: string }[];
  ids.adminA = people.find((p) => p.name === 'Admin A')!.id;
  ids.waiterA = people.find((p) => p.name === 'Garçom A')!.id;
  // Super Admin com código do autenticador.
  await ownerQuery(`DELETE FROM platform_admins WHERE email = 'ia@plataforma.test'`);
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('ia@plataforma.test', 'IA', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  const res = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({ email: 'ia@plataforma.test', password: 'senha-super-admin-123', code: totpCode(SECRET, totpStep()) });
  expect(res.status).toBe(200);
  adminCookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0];
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => orSrv?.close(r));
});

describe('Chat da equipe', () => {
  let dm = '';
  let group = '';
  let msg = '';

  it('lista a equipe só do próprio restaurante', async () => {
    const a = (await get('adminA', '/chat/people').expect(200)).body as { name: string }[];
    expect(a.map((p) => p.name).sort()).toEqual(['Admin A', 'Garçom A']);
    const b = (await get('adminB', '/chat/people').expect(200)).body as { name: string }[];
    expect(b.map((p) => p.name)).toEqual(['Admin B']);
  });

  it('conversa direta nasce uma vez só e leva a mensagem ao outro', async () => {
    const c1 = (await send('adminA', 'post', '/chat/conversations/direct', { userId: ids.waiterA }).expect(200)).body;
    const c2 = (await send('waiterA', 'post', '/chat/conversations/direct', { userId: ids.adminA }).expect(200)).body;
    expect(c1.id).toBe(c2.id);
    expect(c1.name).toBe('Garçom A');
    expect(c2.name).toBe('Admin A');
    dm = c1.id;
    const m = (
      await send('adminA', 'post', `/chat/conversations/${dm}/messages`, {
        body: 'Mesa 4 pediu a conta',
        mentions: [ids.waiterA],
      }).expect(201)
    ).body;
    msg = m.id;
    expect(m).toMatchObject({ body: 'Mesa 4 pediu a conta', authorName: 'Admin A' });
    const list = (await get('waiterA', '/chat/conversations').expect(200)).body;
    expect(list[0]).toMatchObject({ id: dm, unread: 1, last: { body: 'Mesa 4 pediu a conta' } });
    expect((await get('waiterA', '/chat/summary').expect(200)).body).toEqual({ unread: 1, notices: 1 });
    await send('waiterA', 'post', `/chat/conversations/${dm}/read`).expect(200);
    expect((await get('waiterA', '/chat/summary').expect(200)).body.unread).toBe(0);
    const notices = (await get('waiterA', '/chat/notices').expect(200)).body;
    expect(notices[0]).toMatchObject({ kind: 'mention', conversationId: dm });
  });

  it('reage, responde, edita e apaga', async () => {
    const r = (await send('waiterA', 'post', `/chat/messages/${msg}/react`, { emoji: '❤️' }).expect(200)).body;
    expect(r.reactions['❤️']).toEqual([ids.waiterA]);
    const r2 = (await send('waiterA', 'post', `/chat/messages/${msg}/react`, { emoji: '❤️' }).expect(200)).body;
    expect(r2.reactions['❤️']).toBeUndefined();
    await send('waiterA', 'post', `/chat/messages/${msg}/react`, { emoji: '🍕' }).expect(400);
    const reply = (
      await send('waiterA', 'post', `/chat/conversations/${dm}/messages`, { body: 'Levando!', replyTo: msg }).expect(201)
    ).body;
    expect(reply.reply).toMatchObject({ id: msg, body: 'Mesa 4 pediu a conta', authorName: 'Admin A' });
    await send('adminA', 'patch', `/chat/messages/${reply.id}`, { body: 'outra' }).expect(403);
    await send('waiterA', 'patch', `/chat/messages/${reply.id}`, { body: 'Levando agora!' }).expect(200);
    await send('waiterA', 'delete', `/chat/messages/${reply.id}`).expect(200);
    const page = (await get('adminA', `/chat/conversations/${dm}/messages`).expect(200)).body;
    const gone = page.messages.find((m: { id: string }) => m.id === reply.id);
    expect(gone).toMatchObject({ deleted: true, body: '' });
  });

  it('outro restaurante não enxerga nem escreve na conversa', async () => {
    await get('adminB', `/chat/conversations/${dm}/messages`).expect(404);
    await send('adminB', 'post', `/chat/conversations/${dm}/messages`, { body: 'oi' }).expect(404);
    await send('adminB', 'post', '/chat/conversations/direct', { userId: ids.adminA }).expect(404);
    expect((await get('adminB', '/chat/conversations').expect(200)).body).toEqual([]);
  });

  it('grupo: quem é chamado entra e recebe aviso; administrador gerencia', async () => {
    await send('adminA', 'post', '/chat/conversations', { kind: 'group', name: 'Turno da noite', memberIds: [] }).expect(422);
    const g = (
      await send('adminA', 'post', '/chat/conversations', {
        kind: 'group',
        name: 'Turno da noite',
        memberIds: [ids.waiterA],
      }).expect(201)
    ).body;
    group = g.id;
    expect(g).toMatchObject({ kind: 'group', name: 'Turno da noite', memberCount: 2, myRole: 'admin' });
    const d = (await get('waiterA', `/chat/conversations/${group}`).expect(200)).body;
    expect(d.members.map((m: { name: string }) => m.name).sort()).toEqual(['Admin A', 'Garçom A']);
    await send('waiterA', 'patch', `/chat/conversations/${group}`, { name: 'Outro' }).expect(403);
    await send('waiterA', 'patch', `/chat/conversations/${group}`, { pinned: true, muted: true }).expect(200);
    const mine = (await get('waiterA', '/chat/conversations').expect(200)).body;
    expect(mine[0]).toMatchObject({ id: group, pinned: true, muted: true });
    const n = (await get('waiterA', '/chat/notices').expect(200)).body;
    expect(n[0]).toMatchObject({ kind: 'group', conversationId: group });
    await send('waiterA', 'post', `/chat/conversations/${group}/leave`).expect(200);
    await get('waiterA', `/chat/conversations/${group}`).expect(404);
  });

  it('canal aberto: aparece para quem não entrou e qualquer um entra', async () => {
    const c = (
      await send('adminA', 'post', '/chat/conversations', { kind: 'channel', name: 'Avisos da cozinha' }).expect(201)
    ).body;
    const open = (await get('waiterA', '/chat/channels').expect(200)).body;
    expect(open.map((x: { id: string }) => x.id)).toContain(c.id);
    await send('waiterA', 'post', `/chat/conversations/${c.id}/join`).expect(200);
    expect((await get('waiterA', '/chat/channels').expect(200)).body).toEqual([]);
    await send('adminB', 'post', `/chat/conversations/${c.id}/join`).expect(404);
  });

  it('busca só nas conversas da pessoa', async () => {
    const r = (await get('adminA', '/chat/search?q=conta').expect(200)).body;
    expect(r.map((m: { body: string }) => m.body)).toContain('Mesa 4 pediu a conta');
    expect((await get('adminB', '/chat/search?q=conta').expect(200)).body).toEqual([]);
  });

  it('mural: todos leem, gestor fixa, autor apaga', async () => {
    const p = (await send('waiterA', 'post', '/chat/posts', { body: 'Falta guardanapo no salão' }).expect(201)).body;
    await send('adminA', 'post', '/chat/posts', { body: 'Reunião amanhã às 10h' }).expect(201);
    await send('waiterA', 'post', `/chat/posts/${p.id}/pin`, { pinned: true }).expect(403);
    await send('adminA', 'post', `/chat/posts/${p.id}/pin`, { pinned: true }).expect(200);
    await send('adminA', 'post', `/chat/posts/${p.id}/react`, { emoji: '👍' }).expect(200);
    const posts = (await get('waiterA', '/chat/posts').expect(200)).body;
    expect(posts[0]).toMatchObject({ id: p.id, pinned: true, reactions: { '👍': [ids.adminA] } });
    expect((await get('adminB', '/chat/posts').expect(200)).body).toEqual([]);
    const n = (await get('adminA', '/chat/notices').expect(200)).body;
    expect(n.some((x: { kind: string }) => x.kind === 'post')).toBe(true);
    await send('adminA', 'post', '/chat/notices/read', {}).expect(200);
    expect((await get('adminA', '/chat/summary').expect(200)).body.notices).toBe(0);
    await send('waiterA', 'delete', `/chat/posts/${p.id}`).expect(200);
  });

  it('foto no chat: qualquer pessoa da equipe envia', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await http
      .post('/api/v1/chat/media')
      .set('Host', HOST_A)
      .set('Cookie', cookies.waiterA)
      .set(CSRF)
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(201);
    const m = (
      await send('waiterA', 'post', `/chat/conversations/${dm}/messages`, { imageId: up.body.id }).expect(201)
    ).body;
    expect(m.imageId).toBe(up.body.id);
    await send('adminB', 'post', `/chat/conversations/${dm}/messages`, { imageId: up.body.id }).expect(404);
  });
});

describe('Assistente de IA', () => {
  it('começa desligado', async () => {
    const s = (await get('adminA', '/chat/ai').expect(200)).body;
    expect(s).toMatchObject({ enabled: false, reason: 'platform', name: 'Comandinho' });
    await send('adminA', 'post', '/chat/ai/messages', { content: 'oi' }).expect(503);
  });

  it('Super Admin salva a chave (cifrada), testa e vê o saldo', async () => {
    await psend('put', '/ai/settings', {
      enabled: true,
      model: 'google/gemini-2.5-flash-lite',
      assistantName: 'Comandinho',
      defaultMonthlyTokens: 1000,
      lowBalanceUsd: 2,
    }).expect(422);
    const s = (
      await psend('put', '/ai/settings', {
        enabled: true,
        apiKey: 'sk-or-teste',
        model: 'google/gemini-2.5-flash-lite',
        assistantName: 'Comandinho',
        defaultMonthlyTokens: 1000,
        lowBalanceUsd: 2,
      }).expect(200)
    ).body;
    expect(s.settings).toMatchObject({ enabled: true, hasApiKey: true, keyReadable: true });
    expect(JSON.stringify(s)).not.toContain('sk-or-teste');
    expect(s.account).toMatchObject({ remainingUsd: 7.5, keyLimitUsd: 10 });
    const [row] = await ownerQuery<{ k: Buffer }>(`SELECT api_key_enc AS k FROM platform_ai_settings`);
    expect(row.k.toString()).not.toContain('sk-or-teste');
    const t = (await psend('post', '/ai/test', { model: 'google/gemini-2.5-flash-lite' }).expect(200)).body;
    expect(t).toMatchObject({ ok: true });
    const bad = (await psend('post', '/ai/test', { apiKey: 'errada', model: 'x/y' }).expect(200)).body;
    expect(bad.ok).toBe(false);
    // Restaurante não acessa a configuração da plataforma.
    await http.get('/api/v1/platform/ai').set('Host', HOST_A).set('Cookie', cookies.adminA).expect(404);
  });

  it('responde em pedaços, grava a conversa e o uso do restaurante', async () => {
    const res = await send('waiterA', 'post', '/chat/ai/messages', {
      content: 'Como abro o caixa?',
      screen: '/caixa',
    })
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', (c: Buffer) => (d += c.toString()));
        r.on('end', () => cb(null, d));
      })
      .expect(200);
    const events = parseSse(res.body as string);
    const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(text).toBe('Para abrir o caixa, vá em **Caixa**.');
    const done = events.find((e) => e.event === 'done')!.data;
    expect(done.usage).toMatchObject({ used: 660, limit: 1000 });
    const call = orCalls.find((c) => c.path === '/chat/completions' && c.body?.max_tokens !== 30)!;
    const msgs = call.body!.messages as { role: string; content: string }[];
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Tela aberta agora: Caixa');
    expect(msgs[0].content).toContain('Garçom A');
    const s = (await get('waiterA', '/chat/ai').expect(200)).body;
    expect(s.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(s.usage).toMatchObject({ used: 660, limit: 1000, percent: 66 });
    // A conversa é de cada pessoa.
    expect((await get('adminA', '/chat/ai').expect(200)).body.messages).toEqual([]);
    expect((await get('adminB', '/chat/ai').expect(200)).body.usage.used).toBe(0);
  });

  it('passou do limite: avisa os gestores e para de responder', async () => {
    await send('waiterA', 'post', '/chat/ai/messages', { content: 'E o sangria?' })
      .buffer(true)
      .parse((r, cb) => {
        r.on('data', () => undefined);
        r.on('end', () => cb(null, ''));
      })
      .expect(200);
    const n = (await get('adminA', '/chat/notices').expect(200)).body;
    expect(n[0]).toMatchObject({ kind: 'ai' });
    expect(n[0].title).toContain('limite');
    const s = (await get('waiterA', '/chat/ai').expect(200)).body;
    expect(s).toMatchObject({ enabled: false, reason: 'limit' });
    const r = await send('waiterA', 'post', '/chat/ai/messages', { content: 'oi' }).expect(429);
    expect(r.body.code).toBe('ai_limit');
  });

  it('painel mostra o consumo por restaurante e muda o limite de um', async () => {
    const o = (await pget('/ai').expect(200)).body;
    const a = o.tenants.find((t: { id: string }) => t.id === fx.tenantA);
    expect(a).toMatchObject({ tokens: 1320, calls: 2, users: 1, limit: 1000 });
    expect(a.costUsd).toBeCloseTo(0.00024, 6);
    expect(o.month.calls).toBeGreaterThanOrEqual(2);
    expect(o.days).toHaveLength(30);
    await psend('put', `/ai/tenants/${fx.tenantA}`, { enabled: true, monthlyTokens: 0 }).expect(200);
    expect((await get('waiterA', '/chat/ai').expect(200)).body).toMatchObject({
      enabled: true,
      usage: { limit: 0, percent: null },
    });
    await psend('put', `/ai/tenants/${fx.tenantA}`, { enabled: false, monthlyTokens: null }).expect(200);
    expect((await get('waiterA', '/chat/ai').expect(200)).body.reason).toBe('tenant');
    const audit = await ownerQuery<{ action: string; data: unknown }>(
      `SELECT action, data FROM platform_audit_log WHERE action LIKE 'platform.ai_%'`,
    );
    expect(audit.map((x) => x.action)).toContain('platform.ai_settings_updated');
    expect(JSON.stringify(audit)).not.toContain('sk-or-teste');
  });

  it('apaga a própria conversa', async () => {
    await send('waiterA', 'delete', '/chat/ai/messages').expect(200);
    expect((await get('waiterA', '/chat/ai').expect(200)).body.messages).toEqual([]);
  });
});
