import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { crc16 } from '@comandou/shared';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Pix pelo cardápio com comprovante (sem banco): a loja põe a chave, o cliente paga pelo QR Code
 * com o valor e manda o comprovante; o PDV abre, aprova (o Pix entra no caixa) ou recusa.
 * Arquivo próprio: o pedido público tem limite por minuto.
 */
const HOST_A = 'pix-a.comandou.test';
const HOST_B = 'pix-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `pix-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

/** PNG de 1x1 (a API confere a assinatura do arquivo). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

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

/** Cliente final: sem login da equipe. O Pix pelo cardápio pede a conta dele (cm_cid). */
const shopper = { cookie: '' };
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object, idem?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (shopper.cookie && host === HOST_A) r.set('Cookie', shopper.cookie);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
  upload: (url: string, file: Buffer, type: string, host = HOST_A) =>
    http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('Content-Type', type).send(file),
};

beforeAll(async () => {
  fx = await seedTwoTenants('pix');
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@pix-a.test', 'Caixa Pix', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@pix-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@pix-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@pix-a.test');
  cookies.adminB = await login(HOST_B, 'admin@pix-b.test');
  await patch('adminA', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: false,
  }).expect(200);
  const su = await pub
    .post('/store/account/signup', {
      name: 'Bia do Pix',
      phone: '11977776666',
      password: 'segredo1',
    })
    .expect(201);
  const raw = su.headers['set-cookie'] as unknown as string[];
  shopper.cookie = raw.find((c) => c.startsWith('cm_cid='))!.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

const pickup = (extra: object = {}) => ({
  channel: 'pickup',
  token: token(),
  customerName: 'Bia do Pix',
  customerPhone: '11988887777',
  paymentMethod: 'pix',
  items: [{ productId: fx.prodA, quantity: 2 }],
  ...extra,
});

let tableId = '';
let sessionId = '';

describe('Pix pelo cardápio com comprovante', () => {
  it('configuração: confere a chave, guarda no formato do Pix e só liga completa', async () => {
    const off = await patch('adminA', '/store/settings', { pixEnabled: true }).expect(422);
    expect(off.body.message).toMatch(/preencha a chave/);
    const bad = await patch('adminA', '/store/settings', {
      pixKeyType: 'cpf',
      pixKey: '111.111.111-12',
    }).expect(422);
    expect(bad.body.message).toMatch(/Chave Pix inválida/);
    // Nome e cidade passam dos limites do Pix: recusa com o limite na mensagem.
    await patch('adminA', '/store/settings', { pixCity: 'São José dos Campos' }).expect(400);
    // O caixa (sem gerir as configurações) não muda a chave.
    await patch('cashierA', '/store/settings', { pixKey: 'x@y.com' }).expect(403);
    const s = (
      await patch('adminA', '/store/settings', {
        pixEnabled: true,
        pixKeyType: 'cpf',
        pixKey: '529.982.247-25',
        pixName: 'Lanchonete São João',
        pixCity: 'São Paulo',
      }).expect(200)
    ).body;
    expect(s).toMatchObject({ pixEnabled: true, pixKeyType: 'cpf', pixKey: '52998224725' });

    const menu = (await pub.get('/store').expect(200)).body;
    expect(menu.pix).toEqual({
      keyType: 'cpf',
      key: '52998224725',
      keyLabel: '529.982.247-25',
      name: 'Lanchonete São João',
      city: 'São Paulo',
    });
    // Na mesa também: o cliente escolhe pagar pelo Pix agora ou no fim, com o garçom.
    const table = (await post('adminA', '/tables', { label: 'PX1' }).expect(201)).body;
    tableId = table.id;
    expect((await pub.get(`/store?mesa=${table.id}`).expect(200)).body.pix).toMatchObject({
      key: '52998224725',
    });
    // Outro restaurante não tem Pix.
    expect((await pub.get('/store', HOST_B).expect(200)).body.pix).toBeNull();
  });

  let orderId = '';
  let tk = '';
  it('pedido com Pix espera o comprovante; o acompanhamento traz o copia e cola com o valor', async () => {
    const body = pickup();
    tk = body.token;
    // Sem a conta aberta, o Pix pelo cardápio não vai: o cardápio leva para o login.
    const cookie = shopper.cookie;
    shopper.cookie = '';
    const anon = await pub.post('/store/orders', pickup(), key()).expect(403);
    expect(anon.body).toMatchObject({ code: 'login_required' });
    shopper.cookie = cookie;
    const r = await pub.post('/store/orders', body, key()).expect(201);
    expect(r.body).toMatchObject({ status: 'awaiting', total: '51.80', pixStatus: 'waiting' });

    const v = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(v.pix).toMatchObject({
      status: 'waiting',
      amount: '51.80',
      receipt: null,
      canSend: true,
      payee: { name: 'Lanchonete São João', keyType: 'cpf', key: '529.982.247-25' },
    });
    const code = v.pix.code as string;
    expect(code.startsWith('000201')).toBe(true);
    expect(code).toContain('0111' + '52998224725');
    expect(code).toContain('540551.80');
    expect(code).toContain('5919Lanchonete Sao Joao');
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));

    const list = (await get('cashierA', '/orders?active=true').expect(200)).body as {
      id: string;
      number: number;
      pixStatus: string | null;
      pixReceipt: unknown;
    }[];
    const o = list.find((x) => x.number === r.body.number)!;
    orderId = o.id;
    expect(o.pixStatus).toBe('waiting');
    expect(o.pixReceipt).toBeNull();
  });

  it('cliente manda o comprovante; só foto ou PDF de verdade, até 3 MB', async () => {
    await pub
      .upload(`/store/orders/${tk}/pix-receipt`, Buffer.from('oi'), 'text/plain')
      .expect(422);
    await pub
      .upload(`/store/orders/${tk}/pix-receipt`, Buffer.from('não é png'), 'image/png')
      .expect(422);
    await pub.upload(`/store/orders/${token()}/pix-receipt`, PNG, 'image/png').expect(404);
    // Link de um restaurante não vale no outro.
    await pub.upload(`/store/orders/${tk}/pix-receipt`, PNG, 'image/png', HOST_B).expect(404);
    const sent = await pub.upload(`/store/orders/${tk}/pix-receipt`, PNG, 'image/png').expect(200);
    expect(sent.body.status).toBe('submitted');

    const v = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(v.pix).toMatchObject({ status: 'submitted', receipt: { status: 'submitted' } });

    const o = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    expect(o.pixStatus).toBe('submitted');
    expect(o.pixReceipt).toMatchObject({
      status: 'submitted',
      contentType: 'image/png',
      amount: '51.80',
      hasFile: true,
    });
    expect(o.pixReceipts).toHaveLength(1);
  });

  it('equipe abre o arquivo; garçom e outro restaurante não', async () => {
    const o = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    const url = `/orders/${orderId}/pix-receipts/${o.pixReceipt.id}/file`;
    const f = await get('cashierA', url).buffer(true).expect(200);
    expect(f.headers['content-type']).toBe('image/png');
    expect(f.headers['cache-control']).toMatch(/private/);
    expect(Buffer.compare(f.body as Buffer, PNG)).toBe(0);
    await get('waiterA', url).expect(403);
    await get('adminB', url).expect(404);
  });

  it('recusado com motivo: o cliente vê e manda outro (PDF)', async () => {
    const o = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    const rid = o.pixReceipt.id;
    await post('cashierA', `/orders/${orderId}/pix-receipts/${rid}/reject`, { reason: 'x' }).expect(
      400,
    );
    const rej = await post('cashierA', `/orders/${orderId}/pix-receipts/${rid}/reject`, {
      reason: 'Valor diferente do pedido',
    }).expect(200);
    expect(rej.body.pixStatus).toBe('rejected');
    // Já conferido: não recusa nem aprova de novo.
    await post('cashierA', `/orders/${orderId}/pix-receipts/${rid}/reject`, {
      reason: 'De novo',
    }).expect(409);

    const v = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(v.pix).toMatchObject({
      status: 'rejected',
      canSend: true,
      receipt: { status: 'rejected', reason: 'Valor diferente do pedido' },
    });
    expect(v.pix.code).toBeTruthy();

    await pub.upload(`/store/orders/${tk}/pix-receipt`, PDF, 'application/pdf').expect(200);
    const again = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    expect(again.pixStatus).toBe('submitted');
    expect(again.pixReceipt.contentType).toBe('application/pdf');
    expect(again.pixReceipts.map((r: { status: string }) => r.status)).toEqual([
      'submitted',
      'rejected',
    ]);
  });

  it('aprovado: o Pix entra no caixa, o pedido fica pago e o cliente não manda mais', async () => {
    const o = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    const rid = o.pixReceipt.id;
    const url = `/orders/${orderId}/pix-receipts/${rid}/approve`;
    // Sem a chave de idempotência, sem caixa aberto ou sem poder receber: não aprova.
    await post('cashierA', url, {}).expect(422);
    const noCash = await post('cashierA', url, {}, key()).expect(422);
    expect(noCash.body.message).toMatch(/Abra um caixa/);
    await post('waiterA', url, {}, key()).expect(403);

    const reg = (await post('adminA', '/cash-registers', { name: 'Caixa Pix' }).expect(201)).body;
    const session = (
      await post('cashierA', '/cash/sessions', {
        registerId: reg.id,
        openingAmount: '0.00',
      }).expect(201)
    ).body;
    sessionId = session.id;
    const k = key();
    const ok = await post('cashierA', url, { cashSessionId: session.id }, k).expect(200);
    expect(ok.body).toMatchObject({
      pixStatus: 'approved',
      paymentStatus: 'paid',
      balance: '0.00',
    });
    expect(ok.body.payments).toHaveLength(1);
    expect(ok.body.payments[0]).toMatchObject({ method: 'pix', amount: '51.80' });
    // Reenvio com a mesma chave não lança de novo; outra chave esbarra no já aprovado.
    const replay = await post('cashierA', url, { cashSessionId: session.id }, k).expect(200);
    expect(replay.body.payments).toHaveLength(1);
    await post('cashierA', url, { cashSessionId: session.id }, key()).expect(409);

    const v = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(v.pix).toMatchObject({ status: 'approved', code: null, canSend: false });
    expect(v.paymentStatus).toBe('paid');
    const late = await pub.upload(`/store/orders/${tk}/pix-receipt`, PNG, 'image/png').expect(409);
    expect(late.body.message).toMatch(/já foi confirmado/);

    const cash = (await get('cashierA', `/cash/sessions/${session.id}`).expect(200)).body;
    expect(JSON.stringify(cash)).toContain('51.80');
  });

  it('na mesa: paga pelo Pix do cardápio e a comanda só cobra o que falta', async () => {
    const tk2 = token();
    const r = await pub
      .post(
        '/store/orders',
        {
          channel: 'table',
          tableId,
          token: tk2,
          customerName: 'Rui da Mesa',
          paymentMethod: 'pix',
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    expect(r.body.pixStatus).toBe('waiting');
    // Quem escolhe pagar no fim (sem forma de pagamento) segue como antes, sem Pix.
    const later = await pub
      .post(
        '/store/orders',
        {
          channel: 'table',
          tableId,
          token: token(),
          customerName: 'Rui da Mesa',
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    expect(later.body.pixStatus).toBeNull();

    const list = (await get('cashierA', '/orders?active=true').expect(200)).body as {
      id: string;
      number: number;
      tabId: string;
      paymentHint: string | null;
    }[];
    const o = list.find((x) => x.number === r.body.number)!;
    const o2 = list.find((x) => x.number === later.body.number)!;
    expect(o.paymentHint).toBe('pix');
    expect(o.tabId).toBe(o2.tabId);
    for (const x of [o, o2])
      await post('cashierA', `/orders/${x.id}/status`, { to: 'new' }).expect(201);

    await pub.upload(`/store/orders/${tk2}/pix-receipt`, PNG, 'image/png').expect(200);
    // Comprovante esperando conferência: cobrar a mesa agora faria o cliente pagar duas vezes.
    const tab = (await get('cashierA', `/tabs/${o.tabId}`).expect(200)).body;
    const blocked = await post(
      'cashierA',
      `/tabs/${o.tabId}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: tab.balance },
      key(),
    ).expect(409);
    expect(blocked.body.message).toMatch(/pagou o pedido #\d+ pelo Pix/);

    const rid = (await get('cashierA', `/orders/${o.id}`).expect(200)).body.pixReceipt.id;
    await post(
      'cashierA',
      `/orders/${o.id}/pix-receipts/${rid}/approve`,
      { cashSessionId: sessionId },
      key(),
    ).expect(200);
    const after = (await get('cashierA', `/tabs/${o.tabId}`).expect(200)).body;
    const paidOrder = after.orders.find((x: { id: string }) => x.id === o.id);
    expect(paidOrder).toMatchObject({ paymentStatus: 'paid', pixStatus: 'approved' });
    // O saldo da mesa é só o pedido de quem vai pagar no fim.
    expect(after.balance).toBe(
      after.orders.find((x: { id: string }) => x.id === o2.id).balance as string,
    );
    await post(
      'cashierA',
      `/tabs/${o.tabId}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: after.balance },
      key(),
    ).expect(201);
  });

  it('sem o Pix ligado, o pedido com Pix é o de sempre (paga na entrega)', async () => {
    await patch('adminA', '/store/settings', { pixEnabled: false }).expect(200);
    expect((await pub.get('/store').expect(200)).body.pix).toBeNull();
    const body = pickup();
    const r = await pub.post('/store/orders', body, key()).expect(201);
    expect(r.body.pixStatus).toBeNull();
    expect((await pub.get(`/store/orders/${body.token}`).expect(200)).body.pix).toBeNull();
    await pub.upload(`/store/orders/${body.token}/pix-receipt`, PNG, 'image/png').expect(409);
    await patch('adminA', '/store/settings', { pixEnabled: true }).expect(200);
  });

  it('a limpeza apaga o arquivo depois de 180 dias e guarda a decisão', async () => {
    await ownerQuery(
      `UPDATE pix_receipts SET created_at = created_at - interval '181 days' WHERE order_id = $1`,
      [orderId],
    );
    const r = await app.get(MaintenanceService).purge();
    expect(r.pixReceipts).toBeGreaterThanOrEqual(2);
    const o = (await get('cashierA', `/orders/${orderId}`).expect(200)).body;
    expect(o.pixReceipt).toMatchObject({ status: 'approved', hasFile: false });
    const f = await get(
      'cashierA',
      `/orders/${orderId}/pix-receipts/${o.pixReceipt.id}/file`,
    ).expect(404);
    expect(f.body.message).toMatch(/apagado/);
  });
});
