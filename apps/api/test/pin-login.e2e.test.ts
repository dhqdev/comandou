import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PIN_LOCK_THRESHOLD, pinHash } from '../src/auth/pin';
import { createApp } from '../src/bootstrap';
import { APP_URL, testEnv } from './env';
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

  it('dono de A não toma a conta que a pessoa usa em B (PIN + trocar senha)', async () => {
    // O administrador de A põe o e-mail do dono de B na equipe como garçom: a conta é a mesma.
    const chosen = await as(admin).post('/users', {
      email: 'admin@pin-b.test',
      name: 'Vítima',
      password: 'senha-qualquer-1',
      role: 'waiter',
      pin: '7392',
    });
    expect(chosen.status).toBe(409);
    expect(chosen.body.message).toMatch(/outro restaurante/);
    const added = await as(admin).post('/users', {
      email: 'admin@pin-b.test',
      name: 'Vítima',
      password: 'senha-qualquer-1',
      role: 'waiter',
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ existingAccount: true, pin: null, hasPin: false });
    const victim = added.body.id as string;
    // Nem pelo botão Criar PIN.
    const setPin = await as(admin).post(`/users/${victim}/pin`, { pin: '7392' });
    expect(setPin.status).toBe(409);
    expect(setPin.body.message).toMatch(/outro restaurante/);

    // PIN que já existia antes da correção também não abre a conta.
    await ownerQuery(`UPDATE memberships SET pin_hash = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      fx.tenantA,
      victim,
      pinHash(fx.tenantA, '7392'),
    ]);
    const viaPin = await pinLogin('7392', 'waiter');
    expect(viaPin.status).toBe(403);
    expect(cookieOf(viaPin)).toBe('');

    // Mesmo com uma sessão da pessoa em A, a senha (que vale em B) só muda com a senha atual.
    const inA = cookieOf(
      await http
        .post('/api/v1/auth/login')
        .set('Host', HOST_A)
        .set(CSRF)
        .send({ email: 'admin@pin-b.test', password: PASSWORD }),
    );
    const noCurrent = await as(inA).post('/auth/password', { next: 'tomada-de-conta-1' });
    expect(noCurrent.status).toBe(401);
    expect(noCurrent.body.code).toBe('current_password');
    const wrong = await as(inA).post('/auth/password', {
      next: 'tomada-de-conta-1',
      current: 'chute-errado-1',
    });
    expect(wrong.status).toBe(401);
    const intoB = (password: string) =>
      http
        .post('/api/v1/auth/login')
        .set('Host', HOST_B)
        .set(CSRF)
        .send({ email: 'admin@pin-b.test', password });
    expect((await intoB('tomada-de-conta-1')).status).toBe(401);
    expect((await intoB(PASSWORD)).status).toBe(200);

    // O banco também recusa a troca sem a senha atual (e com hash que não é o atual).
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      const call = async (user: string, sql: string) => {
        await c.query('BEGIN');
        try {
          await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
          await c.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
          return (await c.query(sql)).rows[0] as Record<string, unknown>;
        } finally {
          await c.query('ROLLBACK');
        }
      };
      await expect(call(victim, `SELECT app_set_own_password('x')`)).rejects.toMatchObject({
        code: '42501',
      });
      expect(await call(victim, `SELECT app_set_own_password('x', 'outro') AS ok`)).toEqual({
        ok: false,
      });
      // Conta só deste restaurante continua trocando sem a senha atual.
      const [{ id: own }] = await ownerQuery<{ id: string }>(
        `SELECT id FROM users WHERE email = 'garcom@pin-a.test'`,
      );
      await expect(call(own, `SELECT app_set_own_password('x')`)).resolves.toBeTruthy();
    } finally {
      await c.end();
    }

    // A própria pessoa, sabendo a senha atual, troca normalmente.
    const ok = await as(inA).post('/auth/password', {
      next: 'senha-nova-do-dono-b',
      current: PASSWORD,
    });
    expect(ok.status).toBe(204);
    // A sessão aberta no outro restaurante (com a senha antiga) cai; a de quem trocou continua.
    expect((await as(adminB, HOST_B).get('/auth/me')).status).toBe(401);
    expect((await as(inA).get('/auth/me')).status).toBe(200);
    expect((await intoB('senha-nova-do-dono-b')).status).toBe(200);
    adminB = cookieOf(await intoB('senha-nova-do-dono-b'));
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

  it('PINs errados ao mesmo tempo não passam do limite do restaurante', async () => {
    const d = await as(adminB, HOST_B).post('/users', { name: 'Moto B', role: 'driver' });
    expect(d.status).toBe(201);
    const count = async () =>
      (
        await ownerQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE tenant_id = $1 AND action = 'auth.pin_failed'`,
          [fx.tenantB],
        )
      )[0].n;
    const before = await count();
    const wrongPin = d.body.pin === '9071' ? '9072' : '9071';
    const res = await Promise.all(
      Array.from({ length: 30 }, () => pinLogin(wrongPin, 'driver', HOST_B)),
    );
    // Cada tentativa conta e confere uma por vez: só as que cabem no limite são avaliadas.
    expect(await count()).toBe(PIN_LOCK_THRESHOLD);
    expect(res.filter((r) => r.status === 401)).toHaveLength(PIN_LOCK_THRESHOLD - before);
    expect(res.filter((r) => r.status === 429)).toHaveLength(30 - (PIN_LOCK_THRESHOLD - before));
    // Pausado: nem o PIN certo entra.
    expect((await pinLogin(d.body.pin, 'driver', HOST_B)).status).toBe(429);
  });
});
