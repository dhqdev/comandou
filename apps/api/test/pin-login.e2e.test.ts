import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Entrada do garçom e do entregador pelo PIN de 4 números: cadastro só com nome, PIN único no
 * restaurante, só vale no app do papel, não cruza restaurantes, troca derruba as sessões e o
 * restaurante pausa a entrada por PIN depois de muitos erros.
 */
const HOST_A = 'pin-a.comandou.test';
const HOST_B = 'pin-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let admin = '';
let adminB = '';

const cookieOf = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith('cm_sid='))
    ?.split(';')[0] ?? '';

const pinLogin = (pin: string, appName: 'waiter' | 'driver', host = HOST_A) =>
  http.post('/api/v1/auth/pin').set('Host', host).set(CSRF).send({ pin, app: appName });
const as = (cookie: string, host = HOST_A) => ({
  get: (url: string) => http.get(`/api/v1${url}`).set('Host', host).set('Cookie', cookie),
  post: (url: string, body: object = {}) =>
    http.post(`/api/v1${url}`).set('Host', host).set('Cookie', cookie).set(CSRF).send(body),
  patch: (url: string, body: object) =>
    http.patch(`/api/v1${url}`).set('Host', host).set('Cookie', cookie).set(CSRF).send(body),
});

beforeAll(async () => {
  fx = await seedTwoTenants('pin');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const login = async (host: string, email: string) =>
    cookieOf(
      await http
        .post('/api/v1/auth/login')
        .set('Host', host)
        .set(CSRF)
        .send({ email, password: PASSWORD }),
    );
  admin = await login(HOST_A, 'admin@pin-a.test');
  adminB = await login(HOST_B, 'admin@pin-b.test');
});
afterAll(async () => {
  await app?.close();
});

describe('PIN da equipe', () => {
  let waiter: { id: string; pin: string };
  let driver: { id: string; pin: string };

  it('garçom e entregador são cadastrados só com o nome e já recebem um PIN', async () => {
    const w = await as(admin).post('/users', { name: 'Garçom Pin', role: 'waiter' });
    expect(w.status).toBe(201);
    expect(w.body.pin).toMatch(/^[0-9]{4}$/);
    expect(w.body.hasPin).toBe(true);
    waiter = { id: w.body.id, pin: w.body.pin };

    const d = await as(admin).post('/users', { name: 'Moto Pin', role: 'driver', pin: '4071' });
    expect(d.status).toBe(201);
    expect(d.body.pin).toBe('4071');
    driver = { id: d.body.id, pin: '4071' };
    // Entregador já entra na lista de quem leva o pedido (Entregas).
    const couriers = await as(admin).get('/couriers');
    expect(couriers.body.find((c: { userId: string }) => c.userId === driver.id)).toBeTruthy();

    // Outros papéis continuam pedindo e-mail e senha; PIN fraco ou repetido é recusado.
    expect((await as(admin).post('/users', { name: 'Caixa', role: 'cashier' })).status).toBe(400);
    expect(
      (await as(admin).post('/users', { name: 'Xy', role: 'waiter', pin: '1234' })).status,
    ).toBe(409);
    expect(
      (await as(admin).post('/users', { name: 'Xy', role: 'waiter', pin: '4071' })).status,
    ).toBe(409);
    // O PIN nunca vai para a auditoria. Olha só este restaurante e os campos de PIN: o banco de
    // teste é compartilhado e um UUID ou IP de outro teste pode ter "4071" por acaso.
    const [a] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1
          AND (data->>'pin' = '4071' OR data::text ~ '(^|[^0-9a-f-])4071([^0-9a-f-]|$)')`,
      [fx.tenantA],
    );
    expect(a.n).toBe(0);
  });

  it('o PIN entra só no app do próprio papel', async () => {
    const ok = await pinLogin(driver.pin, 'driver');
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('driver');
    const me = await as(cookieOf(ok)).get('/auth/me');
    expect(me.body.user.id).toBe(driver.id);

    expect((await pinLogin(driver.pin, 'waiter')).status).toBe(401);
    const w = await pinLogin(waiter.pin, 'waiter');
    expect(w.status).toBe(200);
    expect((await pinLogin('12a4', 'waiter')).status).toBe(400);
  });

  it('o PIN de um restaurante não entra no outro', async () => {
    expect((await pinLogin(driver.pin, 'driver', HOST_B)).status).toBe(401);
    // E o administrador do B não mexe no PIN de quem é do A.
    expect((await as(adminB, HOST_B).post(`/users/${driver.id}/pin`, {})).status).toBe(404);
  });

  it('trocar o PIN tira a pessoa dos aparelhos e o antigo para de valer', async () => {
    const s = cookieOf(await pinLogin(waiter.pin, 'waiter'));
    expect((await as(s).get('/auth/me')).status).toBe(200);
    const r = await as(admin).post(`/users/${waiter.id}/pin`, { pin: '5820' });
    expect(r.status).toBe(201);
    expect(r.body.pin).toBe('5820');
    expect((await as(s).get('/auth/me')).status).toBe(401);
    expect((await pinLogin(waiter.pin, 'waiter')).status).toBe(401);
    expect((await pinLogin('5820', 'waiter')).status).toBe(200);
    waiter.pin = '5820';
  });

  it('desativado não entra; virar caixa apaga o PIN', async () => {
    await as(admin).patch(`/users/${waiter.id}`, { status: 'revoked' });
    expect((await pinLogin(waiter.pin, 'waiter')).status).toBe(401);
    await as(admin).patch(`/users/${waiter.id}`, { status: 'active', role: 'cashier' });
    const list = await as(admin).get('/users');
    expect(list.body.find((m: { id: string }) => m.id === waiter.id).hasPin).toBe(false);
    expect((await as(admin).post(`/users/${waiter.id}/pin`, {})).status).toBe(409);
  });

  it('muitos PINs errados no restaurante pausam a entrada por PIN (só nele)', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pinLogin('9071', 'driver')).status;
    expect(last).toBe(429);
    // Nem o PIN certo entra durante a pausa.
    expect((await pinLogin(driver.pin, 'driver')).status).toBe(429);
    // O outro restaurante não é afetado (responde 401 normal, não 429).
    expect((await pinLogin('9071', 'driver', HOST_B)).status).toBe(401);
  });
});
