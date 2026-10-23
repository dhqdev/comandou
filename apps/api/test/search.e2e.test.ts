import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { parseTerm } from '../src/search/search.controller';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/** Busca global (barra do topo / Ctrl+K): tudo do restaurante, só do restaurante, só o permitido. */
const HOST_A = 'busca-a.comandou.test';
const HOST_B = 'busca-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
}

interface Hit {
  kind: string;
  id: string;
  title: string;
  detail: string | null;
  ref: string | null;
}
async function search(term: string, who = 'adminA'): Promise<Hit[]> {
  const res = await http
    .get(`/api/v1/search?q=${encodeURIComponent(term)}`)
    .set('Host', who.endsWith('B') ? HOST_B : HOST_A)
    .set('Cookie', cookies[who]!)
    .expect(200);
  return res.body.results as Hit[];
}

let orderId: string;
let tableId: string;
let tabId: string;

beforeAll(async () => {
  fx = await seedTwoTenants('busca');
  const [cust] = await ownerQuery<{ id: string }>(
    `INSERT INTO customers (tenant_id, name, phone, email, password_hash)
     VALUES ($1, 'João Gonçalves', '11977776666', 'joao@cliente.test', 'x'),
            ($2, 'João do B', '11955554444', null, 'x') RETURNING id`,
    [fx.tenantA, fx.tenantB],
  );
  expect(cust).toBeTruthy();
  [{ id: tableId }] = (await ownerQuery<{ id: string }>(
    `INSERT INTO dining_tables (tenant_id, label, area) VALUES ($1, '17', 'Varanda') RETURNING id`,
    [fx.tenantA],
  )) as [{ id: string }];
  [{ id: tabId }] = (await ownerQuery<{ id: string }>(
    `INSERT INTO tabs (tenant_id, number, table_id, customer_name) VALUES ($1, 88, $2, 'Família Souza') RETURNING id`,
    [fx.tenantA, tableId],
  )) as [{ id: string }];
  [{ id: orderId }] = (await ownerQuery<{ id: string }>(
    `INSERT INTO orders (tenant_id, number, channel, subtotal, total, customer_name, customer_phone)
     VALUES ($1, 4321, 'delivery', '50.00', '50.00', 'Ana Lúcia', '(11) 93333-2222') RETURNING id`,
    [fx.tenantA],
  )) as [{ id: string }];
  await ownerQuery(
    `INSERT INTO stock_items (tenant_id, name, unit) VALUES ($1, 'Pão de hambúrguer', 'un')`,
    [fx.tenantA],
  );
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@busca-a.test');
  cookies.adminB = await login(HOST_B, 'admin@busca-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@busca-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('parseTerm', () => {
  it('normaliza acento, maiúscula, # e dígitos', () => {
    expect(parseTerm('  ')).toBeNull();
    expect(parseTerm('#12')).toMatchObject({ words: ['12'], number: 12, digits: '12' });
    expect(parseTerm('Pão  QUEIJO')).toMatchObject({ words: ['pao', 'queijo'], number: null });
    expect(parseTerm('(11) 9 7777')?.digits).toBe('1197777');
  });
});

describe('GET /search', () => {
  it('exige sessão', async () => {
    await http.get('/api/v1/search?q=joao').set('Host', HOST_A).expect(401);
  });

  it('busca vazia volta lista vazia', async () => {
    expect(await search('   ')).toEqual([]);
  });

  it('acha cliente sem acento e pelo celular, só do próprio restaurante', async () => {
    const byName = await search('joao gonc');
    expect(byName.filter((h) => h.kind === 'customer').map((h) => h.title)).toEqual([
      'João Gonçalves',
    ]);
    const byPhone = await search('97777-6666');
    expect(byPhone.some((h) => h.kind === 'customer' && h.title === 'João Gonçalves')).toBe(true);
    const inB = await search('joao', 'adminB');
    expect(inB.filter((h) => h.kind === 'customer').map((h) => h.title)).toEqual(['João do B']);
  });

  it('acha pedido pelo número, pelo nome e pelo telefone', async () => {
    const [first] = await search('#4321');
    expect(first).toMatchObject({ kind: 'order', id: orderId, title: 'Pedido #4321' });
    expect((await search('ana lucia')).some((h) => h.id === orderId)).toBe(true);
    expect((await search('933332222')).some((h) => h.id === orderId)).toBe(true);
  });

  it('acha mesa (com a comanda aberta), comanda, produto e insumo', async () => {
    const mesa = (await search('varanda')).find((h) => h.kind === 'table');
    expect(mesa).toMatchObject({ id: tableId, title: 'Mesa 17', ref: tabId });
    const comanda = (await search('souza')).find((h) => h.kind === 'tab');
    expect(comanda).toMatchObject({ id: tabId, title: 'Comanda 88' });
    const prod = (await search('x-burg')).find((h) => h.kind === 'product');
    expect(prod).toMatchObject({ id: fx.prodA, ref: fx.catA });
    expect((await search('pao hamb')).some((h) => h.kind === 'stock_item')).toBe(true);
  });

  it('não mistura restaurantes', async () => {
    const hits = await search('burguer', 'adminB');
    expect(hits.some((h) => h.id === fx.prodA)).toBe(false);
    expect((await search('pizza')).some((h) => h.id === fx.prodB)).toBe(false);
  });

  it('respeita as permissões do papel', async () => {
    const hits = await search('a', 'waiterA');
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds.has('customer')).toBe(false);
    expect(kinds.has('stock_item')).toBe(false);
    expect(kinds.has('member')).toBe(false);
    expect(kinds.has('finance_entry')).toBe(false);
    expect((await search('x-burg', 'waiterA')).some((h) => h.id === fx.prodA)).toBe(true);
    // Equipe só para quem gerencia usuários.
    expect((await search('garcom')).some((h) => h.kind === 'member')).toBe(true);
  });

  it('curingas do LIKE são texto comum', async () => {
    expect(await search('%')).toEqual([]);
    expect(await search('_')).toEqual([]);
  });
});
