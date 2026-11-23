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
 * Cliente da mesa pelo celular: CPF obrigatório no pedido, chamar o garçom (aparece para a equipe
 * até alguém atender) e fechar a conta inteira pelo Pix com comprovante, que o caixa aprova (o
 * valor entra como Pix nos pedidos da comanda e a mesa fica livre) ou recusa.
 */
const HOST_A = 'mself-a.comandou.test';
const HOST_B = 'mself-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const CPF = '529.982.247-25';

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `mself-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

/** PNG de 1x1 (a API confere a assinatura do arquivo). */
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
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object, idem?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
  upload: (url: string, file: Buffer, type: string, host = HOST_A) =>
    http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('Content-Type', type).send(file),
};

beforeAll(async () => {
  fx = await seedTwoTenants('mself');
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@mself-a.test', 'Caixa', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@mself-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@mself-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@mself-a.test');
  cookies.adminB = await login(HOST_B, 'admin@mself-b.test');
  await patch('adminA', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: true,
  }).expect(200);
});

afterAll(async () => {
  await app?.close();
});

describe('Mesa pelo celular: CPF, chamar o garçom e fechar a conta pelo Pix', () => {
  let table: { id: string; label: string };
  let sessionId: string;
  const atTable = (extra: object = {}) => ({
    channel: 'table',
    tableId: table.id,
    token: token(),
    customerName: 'Ana na Mesa',
    customerCpf: CPF,
    items: [{ productId: fx.prodA, quantity: 2 }],
    ...extra,
  });

  it('pedido da mesa exige o CPF, que vai para o pedido (nota fiscal)', async () => {
    table = (await post('adminA', '/tables', { label: 'M7' }).expect(201)).body;
    const noCpf = atTable({ customerCpf: undefined });
    await pub.post('/store/orders', noCpf, key()).expect(400);
    await pub.post('/store/orders', atTable({ customerCpf: '111.111.111-11' }), key()).expect(400);
    const o = (await pub.post('/store/orders', atTable(), key()).expect(201)).body;
    const [row] = await ownerQuery<{ tax_document: string }>(
      `SELECT tax_document FROM orders WHERE tenant_id = $1 AND number = $2`,
      [fx.tenantA, o.number],
    );
    expect(row!.tax_document).toBe('52998224725');
    // O garçom também lança na mesma comanda.
    const tab = (await get('adminA', '/tabs').expect(200)).body.find(
      (t: { tableId: string }) => t.tableId === table.id,
    );
    await post(
      'waiterA',
      '/orders',
      { channel: 'table', tabId: tab.id, items: [{ productId: fx.prodA, quantity: 1 }] },
      key(),
    ).expect(201);
  });

  it('chamar o garçom aparece para a equipe até alguém atender', async () => {
    await pub.post(`/store/table/${table.id}/call`, { kind: 'waiter' }).expect(200);
    // Chamar de novo não abre outro chamado.
    await pub.post(`/store/table/${table.id}/call`, { kind: 'bill' }).expect(200);
    const calls = (await get('waiterA', '/table-service/calls').expect(200)).body;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tableId: table.id, tableLabel: 'M7', kind: 'bill' });
    // Outro restaurante não vê nem chama esta mesa.
    expect((await get('adminB', '/table-service/calls').expect(200)).body).toHaveLength(0);
    await pub.post(`/store/table/${table.id}/call`, {}, undefined, HOST_B).expect(404);
    let bill = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(bill.call).toMatchObject({ kind: 'bill' });
    await post('waiterA', `/table-service/calls/${calls[0].id}/answer`).expect(200);
    expect((await get('cashierA', '/table-service/calls').expect(200)).body).toHaveLength(0);
    bill = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(bill.call).toBeNull();
    // O cliente também pode desistir.
    await pub.post(`/store/table/${table.id}/call`, {}).expect(200);
    await pub.post(`/store/table/${table.id}/call/cancel`, {}).expect(200);
    expect((await get('cashierA', '/table-service/calls').expect(200)).body).toHaveLength(0);
  });

  it('conta da mesa: itens e saldo de todos os pedidos; Pix só com a chave da loja', async () => {
    const bill = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(bill).toMatchObject({
      open: true,
      table: { id: table.id, label: 'M7' },
      methods: { pix: false },
      awaiting: 0,
    });
    // 2 + 1 X-Burguer de R$ 25,90.
    expect(bill.due).toBe('77.70');
    expect(bill.items).toHaveLength(2);
    await pub.upload(`/store/table/${table.id}/pix-receipt`, PNG, 'image/png').expect(409);
    await patch('adminA', '/store/settings', {
      pixEnabled: true,
      pixKeyType: 'cpf',
      pixKey: CPF,
      pixName: 'Lanchonete da Mesa',
      pixCity: 'Sao Paulo',
    }).expect(200);
    const again = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(again.methods.pix).toBe(true);
    expect(again.pix).toMatchObject({ keyType: 'cpf', name: 'Lanchonete da Mesa' });
  });

  it('comprovante: caixa recusa, cliente manda outro e o caixa aprova o Pix da conta inteira', async () => {
    await pub
      .upload(`/store/table/${table.id}/pix-receipt`, Buffer.from('nada'), 'image/png')
      .expect(422);
    const sent = (
      await pub.upload(`/store/table/${table.id}/pix-receipt`, PNG, 'image/png').expect(200)
    ).body;
    expect(sent).toMatchObject({ status: 'submitted', amount: '77.70' });
    let pending = (await get('cashierA', '/table-service/receipts').expect(200)).body;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tableLabel: 'M7', amount: '77.70', due: '77.70' });
    const file = await get('cashierA', `/table-service/receipts/${pending[0].id}/file`)
      .buffer(true)
      .expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    // Garçom não confere Pix; o outro restaurante não acha o comprovante.
    await get('waiterA', '/table-service/receipts').expect(403);
    await get('adminB', `/table-service/receipts/${pending[0].id}/file`).expect(404);

    // Com o comprovante esperando, cobrar a comanda de novo é barrado.
    const reg = (await post('adminA', '/cash-registers', { name: 'Caixa Mesa' }).expect(201)).body;
    sessionId = (
      await post('cashierA', '/cash/sessions', {
        registerId: reg.id,
        openingAmount: '0.00',
      }).expect(201)
    ).body.id;
    const tab = (await get('adminA', '/tabs').expect(200)).body.find(
      (t: { tableId: string }) => t.tableId === table.id,
    );
    expect(tab.billRequestedAt).toBeTruthy();
    // A mesa e a comanda avisam que tem comprovante esperando (Salão e PDV).
    expect(tab.pixReceiptAt).toBeTruthy();
    const tableRow = (await get('waiterA', '/tables').expect(200)).body.find(
      (t: { id: string }) => t.id === table.id,
    );
    expect(tableRow.pixReceiptAt).toBeTruthy();
    const charge = await post(
      'cashierA',
      `/tabs/${tab.id}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: '10.00' },
      key(),
    );
    expect(charge.status).toBe(409);
    expect(charge.body.message).toContain('comprovante do Pix da conta');

    await post('cashierA', `/table-service/receipts/${pending[0].id}/reject`, {
      reason: 'Valor diferente',
    }).expect(200);
    let bill = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(bill.receipt).toMatchObject({ status: 'rejected', rejectReason: 'Valor diferente' });
    expect((await get('adminA', `/tabs/${tab.id}`).expect(200)).body.pixReceiptAt).toBeNull();

    await pub.upload(`/store/table/${table.id}/pix-receipt`, PNG, 'image/png').expect(200);
    pending = (await get('cashierA', '/table-service/receipts').expect(200)).body;
    const url = `/table-service/receipts/${pending[0].id}/approve`;
    await post('cashierA', url, { cashSessionId: sessionId }).expect(422);
    // Pedidos ainda em preparo: o Pix entra, mas a mesa só fica livre quando tudo sair.
    const k = key();
    const ok = (await post('cashierA', url, { cashSessionId: sessionId }, k).expect(200)).body;
    expect(ok).toMatchObject({ applied: '77.70', short: '0.00', tabClosed: false });
    // Reenvio com a mesma chave não lança duas vezes.
    await post('cashierA', url, { cashSessionId: sessionId }, k).expect(200);
    const payments = await ownerQuery<{ n: number; sum: string }>(
      `SELECT count(*)::int AS n, sum(p.amount)::text AS sum FROM payments p
         JOIN orders o ON o.id = p.order_id WHERE o.tab_id = $1 AND p.method = 'pix'`,
      [tab.id],
    );
    expect(payments[0]).toEqual({ n: 2, sum: '77.70' });
    bill = (await pub.get(`/store/table/${table.id}/bill`).expect(200)).body;
    expect(bill).toMatchObject({ due: '0.00', receipt: { status: 'approved' } });
    await pub.upload(`/store/table/${table.id}/pix-receipt`, PNG, 'image/png').expect(409);
  });
});
