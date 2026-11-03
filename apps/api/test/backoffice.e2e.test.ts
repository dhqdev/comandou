import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { APP_URL, testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 4: equipe, estoque (ficha técnica), entregas e rastreio, fila de impressão e financeiro.
 * Sempre pela API HTTP real, com dois restaurantes para checar isolamento.
 */
const HOST_A = 'bo-a.comandou.test';
const HOST_B = 'bo-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let keySeq = 0;
const key = () => `bo-key-${Date.now()}-${++keySeq}`;

async function login(host: string, email: string, password = PASSWORD) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
}

const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const post = (w: string, url: string, body: object = {}, idem?: string) => {
  const r = http
    .post(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const patch = (w: string, url: string, body: object) =>
  http
    .patch(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const put = (w: string, url: string, body: object) =>
  http
    .put(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

async function addUser(tenantId: string, email: string, role: string) {
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, `${role} ${email.split('@')[0]}`, await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
    tenantId,
    u.id,
    role,
  ]);
  return u.id;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  fx = await seedTwoTenants('bo');
  ids.driverA = await addUser(fx.tenantA, 'moto1@bo-a.test', 'driver');
  ids.driver2A = await addUser(fx.tenantA, 'moto2@bo-a.test', 'driver');
  ids.cashierA = await addUser(fx.tenantA, 'caixa@bo-a.test', 'cashier');
  ids.pdvA = await addUser(fx.tenantA, 'pdv@bo-a.test', 'attendant');
  ids.stockA = await addUser(fx.tenantA, 'estoque@bo-a.test', 'manager');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@bo-a.test');
  cookies.adminB = await login(HOST_B, 'admin@bo-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@bo-a.test');
  cookies.driverA = await login(HOST_A, 'moto1@bo-a.test');
  cookies.driver2A = await login(HOST_A, 'moto2@bo-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@bo-a.test');
  cookies.pdvA = await login(HOST_A, 'pdv@bo-a.test');
  cookies.stockA = await login(HOST_A, 'estoque@bo-a.test');
});
afterAll(async () => {
  await app?.close();
});

const order = (w: string, body: object, idem?: string) => post(w, '/orders', body, idem);
const counterOrder = (quantity = 1, optionIds?: string[]) =>
  order('waiterA', {
    channel: 'counter',
    items: [{ productId: fx.prodA, quantity, ...(optionIds ? { optionIds } : {}) }],
  });

// ------------------------------------------------------------------------------- equipe
describe('Equipe (usuários e papéis)', () => {
  it('só o administrador gerencia a equipe', async () => {
    await get('waiterA', '/users').expect(403);
    await get('cashierA', '/users').expect(403);
    const list = (await get('adminA', '/users').expect(200)).body as { email: string }[];
    expect(list.map((u) => u.email)).toContain('garcom@bo-a.test');
    // Restaurante B não vê a equipe de A.
    const listB = (await get('adminB', '/users').expect(200)).body as { email: string }[];
    expect(listB.map((u) => u.email)).not.toContain('garcom@bo-a.test');
  });

  it('cria membro que consegue entrar; e-mail repetido dá 409', async () => {
    const r = await post('adminA', '/users', {
      email: 'Atendente@BO-A.test',
      name: 'Ana Atendente',
      password: 'senha-da-ana-1',
      role: 'attendant',
    }).expect(201);
    expect(r.body).toMatchObject({
      email: 'atendente@bo-a.test',
      role: 'attendant',
      existingAccount: false,
    });
    expect(r.body.passwordHash).toBeUndefined();
    await login(HOST_A, 'atendente@bo-a.test', 'senha-da-ana-1');
    await post('adminA', '/users', {
      email: 'atendente@bo-a.test',
      name: 'Outra',
      password: 'outra-senha-1',
      role: 'waiter',
    }).expect(409);
    await post('adminA', '/users', {
      email: 'x@y.z',
      name: 'X',
      password: 'curta',
      role: 'waiter',
    }).expect(400);
  });

  it('conta já existente em outro restaurante só ganha o vínculo (senha não muda)', async () => {
    const r = await post('adminA', '/users', {
      email: 'admin@bo-b.test',
      name: 'Admin B',
      password: 'tentativa-de-troca',
      role: 'waiter',
    }).expect(201);
    expect(r.body.existingAccount).toBe(true);
    await login(HOST_A, 'admin@bo-b.test', PASSWORD);
    const bad = await http
      .post('/api/v1/auth/login')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ email: 'admin@bo-b.test', password: 'tentativa-de-troca' });
    expect(bad.status).toBe(401);
  });

  it('não altera o próprio acesso; desativar encerra as sessões', async () => {
    const me = (await get('adminA', '/auth/me').expect(200)).body.user;
    await patch('adminA', `/users/${me.id}`, { role: 'waiter' }).expect(409);
    const c = await login(HOST_A, 'atendente@bo-a.test', 'senha-da-ana-1');
    cookies.attA = c;
    await get('attA', '/auth/me').expect(200);
    const list = (await get('adminA', '/users').expect(200)).body as {
      id: string;
      email: string;
    }[];
    const ana = list.find((u) => u.email === 'atendente@bo-a.test')!;
    await patch('adminA', `/users/${ana.id}`, { status: 'revoked' }).expect(200);
    await get('attA', '/auth/me').expect(401);
    const relogin = await http
      .post('/api/v1/auth/login')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ email: 'atendente@bo-a.test', password: 'senha-da-ana-1' });
    expect(relogin.status).toBe(401);
    // Reativar devolve o acesso.
    await patch('adminA', `/users/${ana.id}`, { status: 'active', role: 'cashier' }).expect(200);
    await login(HOST_A, 'atendente@bo-a.test', 'senha-da-ana-1');
  });

  it('dois administradores rebaixando um ao outro ao mesmo tempo: sobra ao menos um', async () => {
    await post('adminA', '/users', {
      email: 'dono2@bo-a.test',
      name: 'Dono 2',
      password: 'senha-dono-2',
      role: 'owner',
    }).expect(201);
    cookies.owner2A = await login(HOST_A, 'dono2@bo-a.test', 'senha-dono-2');
    const me1 = (await get('adminA', '/auth/me')).body.user.id as string;
    const me2 = (await get('owner2A', '/auth/me')).body.user.id as string;
    const [r1, r2] = await Promise.all([
      patch('adminA', `/users/${me2}`, { role: 'manager' }),
      patch('owner2A', `/users/${me1}`, { role: 'manager' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // Um vence; o outro é recusado (403: já não é administrador, ou 409: seria o último).
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const [{ n }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'`,
      [fx.tenantA],
    );
    expect(n).toBe(1);
    // Restaura o administrador original para os próximos testes.
    await ownerQuery(
      `UPDATE memberships SET role = 'owner' WHERE tenant_id = $1 AND user_id = $2`,
      [fx.tenantA, me1],
    );
  });

  it('troca a própria senha conferindo a atual e encerra as outras sessões', async () => {
    const other = await login(HOST_A, 'caixa@bo-a.test');
    cookies.cashier2A = other;
    await post('cashierA', '/auth/password', {
      current: 'errada',
      next: 'nova-senha-caixa',
    }).expect(401);
    await post('cashierA', '/auth/password', {
      current: PASSWORD,
      next: 'nova-senha-caixa',
    }).expect(204);
    await get('cashierA', '/auth/me').expect(200);
    await get('cashier2A', '/auth/me').expect(401);
    await login(HOST_A, 'caixa@bo-a.test', 'nova-senha-caixa');
  });
});

// ------------------------------------------------------------------------------- estoque
let pao: { id: string };
let carne: { id: string };
let bacon: { id: string };
let extras: { id: string; options: { id: string; name: string }[] };

describe('Estoque e ficha técnica', () => {
  it('cadastra insumos; garçom não acessa; estoquista sim', async () => {
    await get('waiterA', '/stock/items').expect(403);
    pao = (await post('stockA', '/stock/items', { name: 'Pão', unit: 'un' }).expect(201)).body;
    carne = (
      await post('adminA', '/stock/items', { name: 'Carne', unit: 'kg', minQuantity: '5' }).expect(
        201,
      )
    ).body;
    bacon = (await post('adminA', '/stock/items', { name: 'Bacon', unit: 'kg' }).expect(201)).body;
    await post('adminA', '/stock/items', { name: 'Pão', unit: 'un' }).expect(409);
    await post('adminA', '/stock/items', { name: 'X', unit: 'caixa' }).expect(400);
    expect((await get('cashierA', '/stock/items').expect(200)).body).toHaveLength(3);
    await post('cashierA', '/stock/items', { name: 'Y', unit: 'un' }).expect(403);
  });

  it('entrada recalcula custo médio; perda e contagem exigem motivo', async () => {
    const mv = (id: string, body: object) => post('stockA', `/stock/items/${id}/movements`, body);
    await mv(pao.id, { kind: 'purchase', quantity: '10', unitCost: '1.50' }).expect(201);
    const p2 = (
      await mv(pao.id, { kind: 'purchase', quantity: '10', unitCost: '2.50' }).expect(201)
    ).body;
    expect(p2).toMatchObject({ quantity: '20.000', avgCost: '2.0000', stockValue: '40.00' });
    await mv(carne.id, { kind: 'purchase', quantity: '2.5', unitCost: '40' }).expect(201);
    await mv(bacon.id, { kind: 'purchase', quantity: '1', unitCost: '30' }).expect(201);
    await mv(pao.id, { kind: 'loss', quantity: '2' }).expect(422);
    const loss = (
      await mv(pao.id, { kind: 'loss', quantity: '2', note: 'Pão amassado' }).expect(201)
    ).body;
    expect(loss.quantity).toBe('18.000');
    await mv(pao.id, { kind: 'loss', quantity: '100', note: 'Muito' }).expect(409);
    await mv(pao.id, { kind: 'purchase', quantity: '0.0001' }).expect(400);
    const count = (
      await mv(pao.id, { kind: 'count', quantity: '17', note: 'Inventário' }).expect(201)
    ).body;
    expect(count.quantity).toBe('17.000');
    const movs = (await get('stockA', `/stock/movements?itemId=${pao.id}`).expect(200)).body as {
      kind: string;
      quantity: string;
      balanceAfter: string;
    }[];
    expect(movs.map((m) => [m.kind, m.quantity, m.balanceAfter])).toEqual([
      ['adjustment', '-1.000', '17.000'],
      ['loss', '-2.000', '18.000'],
      ['purchase', '10.000', '20.000'],
      ['purchase', '10.000', '10.000'],
    ]);
    // Carne abaixo do mínimo aparece como "baixo".
    const items = (await get('stockA', '/stock/items').expect(200)).body as {
      id: string;
      low: boolean;
    }[];
    expect(items.find((i) => i.id === carne.id)!.low).toBe(true);
  });

  it('ficha técnica de produto e de adicional baixa o estoque na venda', async () => {
    extras = (
      await post('adminA', '/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 2,
        options: [{ name: 'Bacon extra', priceDelta: '5.00' }],
      }).expect(201)
    ).body;
    await put('adminA', `/products/${fx.prodA}/option-groups`, { groupIds: [extras.id] }).expect(
      200,
    );
    await put('stockA', `/stock/recipes/products/${fx.prodA}`, {
      lines: [
        { stockItemId: pao.id, quantity: '1' },
        { stockItemId: carne.id, quantity: '0.150' },
      ],
    }).expect(200);
    await put('stockA', `/stock/recipes/options/${extras.options[0].id}`, {
      lines: [{ stockItemId: bacon.id, quantity: '0.050' }],
    }).expect(200);
    await put('stockA', `/stock/recipes/products/${fx.prodA}`, {
      lines: [
        { stockItemId: pao.id, quantity: '1' },
        { stockItemId: pao.id, quantity: '2' },
      ],
    }).expect(400);
    // Restaurante B não usa insumo de A na própria ficha nem mexe na ficha de A.
    await put('adminB', `/stock/recipes/products/${fx.prodB}`, {
      lines: [{ stockItemId: pao.id, quantity: '1' }],
    }).expect(422);
    await put('adminB', `/stock/recipes/products/${fx.prodA}`, { lines: [] }).expect(404);

    const o = (await counterOrder(2, [extras.options[0].id]).expect(201)).body;
    const items = (await get('stockA', '/stock/items').expect(200)).body as {
      id: string;
      quantity: string;
    }[];
    const qty = (id: string) => items.find((i) => i.id === id)!.quantity;
    expect(qty(pao.id)).toBe('15.000');
    expect(qty(carne.id)).toBe('2.200');
    expect(qty(bacon.id)).toBe('0.900');

    // Cancelar devolve os insumos (estorno, sem apagar a venda).
    await post('adminA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'Cliente desistiu',
    }).expect(201);
    const after = (await get('stockA', '/stock/items').expect(200)).body as {
      id: string;
      quantity: string;
    }[];
    expect(after.find((i) => i.id === pao.id)!.quantity).toBe('17.000');
    expect(after.find((i) => i.id === bacon.id)!.quantity).toBe('1.000');
    const movs = (await get('stockA', `/stock/movements?itemId=${pao.id}&limit=2`).expect(200))
      .body;
    expect(movs.map((m: { kind: string }) => m.kind)).toEqual(['sale_reversal', 'sale']);
  });

  it('sem saldo suficiente o pedido é recusado e nada é gravado', async () => {
    const [{ n: before }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    const r = await counterOrder(20).expect(409);
    expect(r.body.message).toContain('Estoque insuficiente');
    expect(r.body.message).toContain('Carne');
    const [{ n: after }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    expect(after).toBe(before);
    // Com "permitir negativo", a venda passa.
    await patch('adminA', `/stock/items/${carne.id}`, { allowNegative: true }).expect(200);
    await patch('adminA', `/stock/items/${pao.id}`, { allowNegative: true }).expect(200);
    const o = (await counterOrder(20).expect(201)).body;
    await post('adminA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'Teste negativo',
    }).expect(201);
    await patch('adminA', `/stock/items/${carne.id}`, { allowNegative: false }).expect(200);
    await patch('adminA', `/stock/items/${pao.id}`, { allowNegative: false }).expect(200);
  });

  it('vendas simultâneas não deixam o estoque negativo', async () => {
    // Deixa só 3 pães.
    await post('stockA', `/stock/items/${pao.id}/movements`, {
      kind: 'count',
      quantity: '3',
      note: 'Teste de concorrência',
    }).expect(201);
    const results = await Promise.all(Array.from({ length: 6 }, () => counterOrder(1)));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const [row] = await ownerQuery<{ quantity: string }>(
      `SELECT quantity::text FROM stock_items WHERE id = $1`,
      [pao.id],
    );
    expect(row.quantity).toBe('0.000');
    // Livro-razão confere com o saldo.
    const [sum] = await ownerQuery<{ s: string }>(
      `SELECT sum(quantity)::text AS s FROM stock_movements WHERE stock_item_id = $1`,
      [pao.id],
    );
    expect(sum.s).toBe('0.000');
    await post('stockA', `/stock/items/${pao.id}/movements`, {
      kind: 'purchase',
      quantity: '50',
    }).expect(201);
    await post('stockA', `/stock/items/${carne.id}/movements`, {
      kind: 'purchase',
      quantity: '20',
    }).expect(201);
  });

  it('inventário em lote ajusta vários insumos de uma vez e valoriza a diferença', async () => {
    const lines = [
      { stockItemId: pao.id, quantity: '48' },
      { stockItemId: bacon.id, quantity: '1' },
    ];
    await post('cashierA', '/stock/counts', { note: 'Inventário', lines }).expect(403);
    await post('stockA', '/stock/counts', { note: 'Inventário', lines: [] }).expect(400);
    await post('stockA', '/stock/counts', {
      note: 'Inventário',
      lines: [lines[0], lines[0]],
    }).expect(400);
    await post('adminB', '/stock/counts', { note: 'Inventário', lines }).expect(404);
    // Pão: 50 no sistema, 48 contados a R$ 2,00 = faltaram R$ 4,00. Bacon confere.
    const r = (
      await post('stockA', '/stock/counts', { note: 'Inventário mensal', lines }).expect(201)
    ).body;
    expect(r).toMatchObject({ itemsCounted: 2, itemsChanged: 1, valueDelta: '-4.00' });
    const items = (await get('stockA', '/stock/items').expect(200)).body as {
      id: string;
      quantity: string;
      countedAt: string | null;
    }[];
    expect(items.find((i) => i.id === pao.id)).toMatchObject({ quantity: '48.000' });
    expect(items.find((i) => i.id === bacon.id)!.countedAt).not.toBeNull();
    const [mv] = (await get('stockA', `/stock/movements?itemId=${pao.id}&limit=1`).expect(200))
      .body as { kind: string; countId: string; value: string }[];
    expect(mv).toMatchObject({ kind: 'adjustment', countId: r.id, value: '-4.00' });
    const counts = (await get('stockA', '/stock/counts').expect(200)).body;
    expect(counts[0]).toMatchObject({ id: r.id, itemsChanged: 1, note: 'Inventário mensal' });
    expect((await get('adminB', '/stock/counts').expect(200)).body).toHaveLength(0);
  });

  it('precificação: custo pela ficha técnica e parâmetros de preço', async () => {
    await get('cashierA', '/stock/pricing').expect(403);
    const r = (await get('stockA', '/stock/pricing').expect(200)).body as {
      settings: Record<string, string>;
      products: {
        id: string;
        cost: string | null;
        hasRecipe: boolean;
        targetMargin: string | null;
      }[];
      options: { id: string; cost: string | null }[];
      summary: { cogs30: string };
    };
    // 1 pão (R$ 2,00) + 0,150 kg de carne (R$ 40,00/kg) = R$ 8,00.
    expect(r.products.find((p) => p.id === fx.prodA)).toMatchObject({
      hasRecipe: true,
      cost: '8.0000',
      targetMargin: null,
    });
    expect(r.options.find((o) => o.id === extras.options[0].id)!.cost).toBe('1.5000');
    expect(r.settings).toMatchObject({ taxPercent: '6.00', targetMargin: '15.00' });
    expect(Number(r.summary.cogs30)).toBeGreaterThan(0);

    const settings = { taxPercent: '8', feePercent: '3.5', fixedPercent: '25', targetMargin: '20' };
    await put('stockA', '/stock/pricing/settings', { ...settings, fixedPercent: '60' }).expect(400);
    await put('cashierA', '/stock/pricing/settings', settings).expect(403);
    expect((await put('stockA', '/stock/pricing/settings', settings).expect(200)).body).toEqual({
      taxPercent: '8.00',
      feePercent: '3.50',
      fixedPercent: '25.00',
      targetMargin: '20.00',
    });
    await put('stockA', `/stock/pricing/products/${fx.prodA}`, { targetMargin: '60' }).expect(422);
    await put('stockA', `/stock/pricing/products/${fx.prodA}`, { targetMargin: '30' }).expect(200);
    await put('adminB', `/stock/pricing/products/${fx.prodA}`, { targetMargin: '30' }).expect(404);
    const after = (await get('adminA', '/stock/pricing').expect(200)).body as typeof r;
    expect(after.products.find((p) => p.id === fx.prodA)!.targetMargin).toBe('30.00');
    await put('stockA', `/stock/pricing/products/${fx.prodA}`, { targetMargin: null }).expect(200);
    expect((await get('adminB', '/stock/pricing').expect(200)).body.settings.taxPercent).toBe(
      '6.00',
    );
  });

  it('isolamento: B não vê nem altera insumos de A', async () => {
    expect((await get('adminB', '/stock/items').expect(200)).body).toHaveLength(0);
    await patch('adminB', `/stock/items/${pao.id}`, { name: 'Hack' }).expect(404);
    await post('adminB', `/stock/items/${pao.id}/movements`, {
      kind: 'purchase',
      quantity: '1',
    }).expect(404);
    expect((await get('adminB', '/stock/movements').expect(200)).body).toHaveLength(0);
  });
});

describe('Estoque: recebimento, produção, lotes, saídas e fatores', () => {
  let tomate: { id: string; code: string };
  let molho: { id: string; code: string };
  let refri: { id: string };
  const qtyOf = async (id: string) =>
    ((await get('stockA', `/stock/items/${id}`).expect(200)).body as { quantity: string }).quantity;

  it('insumo ganha código automático e aceita código de barras e validade padrão', async () => {
    tomate = (await post('stockA', '/stock/items', { name: 'Tomate', unit: 'kg' }).expect(201))
      .body;
    molho = (
      await post('stockA', '/stock/items', { name: 'Molho', unit: 'kg', shelfLifeDays: 3 }).expect(
        201,
      )
    ).body;
    refri = (
      await post('stockA', '/stock/items', {
        name: 'Refri lata',
        unit: 'un',
        code: 'REF-1',
        barcode: '7891000',
      }).expect(201)
    ).body;
    expect(tomate.code).toMatch(/^IN-\d{6}$/);
    expect(molho).toMatchObject({ shelfLifeDays: 3, hasPrep: false });
    expect(refri).toMatchObject({ code: 'REF-1', barcode: '7891000' });
    await post('stockA', '/stock/items', { name: 'Outro', unit: 'un', code: 'ref-1' }).expect(409);
  });

  it('fatores de conversão: sigla única por insumo, unidade segue o insumo', async () => {
    await post('cashierA', '/stock/factors', {
      code: 'CX12',
      name: 'Caixa',
      unit: 'un',
      factor: '12',
    }).expect(403);
    const f = (
      await post('stockA', '/stock/factors', {
        code: 'CX12',
        name: 'Caixa com 12',
        unit: 'kg',
        factor: '12',
        stockItemId: refri.id,
      }).expect(201)
    ).body;
    expect(f).toMatchObject({
      code: 'CX12',
      unit: 'un',
      factor: '12.0000',
      itemName: 'Refri lata',
    });
    await post('stockA', '/stock/factors', {
      code: 'cx12',
      name: 'Repetido',
      unit: 'un',
      factor: '6',
      stockItemId: refri.id,
    }).expect(409);
    const g = (
      await post('stockA', '/stock/factors', {
        code: 'SC5',
        name: 'Saco 5 kg',
        unit: 'kg',
        factor: '5',
      }).expect(201)
    ).body;
    await patch('stockA', `/stock/factors/${g.id}`, {
      code: 'SC5',
      name: 'Saco de 5 kg',
      unit: 'kg',
      factor: '5',
    }).expect(200);
    expect((await get('stockA', '/stock/factors').expect(200)).body).toHaveLength(2);
    expect((await get('adminB', '/stock/factors').expect(200)).body).toHaveLength(0);
    await http
      .delete(`/api/v1/stock/factors/${g.id}`)
      .set('Host', HOST_B)
      .set('Cookie', cookies.adminB!)
      .set(CSRF)
      .expect(404);
  });

  it('recebimento converte a unidade, calcula custo médio e cria lote com validade', async () => {
    const r = (
      await post('stockA', '/stock/receipts', {
        supplier: 'Hortifruti Sul',
        invoice: '1234',
        receivedOn: '2026-10-20',
        lines: [
          // 2 sacos de 5 kg a R$ 30,00 o saco = 10 kg a R$ 6,00/kg.
          {
            stockItemId: tomate.id,
            quantity: '2',
            unit: 'SC5',
            factor: '5',
            unitCost: '30',
            expiresOn: '2026-10-30',
          },
          { stockItemId: refri.id, quantity: '1', unit: 'CX12', factor: '12', unitCost: '36' },
        ],
      }).expect(201)
    ).body;
    expect(r).toMatchObject({ code: expect.stringMatching(/^REC-\d{6}$/), total: '96.00' });
    expect(await get('stockA', `/stock/items/${tomate.id}`).expect(200)).toMatchObject({
      body: { quantity: '10.000', avgCost: '6.0000' },
    });
    expect(await qtyOf(refri.id)).toBe('12.000');
    const detail = (await get('stockA', `/stock/receipts/${r.id}`).expect(200)).body;
    expect(detail.lines[0]).toMatchObject({
      quantity: '10.000',
      enteredQuantity: '2.000',
      enteredUnit: 'SC5',
      unitCost: '6.0000',
      expiresOn: '2026-10-30',
    });
    expect(detail.lines[1].lotCode).toBeNull();
    expect((await get('stockA', '/stock/receipts').expect(200)).body[0]).toMatchObject({
      code: r.code,
      linesCount: 2,
    });
    await post('stockA', '/stock/receipts', { lines: [] }).expect(400);
    await post('adminB', '/stock/receipts', {
      lines: [{ stockItemId: tomate.id, quantity: '1', unit: 'kg', factor: '1' }],
    }).expect(404);
    expect((await get('adminB', '/stock/receipts').expect(200)).body).toHaveLength(0);
  });

  it('produção baixa a ficha de preparo, dá entrada com custo e cria lote', async () => {
    // Ficha: 4 kg de tomate rendem 2 kg de molho.
    const m = (
      await put('stockA', `/stock/items/${molho.id}/recipe`, {
        yield: '2',
        lines: [{ stockItemId: tomate.id, quantity: '4' }],
      }).expect(200)
    ).body;
    expect(m).toMatchObject({ hasPrep: true, recipeYield: '2.000' });
    await put('stockA', `/stock/items/${molho.id}/recipe`, {
      yield: '2',
      lines: [{ stockItemId: molho.id, quantity: '1' }],
    }).expect(422);
    const recipes = (await get('stockA', '/stock/item-recipes').expect(200)).body;
    expect(recipes).toEqual([{ itemId: molho.id, stockItemId: tomate.id, quantity: '4.000' }]);

    // Pede mais tomate do que tem: nada muda.
    await post('stockA', '/stock/productions', {
      lines: [{ stockItemId: molho.id, quantity: '6' }],
    }).expect(409);
    expect(await qtyOf(tomate.id)).toBe('10.000');

    const out = (
      await post('stockA', '/stock/productions', {
        lines: [{ stockItemId: molho.id, quantity: '1.5' }],
      }).expect(201)
    ).body;
    // 1,5 kg de molho = 3 kg de tomate × R$ 6,00 = R$ 18,00 (R$ 12,00/kg).
    expect(out[0]).toMatchObject({ code: expect.stringMatching(/^PRD-/), totalCost: '18.00' });
    expect(await qtyOf(tomate.id)).toBe('7.000');
    expect((await get('stockA', `/stock/items/${molho.id}`).expect(200)).body).toMatchObject({
      quantity: '1.500',
      avgCost: '12.0000',
    });
    const lots = (await get('stockA', `/stock/lots?itemId=${molho.id}`).expect(200)).body;
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ origin: 'production', status: 'available', quantity: '1.500' });
    // Validade padrão do insumo: 3 dias.
    const diff = (Date.parse(lots[0].expiresOn) - Date.parse(lots[0].madeOn)) / 86400000;
    expect(diff).toBe(3);
    const prods = (await get('stockA', '/stock/productions').expect(200)).body;
    expect(prods[0]).toMatchObject({ itemName: 'Molho', lotCode: lots[0].code });
    const movs = (
      await get('stockA', `/stock/movements?itemId=${tomate.id}&direction=out`).expect(200)
    ).body;
    expect(movs[0]).toMatchObject({
      kind: 'production',
      quantity: '-3.000',
      productionCode: out[0].code,
    });
  });

  it('lotes: manual, descarte registra perda e não fecha duas vezes', async () => {
    const lot = (
      await post('stockA', '/stock/lots', {
        stockItemId: tomate.id,
        quantity: '2',
        code: 'FORN-77',
        madeOn: '2026-10-01',
        expiresOn: '2026-10-25',
      }).expect(201)
    ).body;
    expect(lot).toMatchObject({ code: 'FORN-77', origin: 'manual', itemName: 'Tomate' });
    expect(await qtyOf(tomate.id)).toBe('7.000');
    await post('cashierA', `/stock/lots/${lot.id}/close`, { status: 'discarded' }).expect(403);
    await post('stockA', `/stock/lots/${lot.id}/close`, {
      status: 'discarded',
      note: 'Vencido',
    }).expect(201);
    expect(await qtyOf(tomate.id)).toBe('5.000');
    await post('stockA', `/stock/lots/${lot.id}/close`, { status: 'used' }).expect(409);
    const [mv] = (await get('stockA', `/stock/movements?itemId=${tomate.id}&limit=1`).expect(200))
      .body;
    expect(mv).toMatchObject({ kind: 'loss', quantity: '-2.000', lotCode: 'FORN-77' });
    expect((await get('adminB', '/stock/lots').expect(200)).body).toHaveLength(0);
    await post('adminB', `/stock/lots/${lot.id}/close`, { status: 'used' }).expect(404);
  });

  it('saída avulsa exige motivo e aparece nas saídas', async () => {
    const mv = (body: object) => post('stockA', `/stock/items/${refri.id}/movements`, body);
    await mv({ kind: 'withdrawal', quantity: '2' }).expect(422);
    await mv({ kind: 'withdrawal', quantity: '20', note: 'Consumo interno' }).expect(409);
    await mv({ kind: 'withdrawal', quantity: '2', note: 'Consumo interno' }).expect(201);
    expect(await qtyOf(refri.id)).toBe('10.000');
    const out = (await get('stockA', '/stock/movements?direction=out&limit=50').expect(200))
      .body as { kind: string; itemName: string }[];
    expect(out.some((m) => m.kind === 'withdrawal' && m.itemName === 'Refri lata')).toBe(true);
    expect(out.every((m) => m.kind !== 'purchase')).toBe(true);
  });
});

// ------------------------------------------------------------------------------- entregas
let courier1: { id: string };
let courier2: { id: string };

async function readyDelivery() {
  const o = (
    await order('waiterA', {
      channel: 'delivery',
      deliveryAddress: 'Rua das Flores, 100 - Centro',
      customerName: 'Carla Cliente',
      customerPhone: '11999990000',
      deliveryFee: '5.00',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(201)
  ).body;
  await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
  return o as { id: string; number: number };
}
const track = (token: string, host = HOST_A) =>
  http.get(`/api/v1/track/${token}`).set('Host', host);
const tokenOf = (path: string) => path.split('/').pop()!;

describe('Entregas e rastreio', () => {
  it('cadastra entregadores (com login de entregador vinculado)', async () => {
    await post('waiterA', '/couriers', { name: 'X' }).expect(403);
    courier1 = (
      await post('adminA', '/couriers', {
        name: 'João Moto',
        phone: '11988887777',
        userId: ids.driverA,
      }).expect(201)
    ).body;
    courier2 = (
      await post('adminA', '/couriers', { name: 'Pedro Bike', userId: ids.driver2A }).expect(201)
    ).body;
    // Usuário de outro restaurante não pode ser vinculado.
    const otherUser = await addUser(fx.tenantB, 'so-b@bo-b.test', 'driver');
    await post('adminA', '/couriers', { name: 'Intruso', userId: otherUser }).expect(422);
    expect((await get('adminB', '/couriers').expect(200)).body).toHaveLength(0);
  });

  it('despacha, rastreia publicamente, entregador envia posição e conclui', async () => {
    const counter = (await counterOrder(1).expect(201)).body;
    await post('adminA', `/orders/${counter.id}/status`, { to: 'ready' }).expect(201);
    await post('adminA', `/orders/${counter.id}/dispatch`, { courierId: courier1.id }).expect(409);

    const o = (
      await order('waiterA', {
        channel: 'delivery',
        deliveryAddress: 'Rua A, 1',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(409); // ainda não pronto
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    // Sem entregador não sai: o status genérico não aceita "saiu para entrega".
    await post('adminA', `/orders/${o.id}/status`, { to: 'dispatched' }).expect(409);
    await post('driverA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(403);
    const d = (
      await post('cashierA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(201)
    ).body;
    expect(d.trackingPath).toMatch(/^\/rastreio\/[A-Za-z0-9_-]{32}$/);
    expect(d.delivery).toMatchObject({
      status: 'out',
      orderStatus: 'dispatched',
      courierName: 'João Moto',
    });
    await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier2.id }).expect(409);

    // Rastreio público: sem sessão, só o mínimo (sem endereço/telefone).
    const tk = tokenOf(d.trackingPath);
    const t1 = (await track(tk).expect(200)).body;
    expect(t1).toMatchObject({
      orderNumber: o.number,
      status: 'out',
      courier: 'João',
      location: null,
    });
    expect(JSON.stringify(t1)).not.toContain('Rua A');
    await track(tk, HOST_B).expect(404);
    await track('token-que-nao-existe-1234567890').expect(404);

    // Só o entregador da corrida envia posição.
    await post('driver2A', `/deliveries/${d.delivery.id}/location`, {
      lat: -23.5,
      lng: -46.6,
    }).expect(403);
    await post('driverA', `/deliveries/${d.delivery.id}/location`, { lat: 200, lng: 0 }).expect(
      400,
    );
    await post('driverA', `/deliveries/${d.delivery.id}/location`, {
      lat: -23.55052,
      lng: -46.633308,
    }).expect(201);
    const t2 = (await track(tk).expect(200)).body;
    expect(t2.location).toMatchObject({ lat: '-23.550520', lng: '-46.633308' });
    expect(t2.trail).toEqual([[-23.55052, -46.633308]]);
    expect(t2).not.toHaveProperty('address');

    // Entregador vê só as próprias entregas.
    const mine = (await get('driverA', '/deliveries').expect(200)).body as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(d.delivery.id);
    expect((await get('driver2A', '/deliveries').expect(200)).body).toHaveLength(0);
    await post('driver2A', `/deliveries/${d.delivery.id}/complete`).expect(403);
    // O entregador não vê pedidos da loja nem o código do cliente.
    await get('driverA', '/orders').expect(403);
    await get('driverA', '/products').expect(403);
    expect(JSON.stringify(mine)).not.toMatch(/confirm|"code"/);

    // Conclui só com o código de 4 dígitos que o cliente recebeu (como no iFood).
    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d.delivery.id],
    );
    expect(code).toMatch(/^[0-9]{4}$/);
    expect(t2.code).toBe(code);
    const wrong = code === '0000' ? '1111' : '0000';
    await post('driverA', `/deliveries/${d.delivery.id}/complete`).expect(422);
    await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code: wrong }).expect(422);
    await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code: 'abcd' }).expect(400);
    const done = (
      await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code }).expect(201)
    ).body;
    expect(done).toMatchObject({ status: 'delivered', orderStatus: 'completed' });
    await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code }).expect(409);
    const t3 = (await track(tk).expect(200)).body;
    expect(t3).toMatchObject({ status: 'delivered', location: null, trail: [], code: null });

    // Link encurtado após a entrega; depois de expirar, 410.
    await ownerQuery(
      `UPDATE deliveries SET tracking_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [d.delivery.id],
    );
    await track(tk).expect(410);
  });

  it('entrega não realizada volta o pedido para pronto e permite sair de novo', async () => {
    const o = await readyDelivery();
    const d = (
      await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier2.id }).expect(201)
    ).body;
    await post('driver2A', `/deliveries/${d.delivery.id}/fail`, {}).expect(400);
    const f = (
      await post('driver2A', `/deliveries/${d.delivery.id}/fail`, {
        reason: 'Cliente ausente',
      }).expect(201)
    ).body;
    expect(f).toMatchObject({
      status: 'failed',
      orderStatus: 'ready',
      failureReason: 'Cliente ausente',
    });
    await track(tokenOf(d.trackingPath)).expect(200);
    const d2 = (
      await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(201)
    ).body;
    // Novo link; regenerar invalida o anterior.
    const again = (await post('adminA', `/deliveries/${d2.delivery.id}/tracking-link`).expect(201))
      .body;
    await track(tokenOf(d2.trackingPath)).expect(404);
    await track(tokenOf(again.trackingPath)).expect(200);
    // Concluir pelo status do pedido também encerra a entrega.
    await post('adminA', `/orders/${o.id}/status`, { to: 'completed' }).expect(201);
    const today = (await get('adminA', '/deliveries?scope=today').expect(200)).body as {
      id: string;
      status: string;
    }[];
    expect(today.find((x) => x.id === d2.delivery.id)!.status).toBe('delivered');
  });

  it('código errado várias vezes trava; o restaurante conclui sem código', async () => {
    const o = await readyDelivery();
    const d = (
      await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(201)
    ).body;
    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d.delivery.id],
    );
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++)
      await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code: wrong }).expect(422);
    // Travou: nem o código certo passa mais pelo entregador.
    await post('driverA', `/deliveries/${d.delivery.id}/complete`, { code }).expect(409);
    await post('cashierA', `/deliveries/${d.delivery.id}/complete`).expect(201);
  });

  it('isolamento: B não despacha nem conclui entregas de A', async () => {
    const o = await readyDelivery();
    const courierB = (await post('adminB', '/couriers', { name: 'Moto B' }).expect(201)).body;
    await post('adminB', `/orders/${o.id}/dispatch`, { courierId: courierB.id }).expect(404);
    await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courierB.id }).expect(404);
    const d = (
      await post('adminA', `/orders/${o.id}/dispatch`, { courierId: courier1.id }).expect(201)
    ).body;
    await post('adminB', `/deliveries/${d.delivery.id}/complete`).expect(404);
    expect((await get('adminB', '/deliveries?scope=today').expect(200)).body).toHaveLength(0);
    await post('adminA', `/deliveries/${d.delivery.id}/complete`).expect(201);
  });
});

// ------------------------------------------------------------------------------- impressão
let agentToken = '';
let agent2Token = '';
const agentPost = (token: string, url: string, body: object = {}, host = HOST_A) =>
  http
    .post(`/api/v1/print-agent${url}`)
    .set('Host', host)
    .set(CSRF)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('Impressão (agente local e fila)', () => {
  it('sem agente ativo, pedidos não geram fila e reimpressão avisa', async () => {
    const o = (await counterOrder(1).expect(201)).body;
    const [{ n }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM print_jobs WHERE order_id = $1`,
      [o.id],
    );
    expect(n).toBe(0);
    await post('adminA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(409);
  });

  it('cria agentes (token mostrado uma vez, só o hash fica no banco)', async () => {
    await post('waiterA', '/printing/agents', { name: 'X' }).expect(403);
    const a = (await post('adminA', '/printing/agents', { name: 'PC do caixa' }).expect(201)).body;
    expect(a.token).toMatch(/^pma_/);
    agentToken = a.token;
    agent2Token = (await post('adminA', '/printing/agents', { name: 'PC da cozinha' }).expect(201))
      .body.token;
    const list = (await get('adminA', '/printing/agents').expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(agentToken);
    const [row] = await ownerQuery<{ token_hash: Buffer }>(
      `SELECT token_hash FROM print_agents WHERE name = 'PC do caixa'`,
    );
    expect(row.token_hash.toString('utf8')).not.toContain('pma_');
  });

  it('agente autentica pelo token e pelo host do restaurante', async () => {
    await agentPost('pma_invalido', '/heartbeat').expect(401);
    await agentPost(agentToken, '/heartbeat', {}, HOST_B).expect(401);
    const hb = (await agentPost(agentToken, '/heartbeat', { version: '0.3.0' }).expect(200)).body;
    expect(hb.agent).toBe('PC do caixa');
    expect(hb.targets).toEqual(expect.arrayContaining(['Cozinha', 'Caixa']));
    const list = (await get('adminA', '/printing/agents').expect(200)).body as {
      name: string;
      online: boolean;
    }[];
    expect(list.find((x) => x.name === 'PC do caixa')!.online).toBe(true);
  });

  it('pedido novo gera comanda de cozinha; dois agentes nunca pegam o mesmo trabalho', async () => {
    const o = (
      await order('waiterA', {
        channel: 'counter',
        customerName: 'Mesa do canto',
        items: [{ productId: fx.prodA, quantity: 2, notes: 'sem cebola' }],
      }).expect(201)
    ).body;
    const [c1, c2] = await Promise.all([
      agentPost(agentToken, '/claim', { limit: 5 }).expect(200),
      agentPost(agent2Token, '/claim', { limit: 5 }).expect(200),
    ]);
    const all = [...c1.body.jobs, ...c2.body.jobs] as {
      id: string;
      payload: string;
      kind: string;
    }[];
    const forOrder = all.filter((j) => j.payload.includes(`PEDIDO #${o.number}`));
    expect(forOrder).toHaveLength(1);
    expect(new Set(all.map((j) => j.id)).size).toBe(all.length);
    expect(forOrder[0].kind).toBe('kitchen_ticket');
    expect(forOrder[0].payload).toContain('2x X-Burguer A');
    expect(forOrder[0].payload).toContain('OBS: sem cebola');
    const owner = c1.body.jobs.some((j: { id: string }) => j.id === forOrder[0].id)
      ? agentToken
      : agent2Token;
    const other = owner === agentToken ? agent2Token : agentToken;
    // Só quem reservou confirma.
    await agentPost(other, `/jobs/${forOrder[0].id}/result`, { ok: true }).expect(409);
    await agentPost(owner, `/jobs/${forOrder[0].id}/result`, { ok: true }).expect(200);
    for (const j of all.filter((x) => x.id !== forOrder[0].id)) {
      const tok = c1.body.jobs.some((y: { id: string }) => y.id === j.id)
        ? agentToken
        : agent2Token;
      await agentPost(tok, `/jobs/${j.id}/result`, { ok: true }).expect(200);
    }
    const jobs = (await get('adminA', '/printing/jobs?status=done').expect(200)).body as {
      id: string;
    }[];
    expect(jobs.map((j) => j.id)).toContain(forOrder[0].id);
  });

  it('falha volta para a fila até o limite de tentativas; depois pode ser recolocada', async () => {
    const o = (await counterOrder(1).expect(201)).body;
    const r = (await post('cashierA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(201))
      .body;
    expect(r).toHaveLength(1);
    // Descarta comandas de cozinha pendentes deste pedido para isolar o recibo.
    await ownerQuery(
      `UPDATE print_jobs SET status = 'done' WHERE order_id = $1 AND kind = 'kitchen_ticket'`,
      [o.id],
    );
    let last = '';
    for (let i = 1; i <= 5; i++) {
      const c = (await agentPost(agentToken, '/claim', { limit: 5 }).expect(200)).body.jobs as {
        id: string;
        payload: string;
        attempts: number;
      }[];
      const job = c.find((j) => j.id === r[0].id)!;
      expect(job.attempts).toBe(i);
      if (i === 1) expect(job.payload).toContain('NÃO É DOCUMENTO FISCAL');
      last = (
        await agentPost(agentToken, `/jobs/${job.id}/result`, {
          ok: false,
          error: 'Sem papel',
        }).expect(200)
      ).body.status;
    }
    expect(last).toBe('failed');
    const c = (await agentPost(agentToken, '/claim', {}).expect(200)).body.jobs as { id: string }[];
    expect(c.map((j) => j.id)).not.toContain(r[0].id);
    await post('adminA', `/printing/jobs/${r[0].id}/retry`).expect(201);
    const c2 = (await agentPost(agentToken, '/claim', {}).expect(200)).body.jobs as {
      id: string;
    }[];
    expect(c2.map((j) => j.id)).toContain(r[0].id);
  });

  it('conferência de delivery mostra taxa de entrega, troco e observações', async () => {
    const o = (
      await order('cashierA', {
        channel: 'delivery',
        customerName: 'Carla',
        customerPhone: '11922221111',
        deliveryAddress: 'Rua A, 10',
        deliveryFee: '6.00',
        notes: 'Interfone quebrado, ligar.',
        items: [{ productId: fx.prodA, quantity: 1, notes: 'sem picles' }],
      }).expect(201)
    ).body;
    const r = (await post('cashierA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(201))
      .body as { id: string }[];
    const payload = (
      await ownerQuery<{ payload: string }>(`SELECT payload FROM print_jobs WHERE id = $1`, [
        r[0].id,
      ])
    )[0].payload;
    expect(payload).toContain('Subtotal');
    expect(payload).toMatch(/Taxa de entrega\s+R\$ 6,00/);
    expect(payload).toContain('OBS: sem picles');
    expect(payload).toContain('OBS DO PEDIDO: Interfone quebrado, ligar.');
    await ownerQuery(`UPDATE print_jobs SET status = 'done' WHERE order_id = $1`, [o.id]);
  });

  it('trabalho reservado e não confirmado volta para a fila após o prazo', async () => {
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body;
    const c1 = (await agentPost(agentToken, '/claim', {}).expect(200)).body.jobs as {
      id: string;
    }[];
    expect(c1.map((j) => j.id)).toContain(t.id);
    expect(
      ((await agentPost(agent2Token, '/claim', {}).expect(200)).body.jobs as { id: string }[]).map(
        (j) => j.id,
      ),
    ).not.toContain(t.id);
    await ownerQuery(
      `UPDATE print_jobs SET claimed_at = now() - interval '2 minutes' WHERE id = $1`,
      [t.id],
    );
    const c2 = (await agentPost(agent2Token, '/claim', {}).expect(200)).body.jobs as {
      id: string;
    }[];
    expect(c2.map((j) => j.id)).toContain(t.id);
    // O primeiro agente, atrasado, não consegue mais confirmar.
    await agentPost(agentToken, `/jobs/${t.id}/result`, { ok: true }).expect(409);
    await agentPost(agent2Token, `/jobs/${t.id}/result`, { ok: true }).expect(200);
  });

  it('modelos de impressão (Liquid): valida, mostra prévia, imprime e volta ao padrão', async () => {
    await get('waiterA', '/printing/templates').expect(403);
    const list = (await get('adminA', '/printing/templates').expect(200)).body as {
      kind: string;
      body: string | null;
      default: string;
    }[];
    expect(list.map((t) => t.kind)).toEqual(['receipt', 'kitchen_ticket', 'fiscal_footer']);
    expect(list.every((t) => t.body === null && t.default.length > 20)).toBe(true);
    // Erro de sintaxe, filtro desconhecido e tentativa de ler arquivo são recusados.
    await put('adminA', '/printing/templates/receipt', { body: '{% for i in itens %}' }).expect(
      422,
    );
    await put('adminA', '/printing/templates/receipt', { body: '{{ x | nao_existe }}' }).expect(
      422,
    );
    const inc = await put('adminA', '/printing/templates/receipt', {
      body: '{% include "/etc/passwd" %}',
    }).expect(422);
    expect(inc.body.message).toContain('não podem incluir');
    await put('adminA', '/printing/templates/outro', { body: 'x' }).expect(400);

    const body = `{{ "CONTA DA CASA" | centro }}
{% for item in itens %}{{ item.quantidade | qtd | append: "x " | append: item.nome | linha: item.total_formatado }}
{% endfor %}{{ "TOTAL" | linha: totais.total_formatado }}
{{ loja.nome }}`;
    const pv = (
      await post('adminA', '/printing/templates/preview', { kind: 'receipt', body }).expect(200)
    ).body;
    expect(pv.text).toContain('CONTA DA CASA');
    expect(pv.text).toMatch(/TOTAL\s+R\$ \d/);
    await put('adminA', '/printing/templates/receipt', { body }).expect(200);

    const o = (await counterOrder(1).expect(201)).body;
    await post('adminA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(201);
    const jobs = await ownerQuery<{ payload: string }>(
      `SELECT payload FROM print_jobs WHERE order_id = $1 AND kind = 'receipt'`,
      [o.id],
    );
    expect(jobs[0].payload).toContain('CONTA DA CASA');
    expect(jobs[0].payload).not.toContain('CONFERÊNCIA DE CONTA');
    // Cada restaurante tem os seus modelos.
    const b = (await get('adminB', '/printing/templates').expect(200)).body as { body: string }[];
    expect(b.every((t) => t.body === null)).toBe(true);
    // Voltar ao padrão.
    await http
      .delete('/api/v1/printing/templates/receipt')
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA)
      .set(CSRF)
      .expect(200);
    await post('adminA', `/orders/${o.id}/print`, { kind: 'receipt' }).expect(201);
    const after = await ownerQuery<{ payload: string }>(
      `SELECT payload FROM print_jobs WHERE order_id = $1 AND kind = 'receipt' ORDER BY created_at DESC LIMIT 1`,
      [o.id],
    );
    expect(after[0].payload).toContain('CONFERÊNCIA DE CONTA');
  });

  it('desativar ou trocar o token bloqueia o agente; B não vê a fila de A', async () => {
    const list = (await get('adminA', '/printing/agents').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const a2 = list.find((x) => x.name === 'PC da cozinha')!;
    const rotated = (await post('adminA', `/printing/agents/${a2.id}/token`).expect(201)).body;
    await agentPost(agent2Token, '/heartbeat').expect(401);
    await agentPost(rotated.token, '/heartbeat').expect(200);
    await patch('adminA', `/printing/agents/${a2.id}`, { active: false }).expect(200);
    await agentPost(rotated.token, '/heartbeat').expect(401);
    expect((await get('adminB', '/printing/jobs').expect(200)).body).toHaveLength(0);
    await post(
      'adminB',
      `/printing/jobs/${(await get('adminA', '/printing/jobs')).body[0].id}/retry`,
    ).expect(404);
  });
});

// ------------------------------------------------------------------------------- financeiro
describe('Financeiro', () => {
  let bill: { id: string };

  it('lança conta a pagar; baixa exige Idempotency-Key e é idempotente', async () => {
    await post('waiterA', '/finance/entries', {}).expect(403);
    await post('pdvA', '/finance/entries', {
      kind: 'payable',
      description: 'X',
      amount: '1.00',
      dueDate: '2026-10-30',
    }).expect(403);
    await post('adminA', '/finance/entries', {
      kind: 'payable',
      description: 'Conta de luz',
      amount: '1.005',
      dueDate: '2026-10-30',
    }).expect(400);
    await post('adminA', '/finance/entries', {
      kind: 'payable',
      description: 'Conta de luz',
      amount: '350.40',
      dueDate: '2026-02-30',
    }).expect(400);
    bill = (
      await post('adminA', '/finance/entries', {
        kind: 'payable',
        description: 'Conta de luz',
        category: 'Energia',
        counterparty: 'Companhia Elétrica',
        amount: '350.40',
        dueDate: '2026-10-30',
      }).expect(201)
    ).body;
    expect(bill).toMatchObject({ status: 'open', amount: '350.40', dueDate: '2026-10-30' });
    await post('adminA', `/finance/entries/${bill.id}/settle`, { method: 'pix' }).expect(422);
    const k = key();
    const s1 = (
      await post(
        'adminA',
        `/finance/entries/${bill.id}/settle`,
        { method: 'pix', paidAt: '2026-10-22' },
        k,
      ).expect(201)
    ).body;
    const s2 = (
      await post(
        'adminA',
        `/finance/entries/${bill.id}/settle`,
        { method: 'pix', paidAt: '2026-10-22' },
        k,
      ).expect(201)
    ).body;
    expect(s1).toEqual(s2);
    expect(s1).toMatchObject({ status: 'paid', paidAt: '2026-10-22', paidMethod: 'pix' });
    await post('adminA', `/finance/entries/${bill.id}/settle`, { method: 'pix' }, key()).expect(
      409,
    );
    await post('adminA', `/finance/entries/${bill.id}/cancel`, { reason: 'Engano' }).expect(409);
  });

  it('cancela lançamento em aberto com motivo; vencidos aparecem como atrasados', async () => {
    const old = (
      await post('adminA', '/finance/entries', {
        kind: 'payable',
        description: 'Fornecedor atrasado',
        amount: '100.00',
        dueDate: '2020-01-10',
      }).expect(201)
    ).body;
    expect(old.overdue).toBe(true);
    const rec = (
      await post('adminA', '/finance/entries', {
        kind: 'receivable',
        description: 'Evento fechado',
        amount: '1200.00',
        dueDate: '2026-10-25',
      }).expect(201)
    ).body;
    await post('adminA', `/finance/entries/${rec.id}/cancel`, {}).expect(400);
    const c = (
      await post('adminA', `/finance/entries/${rec.id}/cancel`, {
        reason: 'Evento desmarcado',
      }).expect(201)
    ).body;
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Evento desmarcado' });
    const overdue = (await get('stockA', '/finance/entries?status=overdue').expect(200)).body as {
      id: string;
    }[];
    expect(overdue.map((e) => e.id)).toEqual([old.id]);
    const sum = (await get('adminA', '/finance/summary').expect(200)).body;
    expect(sum).toMatchObject({
      payableOpen: '100.00',
      payableOverdue: '100.00',
      receivableOpen: '0.00',
    });
  });

  it('o banco não deixa a aplicação alterar valor de lançamento nem apagar', async () => {
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(`UPDATE finance_entries SET amount = 1 WHERE id = $1`, [bill.id]),
      ).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(c.query(`DELETE FROM finance_entries WHERE id = $1`, [bill.id])).rejects.toThrow(
        /permission denied/,
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(c.query(`UPDATE stock_movements SET quantity = 1`)).rejects.toThrow(
        /permission denied/,
      );
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('fluxo de caixa e conciliação usam os recebimentos reais do caixa', async () => {
    const reg = (await post('adminA', '/cash-registers', { name: 'Caixa Fin' }).expect(201)).body;
    const s = (
      await post('cashierA', '/cash/sessions', {
        registerId: reg.id,
        openingAmount: '50.00',
      }).expect(201)
    ).body;
    const o = (await counterOrder(1).expect(201)).body;
    await post(
      'cashierA',
      `/orders/${o.id}/payments`,
      { cashSessionId: s.id, method: 'pix', amount: o.total },
      key(),
    ).expect(201);
    const [{ today }] = await ownerQuery<{ today: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM tenants WHERE id = $1`,
      [fx.tenantA],
    );
    const flow = (await get('stockA', `/finance/cash-flow?from=${today}&to=${today}`).expect(200))
      .body;
    expect(flow.days).toHaveLength(1);
    expect(flow.totals.sales).toBe(o.total);
    await get('stockA', `/finance/cash-flow?from=${today}&to=2020-01-01`).expect(400);

    const rec = (await get('adminA', `/finance/reconciliation?day=${today}`).expect(200)).body;
    const pix = rec.methods.find((m: { method: string }) => m.method === 'pix');
    expect(pix.systemAmount).toBe(o.total);
    await post('adminA', '/finance/reconciliation', {
      day: today,
      method: 'pix',
      informedAmount: '1.00',
    }).expect(422);
    const r = (
      await post('adminA', '/finance/reconciliation', {
        day: today,
        method: 'pix',
        informedAmount: '1.00',
        note: 'Extrato ainda não caiu',
      }).expect(201)
    ).body;
    const [ic, sc] = [Math.round(Number('1.00') * 100), Math.round(Number(o.total) * 100)];
    expect(r.difference).toBe(((ic - sc) / 100).toFixed(2));
    await post('adminA', '/finance/reconciliation', {
      day: today,
      method: 'pix',
      informedAmount: o.total,
    }).expect(409);
    await post('pdvA', '/finance/reconciliation', {
      day: today,
      method: 'cash',
      informedAmount: '0',
    }).expect(403);
    // B não vê nada de A.
    const recB = (await get('adminB', `/finance/reconciliation?day=${today}`).expect(200)).body;
    expect(
      recB.methods.every(
        (m: { systemAmount: string; reconciliation: unknown }) =>
          m.systemAmount === '0.00' && !m.reconciliation,
      ),
    ).toBe(true);
    expect((await get('adminB', '/finance/entries').expect(200)).body).toHaveLength(0);
  });
});
