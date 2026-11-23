import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { OnlinePayService } from '../src/online-pay/online-pay.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { FakePagBank, PB, startFakePagBank } from './fake-pagbank';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Conta inteira da mesa (cardápio do QR Code) paga pelo PagBank falso, sem a conta do cliente:
 * o Pix do PagBank fica no lugar do Pix com comprovante; Pix confirmado pelo aviso entra no caixa
 * nos pedidos da comanda e a mesa fica livre; cartão recusado e aprovado; enquanto o PagBank
 * espera, ninguém cobra a comanda de outro jeito; aviso atrasado de Pix pago depois que a mesa
 * pagou com o garçom é devolvido; item cancelado enquanto pagava devolve a sobra; sem caixa
 * aberto, o pago espera o caixa abrir.
 */
const ADMIN_HOST = 'admin.comandou.test';
const HOST_A = 'tpay-a.comandou.test';
const HOST_B = 'tpay-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const CPF = '529.982.247-25';
/** PNG de 1x1 (a API confere a assinatura do arquivo). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let pay: OnlinePayService;
let fake: FakePagBank;
const cookies: Record<string, string> = {};
let sessionId = '';
let registerId = '';
let seq = 0;
const key = () => `tpay-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

type Who = 'adminA' | 'cashierA' | 'waiterA' | 'adminB';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!);
const post = (w: Who, url: string, body: object = {}, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
/** Cliente da mesa, sem conta, de um IP por teste (cada rota tem limite por minuto e por IP). */
const guest = (ip: string, host = HOST_A) => ({
  get: (url: string) => http.get(`/api/v1${url}`).set('Host', host).set('X-Forwarded-For', ip),
  post: (url: string, body: object, idem?: string) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('X-Forwarded-For', ip);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
  upload: (url: string, file: Buffer, type: string) =>
    http
      .post(`/api/v1${url}`)
      .set('Host', host)
      .set(CSRF)
      .set('X-Forwarded-For', ip)
      .set('Content-Type', type)
      .send(file),
});

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  return (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
}

/** Mesa com dois pedidos na mesma comanda: 2 X-Burguer pelo celular e 1 pelo garçom (R$ 77,70). */
async function tableWithOrders(label: string, ip: string) {
  const table = (await post('adminA', '/tables', { label }).expect(201)).body as {
    id: string;
    label: string;
  };
  const r = await guest(ip)
    .post(
      '/store/orders',
      {
        channel: 'table',
        tableId: table.id,
        token: token(),
        customerName: 'Ana na Mesa',
        customerCpf: CPF,
        items: [{ productId: fx.prodA, quantity: 2 }],
      },
      key(),
    )
    .expect(201);
  const [mine] = await ownerQuery<{ id: string; tab_id: string }>(
    `SELECT id, tab_id FROM orders WHERE tenant_id = $1 AND number = $2`,
    [fx.tenantA, r.body.number],
  );
  const waiter = await post(
    'waiterA',
    '/orders',
    { channel: 'table', tabId: mine!.tab_id, items: [{ productId: fx.prodA, quantity: 1 }] },
    key(),
  ).expect(201);
  return { table, tabId: mine!.tab_id, orderIds: [mine!.id, waiter.body.id as string] };
}

const payer = { name: 'Ana na Mesa', cpf: CPF, email: 'ana@cliente.test' };
const pbIdOf = (code: string) => /pix-(ORDE_[a-f0-9]+)/.exec(code)![1]!;
const notify = (pbId: string) =>
  http.post('/api/v1/store/pagbank/notify').set('Host', HOST_A).send({ id: pbId }).expect(200);
const chargesOf = (tabId: string) =>
  ownerQuery<{
    id: string;
    method: string;
    status: string;
    amount: string;
    applied: string | null;
    payment_id: string | null;
    refunded_amount: string;
    excess_refunded_at: Date | null;
  }>(
    `SELECT id, method, status, amount::text, applied::text, payment_id, refunded_amount::text,
            excess_refunded_at
       FROM online_charges WHERE tab_id = $1 ORDER BY created_at`,
    [tabId],
  );
const paymentsOf = (tabId: string) =>
  ownerQuery<{ id: string; order_id: string; method: string; amount: string }>(
    `SELECT p.id, p.order_id, p.method, p.amount::text FROM payments p
       JOIN orders o ON o.id = p.order_id WHERE o.tab_id = $1 ORDER BY p.created_at`,
    [tabId],
  );

beforeAll(async () => {
  fx = await seedTwoTenants('tpay');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('mesa-pagbank@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@tpay-a.test', 'Caixa', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);
  fake = await startFakePagBank();
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      PAGBANK_API_URL_SANDBOX: fake.url,
      PAGBANK_CONNECT_URL_SANDBOX: `${fake.url}/oauth2/authorize`,
      ONLINE_PAY_INTERVAL_SECONDS: '0',
      TRUST_PROXY: 'true',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  pay = app.get(OnlinePayService);

  // Super Admin liga o pagamento pelo app.
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'mesa-pagbank@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  const admin = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
  await http
    .put('/api/v1/platform/online-pay/settings')
    .set('Host', ADMIN_HOST)
    .set('Cookie', admin)
    .set(CSRF)
    .send({
      enabled: true,
      environment: 'sandbox',
      platformToken: PB.PLATFORM_TOKEN,
      clientId: 'client-id-da-comandou',
      clientSecret: PB.CLIENT_SECRET,
      receiverAccountId: PB.PLATFORM_ACCOUNT,
      feePercent: '1.50',
      feeFixed: '0.30',
    })
    .expect(200);

  cookies.adminA = await login(HOST_A, 'admin@tpay-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@tpay-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@tpay-a.test');
  cookies.adminB = await login(HOST_B, 'admin@tpay-b.test');

  // O dono conecta a conta PagBank (Connect).
  const c = await post('adminA', '/online-pay/connect').expect(200);
  const state = new URL(c.body.url).searchParams.get('state')!;
  const back = await http
    .get(`/api/v1/pagbank/connect/callback?code=codigo-bom&state=${encodeURIComponent(state)}`)
    .set('Host', ADMIN_HOST)
    .expect(302);
  const finish = new URL(back.headers.location!);
  const done = await http
    .get(`${finish.pathname}${finish.search}`)
    .set('Host', HOST_A)
    .set('Cookie', cookies.adminA!)
    .expect(302);
  expect(done.headers.location).toBe('/loja-online?aba=pagamentos&pagbank=ok');

  await http
    .patch('/api/v1/store/settings')
    .set('Host', HOST_A)
    .set('Cookie', cookies.adminA!)
    .set(CSRF)
    .send({
      enabled: true,
      isOpen: true,
      autoAccept: true,
      pixEnabled: true,
      pixKeyType: 'cpf',
      pixKey: CPF,
      pixName: 'Lanchonete da Mesa',
      pixCity: 'Sao Paulo',
    })
    .expect(200);
  registerId = (await post('adminA', '/cash-registers', { name: 'Caixa Mesa' }).expect(201)).body
    .id;
  sessionId = (
    await post('cashierA', '/cash/sessions', { registerId, openingAmount: '0.00' }).expect(201)
  ).body.id;
});

afterAll(async () => {
  await app?.close();
  fake?.close();
});

describe('Conta da mesa pelo PagBank', () => {
  it('o PagBank fica no lugar do Pix com comprovante', async () => {
    const t = await tableWithOrders('P1', '10.20.0.1');
    const b = (await guest('10.20.0.1').get(`/store/table/${t.table.id}/bill`).expect(200)).body;
    expect(b).toMatchObject({
      open: true,
      due: '77.70',
      methods: { pix: false, pixAuto: true, card: true },
      pix: null,
      online: { status: 'none', pix: null, cardAttemptsLeft: 3, paidOutside: '0.00' },
    });
    expect(b.pagbank.publicKey).toContain('chave');
    expect(JSON.stringify(b)).not.toContain(CPF);
  });

  it('Pix automático: QR Code do saldo, trava cobrar de outro jeito, confirma sozinho e libera a mesa', async () => {
    const ip = '10.20.0.2';
    const t = await tableWithOrders('P2', ip);
    const url = `/store/table/${t.table.id}/pay/pix`;
    // O cliente viu outro valor (a conta mudou): nada é cobrado.
    const changed = await guest(ip)
      .post(url, { ...payer, amount: '10.00' })
      .expect(409);
    expect(changed.body.code).toBe('bill_changed');
    await guest(ip)
      .post(url, { ...payer, cpf: '111.111.111-11', amount: '77.70' })
      .expect(400);
    // Outro restaurante não acha a mesa.
    await guest(ip, HOST_B)
      .post(url, { ...payer, amount: '77.70' })
      .expect(404);
    const before = fake.orders.size;
    const r = (
      await guest(ip)
        .post(url, { ...payer, amount: '77.70' })
        .expect(200)
    ).body;
    expect(r.online).toMatchObject({ status: 'pending', method: 'pix', amount: '77.70' });
    expect(r.online.pix.code).toMatch(/^00020101021226pix-ORDE_/);
    expect(r.due).toBe('77.70');
    expect(fake.orders.size).toBe(before + 1);
    const [charge] = await chargesOf(t.tabId);
    const sent = fake.orders.get(pbIdOf(r.online.pix.code))!;
    expect(sent.reference_id).toBe(charge!.id);
    const body = sent.body as {
      customer: { name: string; tax_id: string; email: string; phones?: unknown };
      qr_codes: { amount: { value: number }; expiration_date: string }[];
    };
    // Sem conta do cliente: nome, CPF e e-mail de quem paga, sem telefone.
    expect(body.customer).toEqual({
      name: 'Ana na Mesa',
      email: 'ana@cliente.test',
      tax_id: '52998224725',
    });
    expect(body.qr_codes[0]!.amount.value).toBe(7770);
    const minutes = (Date.parse(body.qr_codes[0]!.expiration_date) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThan(11);
    // Pedir de novo devolve o mesmo QR Code.
    const again = (
      await guest(ip)
        .post(url, { ...payer, amount: '77.70' })
        .expect(200)
    ).body;
    expect(again.online.pix.code).toBe(r.online.pix.code);
    expect(fake.orders.size).toBe(before + 1);

    // Enquanto o PagBank espera, ninguém cobra a comanda de outro jeito.
    const tabPay = await post(
      'cashierA',
      `/tabs/${t.tabId}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: '10.00' },
      key(),
    ).expect(409);
    expect(tabPay.body.message).toContain('pagando a conta pelo PagBank');
    const orderPay = await post(
      'cashierA',
      `/orders/${t.orderIds[1]}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: '25.90' },
      key(),
    ).expect(409);
    expect(orderPay.body.message).toContain('pagando a conta pelo PagBank');
    await guest(ip).upload(`/store/table/${t.table.id}/pix-receipt`, PNG, 'image/png').expect(409);

    // Tudo entregue na mesa: pago, a mesa fica livre.
    for (const id of t.orderIds) {
      await post('adminA', `/orders/${id}/status`, { to: 'ready' }).expect(201);
      await post('waiterA', `/orders/${id}/served`).expect(200);
    }
    fake.payPix(pbIdOf(r.online.pix.code));
    await notify(pbIdOf(r.online.pix.code));
    const [paid] = await chargesOf(t.tabId);
    expect(paid).toMatchObject({ status: 'paid', applied: '77.70' });
    expect(paid!.payment_id).toBeTruthy();
    const payments = await paymentsOf(t.tabId);
    expect(payments.map((p) => [p.method, p.amount])).toEqual([
      ['pix', '51.80'],
      ['pix', '25.90'],
    ]);
    const links = await ownerQuery<{ payment_id: string }>(
      `SELECT payment_id FROM online_charge_payments WHERE charge_id = $1`,
      [paid!.id],
    );
    expect(links.map((l) => l.payment_id).sort()).toEqual(payments.map((p) => p.id).sort());
    const [tab] = await ownerQuery<{ status: string }>(`SELECT status FROM tabs WHERE id = $1`, [
      t.tabId,
    ]);
    expect(tab!.status).toBe('closed');
    const bill = (await guest(ip).get(`/store/table/${t.table.id}/bill`).expect(200)).body;
    expect(bill.open).toBe(false);
    // A equipe vê a cobrança da conta da mesa no pedido.
    const o = (await get('cashierA', `/orders/${t.orderIds[1]}`).expect(200)).body;
    expect(o.onlineCharges).toEqual([
      expect.objectContaining({ status: 'paid', forTab: true, applied: '77.70' }),
    ]);
  });

  it('cartão recusado mostra o motivo; aprovado entra no caixa como crédito e o estorno vai ao PagBank', async () => {
    const ip = '10.20.0.3';
    const t = await tableWithOrders('P3', ip);
    const url = `/store/table/${t.table.id}/pay/card`;
    const card = { holderName: 'Ana Pagadora', cpf: CPF, email: payer.email, amount: '77.70' };
    const no = (
      await guest(ip)
        .post(url, { ...card, encryptedCard: PB.CARD_DECLINE })
        .expect(200)
    ).body;
    expect(no.online).toMatchObject({ status: 'declined', cardAttemptsLeft: 2 });
    expect(no.online.declineReason).toMatch(/saldo insuficiente/);
    expect(no.due).toBe('77.70');
    const ok = (
      await guest(ip)
        .post(url, { ...card, encryptedCard: PB.CARD_OK })
        .expect(200)
    ).body;
    expect(ok.online).toMatchObject({ status: 'paid', method: 'card' });
    // Pedidos ainda na cozinha: pago, mas a mesa só fica livre quando tudo sair.
    expect(ok).toMatchObject({ open: true, due: '0.00', paid: '77.70' });
    expect(JSON.stringify(ok.online)).not.toContain('1111');
    const sent = [...fake.orders.values()].at(-1)!.body as {
      charges: { splits: { receivers: { amount: { value: number } }[] } }[];
    };
    const fee = Math.round((7770 * 150) / 10_000) + 30;
    expect(sent.charges[0]!.splits.receivers.map((x) => x.amount.value)).toEqual([7770 - fee, fee]);
    const payments = await paymentsOf(t.tabId);
    expect(payments.map((p) => [p.method, p.amount])).toEqual([
      ['credit', '51.80'],
      ['credit', '25.90'],
    ]);
    // Pagar de novo: a conta já está paga.
    await guest(ip)
      .post(url, { ...card, encryptedCard: PB.CARD_OK })
      .expect(409);
    // Estorno do pagamento do segundo pedido: vai ao PagBank antes, só aquele valor.
    const n = fake.cancels.length;
    await post(
      'adminA',
      `/payments/${payments[1]!.id}/refunds`,
      { cashSessionId: sessionId, amount: '25.90', reason: 'cliente reclamou' },
      key(),
    ).expect(201);
    expect(fake.cancels.length).toBe(n + 1);
    expect(fake.cancels.at(-1)).toMatchObject({ value: 2590, auth: `Bearer ${PB.SELLER_TOKEN}` });
    const [c] = (await chargesOf(t.tabId)).filter((x) => x.status === 'paid');
    expect(c!.refunded_amount).toBe('25.90');
  });

  it('aviso atrasado: o Pix venceu, a mesa pagou com o garçom e o Pix pago depois é devolvido', async () => {
    const ip = '10.20.0.4';
    const t = await tableWithOrders('P4', ip);
    const r = (
      await guest(ip)
        .post(`/store/table/${t.table.id}/pay/pix`, { ...payer, amount: '77.70' })
        .expect(200)
    ).body;
    const pbId = pbIdOf(r.online.pix.code);
    // O QR Code vence: a varredura libera a mesa.
    await ownerQuery(
      `UPDATE online_charges SET pix_expires_at = now() - interval '1 minute' WHERE tab_id = $1`,
      [t.tabId],
    );
    await pay.sweep();
    const b = (await guest(ip).get(`/store/table/${t.table.id}/bill`).expect(200)).body;
    expect(b.online).toMatchObject({ status: 'expired', pix: null });
    // A mesa paga com o garçom.
    await post(
      'cashierA',
      `/tabs/${t.tabId}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: '77.70' },
      key(),
    ).expect(201);
    // O cliente ainda paga o QR Code antigo e o aviso chega depois: o Pix volta inteiro.
    const n = fake.cancels.length;
    fake.payPix(pbId);
    await notify(pbId);
    expect(fake.cancels.length).toBe(n + 1);
    expect(fake.cancels.at(-1)!.value).toBe(7770);
    const [c] = await chargesOf(t.tabId);
    expect(c).toMatchObject({ status: 'refunded', payment_id: null });
    const cash = (await paymentsOf(t.tabId)).map((p) => p.method);
    expect(cash).toEqual(['cash', 'cash']);
  });

  it('desistiu do Pix e pagou no cartão: o Pix antigo pago depois é devolvido', async () => {
    const ip = '10.20.0.5';
    const t = await tableWithOrders('P5', ip);
    const r = (
      await guest(ip)
        .post(`/store/table/${t.table.id}/pay/pix`, { ...payer, amount: '77.70' })
        .expect(200)
    ).body;
    const pbId = pbIdOf(r.online.pix.code);
    const off = (await guest(ip).post(`/store/table/${t.table.id}/pay/cancel`, {}).expect(200))
      .body;
    expect(off.online).toMatchObject({ status: 'expired', pix: null });
    await guest(ip)
      .post(`/store/table/${t.table.id}/pay/card`, {
        encryptedCard: PB.CARD_OK,
        holderName: 'Ana Pagadora',
        cpf: CPF,
        email: payer.email,
        amount: '77.70',
      })
      .expect(200);
    const n = fake.cancels.length;
    fake.payPix(pbId);
    await notify(pbId);
    expect(fake.cancels.length).toBe(n + 1);
    const rows = await chargesOf(t.tabId);
    expect(rows.map((c) => [c.method, c.status])).toEqual([
      ['pix', 'refunded'],
      ['card', 'paid'],
    ]);
    expect(await paymentsOf(t.tabId)).toHaveLength(2);
  });

  it('item cancelado enquanto o cliente pagava: entra o saldo e a sobra volta pelo PagBank', async () => {
    const ip = '10.20.0.6';
    const t = await tableWithOrders('P6', ip);
    const r = (
      await guest(ip)
        .post(`/store/table/${t.table.id}/pay/pix`, { ...payer, amount: '77.70' })
        .expect(200)
    ).body;
    await post('adminA', `/orders/${t.orderIds[1]}/status`, {
      to: 'cancelled',
      reason: 'acabou o pão',
    }).expect(201);
    const pbId = pbIdOf(r.online.pix.code);
    fake.payPix(pbId);
    await notify(pbId);
    const [c] = await chargesOf(t.tabId);
    expect(c).toMatchObject({ status: 'paid', applied: '51.80', refunded_amount: '25.90' });
    expect(c!.excess_refunded_at).toBeTruthy();
    expect(fake.cancels.at(-1)).toMatchObject({ value: 2590, idem: `${c!.id}-sobra` });
    expect((await paymentsOf(t.tabId)).map((p) => p.amount)).toEqual(['51.80']);
    // Rodar a varredura de novo não devolve outra vez.
    const n = fake.cancels.length;
    await pay.sweep();
    expect(fake.cancels.length).toBe(n);
  });

  it('sem caixa aberto: pago fica fora do caixa, trava a comanda e entra quando o caixa abre', async () => {
    await ownerQuery(
      `UPDATE cash_sessions SET status = 'closed', closed_at = now() WHERE id = $1`,
      [sessionId],
    );
    const ip = '10.20.0.7';
    const t = await tableWithOrders('P7', ip);
    const ok = (
      await guest(ip)
        .post(`/store/table/${t.table.id}/pay/card`, {
          encryptedCard: PB.CARD_OK,
          holderName: 'Ana Pagadora',
          cpf: CPF,
          email: payer.email,
          amount: '77.70',
        })
        .expect(200)
    ).body;
    expect(ok).toMatchObject({ due: '0.00', online: { status: 'paid', paidOutside: '77.70' } });
    const [c] = await chargesOf(t.tabId);
    expect(c!.payment_id).toBeNull();
    sessionId = (
      await post('cashierA', '/cash/sessions', { registerId, openingAmount: '0.00' }).expect(201)
    ).body.id;
    const blocked = await post(
      'cashierA',
      `/tabs/${t.tabId}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: '77.70' },
      key(),
    ).expect(409);
    expect(blocked.body.message).toContain('já pagou a conta pelo PagBank');
    await pay.sweep();
    expect((await paymentsOf(t.tabId)).map((p) => p.method)).toEqual(['credit', 'credit']);
    const b = (await guest(ip).get(`/store/table/${t.table.id}/bill`).expect(200)).body;
    expect(b).toMatchObject({ due: '0.00', paid: '77.70', online: { paidOutside: '0.00' } });
  });
});
