import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Pagamento da equipe: dia de trabalho marcado pela sessão, regra por pessoa, a pagar calculado
 * (diária, comissão, taxa de serviço), pagamento sempre lançado no Financeiro, período que não
 * se paga duas vezes, lançamento cancelado reabrindo o período e o perfil do garçom.
 */
const HOST_A = 'sp-a.comandou.test';
const HOST_B = 'sp-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
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
const send = (method: 'post' | 'put', w: string, url: string, body: object = {}) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

const todaySp = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);

async function addMember(email: string, name: string, role: string) {
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, name, await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
    fx.tenantA,
    u.id,
    role,
  ]);
  return u.id;
}

beforeAll(async () => {
  fx = await seedTwoTenants('sp');
  // O garçom já vem da fixture (garcom@sp-a.test).
  const [w] = await ownerQuery<{ id: string }>(
    `SELECT id FROM users WHERE email = 'garcom@sp-a.test'`,
  );
  ids.waiter = w.id;
  ids.cashier = await addMember('caixa@sp-a.test', 'Renata Caixa', 'cashier');
  ids.driver = await addMember('moto@sp-a.test', 'Kaique Moto', 'driver');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@sp-a.test');
  cookies.adminB = await login(HOST_B, 'admin@sp-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@sp-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@sp-a.test');
  // Pedidos lançados pelo garçom hoje: R$ 90 + R$ 50 de itens (com desconto) e R$ 14 de taxa.
  // O cancelado não conta.
  const orders: [number, string, string, string, string, string][] = [
    [1, 'completed', '100.00', '10.00', '9.00', '99.00'],
    [2, 'in_production', '50.00', '0', '5.00', '55.00'],
    [3, 'cancelled', '200.00', '0', '20.00', '220.00'],
  ];
  for (const [n, status, subtotal, discount, surcharge, total] of orders)
    await ownerQuery(
      `INSERT INTO orders (tenant_id, number, channel, status, subtotal, discount, surcharge, total, created_by)
       VALUES ($1, $2, 'table', $3, $4, $5, $6, $7, $8)`,
      [fx.tenantA, n, status, subtotal, discount, surcharge, total, ids.waiter],
    );
});
afterAll(async () => {
  await app?.close();
});

describe('Pagamento da equipe', () => {
  it('perfil, regra, a pagar, pagamento no Financeiro e período que não se repete', async () => {
    const today = todaySp();
    // Entrar no sistema marca o dia de trabalho.
    const me0 = (await get('waiterA', '/staff-pay/me').expect(200)).body;
    expect(me0.workdays.map((d: { day: string }) => d.day)).toEqual([today]);
    expect(me0.month).toMatchObject({ orders: 2, sales: '140.00', service: '14.00', days: 1 });
    expect(me0.pending).toMatchObject({ hasRule: false, gross: '0.00' });

    // Valores da equipe: só quem tem o financeiro.
    await get('cashierA', `/staff-pay?month=${today.slice(0, 7)}`).expect(403);
    await get('waiterA', `/staff-pay?month=${today.slice(0, 7)}`).expect(403);
    const rule = { monthly: '0', dailyRate: '50', salesPercent: 10, servicePercent: 100 };
    await send('put', 'cashierA', `/staff-pay/${ids.waiter}/rule`, { rule }).expect(403);
    await send('put', 'adminA', `/staff-pay/${ids.waiter}/rule`, {
      rule: { ...rule, salesPercent: 120 },
    }).expect(400);
    const saved = (
      await send('put', 'adminA', `/staff-pay/${ids.waiter}/rule`, {
        rule,
        pixKey: 'lucas@pix.test',
      }).expect(200)
    ).body;
    expect(saved.ruleText).toBe('Diária de R$ 50,00 + 10% das vendas + toda a taxa de serviço');
    // Diária (1 dia) + 10% de R$ 140 + a taxa toda (R$ 14).
    expect(saved).toMatchObject({
      days: 1,
      daily: '50.00',
      commission: '14.00',
      serviceShare: '14.00',
      gross: '78.00',
      pixKey: 'lucas@pix.test',
    });
    // Entregador é pago pelo Acerto de Entregas.
    await send('put', 'adminA', `/staff-pay/${ids.driver}/rule`, { rule }).expect(409);
    // Outro restaurante não enxerga a pessoa.
    await send('post', 'adminB', `/staff-pay/${ids.waiter}/preview`, {}).expect(404);

    // Mais dias trabalhados do que dias no período.
    await send('post', 'adminA', `/staff-pay/${ids.waiter}/preview`, {
      from: today,
      to: today,
      days: 2,
    }).expect(400);

    const paid = (
      await send('post', 'adminA', `/staff-pay/${ids.waiter}/payouts`, {
        adjustments: '-8.00',
        method: 'pix',
        paidNow: true,
      }).expect(201)
    ).body;
    expect(paid.gross).toBe('70.00');
    const [fe] = await ownerQuery<{
      status: string;
      category: string;
      amount: string;
      paid_method: string;
    }>(`SELECT status, category, amount::text, paid_method FROM finance_entries WHERE id = $1`, [
      paid.financeEntryId,
    ]);
    expect(fe).toEqual({
      status: 'paid',
      category: 'Salários',
      amount: '70.00',
      paid_method: 'pix',
    });

    // Mesmo período não se paga de novo.
    await send('post', 'adminA', `/staff-pay/${ids.waiter}/payouts`, {
      method: 'pix',
      paidNow: true,
    }).expect(409);
    await send('post', 'adminA', `/staff-pay/${ids.waiter}/payouts`, {
      from: today,
      to: today,
      method: 'cash',
      paidNow: true,
    }).expect(409);

    const ov = (await get('adminA', `/staff-pay?month=${today.slice(0, 7)}`).expect(200)).body;
    const lucas = ov.people.find((p: { userId: string }) => p.userId === ids.waiter);
    expect(lucas).toMatchObject({ pending: '0.00', monthPaid: '70.00', totalPaid: '70.00' });
    expect(ov.people.find((p: { userId: string }) => p.userId === ids.driver)).toMatchObject({
      courier: true,
    });
    expect(ov.totals.monthPaid).toBe('70.00');
  });

  it('pagamento agendado vira conta a pagar e, cancelado no Financeiro, reabre o período', async () => {
    const today = todaySp();
    await send('put', 'adminA', `/staff-pay/${ids.cashier}/rule`, {
      rule: { monthly: '3000', dailyRate: '0', salesPercent: 0, servicePercent: 0 },
    }).expect(200);
    await send('post', 'adminA', `/staff-pay/${ids.cashier}/payouts`, {
      method: 'transfer',
      paidNow: false,
    }).expect(400);
    const due = `${today.slice(0, 8)}28`;
    const p = (
      await send('post', 'adminA', `/staff-pay/${ids.cashier}/payouts`, {
        from: `${today.slice(0, 8)}01`,
        to: today,
        method: 'transfer',
        paidNow: false,
        dueDate: due,
      }).expect(201)
    ).body;
    expect(Number(p.salary)).toBeGreaterThan(0);
    const [fe] = await ownerQuery<{ status: string; due: string }>(
      `SELECT status, to_char(due_date, 'YYYY-MM-DD') AS due FROM finance_entries WHERE id = $1`,
      [p.financeEntryId],
    );
    expect(fe).toEqual({ status: 'open', due });
    const ov = (await get('adminA', `/staff-pay?month=${today.slice(0, 7)}`).expect(200)).body;
    expect(ov.people.find((x: { userId: string }) => x.userId === ids.cashier)).toMatchObject({
      scheduled: p.gross,
      pending: '0.00',
    });

    await send('post', 'adminA', `/finance/entries/${p.financeEntryId}/cancel`, {
      reason: 'Lançado errado',
    }).expect(201);
    const again = (
      await send('post', 'adminA', `/staff-pay/${ids.cashier}/preview`, {}).expect(201)
    ).body;
    // Sem pagamento valendo, volta a contar da entrada na equipe (hoje, neste teste).
    expect(again).toMatchObject({ paidUntil: null, from: today, to: today });
    expect(Number(again.salary)).toBeGreaterThan(0);

    const hist = (await get('adminA', `/staff-pay/${ids.cashier}/payouts`).expect(200)).body;
    expect(hist[0]).toMatchObject({ status: 'cancelled', gross: p.gross });
  });
});
