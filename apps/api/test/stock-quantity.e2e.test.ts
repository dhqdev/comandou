import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Quantidade em estoque do item do cardápio (coluna Estoque da lista de itens): reaproveita o
 * estoque. Item sem ficha ganha o controle simples (insumo com o nome do item, 1 por venda);
 * item com ficha "1 por venda" tem o insumo contado; ficha de vários insumos não aceita número.
 */
const HOST_A = 'sq-a.comandou.test';
const HOST_B = 'sq-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

async function login(who: string, host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  cookies[who] = raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}
const hostOf = (w: string) => (w === 'adminB' ? HOST_B : HOST_A);
const post = (w: string, url: string, body: object, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const put = (w: string, url: string, body: object) =>
  http.put(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!).set(CSRF).send(body);
const get = (w: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!);

type Av = { productId: string; out: boolean; portions: number | null; direct: boolean };
const availability = async (w = 'adminA') =>
  (await get(w, '/stock/availability').expect(200)).body as Av[];

beforeAll(async () => {
  fx = await seedTwoTenants('sq');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  await login('adminA', HOST_A, 'admin@sq-a.test');
  await login('adminB', HOST_B, 'admin@sq-b.test');
  await login('waiterA', HOST_A, 'garcom@sq-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Quantidade em estoque do item', () => {
  it('item sem ficha ganha o controle simples com a quantidade informada', async () => {
    expect((await availability()).find((a) => a.productId === fx.prodA)).toBeUndefined();
    const r = (
      await put('adminA', `/stock/products/${fx.prodA}/quantity`, { quantity: '3' }).expect(200)
    ).body as Av;
    expect(r).toMatchObject({ productId: fx.prodA, out: false, portions: 3, direct: true });
    const [it] = await ownerQuery<{ name: string; unit: string; quantity: string }>(
      `SELECT s.name, s.unit, s.quantity::text FROM product_recipes r
         JOIN stock_items s ON s.id = r.stock_item_id WHERE r.product_id = $1`,
      [fx.prodA],
    );
    expect(it).toEqual({ name: 'X-Burguer A', unit: 'un', quantity: '3.000' });
  });

  it('a venda baixa e, quando zera, o item sai do cardápio sozinho', async () => {
    await post(
      'adminA',
      '/orders',
      { channel: 'counter', items: [{ productId: fx.prodA, quantity: 3 }] },
      crypto.randomUUID(),
    ).expect(201);
    expect((await availability()).find((a) => a.productId === fx.prodA)).toMatchObject({
      out: true,
      portions: 0,
    });
    const menu = (await get('adminA', '/menu?channel=counter').expect(200)).body as {
      products: { id: string; soldOut: boolean }[];
    }[];
    expect(menu.flatMap((c) => c.products).find((p) => p.id === fx.prodA)!.soldOut).toBe(true);
  });

  it('informar de novo conta o mesmo insumo (ajuste no livro do estoque)', async () => {
    const r = (
      await put('adminA', `/stock/products/${fx.prodA}/quantity`, { quantity: '10' }).expect(200)
    ).body as Av;
    expect(r).toMatchObject({ out: false, portions: 10 });
    const rows = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM product_recipes WHERE product_id = $1`,
      [fx.prodA],
    );
    expect(rows[0]!.n).toBe(1);
    const [mov] = await ownerQuery<{ kind: string; quantity: string; note: string }>(
      `SELECT m.kind, m.quantity::text, m.note FROM stock_movements m
         JOIN product_recipes r ON r.stock_item_id = m.stock_item_id
        WHERE r.product_id = $1 ORDER BY m.id DESC LIMIT 1`,
      [fx.prodA],
    );
    expect(mov).toEqual({
      kind: 'adjustment',
      quantity: '10.000',
      note: 'Quantidade ajustada no cardápio',
    });
  });

  it('recusa fração em item por unidade, ficha de vários insumos, sem permissão e de outro restaurante', async () => {
    await put('adminA', `/stock/products/${fx.prodA}/quantity`, { quantity: '1.5' }).expect(422);
    await put('adminA', `/stock/products/${fx.prodA}/quantity`, { quantity: '-1' }).expect(400);
    await put('waiterA', `/stock/products/${fx.prodA}/quantity`, { quantity: '2' }).expect(403);
    await put('adminB', `/stock/products/${fx.prodA}/quantity`, { quantity: '2' }).expect(404);
    const pao = (await post('adminA', '/stock/items', { name: 'Pão', unit: 'un' }).expect(201))
      .body as { id: string };
    const lines = (await get('adminA', '/stock/recipes').expect(200)).body.products as {
      productId: string;
      stockItemId: string;
    }[];
    const own = lines.find((l) => l.productId === fx.prodA)!;
    await put('adminA', `/stock/recipes/products/${fx.prodA}`, {
      lines: [
        { stockItemId: own.stockItemId, quantity: '1' },
        { stockItemId: pao.id, quantity: '1' },
      ],
    }).expect(200);
    expect((await availability()).find((a) => a.productId === fx.prodA)!.direct).toBe(false);
    const r = await put('adminA', `/stock/products/${fx.prodA}/quantity`, { quantity: '5' });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('ficha técnica');
  });
});
