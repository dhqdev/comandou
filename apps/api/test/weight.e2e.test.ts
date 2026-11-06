import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Venda por peso (sorveteria, restaurante por quilo): o item guarda a tara, o pedido grava o peso
 * em kg com a unidade 'kg' e cobra preço do kg × peso. Item por unidade continua só com inteiros.
 */
const HOST_A = 'kg-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let cookie = '';

const post = (url: string, body: object, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const put = (url: string, body: object) =>
  http.put(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie).set(CSRF).send(body);
const get = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie);

beforeAll(async () => {
  fx = await seedTwoTenants('kg');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email: 'admin@kg-a.test', password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  cookie = raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
});
afterAll(async () => {
  await app?.close();
});

describe('Venda por peso', () => {
  let kilo: string;

  it('cadastra o item por peso com a tara', async () => {
    const r = await post('/products', {
      categoryId: fx.catA,
      name: 'Sorvete no peso',
      price: '60.00',
      soldByWeight: true,
      weightTare: '0.020',
    }).expect(201);
    kilo = r.body.id;
    expect(r.body.soldByWeight).toBe(true);
    expect(r.body.weightTare).toBe('0.020');
    await post('/products', {
      categoryId: fx.catA,
      name: 'Tara errada',
      price: '1.00',
      weightTare: '0,02',
    }).expect(400);
    // O cardápio de venda leva a marca e a tara para a tela de pesagem.
    const menu = (await get('/menu?channel=counter').expect(200)).body as {
      products: { id: string; soldByWeight: boolean; weightTare: string }[];
    }[];
    const p = menu.flatMap((c) => c.products).find((x) => x.id === kilo)!;
    expect(p).toMatchObject({ soldByWeight: true, weightTare: '0.020' });
  });

  it('cobra o peso × preço do kg e grava a unidade kg', async () => {
    const r = await post(
      '/orders',
      {
        channel: 'counter',
        items: [
          { productId: kilo, quantity: 0.35 },
          { productId: fx.prodA, quantity: 2 },
        ],
      },
      crypto.randomUUID(),
    ).expect(201);
    const items = r.body.items as {
      productId: string;
      quantity: string;
      unit: string;
      total: string;
    }[];
    const weighed = items.find((i) => i.productId === kilo);
    expect(weighed).toMatchObject({ quantity: '0.350', unit: 'kg', total: '21.00' });
    expect(items.find((i) => i.productId === fx.prodA)!.unit).toBe('un');
    const [row] = await ownerQuery<{ unit: string }>(
      `SELECT unit FROM order_items WHERE order_id = $1 AND product_id = $2`,
      [r.body.id, kilo],
    );
    expect(row!.unit).toBe('kg');
  });

  it('item por unidade não aceita fração; peso aceita até 3 casas', async () => {
    const bad = await post(
      '/orders',
      { channel: 'counter', items: [{ productId: fx.prodA, quantity: 1.5 }] },
      crypto.randomUUID(),
    ).expect(422);
    expect(bad.body.message).toMatch(/vendido por unidade/);
    await post(
      '/orders',
      { channel: 'counter', items: [{ productId: kilo, quantity: 0.3505 }] },
      crypto.randomUUID(),
    ).expect(400);
  });

  it('a ficha do item por peso é por 1 kg: a baixa é a ficha × o peso vendido', async () => {
    const leite = (await post('/stock/items', { name: 'Base de sorvete', unit: 'kg' }).expect(201))
      .body;
    await post(`/stock/items/${leite.id}/movements`, { kind: 'purchase', quantity: '1' }).expect(
      201,
    );
    // 1 kg de sorvete vendido leva 1,1 kg de base (perda na máquina).
    await put(`/stock/recipes/products/${kilo}`, {
      lines: [{ stockItemId: leite.id, quantity: '1.1' }],
    }).expect(200);
    // Menos de 1 kg de ficha no estoque não trava o item por peso: só trava quando zera.
    const av = (await get('/stock/availability').expect(200)).body as {
      productId: string;
      out: boolean;
      portions: number | null;
    }[];
    expect(av.find((a) => a.productId === kilo)).toMatchObject({ out: false, portions: null });
    await post(
      '/orders',
      { channel: 'counter', items: [{ productId: kilo, quantity: 0.35 }] },
      crypto.randomUUID(),
    ).expect(201);
    const items = (await get('/stock/items').expect(200)).body as {
      id: string;
      quantity: string;
    }[];
    // 1,000 − 1,1 × 0,350 = 0,615.
    expect(items.find((i) => i.id === leite.id)!.quantity).toBe('0.615');
  });
});
