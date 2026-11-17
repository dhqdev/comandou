import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Custo automático das fichas: mudou o preço de um insumo (Mudar preço, entrada com custo ou
 * recebimento), o preparo que o leva e o item do cardápio são recalculados na hora, o
 * histórico guarda o antes e depois e os gerentes recebem aviso quando a compra encarece.
 */
const HOST = 'custo-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let cookie = '';

const get = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookie);
const send = (m: 'post' | 'put' | 'patch', url: string, body: object) =>
  http[m](`/api/v1${url}`).set('Host', HOST).set('Cookie', cookie).set(CSRF).send(body);

let tomate = '';
let farinha = '';
let molho = '';

interface Change {
  id: string | null;
  source: string;
  items: { id: string; name: string; oldCost: string; newCost: string }[];
  products: {
    kind: string;
    id: string;
    name: string;
    price: string;
    oldCost: string;
    newCost: string;
  }[];
}

const itemCost = async (id: string) =>
  (await get(`/stock/items/${id}`).expect(200)).body as {
    avgCost: string;
    lastCost: string | null;
  };
const productCost = async () => {
  const p = (await get('/stock/pricing').expect(200)).body as {
    products: { id: string; cost: string | null }[];
  };
  return p.products.find((x) => x.id === fx.prodA)!.cost;
};

beforeAll(async () => {
  fx = await seedTwoTenants('custo');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@custo-a.test', password: PASSWORD });
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  await ownerQuery(`UPDATE products SET price = '20.00' WHERE id = $1`, [fx.prodA]);

  tomate = (await send('post', '/stock/items', { name: 'Tomate', unit: 'kg' }).expect(201)).body.id;
  farinha = (await send('post', '/stock/items', { name: 'Farinha', unit: 'kg' }).expect(201)).body
    .id;
  molho = (await send('post', '/stock/items', { name: 'Molho da casa', unit: 'kg' }).expect(201))
    .body.id;
  await send('post', `/stock/items/${tomate}/movements`, {
    kind: 'purchase',
    quantity: '10',
    unitCost: '5',
  }).expect(201);
  await send('post', `/stock/items/${farinha}/movements`, {
    kind: 'purchase',
    quantity: '10',
    unitCost: '4',
  }).expect(201);
  // 2 kg de tomate rendem 1 kg de molho: custo 10,00/kg.
  await send('put', `/stock/items/${molho}/recipe`, {
    yield: '1',
    lines: [{ stockItemId: tomate, quantity: '2' }],
  }).expect(200);
  // Pizza: 0,100 kg de molho + 0,250 kg de farinha = 1,00 + 1,00.
  await send('put', `/stock/recipes/products/${fx.prodA}`, {
    lines: [
      { stockItemId: molho, quantity: '0.100' },
      { stockItemId: farinha, quantity: '0.250' },
    ],
  }).expect(200);
});

afterAll(async () => {
  await app?.close();
});

describe('custo automático das fichas', () => {
  it('a ficha de preparo define o custo do preparo e o item do cardápio soma tudo', async () => {
    expect((await itemCost(molho)).avgCost).toBe('10.0000');
    expect((await itemCost(tomate)).lastCost).toBe('5.0000');
    expect(Number(await productCost())).toBe(2);
  });

  it('simular o novo preço não grava nada', async () => {
    const r = (
      await send('post', `/stock/items/${tomate}/cost/preview`, { unitCost: '8' }).expect(201)
    ).body as Change;
    expect(r.items.map((i) => i.name).sort()).toEqual(['Molho da casa', 'Tomate']);
    expect(r.products).toEqual([
      expect.objectContaining({ id: fx.prodA, oldCost: '2.0000', newCost: '2.6000' }),
    ]);
    expect((await itemCost(tomate)).avgCost).toBe('5.0000');
    expect((await itemCost(molho)).avgCost).toBe('10.0000');
    const hist = (await get('/stock/cost-changes').expect(200)).body as Change[];
    expect(hist.map((h) => h.source)).not.toContain('manual');
  });

  it('mudar o preço recalcula o preparo e o cardápio em cascata e guarda o histórico', async () => {
    const r = (
      await send('put', `/stock/items/${tomate}/cost`, {
        unitCost: '8',
        note: 'Fornecedor aumentou',
      }).expect(200)
    ).body as { item: { avgCost: string }; change: Change };
    expect(r.item.avgCost).toBe('8.0000');
    expect(r.change.products[0]).toMatchObject({ newCost: '2.6000', price: '20.00' });
    expect((await itemCost(molho)).avgCost).toBe('16.0000');
    expect(Number(await productCost())).toBe(2.6);
    const hist = (await get(`/stock/cost-changes?itemId=${molho}`).expect(200)).body as Change[];
    expect(hist.map((h) => h.source)).toEqual(['manual', 'prep_recipe']);
    expect(hist[0]).toMatchObject({ source: 'manual', label: 'Fornecedor aumentou' });
    const usage = (await get(`/stock/items/${tomate}/usage`).expect(200)).body as {
      preps: { id: string }[];
      menu: { id: string; cost: string }[];
    };
    expect(usage.preps.map((p) => p.id)).toEqual([molho]);
    expect(usage.menu).toEqual([expect.objectContaining({ id: fx.prodA, cost: '2.6000' })]);
  });

  it('preparo não aceita preço manual e ficha circular é recusada', async () => {
    await send('put', `/stock/items/${molho}/cost`, { unitCost: '1' }).expect(409);
    await send('put', `/stock/items/${tomate}/recipe`, {
      yield: '1',
      lines: [{ stockItemId: molho, quantity: '1' }],
    }).expect(409);
  });

  it('recebimento mais caro recalcula pelo custo médio e avisa os gerentes', async () => {
    // Saldo 10 kg a 8,00 + 10 kg a 12,00 = custo médio 10,00; molho 20,00/kg.
    const r = (
      await send('post', '/stock/receipts', {
        supplier: 'Hortifruti Bom Preço',
        lines: [{ stockItemId: tomate, quantity: '10', unit: 'kg', factor: '1', unitCost: '12' }],
      }).expect(201)
    ).body as { costChange: Change };
    expect(r.costChange.items.find((i) => i.id === molho)).toMatchObject({
      oldCost: '16.0000',
      newCost: '20.0000',
    });
    const t = await itemCost(tomate);
    expect(t).toMatchObject({ avgCost: '10.0000', lastCost: '12.0000' });
    expect(Number(await productCost())).toBe(3);
    const notices = await ownerQuery<{ title: string }>(
      `SELECT title FROM chat_notices WHERE tenant_id = $1 AND kind = 'system' AND title LIKE 'O custo de Tomate%'`,
      [fx.tenantA],
    );
    expect(notices.length).toBeGreaterThan(0);
  });

  it('outro restaurante não vê o histórico', async () => {
    const rows = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_cost_changes WHERE tenant_id = $1`,
      [fx.tenantB],
    );
    expect(rows[0]!.n).toBe(0);
  });
});
