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
const remove = (w: string, url: string) =>
  http
    .delete(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF);
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

  it('troca a própria senha sem pedir a atual e encerra as outras sessões', async () => {
    const other = await login(HOST_A, 'caixa@bo-a.test');
    cookies.cashier2A = other;
    await post('cashierA', '/auth/password', { next: PASSWORD }).expect(409);
    await post('cashierA', '/auth/password', { next: 'nova-senha-caixa' }).expect(204);
    await get('cashierA', '/auth/me').expect(200);
    await get('cashier2A', '/auth/me').expect(401);
    await login(HOST_A, 'caixa@bo-a.test', 'nova-senha-caixa');
  });

  it('administrador define senha nova: a pessoa entra com ela e sai dos aparelhos', async () => {
    const r = await post('adminA', '/users', {
      email: 'esqueci@bo-a.test',
      name: 'Esqueci',
      password: 'senha-antiga-1',
      role: 'waiter',
    }).expect(201);
    expect(r.body.sharedAccount).toBe(false);
    const id = r.body.id as string;
    cookies.forgotA = await login(HOST_A, 'esqueci@bo-a.test', 'senha-antiga-1');
    await get('forgotA', '/auth/me').expect(200);

    // Só o administrador; senha curta não passa; outra pessoa da equipe não troca.
    for (const w of ['waiterA', 'cashierA', 'stockA', 'forgotA'])
      await post(w, `/users/${id}/password`, { password: 'senha-nova-123' }).expect(403);
    await post('adminA', `/users/${id}/password`, { password: 'curta' }).expect(400);

    await post('adminA', `/users/${id}/password`, { password: 'senha-nova-123' }).expect(204);
    await get('forgotA', '/auth/me').expect(401);
    const old = await http
      .post('/api/v1/auth/login')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ email: 'esqueci@bo-a.test', password: 'senha-antiga-1' });
    expect(old.status).toBe(401);
    await login(HOST_A, 'esqueci@bo-a.test', 'senha-nova-123');

    // Auditado sem a senha (nem o hash).
    const audit = await ownerQuery<{ actor: string; data: Record<string, unknown> }>(
      `SELECT actor_user_id::text AS actor, data FROM audit_log
        WHERE tenant_id = $1 AND action = 'user.password_reset' AND entity_id = $2`,
      [fx.tenantA, id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].data).toEqual({ by: 'team', email: 'esqueci@bo-a.test' });
    expect(JSON.stringify(audit)).not.toContain('senha-nova-123');
  });

  it('senha nova acaba com o bloqueio por senhas erradas', async () => {
    const list = (await get('adminA', '/users').expect(200)).body as Member[];
    const id = list.find((u) => u.email === 'esqueci@bo-a.test')!.id;
    const wrong = () =>
      http
        .post('/api/v1/auth/login')
        .set('Host', HOST_A)
        .set(CSRF)
        .send({ email: 'esqueci@bo-a.test', password: 'chutando-123' });
    // 10 falhas (somando a do teste acima) bloqueiam a conta.
    for (let i = 0; i < 10; i++) expect([401, 429]).toContain((await wrong()).status);
    // Bloqueada: nem a senha certa entra.
    const locked = await http
      .post('/api/v1/auth/login')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ email: 'esqueci@bo-a.test', password: 'senha-nova-123' });
    expect(locked.status).toBe(429);
    await post('adminA', `/users/${id}/password`, { password: 'senha-depois-1' }).expect(204);
    await login(HOST_A, 'esqueci@bo-a.test', 'senha-depois-1');
  });

  it('não troca a própria, a de outro restaurante nem conta usada em outro restaurante', async () => {
    const me = (await get('adminA', '/auth/me').expect(200)).body.user;
    await post('adminA', `/users/${me.id}/password`, { password: 'senha-nova-123' }).expect(409);

    // Pessoa só de B: para A ela não existe.
    const onlyB = (
      await post('adminB', '/users', {
        email: 'caixa@bo-b.test',
        name: 'Caixa B',
        password: 'senha-caixa-b1',
        role: 'cashier',
      }).expect(201)
    ).body as Member;
    await post('adminA', `/users/${onlyB.id}/password`, { password: 'senha-nova-123' }).expect(404);

    // O administrador de B entrou na equipe de A com a conta dele (teste acima): trocar a senha
    // aqui tomaria a conta dele em B. Recusa, e a senha de B continua a mesma.
    const listA = (await get('adminA', '/users').expect(200)).body as Member[];
    const shared = listA.find((u) => u.email === 'admin@bo-b.test')!;
    expect(shared.sharedAccount).toBe(true);
    expect(listA.find((u) => u.email === 'garcom@bo-a.test')!.sharedAccount).toBe(false);
    const res = await post('adminA', `/users/${shared.id}/password`, {
      password: 'tomar-a-conta-1',
    }).expect(409);
    expect(res.body.message).toMatch(/outro restaurante/);
    await login(HOST_B, 'admin@bo-b.test', PASSWORD);
    const taken = await http
      .post('/api/v1/auth/login')
      .set('Host', HOST_B)
      .set(CSRF)
      .send({ email: 'admin@bo-b.test', password: 'tomar-a-conta-1' });
    expect(taken.status).toBe(401);
    // Do lado de B a mesma conta também aparece como compartilhada (sem dizer com quem).
    const listB = (await get('adminB', '/users').expect(200)).body as Member[];
    expect(listB.find((u) => u.email === 'caixa@bo-b.test')!.sharedAccount).toBe(false);
    expect(listB.find((u) => u.email === 'admin@bo-b.test')!.sharedAccount).toBe(true);
  });

  it('a função do banco só aceita administrador ativo do restaurante', async () => {
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      const [{ id: target }] = await ownerQuery<{ id: string }>(
        `SELECT id FROM users WHERE email = 'esqueci@bo-a.test'`,
      );
      const [{ id: waiter }] = await ownerQuery<{ id: string }>(
        `SELECT id FROM users WHERE email = 'garcom@bo-a.test'`,
      );
      const call = async (user: string | null) => {
        await c.query('BEGIN');
        try {
          await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
          if (user) await c.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
          const r = await c.query(`SELECT app_set_member_password($1, 'x') AS r`, [target]);
          return r.rows[0].r as string;
        } finally {
          await c.query('ROLLBACK');
        }
      };
      await expect(call(null)).rejects.toMatchObject({ code: '42501' });
      await expect(call(waiter)).rejects.toMatchObject({ code: '42501' });
      // A API (papel da app) não grava a senha de ninguém direto na tabela.
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [target]),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});

type Member = { id: string; email: string; sharedAccount: boolean };

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

  it('item sem estoque pela ficha aparece esgotado, com o que falta, e não vende', async () => {
    // Deixa a carne abaixo de uma porção (a ficha pede 0,150 kg).
    await post('stockA', `/stock/items/${carne.id}/movements`, {
      kind: 'count',
      quantity: '0.100',
      note: 'Teste sem estoque',
    }).expect(201);
    const av = (await get('adminA', '/stock/availability').expect(200)).body as {
      productId: string;
      out: boolean;
      portions: number | null;
      missing: string[];
      lines: { name: string; short: boolean }[];
    }[];
    const a = av.find((x) => x.productId === fx.prodA)!;
    expect(a.out).toBe(true);
    expect(a.portions).toBe(0);
    expect(a.missing).toEqual(['Carne']);
    expect(a.lines.find((l) => l.name === 'Pão')!.short).toBe(false);
    // O cardápio de venda já mostra esgotado (PDV, garçom e loja online usam a mesma árvore).
    const menu = (await get('adminA', '/menu?channel=counter').expect(200)).body as {
      products: { id: string; soldOut: boolean; stockOut: boolean }[];
    }[];
    const p = menu.flatMap((c) => c.products).find((x) => x.id === fx.prodA)!;
    expect(p).toMatchObject({ soldOut: true, stockOut: true });
    const r = await counterOrder(1).expect(409);
    expect(r.body.message).toContain('falta Carne');
    // Repôs: volta a vender e a contagem de porções acompanha o saldo.
    await post('stockA', `/stock/items/${carne.id}/movements`, {
      kind: 'purchase',
      quantity: '0.500',
    }).expect(201);
    const av2 = (await get('adminA', '/stock/availability').expect(200)).body as typeof av;
    expect(av2.find((x) => x.productId === fx.prodA)).toMatchObject({ out: false, portions: 4 });
    const menu2 = (await get('adminA', '/menu?channel=counter').expect(200)).body as typeof menu;
    expect(menu2.flatMap((c) => c.products).find((x) => x.id === fx.prodA)!.soldOut).toBe(false);
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

/** Pega trabalhos até achar `id` (os outros são confirmados como impressos). */
async function claimUntil(token: string, id: string) {
  for (let i = 0; i < 20; i++) {
    const jobs = (await agentPost(token, '/claim', { limit: 20 }).expect(200)).body.jobs as {
      id: string;
    }[];
    const hit = jobs.find((j) => j.id === id);
    for (const j of jobs)
      if (j.id !== id) await agentPost(token, `/jobs/${j.id}/result`, { ok: true }).expect(200);
    if (hit) return hit;
  }
  throw new Error(`trabalho ${id} não apareceu na fila`);
}

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
    expect(hb.brand).toMatchObject({ theme: expect.stringMatching(/^(auto|light|dark)$/) });
    await agentPost(agentToken, '/heartbeat', {
      version: '1.4.0',
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb' }],
    }).expect(200);
    const list = (await get('adminA', '/printing/agents').expect(200)).body as {
      name: string;
      online: boolean;
      printers: { label: string }[] | null;
    }[];
    expect(list.find((x) => x.name === 'PC do caixa')!.online).toBe(true);
    expect(list.find((x) => x.name === 'PC do caixa')!.printers?.[0]?.label).toBe('EPSON TM-T20');
    await agentPost(agentToken, '/heartbeat', {
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb', state: 'off' }],
    }).expect(200);
    const off = (await get('adminA', '/printing/agents').expect(200)).body as {
      name: string;
      printers: { state?: string }[];
    }[];
    expect(off.find((x) => x.name === 'PC do caixa')!.printers[0].state).toBe('off');
    await agentPost(agentToken, '/heartbeat', {
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb', state: 'ok' }],
    }).expect(200);
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
      if (last === 'failed') break;
      // A falha só volta depois de uma espera (não a cada 3 segundos).
      const again = (await agentPost(agentToken, '/claim', { limit: 5 }).expect(200)).body.jobs as {
        id: string;
      }[];
      expect(again.map((j) => j.id)).not.toContain(job.id);
      await ownerQuery(`UPDATE print_jobs SET retry_at = now() WHERE id = $1`, [job.id]);
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

  it('tira da fila o que ainda não imprimiu (só os "Na fila")', async () => {
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    await post('cashierA', '/printing/jobs/discard', { ids: [t.id] }).expect(403);
    const d = (await post('adminA', '/printing/jobs/discard', { ids: [t.id] }).expect(200)).body;
    expect(d.discarded).toBe(1);
    const again = (await post('adminA', '/printing/jobs/discard', { ids: [t.id] }).expect(200))
      .body;
    expect(again.discarded).toBe(0);
    const c = (await agentPost(agentToken, '/claim', {}).expect(200)).body.jobs as { id: string }[];
    expect(c.map((j) => j.id)).not.toContain(t.id);
    expect((await post('adminB', '/printing/jobs/discard', {}).expect(200)).body.discarded).toBe(0);
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

  it('via de entrega: prévia, frete no fechamento, impressão e modelo próprio', async () => {
    const o = (
      await order('cashierA', {
        channel: 'delivery',
        customerName: 'Thiago',
        customerPhone: '19982362030',
        deliveryAddress: 'Avenida Antonio Barbosa, 130, Centro, Vinhedo',
        notes: 'Troco para 100',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    // Como no pedido do cardápio online: o cliente vai pagar em dinheiro, troco para 100.
    await ownerQuery(`UPDATE orders SET payment_hint = 'cash', change_for = 100 WHERE id = $1`, [
      o.id,
    ]);
    await get('adminB', `/orders/${o.id}/delivery-slip`).expect(404);
    // Fechar conta: o caixa põe o frete (e a taxa) e o total refaz.
    const adj = (
      await patch('cashierA', `/orders/${o.id}/adjustments`, {
        deliveryFee: '7.00',
        reason: 'Ajuste no fechamento da conta',
      }).expect(200)
    ).body;
    expect(adj.deliveryFee).toBe('7.00');
    expect(Number(adj.total)).toBeCloseTo(Number(o.subtotal) + 7, 2);
    const pv = (await get('cashierA', `/orders/${o.id}/delivery-slip`).expect(200)).body;
    expect(pv.text).toContain('VIA DE ENTREGA');
    expect(pv.text).toContain('Telefone: 19982362030');
    expect(pv.text).toContain('Avenida Antonio Barbosa, 130');
    expect(pv.text).toMatch(/Taxa de entrega:\s+R\$ 7,00/);
    expect(pv.text).toMatch(/TOTAL A COBRAR:\s+R\$ \d/);
    expect(pv.text).toContain('Pagamento: Dinheiro');
    expect(pv.text).toMatch(/Levar de troco:/);
    expect(pv.agent).toBe(true);
    const r = (await post('cashierA', `/orders/${o.id}/print`, { kind: 'delivery' }).expect(201))
      .body as { id: string; kind: string }[];
    expect(r[0].kind).toBe('delivery_slip');
    // Modelo próprio do restaurante para a via.
    await put('adminA', '/printing/templates/delivery_slip', {
      body: '{{ "ENTREGA #" | append: pedido.numero }} {{ pedido.cobrar_formatado }}',
    }).expect(200);
    const mine = (await get('cashierA', `/orders/${o.id}/delivery-slip`).expect(200)).body;
    expect(mine.text).toMatch(new RegExp(`^ENTREGA #${o.number} R\\$ `));
    await http
      .delete('/api/v1/printing/templates/delivery_slip')
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA)
      .set(CSRF)
      .expect(200);
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
    // Dentro do prazo (o computador ainda pode estar imprimindo): ninguém pega de novo.
    expect(
      ((await agentPost(agent2Token, '/claim', {}).expect(200)).body.jobs as { id: string }[]).map(
        (j) => j.id,
      ),
    ).not.toContain(t.id);
    await ownerQuery(
      `UPDATE print_jobs SET claimed_at = now() - interval '3 minutes' WHERE id = $1`,
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
    expect(list.map((t) => t.kind)).toEqual([
      'receipt',
      'delivery_slip',
      'kitchen_ticket',
      'fiscal_footer',
    ]);
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

  it('pedido de entrega sai numa ficha só por impressora e o pedido mostra o que foi impresso', async () => {
    const sector = async (name: string) =>
      (
        await ownerQuery<{ id: string }>(
          `INSERT INTO production_sectors (tenant_id, name) VALUES ($1, $2) RETURNING id`,
          [fx.tenantA, name],
        )
      )[0].id;
    const product = async (name: string, sectorId: string) =>
      (
        await ownerQuery<{ id: string }>(
          `INSERT INTO products (tenant_id, category_id, name, price, sector_id)
           VALUES ($1,$2,$3,'10.00',$4) RETURNING id`,
          [fx.tenantA, fx.catA, name, sectorId],
        )
      )[0].id;
    const chapa = await sector('Chapa Ficha');
    const bar = await sector('Bar Ficha');
    const burger = await product('Burger Ficha', chapa);
    const soda = await product('Refri Ficha', bar);
    const items = [
      { productId: burger, quantity: 1 },
      { productId: soda, quantity: 2 },
    ];
    const delivery = () =>
      order('waiterA', {
        channel: 'delivery',
        deliveryAddress: 'Rua das Flores, 100 - Centro',
        customerName: 'Carla Cliente',
        customerPhone: '11999990000',
        items,
      }).expect(201);
    const kitchenJobs = (orderId: string) =>
      ownerQuery<{ target: string; payload: string }>(
        `SELECT target, payload FROM print_jobs WHERE order_id = $1 AND kind = 'kitchen_ticket'`,
        [orderId],
      );
    // Uma impressora só (todas as cozinhas caem na principal): uma ficha com tudo.
    await agentPost(agentToken, '/heartbeat', {
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb' }],
    }).expect(200);
    const one = (await delivery()).body as { id: string; number: number };
    const single = await kitchenJobs(one.id);
    expect(single).toHaveLength(1);
    expect(single[0].payload).toContain('1x Burger Ficha');
    expect(single[0].payload).toContain('2x Refri Ficha');
    expect(single[0].payload).toContain('-- BAR FICHA --');
    expect(single[0].payload).toContain('-- CHAPA FICHA --');
    // A reimpressão também sai numa ficha.
    await post('adminA', `/orders/${one.id}/print`, { kind: 'kitchen' }).expect(201);
    expect(await kitchenJobs(one.id)).toHaveLength(2);

    // O bar tem impressora própria: cada impressora recebe a sua parte.
    await agentPost(agentToken, '/heartbeat', {
      printers: [
        { target: null, label: 'EPSON TM-T20', kind: 'usb' },
        { target: 'Bar Ficha', label: 'Rede do bar', kind: 'network' },
      ],
    }).expect(200);
    const two = (await delivery()).body as { id: string };
    const split = await kitchenJobs(two.id);
    expect(split.map((j) => j.target).sort()).toEqual(['Bar Ficha', 'Chapa Ficha']);

    // Salão segue uma comanda por cozinha.
    const counter = (await order('waiterA', { channel: 'counter', items }).expect(201)).body as {
      id: string;
    };
    expect(await kitchenJobs(counter.id)).toHaveLength(2);

    // Muitas cozinhas na mesma impressora: o pedido entra e sai numa ficha só.
    await agentPost(agentToken, '/heartbeat', {
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb' }],
    }).expect(200);
    const many: { productId: string; quantity: number }[] = [];
    for (let i = 1; i <= 6; i++)
      many.push({
        productId: await product(`Item Ficha ${i}`, await sector(`Cozinha Ficha ${i}`)),
        quantity: 1,
      });
    const big = (
      await order('waiterA', {
        channel: 'delivery',
        deliveryAddress: 'Rua das Flores, 100 - Centro',
        customerName: 'Carla Cliente',
        customerPhone: '11999990000',
        items: many,
      }).expect(201)
    ).body as { id: string };
    expect(await kitchenJobs(big.id)).toHaveLength(1);

    // Histórico de impressões dentro do pedido: hora, o quê, onde, quem e a prévia.
    await post('adminA', `/orders/${one.id}/print`, { kind: 'delivery' }).expect(201);
    const prints = (await get('adminA', `/orders/${one.id}/prints`).expect(200)).body as {
      kind: string;
      target: string;
      status: string;
      createdAt: string;
      byName: string | null;
      text: string;
    }[];
    expect(prints.map((p) => p.kind)).toEqual([
      'delivery_slip',
      'kitchen_ticket',
      'kitchen_ticket',
    ]);
    expect(prints[0].text).toContain('VIA DE ENTREGA');
    expect(prints[1].text).toContain('*** REIMPRESSÃO ***');
    expect(prints.every((p) => p.status === 'queued' && p.createdAt)).toBe(true);
    // Outro restaurante não lê.
    await http
      .get(`/api/v1/orders/${one.id}/prints`)
      .set('Host', HOST_B)
      .set('Cookie', cookies.adminB!)
      .expect((r) => expect([403, 404]).toContain(r.status));

    await ownerQuery(`UPDATE print_jobs SET status = 'done' WHERE order_id = ANY($1::uuid[])`, [
      [one.id, two.id, counter.id],
    ]);
    await agentPost(agentToken, '/heartbeat', {
      printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb', state: 'ok' }],
    }).expect(200);
  });

  it('falha depois de mandar para a impressora não volta sozinha (sem cópias repetidas)', async () => {
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    const c = (await agentPost(agentToken, '/claim', { limit: 1 }).expect(200)).body.jobs as {
      id: string;
    }[];
    const job = c.find((j) => j.id === t.id) ?? (await claimUntil(agentToken, t.id));
    const r = (
      await agentPost(agentToken, `/jobs/${job.id}/result`, {
        ok: false,
        sent: true,
        error: 'O Windows recebeu, mas a impressora não confirmou',
        printer: 'EPSON L4260',
      }).expect(200)
    ).body;
    expect(r.status).toBe('failed');
    await ownerQuery(`UPDATE print_jobs SET retry_at = NULL WHERE id = $1`, [t.id]);
    const again = (await agentPost(agentToken, '/claim', { limit: 20 }).expect(200)).body.jobs as {
      id: string;
    }[];
    expect(again.map((j) => j.id)).not.toContain(t.id);
    for (const j of again) await agentPost(agentToken, `/jobs/${j.id}/result`, { ok: true });
    const [row] = await ownerQuery<{ printer_label: string }>(
      `SELECT printer_label FROM print_jobs WHERE id = $1`,
      [t.id],
    );
    expect(row.printer_label).toBe('EPSON L4260');
  });

  it('tirar da fila o que o computador já pegou: não confirma e a fila do Windows é limpa', async () => {
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    await claimUntil(agentToken, t.id);
    const d = (await post('adminA', '/printing/jobs/discard', { ids: [t.id] }).expect(200)).body;
    expect(d.discarded).toBe(1);
    const jobs = (await get('adminA', '/printing/jobs?status=cancelled').expect(200)).body as {
      id: string;
    }[];
    expect(jobs.map((j) => j.id)).toContain(t.id);
    await agentPost(agentToken, `/jobs/${t.id}/result`, { ok: true }).expect(409);
    const hb = (await agentPost(agentToken, '/heartbeat', {}).expect(200)).body;
    expect(hb.purge).toEqual(expect.any(String));
    const hb2 = (await agentPost(agentToken, '/heartbeat', { purgedAt: hb.purge }).expect(200))
      .body;
    expect(hb2.purge).toBeNull();
    // Volta para a fila se a pessoa quiser.
    await post('adminA', `/printing/jobs/${t.id}/retry`).expect(201);
    await post('adminA', '/printing/jobs/discard', { ids: [t.id] }).expect(200);
  });

  it('tira uma impressora do computador e mostra os trabalhos dela', async () => {
    const list = (await get('adminA', '/printing/agents').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const a = list.find((x) => x.name === 'PC do caixa')!;
    await agentPost(agentToken, '/heartbeat', {
      printers: [
        { target: null, label: 'EPSON L4260', kind: 'document' },
        { target: 'Caixa', label: 'Rede 192.168.0.10', kind: 'network' },
      ],
    }).expect(200);
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    const k = (await post('adminA', '/printing/test', { target: 'Chapa' }).expect(201)).body as {
      id: string;
    };
    const caixa = (await get('adminA', `/printing/agents/${a.id}/jobs?target=Caixa`).expect(200))
      .body as { upcoming: { id: string }[]; past: { id: string }[] };
    expect(caixa.upcoming.map((j) => j.id)).toContain(t.id);
    expect(caixa.upcoming.map((j) => j.id)).not.toContain(k.id);
    const main = (await get('adminA', `/printing/agents/${a.id}/jobs`).expect(200)).body as {
      label: string;
      upcoming: { id: string }[];
      past: { printerLabel: string | null }[];
    };
    expect(main.label).toBe('EPSON L4260');
    expect(main.upcoming.map((j) => j.id)).toContain(k.id);
    expect(main.upcoming.map((j) => j.id)).not.toContain(t.id);
    expect(main.past.some((j) => j.printerLabel === 'EPSON L4260')).toBe(true);
    await post('adminA', '/printing/jobs/discard', { ids: [t.id, k.id] }).expect(200);

    await post('waiterA', `/printing/agents/${a.id}/printers/remove`, { target: 'Caixa' }).expect(
      403,
    );
    const after = (
      await post('adminA', `/printing/agents/${a.id}/printers/remove`, {
        target: 'Caixa',
        label: 'Rede 192.168.0.10',
      }).expect(200)
    ).body as { printers: { target: string | null }[] };
    expect(after.printers.map((p) => p.target)).toEqual([null]);
    const hb = (await agentPost(agentToken, '/heartbeat', {}).expect(200)).body;
    expect(hb.remove).toEqual(['Caixa']);
    const hb2 = (await agentPost(agentToken, '/heartbeat', { removed: ['Caixa'] }).expect(200))
      .body;
    expect(hb2.remove).toEqual([]);
    await post('adminA', `/printing/agents/${a.id}/printers/remove`, { target: null }).expect(200);
    expect((await agentPost(agentToken, '/heartbeat', {}).expect(200)).body.remove).toEqual([null]);
    await agentPost(agentToken, '/heartbeat', { removed: [null] }).expect(200);
  });

  it('fila: filtra, conta por situação, recoloca e apaga (um, escolhidos e o histórico)', async () => {
    const a = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    const b = (await post('adminA', '/printing/test', { target: 'Bar teste' }).expect(201))
      .body as {
      id: string;
    };
    const pend = (
      await get('adminA', '/printing/jobs?status=pending&target=Bar%20teste').expect(200)
    ).body as { id: string }[];
    expect(pend.map((j) => j.id)).toEqual([b.id]);
    const found = (await get('adminA', '/printing/jobs?q=bar%20tes').expect(200)).body as {
      id: string;
    }[];
    expect(found.map((j) => j.id)).toContain(b.id);
    const page1 = (await get('adminA', '/printing/jobs?limit=1').expect(200)).body as {
      id: string;
      createdAt: string;
    }[];
    const page2 = (
      await get(
        'adminA',
        `/printing/jobs?limit=1&before=${encodeURIComponent(page1[0].createdAt)}`,
      ).expect(200)
    ).body as { id: string }[];
    expect(page2[0]?.id).not.toBe(page1[0].id);

    const sum = (await get('adminA', '/printing/jobs/summary').expect(200)).body as {
      counts: Record<string, number>;
      targets: string[];
    };
    expect(sum.counts.queued).toBeGreaterThanOrEqual(2);
    expect(sum.targets).toContain('Bar teste');

    await post('adminA', '/printing/jobs/discard', { ids: [a.id] }).expect(200);
    expect(
      (await post('adminA', '/printing/jobs/requeue', { ids: [a.id] }).expect(200)).body.requeued,
    ).toBe(1);
    await post('waiterA', '/printing/jobs/delete', { ids: [a.id] }).expect(403);
    await post('adminA', '/printing/jobs/delete', {}).expect(400);
    // Por ids apaga até o que está na fila: não sai mais.
    expect(
      (await post('adminA', '/printing/jobs/delete', { ids: [a.id, b.id] }).expect(200)).body
        .deleted,
    ).toBe(2);
    const c = (await agentPost(agentToken, '/claim', { limit: 20 }).expect(200)).body.jobs as {
      id: string;
    }[];
    expect(c.map((j) => j.id)).not.toContain(a.id);
    for (const j of c) await agentPost(agentToken, `/jobs/${j.id}/result`, { ok: true });
    // Histórico por situação: a fila de espera fica.
    const keep = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    await post('adminA', '/printing/jobs/delete', { statuses: ['done', 'cancelled'] }).expect(200);
    const left = (await get('adminA', '/printing/jobs/summary').expect(200)).body.counts;
    expect(left.done).toBe(0);
    expect(left.cancelled).toBe(0);
    expect(left.queued).toBeGreaterThanOrEqual(1);
    await post('adminB', '/printing/jobs/delete', { ids: [keep.id] }).expect(200);
    expect(
      (await get('adminA', '/printing/jobs?status=queued').expect(200)).body.map(
        (j: { id: string }) => j.id,
      ),
    ).toContain(keep.id);
    await post('adminA', '/printing/jobs/discard', { ids: [keep.id] }).expect(200);
  });

  it('exclui um computador: token para de valer e o que ele imprimia volta para a fila', async () => {
    const extra = (await post('adminA', '/printing/agents', { name: 'PC velho' }).expect(201))
      .body as { agent: { id: string }; token: string };
    const t = (await post('adminA', '/printing/test', { target: 'Caixa' }).expect(201)).body as {
      id: string;
    };
    await claimUntil(extra.token, t.id);
    await remove('waiterA', `/printing/agents/${extra.agent.id}`).expect(403);
    await remove('adminA', `/printing/agents/${extra.agent.id}`).expect(200);
    await remove('adminA', `/printing/agents/${extra.agent.id}`).expect(404);
    await agentPost(extra.token, '/heartbeat').expect(401);
    const list = (await get('adminA', '/printing/agents').expect(200)).body as { id: string }[];
    expect(list.map((x) => x.id)).not.toContain(extra.agent.id);
    const [row] = await ownerQuery<{ status: string; claimed_by: string | null }>(
      `SELECT status, claimed_by FROM print_jobs WHERE id = $1`,
      [t.id],
    );
    expect(row).toEqual({ status: 'queued', claimed_by: null });
    await post('adminA', '/printing/jobs/discard', { ids: [t.id] }).expect(200);
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

  it('mês financeiro: o gerente escolhe o dia de início e o resumo segue o período', async () => {
    const def = (await get('stockA', '/finance/settings').expect(200)).body;
    expect(def.monthStartDay).toBe(1);
    expect(def.currentMonth.from.slice(8)).toBe('01');
    await put('pdvA', '/finance/settings', { monthStartDay: 5 }).expect(403);
    await get('waiterA', '/finance/settings').expect(403);
    await put('adminA', '/finance/settings', { monthStartDay: 0 }).expect(400);
    await put('adminA', '/finance/settings', { monthStartDay: 32 }).expect(400);
    const saved = (await put('adminA', '/finance/settings', { monthStartDay: 20 }).expect(200))
      .body;
    expect(saved.monthStartDay).toBe(20);
    expect(saved.currentMonth.from.slice(8)).toBe('20');
    expect(saved.currentMonth.to.slice(8)).toBe('19');
    // Outro restaurante continua no mês do calendário.
    expect((await get('adminB', '/finance/settings').expect(200)).body.monthStartDay).toBe(1);
    // Sem período, o resumo usa o mês atual do restaurante.
    const cur = (await get('adminA', '/finance/summary').expect(200)).body;
    expect(cur.month).toMatchObject({ ...saved.currentMonth, monthStartDay: 20 });
    // Mês de 20/10 a 19/11: a luz (paga em 22/10) entra como paga; o cancelado não conta.
    const oct = (await get('adminA', '/finance/summary?from=2026-10-20&to=2026-11-19').expect(200))
      .body;
    expect(oct.month).toMatchObject({
      from: '2026-10-20',
      to: '2026-11-19',
      paid: '350.40',
      payableDue: '350.40',
      payableLeft: '0.00',
      receivableDue: '0.00',
    });
    const before = (
      await get('adminA', '/finance/summary?from=2026-09-20&to=2026-10-19').expect(200)
    ).body;
    expect(before.month).toMatchObject({ paid: '0.00', payableDue: '0.00' });
    await get('adminA', '/finance/summary?from=2026-10-20').expect(400);
    await put('adminA', '/finance/settings', { monthStartDay: 1 }).expect(200);
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
  it('o caixa fechado vai para o financeiro, concilia com o extrato e entra no DRE', async () => {
    const del = (w: string, url: string) =>
      http
        .delete(`/api/v1${url}`)
        .set('Host', hostOf(w))
        .set('Cookie', cookies[w] ?? '')
        .set(CSRF);
    const cents = (v: string) => Math.round(Number(v) * 100);
    const money = (c: number) => (c / 100).toFixed(2);
    const [{ today }] = await ownerQuery<{ today: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM tenants WHERE id = $1`,
      [fx.tenantA],
    );
    // Taxas e prazos das maquininhas do restaurante.
    await put('pdvA', '/finance/settings', {
      paymentTerms: { debit: { feePercent: '2.00', days: 1 } },
    }).expect(403);
    const terms = {
      cash: { feePercent: '0', days: 0 },
      pix: { feePercent: '0', days: 0 },
      debit: { feePercent: '2.00', days: 1 },
      credit: { feePercent: '3.00', days: 30 },
      voucher: { feePercent: '3.60', days: 15 },
      other: { feePercent: '0', days: 0 },
    };
    await put('adminA', '/finance/settings', {
      paymentTerms: { ...terms, debit: { feePercent: '50', days: 1 } },
    }).expect(400);
    const set = (await put('adminA', '/finance/settings', { paymentTerms: terms }).expect(200))
      .body;
    expect(set.paymentTerms.debit).toEqual({ feePercent: '2.00', days: 1 });
    expect(set.monthStartDay).toBe(1);
    const dre0 = (await get('stockA', `/finance/dre?from=${today}&to=${today}`).expect(200)).body;

    // Um caixa com venda em débito, crédito, PIX e dinheiro.
    const reg = (await post('adminA', '/cash-registers', { name: 'Caixa DRE' }).expect(201)).body;
    const s = (
      await post('cashierA', '/cash/sessions', {
        registerId: reg.id,
        openingAmount: '20.00',
      }).expect(201)
    ).body;
    const paid: Record<string, string> = {};
    for (const method of ['debit', 'credit', 'pix', 'cash']) {
      const o = (await counterOrder(1).expect(201)).body;
      await post(
        'cashierA',
        `/orders/${o.id}/payments`,
        { cashSessionId: s.id, method, amount: o.total },
        key(),
      ).expect(201);
      paid[method] = o.total;
    }
    const day0 = (await get('adminA', `/finance/closings?from=${today}&to=${today}`).expect(200))
      .body.days[0];
    expect(day0.status).toBe('open');
    expect(day0.sessions.find((x: { id: string }) => x.id === s.id).posted).toBe(false);
    await get('cashierA', `/finance/closings?from=${today}&to=${today}`).expect(403);

    // Fecha o caixa: o dia vai sozinho para o financeiro.
    const exp = (await get('cashierA', `/cash/sessions/${s.id}`).expect(200)).body.expected;
    await post(
      'cashierA',
      `/cash/sessions/${s.id}/close`,
      { counted: { cash: exp.cash, debit: exp.debit, credit: exp.credit, pix: exp.pix } },
      key(),
    ).expect(201);
    await post('adminA', `/finance/closings/${s.id}/post`).expect(201);
    const closing = (await get('adminA', `/finance/closings?from=${today}&to=${today}`).expect(200))
      .body.days[0];
    expect(closing.sessions.find((x: { id: string }) => x.id === s.id).posted).toBe(true);
    const fee = (m: string, pct: number) => Math.round(cents(paid[m]!) * pct);
    const st = (
      await get('adminA', '/finance/settlements?status=all').expect(200)
    ).body.rows.filter((x: { sessionId: string }) => x.sessionId === s.id);
    const by = (m: string) => st.find((x: { method: string }) => x.method === m);
    expect(st).toHaveLength(4);
    expect(by('debit').fee).toBe(money(fee('debit', 0.02)));
    expect(by('debit').net).toBe(money(cents(paid.debit!) - fee('debit', 0.02)));
    expect(by('debit').expectedDate > today).toBe(true);
    expect(by('credit').fee).toBe(money(fee('credit', 0.03)));
    expect(by('pix').expectedDate).toBe(today);
    // O dinheiro da gaveta já nasce recebido.
    expect(by('cash').receivedAt).toBe(today);
    const pending = (await get('adminA', '/finance/settlements').expect(200)).body.rows.filter(
      (x: { sessionId: string }) => x.sessionId === s.id,
    );
    expect(pending.map((x: { method: string }) => x.method).sort()).toEqual([
      'credit',
      'debit',
      'pix',
    ]);

    // Conta do banco e o extrato (OFX lido na tela).
    await post('pdvA', '/finance/bank/accounts', { name: 'Itaú' }).expect(403);
    const acc = (
      await post('adminA', '/finance/bank/accounts', {
        name: 'Itaú PJ',
        bankId: '0341',
        accountRef: '12345-6',
      }).expect(201)
    ).body;
    await post('adminA', '/finance/bank/accounts', { name: 'Itaú PJ' }).expect(409);
    const rent = (
      await post('adminA', '/finance/entries', {
        kind: 'payable',
        description: 'Aluguel da loja',
        category: 'Aluguel',
        amount: '100.00',
        dueDate: today,
      }).expect(201)
    ).body;
    const ofx = [
      {
        date: by('debit').expectedDate,
        amount: by('debit').net,
        description: 'REDE DEBITO',
        fitId: 'D1',
      },
      { date: today, amount: by('pix').net, description: 'PIX RECEBIDO CLIENTE', fitId: 'P1' },
      { date: today, amount: '-12.90', description: 'TARIFA PACOTE', fitId: 'T1' },
      { date: today, amount: '-100.00', description: 'TED ALUGUEL', fitId: null },
    ];
    const imp = (
      await post('adminA', `/finance/bank/accounts/${acc.id}/import`, { lines: ofx }).expect(201)
    ).body;
    expect(imp).toEqual({ imported: 4, duplicates: 0, autoMatched: 2 });
    const again = (
      await post('adminA', `/finance/bank/accounts/${acc.id}/import`, { lines: ofx }).expect(201)
    ).body;
    expect(again).toEqual({ imported: 0, duplicates: 4, autoMatched: 0 });
    await post('adminA', `/finance/bank/accounts/${acc.id}/import`, {
      lines: [{ date: today, amount: '0', description: 'x' }],
    }).expect(400);

    const lines = (await get('stockA', `/finance/bank/lines?accountId=${acc.id}`).expect(200)).body;
    expect(lines.summary.open).toBe(2);
    const line = (fit: string) =>
      lines.lines.find((l: { description: string }) => l.description.includes(fit));
    expect(line('REDE').reconciliation).toMatchObject({ kind: 'settlement', auto: true });
    expect(line('PIX').reconciliation.settlements).toHaveLength(1);
    // O aluguel em aberto vira sugestão de baixa, não baixa sozinho.
    expect(line('ALUGUEL').suggestion).toMatchObject({
      kind: 'entry',
      entryId: rent.id,
      settle: true,
      auto: false,
    });

    // Confirma a sugestão: a conta é baixada e a conciliação não pode ser desfeita.
    await post('adminA', '/finance/bank/reconcile', {
      kind: 'entry',
      lineIds: [line('TARIFA').id],
      entryId: rent.id,
    }).expect(422);
    const rr = (
      await post('adminA', '/finance/bank/reconcile', {
        kind: 'entry',
        lineIds: [line('ALUGUEL').id],
        entryId: rent.id,
      }).expect(201)
    ).body;
    expect(rr.entrySettled).toBe(true);
    const rentNow = (await get('adminA', '/finance/entries').expect(200)).body.find(
      (e: { id: string }) => e.id === rent.id,
    );
    expect(rentNow).toMatchObject({ status: 'paid', paidAt: today, paidMethod: 'transfer' });
    await del('adminA', `/finance/bank/reconciliations/${rr.id}`).expect(409);
    await post('adminA', '/finance/bank/reconcile', {
      kind: 'transfer',
      lineIds: [line('ALUGUEL').id],
    }).expect(409);

    // A tarifa vira lançamento pago, já conciliado.
    const tr = (
      await post('adminA', '/finance/bank/reconcile', {
        kind: 'create',
        lineIds: [line('TARIFA').id],
        description: 'Tarifa do pacote',
        category: 'Tarifas bancárias',
      }).expect(201)
    ).body;
    expect(tr.entrySettled).toBe(true);

    // O crédito caiu 10 centavos a menos (taxa real maior): conciliado à mão, sem extrato.
    await post('adminA', '/finance/bank/reconcile', {
      kind: 'manual',
      settlementIds: [by('credit').id],
      day: today,
      amount: money(cents(by('credit').net) - 10),
    }).expect(201);
    await post('adminA', '/finance/bank/reconcile', {
      kind: 'manual',
      settlementIds: [by('credit').id],
      day: today,
      amount: '1.00',
    }).expect(409);

    // Desfazer a automática devolve o débito para "a receber"; rodar de novo concilia outra vez.
    await del('adminA', `/finance/bank/reconciliations/${line('REDE').reconciliationId}`).expect(
      200,
    );
    expect(
      (await get('adminA', '/finance/settlements').expect(200)).body.rows.some(
        (x: { id: string }) => x.id === by('debit').id,
      ),
    ).toBe(true);
    expect((await post('adminA', '/finance/bank/auto').expect(201)).body.autoMatched).toBe(1);
    expect(
      (await get('adminA', `/finance/bank/lines?accountId=${acc.id}&status=open`).expect(200)).body
        .lines,
    ).toHaveLength(0);
    await del('adminA', `/finance/bank/lines/${line('REDE').id}`).expect(409);

    // DRE: as vendas do caixa, as taxas (com o acerto de 10 centavos), o aluguel e a tarifa.
    const dre1 = (await get('stockA', `/finance/dre?from=${today}&to=${today}`).expect(200)).body;
    const val = (d: { dre: { lines: { id: string; value: string }[] } }, id: string) =>
      cents(d.dre.lines.find((l) => l.id === id)?.value ?? '0');
    const sold = ['debit', 'credit', 'pix', 'cash'].reduce((a, m) => a + cents(paid[m]!), 0);
    expect(cents(dre1.dre.totals.grossRevenue) - cents(dre0.dre.totals.grossRevenue)).toBe(sold);
    expect(val(dre1, 'card_fees') - val(dre0, 'card_fees')).toBe(
      -(fee('debit', 0.02) + fee('credit', 0.03) + 10),
    );
    expect(val(dre1, 'occupancy') - val(dre0, 'occupancy')).toBe(-10000);
    expect(val(dre1, 'financial') - val(dre0, 'financial')).toBe(-1290);
    expect(dre1.previous.from < today).toBe(true);
    await get('adminA', `/finance/dre?from=${today}&to=2020-01-01`).expect(400);
    await get('cashierA', `/finance/dre?from=${today}&to=${today}`).expect(403);

    // O banco não deixa a aplicação mudar o valor de um recebível.
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(`UPDATE finance_settlements SET net = 1 WHERE id = $1`, [by('debit').id]),
      ).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }

    // B não vê nada de A.
    expect((await get('adminB', '/finance/bank/accounts').expect(200)).body).toHaveLength(0);
    expect((await get('adminB', '/finance/bank/lines').expect(200)).body.lines).toHaveLength(0);
    expect((await get('adminB', '/finance/settlements').expect(200)).body.rows).toHaveLength(0);
    await post('adminB', '/finance/bank/reconcile', {
      kind: 'ignored',
      lineIds: [line('REDE').id],
    }).expect(404);
  });
});
