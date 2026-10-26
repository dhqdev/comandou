import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Ganhos do entregador: regra da loja, valor gravado ao encerrar a corrida, central do
 * motoboy pelo link, relatório do dono e repasse com retenções e lançamento no financeiro.
 */
const HOST_A = 'cp-a.comandou.test';
const HOST_B = 'cp-b.comandou.test';
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
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
}
const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (method: 'post' | 'patch' | 'put', w: string, url: string, body: object = {}) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const post = (w: string, url: string, body: object = {}) => send('post', w, url, body);
const pub = (url: string) => http.get(`/api/v1${url}`).set('Host', HOST_A);
const pubPost = (url: string, body: object = {}) =>
  http.post(`/api/v1${url}`).set('Host', HOST_A).set(CSRF).send(body);

const month = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

beforeAll(async () => {
  fx = await seedTwoTenants('cp');
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@cp-a.test', 'Caixa', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    u.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@cp-a.test');
  cookies.adminB = await login(HOST_B, 'admin@cp-b.test');
  cookies.cashierA = await login(HOST_A, 'caixa@cp-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Ganhos e repasses do entregador', () => {
  it('regra, corrida gravada, central pelo link, relatório e repasse com impostos', async () => {
    // Padrão: toda a taxa de entrega. Caixa não vê valores de repasse.
    const def = (await get('adminA', '/courier-pay/settings').expect(200)).body;
    expect(def.rule).toMatchObject({ mode: 'fee_percent', feePercent: 100 });
    expect(def.taxes).toMatchObject({ inssRate: 11, inssCeiling: '8475.55' });
    await get('cashierA', '/courier-pay/settings').expect(403);
    await send('put', 'adminA', '/courier-pay/settings', {
      rule: { ...def.rule, mode: 'teletransporte' },
      taxes: def.taxes,
    }).expect(400);

    const rule = {
      mode: 'fixed_plus_km',
      fixed: '6',
      perKm: '1.00',
      kmIncluded: 2,
      feePercent: 0,
      minPerDelivery: '0',
      failedPercent: 50,
      dailyRate: '20.00',
    };
    const saved = (
      await send('put', 'adminA', '/courier-pay/settings', { rule, taxes: def.taxes }).expect(200)
    ).body;
    expect(saved.rule.fixed).toBe('6.00');
    expect(saved.description).toContain('diária de R$ 20,00');

    await send('patch', 'adminA', '/store/settings', { storeLat: -23.55, storeLng: -46.63 }).expect(
      200,
    );
    const c = (await post('adminA', '/couriers', { name: 'Ana Moto' }).expect(201)).body;
    await send('patch', 'cashierA', `/courier-pay/couriers/${c.id}`, {
      taxRegime: 'autonomo',
    }).expect(403);
    await send('patch', 'adminA', `/courier-pay/couriers/${c.id}`, {
      taxRegime: 'autonomo',
      pixKey: 'ana@pix.test',
    }).expect(200);
    const token = (await post('adminA', `/couriers/${c.id}/link`).expect(201)).body.path
      .split('/')
      .pop();

    // ~3 km de linha reta para o norte (≈ 3,9 km de rota estimada).
    const mk = async () => {
      const o = (
        await post('adminA', '/orders', {
          channel: 'delivery',
          deliveryAddress: 'Rua C, 3',
          items: [{ productId: fx.prodA, quantity: 1 }],
        }).expect(201)
      ).body;
      await ownerQuery(
        `UPDATE orders SET delivery_lat = -23.523, delivery_lng = -46.63, delivery_fee = 8, total = total + 8 WHERE id = $1`,
        [o.id],
      );
      await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
      return (await post('adminA', `/orders/${o.id}/dispatch`, { courierId: c.id }).expect(201))
        .body.delivery as { id: string };
    };
    const d1 = await mk();
    const d2 = await mk();
    const home = (await pub(`/courier-app/${token}`).expect(200)).body;
    // 6,00 + (3,90 − 2) × 1,00
    expect(home.deliveries.find((d: { id: string }) => d.id === d1.id).payEstimate).toBe('7.90');

    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d1.id],
    );
    await pubPost(`/courier-app/${token}/deliveries/${d1.id}/complete`, { code }).expect(201);
    await pubPost(`/courier-app/${token}/deliveries/${d2.id}/fail`, {
      reason: 'Cliente ausente',
    }).expect(201);
    const [r1] = await ownerQuery<{ pay: string; dist: number; pending: boolean }>(
      `SELECT courier_pay::text AS pay, distance_m AS dist, payout_pending AS pending FROM deliveries WHERE id = $1`,
      [d1.id],
    );
    expect(r1).toMatchObject({ pay: '7.90', pending: true });
    expect(r1.dist).toBeGreaterThan(3850);
    const [r2] = await ownerQuery<{ pay: string }>(
      `SELECT courier_pay::text AS pay FROM deliveries WHERE id = $1`,
      [d2.id],
    );
    expect(r2.pay).toBe('3.95');

    // Central do motoboy: corridas + diária; pendente com INSS de 11%.
    const earn = (await pub(`/courier-app/${token}/earnings`).expect(200)).body;
    expect(earn.today).toMatchObject({ delivered: 1, failed: 1, rides: '11.85', daily: '20.00' });
    expect(earn.today.total).toBe('31.85');
    expect(earn.pending).toMatchObject({
      rides: 2,
      gross: '31.85',
      withheld: '3.50',
      net: '28.35',
    });
    await pub('/courier-app/link-que-nao-existe-123456/earnings').expect(404);

    const rep = (await get('adminA', `/courier-pay/report?month=${month()}`).expect(200)).body;
    const line = rep.couriers.find((x: { courierId: string }) => x.courierId === c.id);
    expect(line).toMatchObject({
      delivered: 1,
      failed: 1,
      earned: '31.85',
      pendingGross: '31.85',
      pendingNet: '28.35',
      taxRegime: 'autonomo',
    });
    expect(rep.totals.deliveryFees).toBe('16.00');
    expect(
      (await get('adminB', `/courier-pay/report?month=${month()}`).expect(200)).body.couriers,
    ).toEqual([]);

    // Repasse com vale de R$ 1,85: bruto 30,00, INSS 3,30, líquido 26,70.
    const prev = (
      await post('adminA', '/courier-pay/preview', {
        courierId: c.id,
        adjustments: '-1.85',
      }).expect(201)
    ).body;
    expect(prev).toMatchObject({ gross: '30.00', inss: '3.30', irrf: '0.00', net: '26.70' });
    await post('cashierA', '/courier-pay/payouts', { courierId: c.id, method: 'pix' }).expect(403);
    const paid = (
      await post('adminA', '/courier-pay/payouts', {
        courierId: c.id,
        adjustments: '-1.85',
        method: 'pix',
        notes: 'Semana 1',
      }).expect(201)
    ).body;
    expect(paid).toMatchObject({ net: '26.70', deliveries: 1, daysWorked: 1 });
    await post('adminA', '/courier-pay/payouts', { courierId: c.id, method: 'pix' }).expect(409);
    const fin = await ownerQuery<{ category: string; amount: string; status: string }>(
      `SELECT category, amount::text, status FROM finance_entries WHERE tenant_id = $1 ORDER BY category`,
      [fx.tenantA],
    );
    expect(fin).toEqual([
      { category: 'Entregadores', amount: '26.70', status: 'paid' },
      { category: 'Impostos', amount: '3.30', status: 'open' },
    ]);
    const after = (await pub(`/courier-app/${token}/earnings`).expect(200)).body;
    expect(after.pending.gross).toBe('0.00');
    expect(after.payouts[0]).toMatchObject({ net: '26.70', withheld: '3.30' });
    expect(after.recent.every((r: { paid: boolean }) => r.paid)).toBe(true);
  });
});
