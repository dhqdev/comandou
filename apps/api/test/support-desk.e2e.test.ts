import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
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
 * Conversa do restaurante com a Comandou: o dono escreve pela aba Suporte, o Super Admin vê em
 * Conversas, responde, e cada lado só enxerga o que é dele.
 */
const ADMIN_HOST = 'admin.comandou.test';
const HOST_A = 'sd-a.comandou.test';
const HOST_B = 'sd-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
// Menor PNG válido (1x1).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let admin = '';
let ownerA = '';
let ownerB = '';
let waiterA = '';

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}
const tget = (host: string, c: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', host).set('Cookie', c);
const tpost = (host: string, c: string, url: string, b: object = {}) =>
  http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('Cookie', c).send(b);
const pget = (url: string) =>
  http.get(`/api/v1/platform/support${url}`).set('Host', ADMIN_HOST).set('Cookie', admin);
const ppost = (url: string, b: object = {}) =>
  http
    .post(`/api/v1/platform/support${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', admin)
    .send(b);

beforeAll(async () => {
  fx = await seedTwoTenants('sd');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('suporte@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
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
      email: 'suporte@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  admin = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
  ownerA = await login(HOST_A, 'admin@sd-a.test');
  ownerB = await login(HOST_B, 'admin@sd-b.test');
  waiterA = await login(HOST_A, 'garcom@sd-a.test');
});

afterAll(async () => {
  await app?.close();
});

describe('Conversa do restaurante com a Comandou', () => {
  it('começa vazia e só dono/gerente entram', async () => {
    const s = await tget(HOST_A, ownerA, '/help/chat').expect(200);
    expect(s.body.messages).toEqual([]);
    expect(s.body.unread).toBe(0);
    await tget(HOST_A, waiterA, '/help/chat').expect(403);
  });

  it('o dono manda texto e foto; o painel vê com o nome de quem escreveu', async () => {
    await tpost(HOST_A, ownerA, '/help/chat/messages', { body: 'Oi, a impressora parou' }).expect(
      201,
    );
    const up = await http
      .post('/api/v1/help/chat/files?w=1&h=1')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', ownerA)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(201);
    const m = await tpost(HOST_A, ownerA, '/help/chat/messages', { fileId: up.body.id }).expect(
      201,
    );
    expect(m.body.file.url).toBe(`/api/v1/help/chat/files/${up.body.id}`);
    // O mesmo arquivo não vai em duas mensagens.
    await tpost(HOST_A, ownerA, '/help/chat/messages', { fileId: up.body.id }).expect(422);
    await tget(HOST_A, ownerA, `/help/chat/files/${up.body.id}`).expect(200);
    // Outro restaurante não abre a foto.
    await tget(HOST_B, ownerB, `/help/chat/files/${up.body.id}`).expect(404);

    const unread = await pget('/unread').expect(200);
    expect(unread.body).toEqual({ chats: 1, messages: 2 });
    const list = await pget('').expect(200);
    const row = list.body.find((c: { tenantId: string }) => c.tenantId === fx.tenantA);
    expect(row).toMatchObject({ name: expect.any(String), unread: 2, lastPreview: 'Foto' });
    expect(list.body.some((c: { tenantId: string }) => c.tenantId === fx.tenantB)).toBe(false);

    const d = await pget(`/${fx.tenantA}`).expect(200);
    expect(d.body.tenant.id).toBe(fx.tenantA);
    expect(d.body.messages).toHaveLength(2);
    expect(d.body.messages[0]).toMatchObject({ sender: 'tenant', body: 'Oi, a impressora parou' });
    expect(d.body.messages[0].authorName).toBeTruthy();
    expect(d.body.messages[1].file.url).toBe(`/api/v1/platform/support/files/${up.body.id}`);
    await pget(`/files/${up.body.id}`).expect(200);
  });

  it('o painel responde, marca como lida e o restaurante vê a resposta', async () => {
    await ppost(`/${fx.tenantA}/read`).expect(200);
    expect((await pget('/unread')).body.chats).toBe(0);
    const r = await ppost(`/${fx.tenantA}/messages`, { body: 'Já vamos ver!' }).expect(201);
    expect(r.body).toMatchObject({ sender: 'admin', authorName: 'David' });

    const u = await tget(HOST_A, ownerA, '/help/chat/unread').expect(200);
    expect(u.body).toMatchObject({ available: true, unread: 1 });
    const s = await tget(HOST_A, ownerA, '/help/chat').expect(200);
    expect(s.body.messages.at(-1)).toMatchObject({ sender: 'admin', body: 'Já vamos ver!' });
    expect(s.body.otherReadAt).toBeTruthy();
    await tpost(HOST_A, ownerA, '/help/chat/read').expect(200);
    expect((await tget(HOST_A, ownerA, '/help/chat/unread')).body.unread).toBe(0);
    // O outro restaurante continua sem nada.
    expect((await tget(HOST_B, ownerB, '/help/chat')).body.messages).toEqual([]);
  });

  it('o painel começa conversa com qualquer restaurante e encerra; nova mensagem reabre', async () => {
    await ppost(`/${fx.tenantB}/messages`, { body: 'Bem-vindo à Comandou' }).expect(201);
    expect((await tget(HOST_B, ownerB, '/help/chat/unread')).body.unread).toBe(1);
    await http
      .patch(`/api/v1/platform/support/${fx.tenantA}`)
      .set('Host', ADMIN_HOST)
      .set(CSRF)
      .set('Cookie', admin)
      .send({ status: 'closed' })
      .expect(200);
    let closed = await pget('?status=closed').expect(200);
    expect(closed.body.map((c: { tenantId: string }) => c.tenantId)).toContain(fx.tenantA);
    await tpost(HOST_A, ownerA, '/help/chat/messages', { body: 'Voltou a parar' }).expect(201);
    closed = await pget('?status=closed').expect(200);
    expect(closed.body.map((c: { tenantId: string }) => c.tenantId)).not.toContain(fx.tenantA);
  });

  it('sem login do painel não entra; restaurante inexistente dá 404', async () => {
    await http.get('/api/v1/platform/support').set('Host', ADMIN_HOST).expect(401);
    await ppost('/00000000-0000-4000-8000-000000000000/messages', { body: 'x' }).expect(404);
  });
});
