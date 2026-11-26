import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Estoque ligado ao cardápio (0.263): complemento com ficha técnica sem estoque aparece como sem
 * estoque e não vende; item com grupo obrigatório sem opção com estoque sai inteiro; nome repetido
 * diz qual; unidade e desativar respeitam as fichas; a quantidade do item no cardápio reaproveita
 * o insumo de mesmo nome que já está no Estoque.
 */
const HOST_A = 'eo-a.comandou.test';
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
const patch = (url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie).set(CSRF).send(body);
const get = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookie);

interface MenuProduct {
  id: string;
  soldOut: boolean;
  stockOut: boolean;
  optionGroups: { id: string; options: { id: string; stockOut: boolean }[] }[];
}
const menuProducts = async () =>
  ((await get('/menu?channel=counter').expect(200)).body as { products: MenuProduct[] }[]).flatMap(
    (c) => c.products,
  );
const productOnMenu = async (id: string) => (await menuProducts()).find((p) => p.id === id)!;
const optionOnMenu = async (productId: string, optionId: string) =>
  (await productOnMenu(productId)).optionGroups
    .flatMap((g) => g.options)
    .find((o) => o.id === optionId)!;
const order = (productId: string, optionIds: string[] = []) =>
  post(
    '/orders',
    { channel: 'counter', items: [{ productId, quantity: 1, optionIds }] },
    crypto.randomUUID(),
  );
const newProduct = async (name: string, price: string) =>
  (
    await ownerQuery<{ id: string }>(
      `INSERT INTO products (tenant_id, category_id, name, price) VALUES ($1,$2,$3,$4) RETURNING id`,
      [fx.tenantA, fx.catA, name, price],
    )
  )[0]!.id;

type Group = { id: string; options: { id: string; name: string }[] };
let extras: Group;
let queijo: { id: string };

beforeAll(async () => {
  fx = await seedTwoTenants('eo');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email: 'admin@eo-a.test', password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  cookie = raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
});
afterAll(async () => {
  await app?.close();
});

describe('Estoque ligado ao cardápio', () => {
  it('complemento sem estoque aparece como sem estoque e o pedido com ele é recusado', async () => {
    const bacon = (await post('/stock/items', { name: 'Bacon', unit: 'kg' }).expect(201)).body as {
      id: string;
    };
    extras = (
      await post('/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: 'Bacon extra', priceDelta: '5.00' },
          { name: 'Cebola extra', priceDelta: '2.00' },
        ],
      }).expect(201)
    ).body as Group;
    await put(`/products/${fx.prodA}/option-groups`, { groupIds: [extras.id] }).expect(200);
    const baconExtra = extras.options.find((o) => o.name === 'Bacon extra')!.id;
    await put(`/stock/recipes/options/${baconExtra}`, {
      lines: [{ stockItemId: bacon.id, quantity: '0.050' }],
    }).expect(200);

    // Sem bacon: a opção vem sem estoque; o item segue vendendo (o grupo é opcional).
    expect((await optionOnMenu(fx.prodA, baconExtra)).stockOut).toBe(true);
    expect(await productOnMenu(fx.prodA)).toMatchObject({ soldOut: false, stockOut: false });
    const r = await order(fx.prodA, [baconExtra]).expect(409);
    expect(r.body.message).toContain('Bacon extra');
    expect(r.body.message).toContain('falta Bacon');
    await order(fx.prodA).expect(201);

    // Chegou bacon: a opção volta e o pedido com ela passa (e baixa o bacon).
    await post(`/stock/items/${bacon.id}/movements`, { kind: 'purchase', quantity: '1' }).expect(
      201,
    );
    expect((await optionOnMenu(fx.prodA, baconExtra)).stockOut).toBe(false);
    await order(fx.prodA, [baconExtra]).expect(201);
    const [left] = await ownerQuery<{ quantity: string }>(
      `SELECT quantity::text FROM stock_items WHERE id = $1`,
      [bacon.id],
    );
    expect(left!.quantity).toBe('0.950');
  });

  it('item com grupo obrigatório sem opção com estoque fica sem estoque inteiro', async () => {
    const pizza = await newProduct('Pizza A', '50.00');
    queijo = (await post('/stock/items', { name: 'Queijo', unit: 'kg' }).expect(201)).body as {
      id: string;
    };
    const sabores = (
      await post('/option-groups', {
        name: 'Sabor',
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'Muçarela' }, { name: 'Quatro queijos' }],
      }).expect(201)
    ).body as Group;
    await put(`/products/${pizza}/option-groups`, { groupIds: [sabores.id] }).expect(200);
    for (const o of sabores.options)
      await put(`/stock/recipes/options/${o.id}`, {
        lines: [{ stockItemId: queijo.id, quantity: '0.200' }],
      }).expect(200);

    // Nenhum sabor tem queijo para uma pizza: ela sai como sem estoque.
    expect(await productOnMenu(pizza)).toMatchObject({ soldOut: true, stockOut: true });
    await post(`/stock/items/${queijo.id}/movements`, { kind: 'purchase', quantity: '1' }).expect(
      201,
    );
    expect(await productOnMenu(pizza)).toMatchObject({ soldOut: false, stockOut: false });
  });

  it('nome repetido diz qual; unidade e desativar respeitam as fichas técnicas', async () => {
    const dup = await post('/stock/items', { name: 'Bacon', unit: 'kg' }).expect(409);
    expect(dup.body.message).toBe('Já existe um insumo com este nome');

    // Molho está na ficha da Cebola extra (sem movimento ainda): não troca a unidade nem desativa.
    const molho = (await post('/stock/items', { name: 'Molho', unit: 'kg' }).expect(201)).body as {
      id: string;
    };
    const cebola = extras.options.find((o) => o.name === 'Cebola extra')!.id;
    await put(`/stock/recipes/options/${cebola}`, {
      lines: [{ stockItemId: molho.id, quantity: '0.020' }],
    }).expect(200);
    const unit = await patch(`/stock/items/${molho.id}`, { unit: 'g' }).expect(409);
    expect(unit.body.message).toContain('Cebola extra');
    const off = await patch(`/stock/items/${molho.id}`, { active: false }).expect(409);
    expect(off.body.message).toContain('tire-o das fichas');

    // Fora das fichas e sem movimento: troca a unidade e desativa.
    const sal = (await post('/stock/items', { name: 'Sal', unit: 'kg' }).expect(201)).body as {
      id: string;
    };
    await patch(`/stock/items/${sal.id}`, { unit: 'g' }).expect(200);
    await patch(`/stock/items/${sal.id}`, { active: false }).expect(200);
  });

  it('quantidade do item usa o insumo de mesmo nome que já está no Estoque', async () => {
    const refri = await newProduct('Refri A', '6.00');
    const lata = (await post('/stock/items', { name: 'Refri A', unit: 'un' }).expect(201)).body as {
      id: string;
    };
    const r = (await put(`/stock/products/${refri}/quantity`, { quantity: '12' }).expect(200))
      .body as { productId: string; portions: number; direct: boolean };
    expect(r).toMatchObject({ productId: refri, portions: 12, direct: true });
    const lines = await ownerQuery<{ stock_item_id: string }>(
      `SELECT stock_item_id FROM product_recipes WHERE product_id = $1`,
      [refri],
    );
    expect(lines.map((l) => l.stock_item_id)).toEqual([lata.id]);

    // Insumo de mesmo nome em outra unidade: recusa e diz onde ligar.
    const suco = await newProduct('Suco A', '9.00');
    await post('/stock/items', { name: 'Suco A', unit: 'l' }).expect(201);
    const s = await put(`/stock/products/${suco}/quantity`, { quantity: '3' }).expect(409);
    expect(s.body.message).toContain('Fichas técnicas');
  });
});
