import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Perfil e cupons do cliente no cardápio da mesa: a loja liga ou desliga (Perfil na mesa e
 * Cupons na mesa), o cliente guarda o CPF na conta e usa o cupom dele no pedido da mesa.
 */
const HOST = 'tacc-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const CPF = '52998224725';

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let admin = '';
let ana = '';
let tableId = '';
let seq = 0;
const key = () => `tacc-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

const staff = (method: 'post' | 'patch', url: string, body: object) =>
  http[method](`/api/v1${url}`).set('Host', HOST).set('Cookie', admin).set(CSRF).send(body);

const menu = (table?: string) =>
  http
    .get(`/api/v1/store${table ? `?mesa=${table}` : ''}`)
    .set('Host', HOST)
    .expect(200)
    .then((r) => r.body);

const tableOrder = (extra: object = {}) =>
  http
    .post('/api/v1/store/orders')
    .set('Host', HOST)
    .set(CSRF)
    .set('Cookie', ana)
    .set('Idempotency-Key', key())
    .send({
      channel: 'table',
      tableId,
      token: token(),
      customerName: 'Ana na Mesa',
      customerCpf: CPF,
      items: [{ productId: fx.prodA, quantity: 2 }],
      ...extra,
    });

beforeAll(async () => {
  fx = await seedTwoTenants('tacc');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@tacc-a.test', password: PASSWORD })
    .expect(200);
  admin = cookieFrom(res, 'cm_sid')!;
  tableId = (await staff('post', '/tables', { label: '7' }).expect(201)).body.id;
  await staff('post', '/coupons', {
    code: 'MESA10',
    title: '10% na mesa',
    kind: 'percent',
    value: '10.00',
  }).expect(201);
});
afterAll(async () => {
  await app?.close();
});

describe('Perfil e cupons na mesa', () => {
  it('cadastro guarda o CPF (conferido) e Meus dados troca', async () => {
    await http
      .post('/api/v1/store/account/signup')
      .set('Host', HOST)
      .set(CSRF)
      .send({
        name: 'Ana',
        phone: '11955554444',
        password: 'segredo-da-ana',
        cpf: '111.111.111-11',
      })
      .expect(400);
    const r = await http
      .post('/api/v1/store/account/signup')
      .set('Host', HOST)
      .set(CSRF)
      .send({
        name: 'Ana',
        phone: '11955554444',
        password: 'segredo-da-ana',
        cpf: '529.982.247-25',
      })
      .expect(201);
    ana = cookieFrom(r, 'cm_cid')!;
    expect(r.body.customer.cpf).toBe(CPF);
    const p = await http
      .patch('/api/v1/store/account')
      .set('Host', HOST)
      .set(CSRF)
      .set('Cookie', ana)
      .send({ cpf: null })
      .expect(200);
    expect(p.body.customer.cpf).toBeNull();
    const back = await http
      .patch('/api/v1/store/account')
      .set('Host', HOST)
      .set(CSRF)
      .set('Cookie', ana)
      .send({ cpf: CPF })
      .expect(200);
    expect(back.body.customer.cpf).toBe(CPF);
  });

  it('a loja liga e desliga: o cardápio da mesa segue', async () => {
    const on = await menu(tableId);
    expect(on.appearance).toMatchObject({ tableAccount: true, tableCoupons: true });
    expect(on.coupons).toBe(1);
    await staff('patch', '/store/settings', { tableCoupons: false }).expect(200);
    const off = await menu(tableId);
    expect(off.appearance.tableCoupons).toBe(false);
    expect(off.coupons).toBe(0);
    // O cardápio online não muda.
    expect((await menu()).coupons).toBe(1);
  });

  it('cupom no pedido da mesa só com os Cupons na mesa ligados', async () => {
    const blocked = await tableOrder({ couponCode: 'MESA10' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toMatch(/cupom no pedido da mesa/);

    await staff('patch', '/store/settings', { tableCoupons: true }).expect(200);
    const ok = await tableOrder({ couponCode: 'MESA10' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [o] = await ownerQuery<{ discount: string; subtotal: string; tax_document: string }>(
      `SELECT discount::text, subtotal::text, tax_document FROM orders
        WHERE tenant_id = $1 AND number = $2`,
      [fx.tenantA, ok.body.number],
    );
    expect(Number(o!.discount)).toBeCloseTo(Number(o!.subtotal) * 0.1, 2);
    expect(o!.tax_document).toBe(CPF);
    const [use] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM coupon_redemptions WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    expect(use!.n).toBe(1);
  });
});
