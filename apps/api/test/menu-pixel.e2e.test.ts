import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Pixel do cardápio online: o cardápio do cliente manda os eventos (visita, clique no item,
 * sacola, pedido, busca…) e o relatório mostra funil, itens, buscas e origens. Cada restaurante
 * só vê os próprios eventos; cardápio desligado não grava.
 */
const HOST = 'pixel-a.comandou.test';
const OTHER = 'pixel-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let staffA = '';
let staffB = '';
let product = '';
let category = '';
const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];
const as = (r: request.Test, cookie = staffA, host = HOST) =>
  r.set('Host', host).set('Cookie', cookie).set(CSRF);
const pixel = (body: object, host = HOST) =>
  http.post('/api/v1/store/pixel').set('Host', host).set(CSRF).send(body);
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const report = (cookie = staffA, host = HOST) =>
  as(http.get(`/api/v1/reports/menu-pixel?from=${day(-1)}&to=${day(1)}`), cookie, host);

async function login(host: string, email: string) {
  const res = await http.post('/api/v1/auth/login').set('Host', host).set(CSRF).send({
    email,
    password: PASSWORD,
  });
  return cookieFrom(res, 'cm_sid')!;
}

beforeAll(async () => {
  await seedTwoTenants('pixel');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  staffA = await login(HOST, 'admin@pixel-a.test');
  staffB = await login(OTHER, 'admin@pixel-b.test');
  await as(http.patch('/api/v1/store/settings')).send({ enabled: true, isOpen: true }).expect(200);
  const cat = await as(http.post('/api/v1/categories')).send({ name: 'Lanches' }).expect(201);
  category = cat.body.id;
  const p = await as(http.post('/api/v1/products'))
    .send({ categoryId: category, name: 'X-Salada', price: '25.00' })
    .expect(201);
  product = p.body.id;
});

afterAll(async () => {
  await app.close();
});

describe('pixel do cardápio', () => {
  it('grava os eventos e o relatório mostra funil, itens, buscas e origens', async () => {
    const vid = randomUUID();
    const s1 = randomUUID();
    const s2 = randomUUID();
    await pixel({
      sid: s1,
      vid,
      ctx: { device: 'phone', source: 'Instagram', campaign: 'Promo-Sexta' },
      events: [
        { type: 'visit' },
        { type: 'click_category', targetId: category },
        { type: 'view_item', productId: product },
        { type: 'add_to_cart', productId: product, quantity: 2, value: 50 },
        { type: 'view_cart' },
        { type: 'begin_checkout', value: 50 },
        { type: 'purchase', value: 55 },
        { type: 'search', term: 'Salada', quantity: 1 },
        { type: 'search', term: 'pizza', quantity: 0 },
      ],
    }).expect(204);
    // A mesma sessão abrindo de novo não conta outra visita.
    await pixel({ sid: s1, vid, events: [{ type: 'visit' }] }).expect(204);
    // Outra sessão do mesmo visitante: só olhou o item.
    await pixel({
      sid: s2,
      vid,
      ctx: { device: 'desktop' },
      events: [{ type: 'visit' }, { type: 'view_item', productId: product }],
    }).expect(204);

    const r = (await report().expect(200)).body;
    expect(r.totals).toMatchObject({
      visits: 2,
      visitors: 1,
      itemViews: 2,
      adds: 1,
      searches: 2,
      buyerSessions: 1,
    });
    expect(r.funnel.map((f: { sessions: number }) => f.sessions)).toEqual([2, 2, 1, 1, 1, 1]);
    const item = r.products.find((p: { productId: string }) => p.productId === product);
    expect(item).toMatchObject({ name: 'X-Salada', views: 2, viewSessions: 2, adds: 1 });
    expect(r.searches).toEqual(
      expect.arrayContaining([
        { term: 'salada', count: 1, noResults: 0 },
        { term: 'pizza', count: 1, noResults: 1 },
      ]),
    );
    expect(r.sources).toEqual(
      expect.arrayContaining([
        { key: 'instagram', visits: 1, buyers: 1 },
        { key: 'direto', visits: 1, buyers: 0 },
      ]),
    );
    expect(r.campaigns).toEqual([{ key: 'promo-sexta', visits: 1, buyers: 1 }]);
    expect(r.categories).toEqual([{ id: category, name: 'Lanches', clicks: 1 }]);
    expect(r.daily.length).toBe(3);
  });

  it('recusa evento desconhecido e lote grande demais', async () => {
    const base = { sid: randomUUID(), vid: randomUUID() };
    await pixel({ ...base, events: [{ type: 'hack' }] }).expect(400);
    await pixel({
      ...base,
      events: Array.from({ length: 41 }, () => ({ type: 'view_cart' })),
    }).expect(400);
    await pixel({ ...base, events: [] }).expect(400);
  });

  it('cardápio desligado não grava e um restaurante não vê o outro', async () => {
    await as(http.patch('/api/v1/store/settings'), staffB, OTHER)
      .send({ enabled: false })
      .expect(200);
    await pixel(
      { sid: randomUUID(), vid: randomUUID(), events: [{ type: 'visit' }] },
      OTHER,
    ).expect(204);
    const b = (await report(staffB, OTHER).expect(200)).body;
    expect(b.totals.visits).toBe(0);
    expect(b.products).toEqual([]);
  });

  it('o relatório pede login com permissão', async () => {
    await http
      .get(`/api/v1/reports/menu-pixel?from=${day(-1)}&to=${day(1)}`)
      .set('Host', HOST)
      .expect(401);
  });
});
