import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Conta › Meus dados e Conta › Dados do restaurante: o dono muda o cadastro do restaurante e o
 * painel Super Admin lê o mesmo cadastro (tenants + tenant_profiles) e o histórico.
 */
let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
const HOST_A = 'acc-a.comandou.test';
const HOST_B = 'acc-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const cookies: Record<string, string> = {};

async function login(host: string, email: string, password = PASSWORD) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}
const hostOf = (who: string) => (who.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const patch = (w: string, url: string, body: object) =>
  http
    .patch(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

beforeAll(async () => {
  fx = await seedTwoTenants('acc');
  app = await createApp(
    testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000', PLATFORM_DATABASE_URL: PLATFORM_URL }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@acc-a.test');
  cookies.adminB = await login(HOST_B, 'admin@acc-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@acc-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Conta › Dados do restaurante', () => {
  const data = {
    name: 'Fumaça Burger',
    legalName: 'Fumaça Lanches LTDA',
    document: '11.222.333/0001-81',
    contactName: 'Thiago Ferraz',
    phone: '(11) 98765-4321',
    billingEmail: 'Financeiro@Fumaca.test',
    city: 'Campinas',
    state: 'sp',
  };

  it('o dono grava e o cadastro do painel (banco central) fica igual', async () => {
    const res = await patch('adminA', '/account/restaurant', data);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Fumaça Burger',
      document: '11222333000181',
      phone: '11987654321',
      billingEmail: 'financeiro@fumaca.test',
      state: 'SP',
    });
    const [row] = await ownerQuery<Record<string, string>>(
      `SELECT t.name, p.legal_name, p.document, p.contact_name, p.city, p.notes
         FROM tenants t JOIN tenant_profiles p ON p.tenant_id = t.id WHERE t.id = $1`,
      [fx.tenantA],
    );
    expect(row).toMatchObject({
      name: 'Fumaça Burger',
      legal_name: 'Fumaça Lanches LTDA',
      document: '11222333000181',
      contact_name: 'Thiago Ferraz',
      city: 'Campinas',
      notes: null,
    });
    // O nome novo já vale na sessão (topo do sistema).
    const me = await get('adminA', '/auth/me');
    expect(me.body.tenant.name).toBe('Fumaça Burger');
    // Histórico do restaurante no painel: quem mudou e o quê.
    const log = await ownerQuery<{ data: { by: string; fields: string[] } }>(
      `SELECT data FROM platform_audit_log WHERE tenant_id = $1 AND action = 'tenant.profile_updated'`,
      [fx.tenantA],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.data.by).toBe('Admin A');
    expect(log[0]!.data.fields).toEqual(expect.arrayContaining(['name', 'document', 'state']));
  });

  it('as observações internas do painel não mudam nem aparecem', async () => {
    await ownerQuery(`UPDATE tenant_profiles SET notes = 'cliente antigo' WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    const res = await patch('adminA', '/account/restaurant', {
      ...data,
      city: 'Valinhos',
      notes: 'apagar',
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    const [row] = await ownerQuery<{ notes: string }>(
      `SELECT notes FROM tenant_profiles WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    expect(row!.notes).toBe('cliente antigo');
    const got = await get('adminA', '/account');
    expect(got.body.restaurant).toMatchObject({ city: 'Valinhos' });
    expect(got.body.restaurant).not.toHaveProperty('notes');
  });

  it('CPF/CNPJ inválido é recusado', async () => {
    const res = await patch('adminA', '/account/restaurant', { ...data, document: '11111111111' });
    expect(res.status).toBe(400);
  });

  it('só o dono: garçom não lê nem grava, e cada restaurante só o seu', async () => {
    expect((await get('waiterA', '/account')).body.restaurant).toBeNull();
    expect((await patch('waiterA', '/account/restaurant', data)).status).toBe(403);
    // O dono do B grava o B; o A continua como estava.
    expect((await patch('adminB', '/account/restaurant', { name: 'Pizzaria B' })).status).toBe(200);
    const rows = await ownerQuery<{ id: string; name: string }>(
      `SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
    expect(rows.find((r) => r.id === fx.tenantA)!.name).toBe('Fumaça Burger');
    expect(rows.find((r) => r.id === fx.tenantB)!.name).toBe('Pizzaria B');
  });
});

describe('Conta › Meus dados', () => {
  it('troca o nome sem senha', async () => {
    const res = await patch('adminA', '/account/me', {
      name: 'Thiago Ferraz',
      email: 'admin@acc-a.test',
    });
    expect(res.status).toBe(200);
    expect((await get('adminA', '/auth/me')).body.user.name).toBe('Thiago Ferraz');
    const log = await ownerQuery<{ data: { fields: string[] } }>(
      `SELECT data FROM platform_audit_log WHERE tenant_id = $1 AND action = 'tenant.owner_updated'`,
      [fx.tenantA],
    );
    expect(log.at(-1)!.data.fields).toEqual(['name']);
  });

  it('e-mail novo pede a senha atual e não pode ser de outra conta', async () => {
    const body = { name: 'Thiago Ferraz', email: 'thiago@acc-a.test' };
    expect((await patch('adminA', '/account/me', body)).status).toBe(401);
    expect(
      (await patch('adminA', '/account/me', { ...body, currentPassword: 'errada-123' })).status,
    ).toBe(401);
    const taken = await patch('adminA', '/account/me', {
      ...body,
      email: 'garcom@acc-a.test',
      currentPassword: PASSWORD,
    });
    expect(taken.status).toBe(409);
    const ok = await patch('adminA', '/account/me', { ...body, currentPassword: PASSWORD });
    expect(ok.status).toBe(200);
    // Entra com o e-mail novo.
    cookies.adminA = await login(HOST_A, 'thiago@acc-a.test');
    expect((await get('adminA', '/auth/me')).body.user.email).toBe('thiago@acc-a.test');
  });

  it('não muda a conta de outra pessoa', async () => {
    const res = await patch('waiterA', '/account/me', {
      name: 'Garçom Novo',
      email: 'garcom@acc-a.test',
    });
    expect(res.status).toBe(200);
    const [admin] = await ownerQuery<{ name: string }>(
      `SELECT name FROM users WHERE email = 'thiago@acc-a.test'`,
    );
    expect(admin!.name).toBe('Thiago Ferraz');
  });
});
