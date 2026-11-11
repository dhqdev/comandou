import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Estoque por quilo com dois tamanhos do mesmo insumo (o caso do frango frito) e a reserva do
 * pedido online em análise: o estoque sai quando o cliente pede, não só quando a loja aceita.
 * Arquivo próprio: o pedido público tem limite por minuto.
 */
const HOST = 'frango-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let cookie = '';
let seq = 0;
const key = () => `frango-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

const get = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookie);
const send = (m: 'post' | 'put' | 'patch', url: string, body: object, idem?: string) => {
  const r = http[m](`/api/v1${url}`).set('Host', HOST).set('Cookie', cookie).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const pubOrder = (productId: string, quantity = 1) =>
  http
    .post('/api/v1/store/orders')
    .set('Host', HOST)
    .set(CSRF)
    .set('Idempotency-Key', key())
    .send({
      channel: 'pickup',
      token: token(),
      customerName: 'Cliente do Frango',
      customerPhone: '11988887777',
      paymentMethod: 'cash',
      items: [{ productId, quantity }],
    });

let frango = '';
let balde = '';
let porcao = '';
const saldo = async () =>
  ((await get('/stock/items').expect(200)).body as { id: string; quantity: string }[]).find(
    (i) => i.id === frango,
  )!.quantity;
const menu = async () => {
  const cats = (await http.get('/api/v1/store').set('Host', HOST).expect(200)).body.categories as {
    products: { id: string; soldOut: boolean }[];
  }[];
  const all = cats.flatMap((c) => c.products);
  return (id: string) => all.find((p) => p.id === id)!.soldOut;
};

beforeAll(async () => {
  fx = await seedTwoTenants('frango');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@frango-a.test', password: PASSWORD });
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  await send('patch', '/store/settings', { enabled: true, isOpen: true, autoAccept: false }).expect(
    200,
  );
  const [b] = await ownerQuery<{ id: string }>(
    `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,'Balde 1,5 kg','89.90') RETURNING id`,
    [fx.tenantA, fx.catA],
  );
  const [p] = await ownerQuery<{ id: string }>(
    `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,'Porção 75 g','9.90') RETURNING id`,
    [fx.tenantA, fx.catA],
  );
  balde = b!.id;
  porcao = p!.id;
  frango = (await send('post', '/stock/items', { name: 'Frango frito', unit: 'kg' }).expect(201))
    .body.id;
  await send('put', `/stock/recipes/products/${balde}`, {
    lines: [{ stockItemId: frango, quantity: '1.5' }],
  }).expect(200);
  await send('put', `/stock/recipes/products/${porcao}`, {
    lines: [{ stockItemId: frango, quantity: '0.075' }],
  }).expect(200);
  // 3,1 kg prontos para vender: dois baldes e sobra 100 g (uma porção).
  await send(
    'post',
    `/stock/items/${frango}/movements`,
    { kind: 'purchase', quantity: '3.1', unitCost: '20.00' },
    key(),
  ).expect(201);
});

afterAll(async () => {
  await app?.close();
});

describe('Estoque por quilo e reserva do pedido online', () => {
  let first = '';
  it('pedido em análise já reserva o estoque', async () => {
    const r = await pubOrder(balde).expect(201);
    expect(r.body.status).toBe('awaiting');
    first = r.body.id;
    expect(await saldo()).toBe('1.600');
  });

  it('o segundo cliente leva o último balde e o terceiro é barrado na hora', async () => {
    await pubOrder(balde).expect(201);
    expect(await saldo()).toBe('0.100');
    const soldOut = await menu();
    // Falta frango para o balde, mas a porção de 75 g continua à venda.
    expect(soldOut(balde)).toBe(true);
    expect(soldOut(porcao)).toBe(false);
    const third = await pubOrder(balde);
    expect(third.status).toBeGreaterThanOrEqual(400);
    expect(await saldo()).toBe('0.100');
  });

  it('a porção vende até não caber mais uma; depois esgota também', async () => {
    await pubOrder(porcao).expect(201);
    expect(await saldo()).toBe('0.025');
    const soldOut = await menu();
    expect(soldOut(porcao)).toBe(true);
    const r = await pubOrder(porcao);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('aceitar não baixa de novo; recusar devolve a reserva', async () => {
    const orders = (await get('/orders?status=awaiting').expect(200)).body as { id: string }[];
    const id = first || orders[0]!.id;
    const o = (await get(`/orders/${id}`).expect(200)).body;
    await send('post', `/orders/${id}/status`, { to: 'new', expectedVersion: o.version }).expect(
      201,
    );
    expect(await saldo()).toBe('0.025');
    const [other] = await ownerQuery<{ id: string }>(
      `SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.tenant_id = $1 AND o.status = 'awaiting' AND i.product_id = $2 LIMIT 1`,
      [fx.tenantA, balde],
    );
    await send('post', `/orders/${other!.id}/status`, {
      to: 'cancelled',
      reason: 'Sem entregador',
    }).expect(201);
    expect(await saldo()).toBe('1.525');
    const soldOut = await menu();
    expect(soldOut(balde)).toBe(false);
  });
});
