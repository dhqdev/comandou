import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Conversa do cliente com a loja pelo cardápio online: visitante e conta, fotos e vídeos
 * privados, lado da equipe (só quem gere pedidos) e isolamento entre restaurantes.
 */
const HOST_A = 'sc-a.comandou.test';
const HOST_B = 'sc-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let port: number;
const staff: Record<string, string> = {};

const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

async function staffLogin(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieFrom(res, 'cm_sid')!;
}

const c = {
  get: (url: string, cookie?: string, host = HOST_A) => {
    const r = http.get(`/api/v1${url}`).set('Host', host);
    return cookie ? r.set('Cookie', cookie) : r;
  },
  post: (url: string, body: object, cookie?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (cookie) r.set('Cookie', cookie);
    return r.send(body);
  },
  upload: (url: string, type: string, bytes: Buffer, cookie?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('Content-Type', type);
    if (cookie) r.set('Cookie', cookie);
    return r.send(bytes);
  },
};
const admin = {
  get: (url: string, who = 'adminA') =>
    http
      .get(`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who]),
  send: (method: 'post' | 'patch', url: string, body: object, who = 'adminA') =>
    http[method](`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who])
      .set(CSRF)
      .send(body),
};

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.alloc(2000, 3),
]);

beforeAll(async () => {
  await seedTwoTenants('sc');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  http = request(app.getHttpServer());
  staff.adminA = await staffLogin(HOST_A, 'admin@sc-a.test');
  staff.adminB = await staffLogin(HOST_B, 'admin@sc-b.test');
  staff.waiterA = await staffLogin(HOST_A, 'garcom@sc-a.test');
});
afterAll(async () => {
  await app?.close();
});

let guest: string;
let chatId: string;
let videoId: string;

describe('Conversa do cliente com a loja', () => {
  it('visitante vê o convite; sem começar não envia', async () => {
    const r = await c.get('/store/chat').expect(200);
    expect(r.body).toMatchObject({ enabled: true, chat: null, messages: [] });
    await c.post('/store/chat/messages', { body: 'oi' }).expect(404);
    await c.post('/store/chat/start', { name: 'Ana', phone: '119' }).expect(400);
  });

  it('visitante começa com nome e celular e recebe o cookie da conversa', async () => {
    const r = await c
      .post('/store/chat/start', { name: 'Ana Visitante', phone: '(11) 97777-6666' })
      .expect(200);
    guest = cookieFrom(r, 'cm_chat')!;
    expect(guest).toBeTruthy();
    expect(r.body.chat).toMatchObject({ name: 'Ana Visitante', status: 'open' });
    chatId = r.body.chat.id;
    const m = await c
      .post('/store/chat/messages', { body: 'Oi! Vocês têm opção sem glúten? 😀' }, guest)
      .expect(201);
    expect(m.body).toMatchObject({
      sender: 'customer',
      body: 'Oi! Vocês têm opção sem glúten? 😀',
    });
    // Outro restaurante não conhece esta conversa.
    const b = await c.get('/store/chat', guest, HOST_B).expect(200);
    expect(b.body.chat).toBeNull();
  });

  it('foto e vídeo: tipo conferido, só o dono da conversa e a equipe abrem', async () => {
    await c.upload('/store/chat/files', 'image/png', Buffer.from('nao e png'), guest).expect(422);
    await c.upload('/store/chat/files', 'image/png', PNG).expect(404);
    const img = await c.upload('/store/chat/files', 'image/png', PNG, guest).expect(201);
    expect(img.body.kind).toBe('image');
    const vid = await c.upload('/store/chat/files', 'video/mp4', MP4, guest).expect(201);
    expect(vid.body.kind).toBe('video');
    videoId = vid.body.id;
    const sent = await c
      .post('/store/chat/messages', { body: '', fileId: img.body.id }, guest)
      .expect(201);
    expect(sent.body.file).toMatchObject({ kind: 'image' });
    // O mesmo arquivo não vale para outra mensagem.
    await c.post('/store/chat/messages', { fileId: img.body.id }, guest).expect(422);
    await c.post('/store/chat/messages', { fileId: videoId }, guest).expect(201);

    await c.get(`/store/chat/files/${img.body.id}`, guest).expect(200);
    await c.get(`/store/chat/files/${img.body.id}`).expect(404);
    await admin.get(`/support/chats/files/${img.body.id}`).expect(200);
    await admin.get(`/support/chats/files/${img.body.id}`, 'adminB').expect(404);
    // Vídeo em pedaços (o iPhone pede assim).
    const part = await c
      .get(`/store/chat/files/${videoId}`, guest)
      .set('Range', 'bytes=0-99')
      .expect(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${MP4.length}`);
    expect(Number(part.headers['content-length'])).toBe(100);
  });

  it('a equipe vê a conversa esperando, responde e marca como lida', async () => {
    await admin.get('/support/chats', 'waiterA').expect(403);
    const un = await admin.get('/support/chats/unread').expect(200);
    expect(un.body).toMatchObject({ chats: 1, messages: 3 });
    expect(un.body.latest[0]).toMatchObject({ id: chatId, name: 'Ana Visitante' });
    const other = await admin.get('/support/chats/unread', 'adminB').expect(200);
    expect(other.body.chats).toBe(0);

    const list = await admin.get('/support/chats').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      phone: '11977776666',
      unread: 3,
      lastPreview: '🎬 Vídeo',
    });

    const d = await admin.get(`/support/chats/${chatId}`).expect(200);
    expect(d.body.messages).toHaveLength(3);
    expect(d.body.messages[1].file.url).toContain('/support/chats/files/');

    const reply = await admin
      .send('post', `/support/chats/${chatId}/messages`, { body: 'Temos sim! 🍕' })
      .expect(201);
    expect(reply.body).toMatchObject({ sender: 'staff', authorName: 'Admin' });
    expect((await admin.get('/support/chats/unread').expect(200)).body.chats).toBe(0);

    const st = await c.get('/store/chat', guest).expect(200);
    expect(st.body.unread).toBe(1);
    expect(st.body.messages.at(-1)).toMatchObject({ sender: 'staff', body: 'Temos sim! 🍕' });
    expect((await c.get('/store/chat/unread', guest).expect(200)).body.unread).toBe(1);
    await c.post('/store/chat/read', {}, guest).expect(200);
    expect((await c.get('/store/chat/unread', guest).expect(200)).body.unread).toBe(0);
  });

  it('encerrar e reabrir: mensagem nova do cliente reabre', async () => {
    await admin.send('patch', `/support/chats/${chatId}`, { status: 'closed' }).expect(200);
    expect((await admin.get('/support/chats?status=open').expect(200)).body).toHaveLength(0);
    await c.post('/store/chat/messages', { body: 'Obrigada!' }, guest).expect(201);
    const open = await admin.get('/support/chats?status=open').expect(200);
    expect(open.body[0]).toMatchObject({ id: chatId, status: 'open', unread: 1 });
  });

  it('cliente com conta conversa sem informar nada e cita um pedido inexistente', async () => {
    const r = await c
      .post('/store/account/signup', {
        name: 'Bruno Conta',
        phone: '11966665555',
        password: 'segredo1',
      })
      .expect(201);
    const acc = cookieFrom(r, 'cm_cid')!;
    await c.post('/store/chat/messages', { body: '', orderNumber: 999999 }, acc).expect(422);
    await c.post('/store/chat/messages', { body: 'Cadê meu pedido?' }, acc).expect(201);
    const st = await c.get('/store/chat', acc).expect(200);
    expect(st.body.chat).toMatchObject({ name: 'Bruno Conta' });
    const list = await admin.get('/support/chats?q=Bruno').expect(200);
    expect(list.body[0]).toMatchObject({ name: 'Bruno Conta', phone: '11966665555' });
    expect(list.body[0].customerId).toBeTruthy();
  });

  it('tempo real: o aparelho do cliente só entra na sala da própria conversa', async () => {
    const connect = (host: string, cookie?: string) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(`http://127.0.0.1:${port}`, {
          path: '/api/ws',
          transports: ['websocket'],
          extraHeaders: { Host: host, ...(cookie ? { Cookie: cookie } : {}) },
          reconnection: false,
          timeout: 3000,
        });
        s.on('ready', () => resolve(s));
        s.on('connect_error', (e) => reject(e));
      });
    await expect(connect(HOST_A, 'cm_chat=invalido')).rejects.toThrow(/unauthorized/);
    await expect(connect(HOST_B, guest)).rejects.toThrow(/unauthorized/);
    const cs = await connect(HOST_A, guest);
    const ss = await connect(HOST_A, staff.adminA);
    const gotC: { type: string; chatId?: string; sender?: string }[] = [];
    const gotS: { type: string; chatId?: string; sender?: string }[] = [];
    cs.on('event', (e) => gotC.push(e));
    ss.on('event', (e) => gotS.push(e));
    try {
      await admin
        .send('post', `/support/chats/${chatId}/messages`, { body: 'Já já sai!' })
        .expect(201);
      await c.post('/store/chat/messages', { body: 'Valeu' }, guest).expect(201);
      // Evento da operação (loja) não chega ao cliente.
      await admin.send('patch', '/store/settings', { isOpen: true }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(gotC.filter((e) => e.type === 'support.message').map((e) => e.sender)).toEqual([
        'staff',
        'customer',
      ]);
      expect(gotC.every((e) => e.type.startsWith('support.'))).toBe(true);
      expect(gotS.some((e) => e.type === 'support.message' && e.sender === 'customer')).toBe(true);
    } finally {
      cs.close();
      ss.close();
    }
  });

  it('a loja pode desligar a conversa', async () => {
    await admin.send('patch', '/store/settings', { chatEnabled: false }).expect(200);
    const st = await c.get('/store/chat', guest).expect(200);
    expect(st.body).toMatchObject({ enabled: false, chat: null });
    await c.post('/store/chat/messages', { body: 'oi' }, guest).expect(403);
    const menu = await c.get('/store').expect(200);
    expect(menu.body.appearance.chatEnabled).toBe(false);
    await admin.send('patch', '/store/settings', { chatEnabled: true }).expect(200);
  });
});
