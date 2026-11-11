import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Pix a devolver: pedido pago por Pix pelo cardápio que é cancelado (pelo cliente ou pela loja)
 * com o comprovante ainda esperando conferência. A equipe é avisada, e marca que devolveu ou que
 * o Pix não chegou. Arquivo próprio: o pedido público e o comprovante têm limite por minuto.
 */
const HOST_A = 'pixdev-a.comandou.test';
const HOST_B = 'pixdev-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `pixdev-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

type Who = 'adminA' | 'cashierA' | 'waiterA' | 'adminB';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]);
const post = (w: Who, url: string, body: object = {}, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const patch = (w: Who, url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);

/** Cliente final: o Pix pelo cardápio pede a conta dele (cm_cid). */
const shopper = { cookie: '' };
const pub = {
  get: (url: string) => http.get(`/api/v1${url}`).set('Host', HOST_A),
  post: (url: string, body: object, idem?: string) => {
    const r = http
      .post(`/api/v1${url}`)
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', shopper.cookie);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
  upload: (url: string, file: Buffer, type: string) =>
    http.post(`/api/v1${url}`).set('Host', HOST_A).set(CSRF).set('Content-Type', type).send(file),
};

interface StaffOrder {
  id: string;
  number: number;
  status: string;
  version: number;
  pixStatus: string | null;
  pixReceipt: { id: string; status: string; amount: string } | null;
  pixReceipts: { id: string; status: string; reviewedByName: string | null }[];
}

/** Pedido de retirada pago por Pix pelo cardápio; `receipt` manda o comprovante em seguida. */
async function pixOrder(receipt: boolean) {
  const tk = token();
  const r = await pub
    .post(
      '/store/orders',
      {
        channel: 'pickup',
        token: tk,
        customerName: 'Lia do Pix',
        customerPhone: '11988887777',
        paymentMethod: 'pix',
        items: [{ productId: fx.prodA, quantity: 2 }],
      },
      key(),
    )
    .expect(201);
  expect(r.body).toMatchObject({ status: 'awaiting', pixStatus: 'waiting' });
  if (receipt) await pub.upload(`/store/orders/${tk}/pix-receipt`, PNG, 'image/png').expect(200);
  const list = (await get('cashierA', '/orders?active=true').expect(200)).body as StaffOrder[];
  const id = list.find((x) => x.number === r.body.number)!.id;
  return { tk, id, number: r.body.number as number };
}

const staffOrder = async (id: string) =>
  (await get('cashierA', `/orders/${id}`).expect(200)).body as StaffOrder;
const refundList = async (w: Who = 'cashierA') =>
  ((await get(w, '/orders?pixRefund=true').expect(200)).body as StaffOrder[]).map((o) => o.id);
const audit = (orderId: string, action: string) =>
  ownerQuery<{ data: Record<string, unknown>; actor_user_id: string | null }>(
    `SELECT data, actor_user_id FROM audit_log WHERE entity_id = $1 AND action = $2`,
    [orderId, action],
  );

beforeAll(async () => {
  fx = await seedTwoTenants('pixdev');
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@pixdev-a.test', 'Caixa Pix', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@pixdev-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@pixdev-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@pixdev-a.test');
  cookies.adminB = await login(HOST_B, 'admin@pixdev-b.test');
  await patch('adminA', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: false,
    pixEnabled: true,
    pixKeyType: 'cpf',
    pixKey: '529.982.247-25',
    pixName: 'Lanchonete São João',
    pixCity: 'São Paulo',
  }).expect(200);
  const su = await pub
    .post('/store/account/signup', {
      name: 'Lia do Pix',
      phone: '11977775555',
      password: 'segredo1',
    })
    .expect(201);
  const raw = su.headers['set-cookie'] as unknown as string[];
  shopper.cookie = raw.find((c) => c.startsWith('cm_cid='))!.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

describe('Pix a devolver', () => {
  it('cliente desiste com o comprovante enviado: fica a devolver até a equipe marcar que devolveu', async () => {
    const o = await pixOrder(true);
    expect(await refundList()).not.toContain(o.id);
    await pub.post(`/store/orders/${o.tk}/cancel`, {}).expect(200);

    const cancelled = await staffOrder(o.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', pixStatus: 'refund_due' });
    expect(cancelled.pixReceipt).toMatchObject({ status: 'submitted', amount: '51.80' });
    // Sai dos pedidos em andamento, mas o PDV acha pelo aviso de Pix a devolver.
    expect(await refundList()).toContain(o.id);
    expect(await refundList('adminB')).toHaveLength(0);
    const due = await audit(o.id, 'order.pix_refund_due');
    expect(due).toHaveLength(1);
    expect(due[0]!.data).toMatchObject({ receiptId: cancelled.pixReceipt!.id, amount: '51.80' });

    // O cliente vê que a loja vai devolver; não paga nem manda outro comprovante.
    const v = (await pub.get(`/store/orders/${o.tk}`).expect(200)).body;
    expect(v.step).toBe('cancelled');
    expect(v.pix).toMatchObject({
      status: 'refund_due',
      code: null,
      canSend: false,
      receipt: { status: 'submitted', amount: '51.80' },
    });
    const late = await pub
      .upload(`/store/orders/${o.tk}/pix-receipt`, PNG, 'image/png')
      .expect(409);
    expect(late.body.message).toMatch(/fale com a loja/);

    const base = `/orders/${o.id}/pix-receipts/${cancelled.pixReceipt!.id}`;
    // Pedido cancelado não recebe pagamento: aprovar não entra no caixa.
    const approve = await post('cashierA', `${base}/approve`, {}, key()).expect(409);
    expect(approve.body.message).toMatch(/cancelado.*devolvido/);
    // Marcar a devolução é de quem estorna pagamentos (gerente ou dono), e só deste restaurante.
    await post('cashierA', `${base}/refunded`).expect(403);
    await post('waiterA', `${base}/refunded`).expect(403);
    await post('adminB', `${base}/refunded`).expect(404);
    const done = (await post('adminA', `${base}/refunded`).expect(200)).body as StaffOrder;
    expect(done).toMatchObject({ status: 'cancelled', pixStatus: 'refunded' });
    expect(done.pixReceipts[0]).toMatchObject({ status: 'refunded' });
    expect(done.pixReceipts[0]!.reviewedByName).toBeTruthy();
    expect(done.version).toBeGreaterThan(cancelled.version);
    // Já resolvido: não marca de novo nem recusa depois.
    const again = await post('adminA', `${base}/refunded`).expect(409);
    expect(again.body.message).toMatch(/já foi marcado como devolvido/);
    await post('adminA', `${base}/reject`, { reason: 'Pix não caiu na conta' }).expect(409);
    expect(await refundList()).not.toContain(o.id);
    const refunded = await audit(o.id, 'order.pix_refunded');
    expect(refunded).toHaveLength(1);
    expect(refunded[0]!.data).toMatchObject({ amount: '51.80' });
    expect(refunded[0]!.actor_user_id).toBeTruthy();

    const after = (await pub.get(`/store/orders/${o.tk}`).expect(200)).body;
    expect(after.pix).toMatchObject({ status: 'refunded', receipt: { status: 'refunded' } });
    // Nada entrou no caixa por este pedido.
    const pays = await ownerQuery(`SELECT 1 FROM payments WHERE order_id = $1`, [o.id]);
    expect(pays).toHaveLength(0);
  });

  it('loja recusa o pedido com o comprovante enviado; o Pix não chegou: encerra como não recebido', async () => {
    const o = await pixOrder(true);
    const before = await staffOrder(o.id);
    await post('cashierA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'Sem o produto hoje',
      expectedVersion: before.version,
    }).expect(201);
    const cancelled = await staffOrder(o.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', pixStatus: 'refund_due' });
    expect(await refundList()).toContain(o.id);

    const base = `/orders/${o.id}/pix-receipts/${cancelled.pixReceipt!.id}`;
    const rej = (
      await post('cashierA', `${base}/reject`, { reason: 'Pix não caiu na conta' }).expect(200)
    ).body as StaffOrder;
    expect(rej).toMatchObject({ status: 'cancelled', pixStatus: 'rejected' });
    expect(await refundList()).not.toContain(o.id);
    await post('adminA', `${base}/refunded`).expect(409);

    const v = (await pub.get(`/store/orders/${o.tk}`).expect(200)).body;
    expect(v.pix).toMatchObject({
      status: 'rejected',
      canSend: false,
      receipt: { status: 'rejected', reason: 'Pix não caiu na conta' },
    });
  });

  it('sem comprovante não há o que devolver; pedido em andamento não se marca como devolvido', async () => {
    const o = await pixOrder(false);
    await pub.post(`/store/orders/${o.tk}/cancel`, {}).expect(200);
    expect(await staffOrder(o.id)).toMatchObject({ status: 'cancelled', pixStatus: 'waiting' });
    expect(await refundList()).not.toContain(o.id);
    expect(await audit(o.id, 'order.pix_refund_due')).toHaveLength(0);

    // Comprovante esperando conferência num pedido que segue de pé: aprova ou recusa, não devolve.
    const live = await pixOrder(true);
    const rid = (await staffOrder(live.id)).pixReceipt!.id;
    const no = await post('adminA', `/orders/${live.id}/pix-receipts/${rid}/refunded`).expect(409);
    expect(no.body.message).toMatch(/não tem Pix a devolver/);
    expect(await staffOrder(live.id)).toMatchObject({ status: 'awaiting', pixStatus: 'submitted' });
  });
});
