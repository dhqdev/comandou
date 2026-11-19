import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { OnlinePayService } from '../src/online-pay/online-pay.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Pagamento pelo app (PagBank falso): sem conta conectada nada muda; o dono conecta pelo Connect
 * (state de uso único, tokens cifrados); cartão recusado e aprovado com split (restaurante +
 * taxa da Comandou); pago sem caixa entra no caixa depois; estorno vai ao PagBank; Pix confirmado
 * pelo aviso (que só dispara consulta); cancelado pago é devolvido; sem pagamento cancela sozinho.
 */
const ADMIN_HOST = 'admin.comandou.test';
const HOST_A = 'op-a.comandou.test';
const HOST_B = 'op-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const PLATFORM_TOKEN = 'token-da-conta-comandou-0123456789';
const CLIENT_SECRET = 'segredo-da-aplicacao-0123456789';
const SELLER_TOKEN = 'token-do-restaurante-0123456789';
const PLATFORM_ACCOUNT = 'ACCO_COMANDOU0001';
const SELLER_ACCOUNT = 'ACCO_RESTAURANTE01';
const CARD_OK = 'C'.repeat(200);
const CARD_DECLINE = 'D'.repeat(200);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let pay: OnlinePayService;
let adminCookie = '';
const staff: Record<string, string> = {};
const shopper = { cookie: '' };
let pagbank: Server;
let pbUrl = '';
let seq = 0;
const idem = () => `op-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

// ---------------------------------------------------------------- PagBank falso
interface FakeOrder {
  id: string;
  reference_id: string;
  body: Record<string, unknown>;
  charges: { id: string; status: string; amount: { value: number } }[];
  qr_codes?: { id: string; text: string; expiration_date: string }[];
}
const fake = {
  orders: new Map<string, FakeOrder>(),
  /** Pedido criado por chave de idempotência (repetir a chave devolve o mesmo pedido). */
  byIdem: new Map<string, string>(),
  /** Resposta perdida: 'once' = só o primeiro envio de cada chave; 'always' = todos. */
  lose: null as null | 'once' | 'always',
  lost: new Set<string>(),
  cancels: [] as { chargeId: string; value: number; auth: string }[],
  tokenCalls: [] as {
    auth: string;
    clientId: string;
    secret: string;
    body: Record<string, unknown>;
  }[],
  auths: [] as string[],
};

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d ? JSON.parse(d) : {}));
  });
}

async function pagbankHandler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const auth = String(req.headers.authorization ?? '');
  const body = await readBody(req);
  const url = req.url ?? '';
  if (req.method === 'POST' && url === '/oauth2/token') {
    fake.tokenCalls.push({
      auth,
      clientId: String(req.headers.x_client_id ?? ''),
      secret: String(req.headers.x_client_secret ?? ''),
      body,
    });
    if (body.code !== 'codigo-bom')
      return send(400, { error_messages: [{ description: 'invalid code' }] });
    return send(200, {
      access_token: SELLER_TOKEN,
      refresh_token: 'refresh-1',
      expires_in: 31_536_000,
      account_id: SELLER_ACCOUNT,
    });
  }
  if (req.method === 'POST' && url === '/public-keys') {
    if (auth !== `Bearer ${SELLER_TOKEN}`) return send(401, {});
    return send(201, { public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA-chave' });
  }
  if (req.method === 'POST' && url === '/orders') {
    fake.auths.push(auth);
    if (auth !== `Bearer ${SELLER_TOKEN}`) return send(401, {});
    const key = String(req.headers['x-idempotency-key'] ?? '');
    const lose = () => {
      if (fake.lose === 'always') return true;
      if (fake.lose === 'once' && !fake.lost.has(key)) return !!fake.lost.add(key);
      return false;
    };
    const known = key ? fake.orders.get(fake.byIdem.get(key) ?? '') : undefined;
    if (known) {
      // Mesma chave: o PagBank devolve o pedido que já criou (não cobra de novo).
      if (lose()) return send(502, {});
      return send(201, { id: known.id, reference_id: known.reference_id, charges: known.charges });
    }
    const id = `ORDE_${randomBytes(6).toString('hex')}`;
    const charges = (body.charges as Record<string, unknown>[] | undefined) ?? [];
    const o: FakeOrder = { id, reference_id: String(body.reference_id), body, charges: [] };
    if (charges.length) {
      const pm = charges[0]!.payment_method as { card: { encrypted: string } };
      const value = (charges[0]!.amount as { value: number }).value;
      o.charges.push({
        id: `CHAR_${randomBytes(6).toString('hex')}`,
        status: pm.card.encrypted === CARD_DECLINE ? 'DECLINED' : 'PAID',
        amount: { value },
      });
    } else {
      o.qr_codes = [
        {
          id: `QRCO_${id}`,
          text: `00020101021226pix-${id}`,
          expiration_date: '2099-01-01T00:00:00-03:00',
        },
      ];
    }
    fake.orders.set(id, o);
    if (key) fake.byIdem.set(key, id);
    // Criou o pedido (e cobrou), mas a resposta não chega.
    if (lose()) return send(502, {});
    return send(201, {
      id,
      reference_id: o.reference_id,
      charges: o.charges.map((c) => ({
        ...c,
        payment_response:
          c.status === 'DECLINED'
            ? { code: '20007', message: 'saldo insuficiente' }
            : { code: '20000' },
        payment_method: { type: 'CREDIT_CARD', card: { brand: 'visa', last_digits: '1111' } },
      })),
      qr_codes: o.qr_codes,
    });
  }
  const get = /^\/orders\/(ORDE_[a-f0-9]+)$/.exec(url);
  if (req.method === 'GET' && get) {
    const o = fake.orders.get(get[1]!);
    if (!o || auth !== `Bearer ${SELLER_TOKEN}`) return send(404, {});
    return send(200, {
      id: o.id,
      reference_id: o.reference_id,
      charges: o.charges,
      qr_codes: o.qr_codes,
    });
  }
  const cancel = /^\/charges\/(CHAR_[a-f0-9]+)\/cancel$/.exec(url);
  if (req.method === 'POST' && cancel) {
    const value = (body.amount as { value: number }).value;
    fake.cancels.push({ chargeId: cancel[1]!, value, auth });
    return send(201, { id: cancel[1], status: 'CANCELED' });
  }
  send(404, { error_messages: [{ description: 'not found' }] });
}

/** O cliente pagou o Pix no app do banco. */
function payPix(pbOrderId: string) {
  const o = fake.orders.get(pbOrderId)!;
  const value = (o.body.qr_codes as { amount: { value: number } }[])[0]!.amount.value;
  o.charges.push({
    id: `CHAR_${randomBytes(6).toString('hex')}`,
    status: 'PAID',
    amount: { value },
  });
}

// ---------------------------------------------------------------- ajudantes
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
const sget = (w: string, url: string, host = HOST_A) =>
  http.get(`/api/v1${url}`).set('Host', host).set('Cookie', staff[w]!);
const ssend = (w: string, m: 'post' | 'patch', url: string, body: object = {}, key?: string) => {
  const r = http[m](`/api/v1${url}`)
    .set('Host', w === 'adminB' ? HOST_B : HOST_A)
    .set('Cookie', staff[w]!)
    .set(CSRF);
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};
const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', adminCookie);
const psend = (m: 'put' | 'post', url: string, body: object = {}) =>
  http[m](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set('Cookie', adminCookie)
    .set(CSRF)
    .send(body);
const pub = {
  get: (url: string, host = HOST_A) =>
    http.get(`/api/v1${url}`).set('Host', host).set('Cookie', shopper.cookie),
  post: (url: string, body: object, key?: string, host = HOST_A, withCookie = true) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (withCookie && shopper.cookie) r.set('Cookie', shopper.cookie);
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  },
};
/** O mesmo cliente vindo de outro IP (cada rota de pagamento tem limite por minuto e por IP). */
const from = (ip: string) => ({
  get: (url: string) => pub.get(url).set('X-Forwarded-For', ip),
  post: (url: string, body: object) => {
    const r = http.post(`/api/v1${url}`).set('Host', HOST_A).set(CSRF).set('X-Forwarded-For', ip);
    if (shopper.cookie) r.set('Cookie', shopper.cookie);
    return r.send(body);
  },
});

const settings = {
  enabled: true,
  environment: 'sandbox',
  platformToken: PLATFORM_TOKEN,
  clientId: 'client-id-da-comandou',
  clientSecret: CLIENT_SECRET,
  receiverAccountId: PLATFORM_ACCOUNT,
  feePercent: '1.50',
  feeFixed: '0.30',
};

async function placePickup(paymentMethod: string, extra: object = {}) {
  const t = token();
  const r = await pub
    .post(
      '/store/orders',
      {
        channel: 'pickup',
        token: t,
        customerName: 'Bia Pagadora',
        customerPhone: '11977776655',
        paymentMethod,
        items: [{ productId: fx.prodA, quantity: 2 }],
        ...extra,
      },
      idem(),
    )
    .expect(201);
  const [o] = await ownerQuery<{ id: string; total: string }>(
    `SELECT id, total::text FROM orders WHERE tenant_id = $1 AND number = $2`,
    [fx.tenantA, r.body.number],
  );
  return { token: t, id: o!.id, total: o!.total, res: r.body };
}

const payer = { cpf: '529.982.247-25', email: 'bia@cliente.test' };

beforeAll(async () => {
  fx = await seedTwoTenants('op');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('pagamentos@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@op-a.test', 'Caixa OP', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);

  pagbank = createServer((req, res) => void pagbankHandler(req, res));
  await new Promise<void>((r) => pagbank.listen(0, '127.0.0.1', r));
  pbUrl = `http://127.0.0.1:${(pagbank.address() as AddressInfo).port}`;

  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      PAGBANK_API_URL_SANDBOX: pbUrl,
      PAGBANK_CONNECT_URL_SANDBOX: `${pbUrl}/oauth2/authorize`,
      ONLINE_PAY_INTERVAL_SECONDS: '0',
      TRUST_PROXY: 'true',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  pay = app.get(OnlinePayService);
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'pagamentos@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  adminCookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
  staff.adminA = await login(HOST_A, 'admin@op-a.test');
  staff.cashierA = await login(HOST_A, 'caixa@op-a.test');
  staff.adminB = await login(HOST_B, 'admin@op-b.test');
  await ssend('adminA', 'patch', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: false,
  }).expect(200);
  const su = await pub
    .post('/store/account/signup', {
      name: 'Bia Pagadora',
      phone: '11977776655',
      password: 'segredo1',
    })
    .expect(201);
  shopper.cookie = (su.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_cid='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  pagbank?.close();
});

describe('Super Admin: pagamentos pelo app', () => {
  it('guarda token e segredo cifrados e nunca devolve', async () => {
    await psend('put', '/online-pay/settings', { ...settings, feePercent: '25' }).expect(400);
    const r = await psend('put', '/online-pay/settings', settings).expect(200);
    expect(r.body.settings).toMatchObject({
      enabled: true,
      hasPlatformToken: true,
      hasClientSecret: true,
      receiverAccountId: PLATFORM_ACCOUNT,
      feePercent: '1.50',
      feeFixed: '0.30',
    });
    expect(JSON.stringify(r.body)).not.toContain(PLATFORM_TOKEN);
    expect(JSON.stringify(r.body)).not.toContain(CLIENT_SECRET);
    const [row] = await ownerQuery<{ t: Buffer; s: Buffer }>(
      `SELECT platform_token_enc AS t, client_secret_enc AS s FROM platform_online_pay_settings`,
    );
    expect(row!.t.toString('latin1')).not.toContain(PLATFORM_TOKEN);
    const audit = await ownerQuery<{ data: unknown }>(
      `SELECT data FROM platform_audit_log WHERE action = 'platform.online_pay.settings_updated'`,
    );
    expect(JSON.stringify(audit)).not.toContain(PLATFORM_TOKEN);
  });

  it('o restaurante não lê as configurações da plataforma', async () => {
    await sget('adminA', '/platform/online-pay').expect(404);
  });
});

describe('Restaurante conecta a conta PagBank', () => {
  it('sem conta conectada, o cardápio segue como antes', async () => {
    const v = await sget('adminA', '/online-pay').expect(200);
    expect(v.body).toMatchObject({ available: true, connected: false, fee: { percent: '1.50' } });
    const menu = await pub.get('/store').expect(200);
    expect(menu.body.onlinePay).toBeNull();
    // Crédito "pelo app" sem conta conectada: recusado; na entrega continua valendo.
    await pub
      .post(
        '/store/orders',
        {
          channel: 'pickup',
          token: token(),
          customerName: 'Bia',
          customerPhone: '11977776655',
          paymentMethod: 'credit',
          payInApp: true,
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        idem(),
      )
      .expect(409);
  });

  it('só o dono conecta; state de uso único leva de volta ao restaurante', async () => {
    await ssend('cashierA', 'post', '/online-pay/connect').expect(403);
    const c = await ssend('adminA', 'post', '/online-pay/connect').expect(200);
    const u = new URL(c.body.url);
    expect(u.searchParams.get('client_id')).toBe('client-id-da-comandou');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://admin.comandou.test/api/v1/pagbank/connect/callback',
    );
    expect(c.body.url).toContain('scope=payments.read+payments.create+payments.refund');
    const state = u.searchParams.get('state')!;
    // Volta do PagBank no painel: redireciona para o endereço do restaurante.
    const back = await http
      .get(`/api/v1/pagbank/connect/callback?code=codigo-bom&state=${encodeURIComponent(state)}`)
      .set('Host', ADMIN_HOST)
      .expect(302);
    const finish = new URL(back.headers.location!);
    expect(finish.host).toBe(HOST_A);
    expect(finish.pathname).toBe('/api/v1/online-pay/connect/finish');
    // Outro restaurante não usa o state de A.
    const other = await http
      .get(`${finish.pathname}${finish.search}`)
      .set('Host', HOST_B)
      .set('Cookie', staff.adminB!)
      .expect(302);
    expect(other.headers.location).toContain('pagbank=erro');
    const done = await http
      .get(`${finish.pathname}${finish.search}`)
      .set('Host', HOST_A)
      .set('Cookie', staff.adminA!)
      .expect(302);
    expect(done.headers.location).toBe('/loja-online?aba=pagamentos&pagbank=ok');
    expect(fake.tokenCalls.at(-1)).toMatchObject({
      auth: `Bearer ${PLATFORM_TOKEN}`,
      clientId: 'client-id-da-comandou',
      secret: CLIENT_SECRET,
      body: { grant_type: 'authorization_code', code: 'codigo-bom' },
    });
    // Repetir o mesmo state: recusado.
    const again = await http
      .get(`${finish.pathname}${finish.search}`)
      .set('Host', HOST_A)
      .set('Cookie', staff.adminA!)
      .expect(302);
    expect(again.headers.location).toContain('pagbank=erro');
    const v = await sget('adminA', '/online-pay').expect(200);
    expect(v.body).toMatchObject({ connected: true, sellerAccountId: SELLER_ACCOUNT });
    expect(JSON.stringify(v.body)).not.toContain(SELLER_TOKEN);
    const [acc] = await ownerQuery<{ t: Buffer }>(
      `SELECT access_token_enc AS t FROM online_pay_accounts WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    expect(acc!.t.toString('latin1')).not.toContain(SELLER_TOKEN);
    // State desconhecido no painel: 400, sem redirecionar.
    await http
      .get('/api/v1/pagbank/connect/callback?code=x&state=abc')
      .set('Host', ADMIN_HOST)
      .expect(400);
  });

  it('o cardápio passa a oferecer cartão e Pix pelo app', async () => {
    const menu = await pub.get('/store').expect(200);
    expect(menu.body.onlinePay).toMatchObject({ card: true, pix: true, env: 'SANDBOX' });
    expect(menu.body.onlinePay.publicKey).toContain('chave');
    const b = await http.get('/api/v1/store').set('Host', HOST_B).expect(200);
    expect(b.body.onlinePay).toBeNull();
  });
});

let card: Awaited<ReturnType<typeof placePickup>>;
let sessionId = '';

describe('Cartão pelo app', () => {
  it('pedido nasce em análise e não vai para a cozinha antes de pagar', async () => {
    // Sem a conta do cliente: precisa entrar.
    const anon = await pub
      .post(
        '/store/orders',
        {
          channel: 'pickup',
          token: token(),
          customerName: 'Sem Conta',
          customerPhone: '11900001111',
          paymentMethod: 'credit',
          payInApp: true,
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        idem(),
        HOST_A,
        false,
      )
      .expect(403);
    expect(anon.body.code).toBe('login_required');
    card = await placePickup('credit', { payInApp: true });
    expect(card.res).toMatchObject({ status: 'awaiting', payOnline: 'card' });
    const accept = await ssend('adminA', 'post', `/orders/${card.id}/status`, { to: 'new' });
    expect(accept.status).toBe(409);
    expect(accept.body.message).toMatch(/ainda não pagou/);
  });

  it('cartão recusado mostra o motivo e deixa tentar de novo', async () => {
    const r = await pub
      .post(`/store/orders/${card.token}/pay/card`, {
        encryptedCard: CARD_DECLINE,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'declined', cardAttemptsLeft: 2, canPay: true });
    expect(r.body.declineReason).toMatch(/saldo insuficiente/);
    // CPF inválido: nem chega ao PagBank.
    await pub
      .post(`/store/orders/${card.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        cpf: '111.111.111-11',
        email: payer.email,
      })
      .expect(400);
  });

  it('aprovado: split com a taxa da Comandou, pago sem caixa fica para lançar', async () => {
    const before = fake.orders.size;
    const r = await pub
      .post(`/store/orders/${card.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'paid', card: { brand: 'visa', last4: '1111' } });
    expect(fake.orders.size).toBe(before + 1);
    const sent = [...fake.orders.values()].at(-1)!.body as {
      customer: { tax_id: string; phones: { area: string; number: string }[] };
      charges: {
        amount: { value: number };
        splits: {
          method: string;
          receivers: { account: { id: string }; amount: { value: number } }[];
        };
      }[];
    };
    const totalCents = Math.round(Number(card.total) * 100);
    // 1,5% + R$ 0,30, metade para o par.
    const fee = Math.round((totalCents * 150) / 10_000) + 30;
    expect(sent.customer.tax_id).toBe('52998224725');
    expect(sent.charges[0]!.amount.value).toBe(totalCents);
    expect(sent.charges[0]!.splits).toEqual({
      method: 'FIXED',
      receivers: [
        {
          account: { id: SELLER_ACCOUNT },
          amount: { value: totalCents - fee },
          reason: expect.any(String),
        },
        { account: { id: PLATFORM_ACCOUNT }, amount: { value: fee }, reason: 'Taxa Comandou' },
      ],
    });
    const [ch] = await ownerQuery<{ fee_amount: string; payment_id: string | null }>(
      `SELECT fee_amount::text, payment_id FROM online_charges WHERE order_id = $1 AND status = 'paid'`,
      [card.id],
    );
    expect(Math.round(Number(ch!.fee_amount) * 100)).toBe(fee);
    expect(ch!.payment_id).toBeNull();
    // Depois de pago o cliente não cancela pelo app, nem paga de novo.
    await pub.post(`/store/orders/${card.token}/cancel`, {}).expect(409);
    await pub
      .post(`/store/orders/${card.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(409);
    // Sem aceite automático: a equipe aceita (agora pago).
    await ssend('adminA', 'post', `/orders/${card.id}/status`, { to: 'new' }).expect(201);
  });

  it('o caixa abre e o pagamento entra sozinho, como crédito', async () => {
    const reg = (
      await ssend('adminA', 'post', '/cash-registers', { name: 'Caixa App' }).expect(201)
    ).body;
    sessionId = (
      await ssend('cashierA', 'post', '/cash/sessions', {
        registerId: reg.id,
        openingAmount: '0.00',
      }).expect(201)
    ).body.id;
    await pay.sweep();
    const o = (await sget('cashierA', `/orders/${card.id}`).expect(200)).body;
    expect(o).toMatchObject({ paymentStatus: 'paid', payOnline: 'card' });
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]).toMatchObject({ method: 'credit', amount: card.total });
    expect(o.onlineCharges.find((c: { status: string }) => c.status === 'paid').paymentId).toBe(
      o.payments[0].id,
    );
  });

  it('estorno no caixa vai ao PagBank antes', async () => {
    const o = (await sget('cashierA', `/orders/${card.id}`).expect(200)).body;
    const r = await ssend(
      'adminA',
      'post',
      `/payments/${o.payments[0].id}/refunds`,
      { cashSessionId: sessionId, amount: o.payments[0].amount, reason: 'cliente desistiu' },
      idem(),
    );
    expect(r.status).toBe(201);
    expect(fake.cancels.at(-1)).toMatchObject({
      value: Math.round(Number(card.total) * 100),
      auth: `Bearer ${SELLER_TOKEN}`,
    });
    const [ch] = await ownerQuery<{ status: string }>(
      `SELECT status FROM online_charges WHERE order_id = $1 AND paid_at IS NOT NULL`,
      [card.id],
    );
    expect(ch!.status).toBe('refunded');
  });
});

describe('Cartão sem resposta do PagBank', () => {
  it('a resposta se perde: repete com a mesma chave e acha o pedido, sem cobrar de novo', async () => {
    const o = await placePickup('credit', { payInApp: true });
    fake.lose = 'once';
    const before = fake.orders.size;
    const r = await from('10.9.0.1')
      .post(`/store/orders/${o.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(200);
    fake.lose = null;
    expect(r.body).toMatchObject({ status: 'paid' });
    expect(fake.orders.size).toBe(before + 1);
    const rows = await ownerQuery<{ status: string }>(
      `SELECT status FROM online_charges WHERE order_id = $1`,
      [o.id],
    );
    expect(rows).toEqual([{ status: 'paid' }]);
  });

  it('sem resposta nenhuma: outro cartão espera, o Pix pode, e o cartão que passou é devolvido', async () => {
    const o = await placePickup('credit', { payInApp: true });
    fake.lose = 'always';
    const r = await from('10.9.0.1')
      .post(`/store/orders/${o.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(200);
    fake.lose = null;
    expect(r.body).toMatchObject({ status: 'pending' });
    const [card] = await ownerQuery<{ id: string }>(
      `SELECT id FROM online_charges WHERE order_id = $1`,
      [o.id],
    );
    // Outro cartão agora poderia cobrar duas vezes.
    const again = await from('10.9.0.1').post(`/store/orders/${o.token}/pay/card`, {
      encryptedCard: CARD_OK,
      holderName: 'Bia Pagadora',
      ...payer,
    });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/não cobrar duas vezes/);
    // O Pix fica liberado e o cliente paga por ele.
    const pix = await from('10.9.0.1').post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    const pixId = /pix-(ORDE_[a-f0-9]+)/.exec(pix.body.pix.code)![1]!;
    payPix(pixId);
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: pixId })
      .expect(200);
    // Chega o aviso do cartão que tinha passado: vira "a devolver".
    const cardOrder = fake.orders.get(fake.byIdem.get(card!.id)!)!;
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: cardOrder.id, reference_id: card!.id })
      .expect(200);
    const rows = await ownerQuery<{ method: string; status: string }>(
      `SELECT method, status FROM online_charges WHERE order_id = $1 ORDER BY created_at`,
      [o.id],
    );
    expect(rows).toEqual([
      { method: 'card', status: 'refund_due' },
      { method: 'pix', status: 'paid' },
    ]);
  });
});

describe('Pix pelo app', () => {
  it('QR Code do PagBank, confirmado pelo aviso que só dispara consulta', async () => {
    await ssend('adminA', 'patch', '/store/settings', { autoAccept: true }).expect(200);
    const o = await placePickup('pix');
    expect(o.res).toMatchObject({ status: 'awaiting', payOnline: 'pix', pixStatus: null });
    const r = await pub.post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    expect(r.body).toMatchObject({ method: 'pix', status: 'pending' });
    expect(r.body.pix.code).toMatch(/^00020101021226pix-ORDE_/);
    // Pedir de novo devolve o mesmo QR Code.
    const again = await pub.post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    expect(again.body.pix.code).toBe(r.body.pix.code);
    const pbId = /pix-(ORDE_[a-f0-9]+)/.exec(r.body.pix.code)![1]!;
    // Aviso com corpo falso dizendo "pago": nada muda (a consulta diz que não).
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: pbId, charges: [{ status: 'PAID' }] })
      .expect(200);
    expect((await pub.get(`/store/orders/${o.token}/pay`).expect(200)).body.status).toBe('pending');
    // Aviso no endereço de outro restaurante: não acha a cobrança.
    payPix(pbId);
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_B)
      .send({ id: pbId })
      .expect(200);
    expect((await pub.get(`/store/orders/${o.token}/pay`).expect(200)).body.status).toBe('pending');
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: pbId })
      .expect(200);
    const view = (await pub.get(`/store/orders/${o.token}`).expect(200)).body;
    expect(view.online).toMatchObject({ status: 'paid', method: 'pix' });
    // Aceite automático: pago, vai para a cozinha e entra no caixa aberto, como Pix.
    expect(view.status).not.toBe('awaiting');
    await pay.sweep();
    const staffView = (await sget('cashierA', `/orders/${o.id}`).expect(200)).body;
    expect(staffView.payments[0]).toMatchObject({ method: 'pix' });
    await ssend('adminA', 'patch', '/store/settings', { autoAccept: false }).expect(200);
  });

  it('pedido cancelado com o Pix pago fora do caixa é devolvido sozinho', async () => {
    // Fecha o caixa do teste: o pagamento não entra.
    await ownerQuery(
      `UPDATE cash_sessions SET status = 'closed', closed_at = now() WHERE id = $1`,
      [sessionId],
    );
    const o = await placePickup('pix');
    const r = await pub.post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    const pbId = /pix-(ORDE_[a-f0-9]+)/.exec(r.body.pix.code)![1]!;
    payPix(pbId);
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: pbId })
      .expect(200);
    await ssend('adminA', 'post', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'acabou o produto',
    }).expect(201);
    const [due] = await ownerQuery<{ status: string }>(
      `SELECT status FROM online_charges WHERE order_id = $1 AND paid_at IS NOT NULL`,
      [o.id],
    );
    expect(due!.status).toBe('refund_due');
    const n = fake.cancels.length;
    await pay.sweep();
    expect(fake.cancels.length).toBe(n + 1);
    const [done] = await ownerQuery<{ status: string }>(
      `SELECT status FROM online_charges WHERE order_id = $1 AND paid_at IS NOT NULL`,
      [o.id],
    );
    expect(done!.status).toBe('refunded');
  });

  it('trocou o Pix pelo cartão e pagou o Pix antigo também: o Pix é devolvido, não some', async () => {
    const o = await placePickup('pix');
    const r = await from('10.9.0.2').post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    const pbId = /pix-(ORDE_[a-f0-9]+)/.exec(r.body.pix.code)![1]!;
    // O cliente troca para o cartão (o Pix fica "vencido" aqui, mas o QR Code ainda vale no banco).
    await from('10.9.0.2')
      .post(`/store/orders/${o.token}/pay/card`, {
        encryptedCard: CARD_OK,
        holderName: 'Bia Pagadora',
        ...payer,
      })
      .expect(200);
    payPix(pbId);
    await http
      .post('/api/v1/store/pagbank/notify')
      .set('Host', HOST_A)
      .send({ id: pbId })
      .expect(200);
    const rows = await ownerQuery<{ method: string; status: string }>(
      `SELECT method, status FROM online_charges WHERE order_id = $1 ORDER BY created_at`,
      [o.id],
    );
    expect(rows).toEqual([
      { method: 'pix', status: 'refund_due' },
      { method: 'card', status: 'paid' },
    ]);
    const n = fake.cancels.length;
    await pay.sweep();
    expect(fake.cancels.length).toBe(n + 1);
  });

  it('Pix trocado e pago sem o aviso do PagBank: a conferência acha o pagamento', async () => {
    const o = await placePickup('pix');
    const r = await from('10.9.0.2').post(`/store/orders/${o.token}/pay/pix`, payer).expect(200);
    const pbId = /pix-(ORDE_[a-f0-9]+)/.exec(r.body.pix.code)![1]!;
    // Venceu aqui (troca de forma), mas o cliente paga o QR Code antigo e o aviso se perde.
    await ownerQuery(
      `UPDATE online_charges SET status = 'expired', pix_expires_at = now() + interval '5 minutes'
        WHERE order_id = $1`,
      [o.id],
    );
    payPix(pbId);
    await pay.sweep();
    const [c] = await ownerQuery<{ status: string }>(
      `SELECT status FROM online_charges WHERE order_id = $1`,
      [o.id],
    );
    expect(c!.status).toBe('paid');
  });

  it('sem pagamento em 20 minutos, o pedido cancela sozinho', async () => {
    const o = await placePickup('credit', { payInApp: true });
    await ownerQuery(`UPDATE orders SET created_at = now() - interval '21 minutes' WHERE id = $1`, [
      o.id,
    ]);
    await pay.sweep();
    const view = (await from('10.9.0.2').get(`/store/orders/${o.token}`).expect(200)).body;
    expect(view.status).toBe('cancelled');
    expect(view.cancelReason).toBe('Pagamento não concluído');
  });
});

describe('Relatório e desconexão', () => {
  it('Super Admin vê o restaurante conectado e a taxa do mês; taxa própria vale na hora', async () => {
    const r = await pget('/online-pay').expect(200);
    const a = r.body.tenants.find((t: { id: string }) => t.id === fx.tenantA);
    expect(a).toMatchObject({ connected: true, sellerAccountId: SELLER_ACCOUNT });
    expect(a.month.n).toBeGreaterThanOrEqual(2);
    expect(Number(a.month.fees)).toBeGreaterThan(0);
    await psend('put', `/online-pay/tenants/${fx.tenantA}/fee`, {
      fee: { percent: '0.50', fixed: '0.00' },
    }).expect(200);
    expect((await sget('adminA', '/online-pay').expect(200)).body.fee).toEqual({
      percent: '0.50',
      fixed: '0.00',
    });
  });

  it('desconectar volta o cardápio ao Pix com comprovante', async () => {
    await ssend('cashierA', 'post', '/online-pay/disconnect').expect(403);
    const r = await ssend('adminA', 'post', '/online-pay/disconnect').expect(200);
    expect(r.body.connected).toBe(false);
    expect((await pub.get('/store').expect(200)).body.onlinePay).toBeNull();
  });
});
