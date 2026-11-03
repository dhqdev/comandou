import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { BillingService } from '../src/billing/billing.service';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Cobrança automática (Asaas falso): 7 dias de teste, fatura antes do fim, pagamento pelo webhook
 * soma 30 dias, sem pagamento bloqueia sozinho (só lê, entra e paga), pagar libera; troca para
 * plano maior com diferença proporcional; contrato vencido sem renovação também bloqueia.
 */
const ADMIN_HOST = 'admin.comandou.test';
const HOST_A = 'bl-a.comandou.test';
const HOST_B = 'bl-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const API_KEY = '$aact_chave_de_teste_do_asaas_0123456789';
const DAY = 86_400_000;

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let billing: BillingService;
let cookie = '';
let asaas: Server;
let asaasUrl = '';
let plans: { basic: string; pro: string };

// ---------------------------------------------------------------- Asaas falso
interface FakePayment {
  id: string;
  customer: string;
  status: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
  billingType: string;
  paymentDate?: string | null;
  deleted?: boolean;
}
const fake = {
  customers: [] as { id: string; cpfCnpj: string; name: string }[],
  payments: new Map<string, FakePayment>(),
  webhooks: [] as { url: string; authToken: string }[],
  keys: new Set<string>(),
};
function asaasHandler(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    fake.keys.add(String(req.headers['access_token']));
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.headers['access_token'] !== API_KEY)
      return send(401, { errors: [{ description: 'invalid' }] });
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url!.replace(/^\/v3/, '');
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && url === '/myAccount')
      return send(200, { name: 'Comandou Tecnologia', email: 'x@y' });
    if (req.method === 'GET' && url === '/finance/balance') return send(200, { balance: 123.45 });
    if (req.method === 'POST' && url === '/customers') {
      const c = { id: `cus_${fake.customers.length + 1}`, ...body };
      fake.customers.push(c);
      return send(200, c);
    }
    if (req.method === 'POST' && url === '/payments') {
      const id = `pay_${fake.payments.size + 1}`;
      const p: FakePayment = {
        id,
        customer: body.customer,
        status: 'PENDING',
        value: body.value,
        dueDate: body.dueDate,
        description: body.description,
        externalReference: body.externalReference,
        billingType: body.billingType,
      };
      fake.payments.set(id, p);
      return send(200, {
        ...p,
        invoiceUrl: `https://sandbox.asaas.test/i/${id}`,
        bankSlipUrl: `https://sandbox.asaas.test/b/${id}`,
      });
    }
    if (req.method === 'GET' && (m = url.match(/^\/payments\?externalReference=([^&]+)/))) {
      const ref = decodeURIComponent(m[1]!);
      return send(200, {
        data: [...fake.payments.values()].filter((p) => p.externalReference === ref && !p.deleted),
      });
    }
    if (req.method === 'POST' && (m = url.match(/^\/payments\/([^/]+)\/receiveInCash$/))) {
      const p = fake.payments.get(m[1]!);
      if (!p) return send(404, { errors: [{ description: 'não existe' }] });
      p.status = 'RECEIVED_IN_CASH';
      p.paymentDate = body.paymentDate;
      return send(200, p);
    }
    if ((m = url.match(/^\/payments\/([^/]+)$/))) {
      const p = fake.payments.get(m[1]!);
      if (!p) return send(404, { errors: [{ description: 'não existe' }] });
      if (req.method === 'DELETE') {
        p.deleted = true;
        return send(200, { deleted: true, id: p.id });
      }
      return send(200, { ...p, invoiceUrl: `https://sandbox.asaas.test/i/${p.id}` });
    }
    if ((m = url.match(/^\/payments\/([^/]+)\/pixQrCode$/)))
      return send(200, { encodedImage: 'iVBORw0K', payload: `00020126pix-${m[1]}` });
    if ((m = url.match(/^\/payments\/([^/]+)\/identificationField$/)))
      return send(200, { identificationField: `23793.38128 ${m[1]}` });
    if (req.method === 'POST' && url === '/webhooks') {
      fake.webhooks.push(body);
      return send(200, { id: 'wh_1' });
    }
    send(404, { errors: [{ description: `rota ${url}` }] });
  });
}

// ---------------------------------------------------------------- ajudantes
const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put', url: string, body: object = {}) =>
  http[method](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);
async function tenantLogin(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD })
    .expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}
const tget = (host: string, c: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', host).set('Cookie', c);
const tpost = (host: string, c: string, url: string, b: object) =>
  http.post(`/api/v1${url}`).set('Host', host).set(CSRF).set('Cookie', c).send(b);
const hook = (token: string | undefined, body: object) => {
  const r = http.post('/api/v1/platform/billing/asaas/webhook').set('Host', ADMIN_HOST);
  if (token) r.set('asaas-access-token', token);
  return r.send(body);
};
const sub = async (tenantId: string) =>
  (
    await ownerQuery<{
      status: string;
      plan_id: string;
      trial_ends_at: Date | null;
      current_period_end: Date | null;
      billing_mode: string;
      block_reason: string | null;
    }>(
      `SELECT status, plan_id, trial_ends_at, current_period_end, billing_mode, block_reason
         FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'`,
      [tenantId],
    )
  )[0]!;

const settings = {
  enabled: true,
  environment: 'sandbox',
  apiKey: API_KEY,
  invoiceDaysBefore: 5,
  blockAfterDays: 0,
  upgradeDueDays: 3,
  contractRenewalDays: 30,
  contractGraceDays: 15,
};

beforeAll(async () => {
  fx = await seedTwoTenants('bl');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('cobranca@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  const [basic] = await ownerQuery<{ id: string }>(
    `INSERT INTO plans (code, name, price_monthly, max_products, trial_days)
     VALUES ('bl-basico', 'Básico BL', 90.00, 50, 7) RETURNING id`,
  );
  const [pro] = await ownerQuery<{ id: string }>(
    `INSERT INTO plans (code, name, price_monthly, trial_days, feature_fiscal)
     VALUES ('bl-pro', 'Pro BL', 180.00, 7, true) RETURNING id`,
  );
  plans = { basic: basic!.id, pro: pro!.id };
  await ownerQuery(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now()
      WHERE tenant_id = ANY($1) AND status <> 'cancelled'`,
    [[fx.tenantA, fx.tenantB]],
  );
  // B nasce antes de ligar a cobrança: fica "manual".
  await ownerQuery(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
     VALUES ($1, $2, 'trialing', now() - interval '3 days')`,
    [fx.tenantB, plans.basic],
  );
  await ownerQuery(
    `INSERT INTO tenant_profiles (tenant_id, legal_name, document, billing_email, phone)
     VALUES ($1, 'Restaurante A Ltda', '11222333000181', 'fin@bl-a.test', '11999990000')
     ON CONFLICT (tenant_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, document = EXCLUDED.document`,
    [fx.tenantA],
  );

  asaas = createServer(asaasHandler);
  await new Promise<void>((r) => asaas.listen(0, '127.0.0.1', r));
  asaasUrl = `http://127.0.0.1:${(asaas.address() as AddressInfo).port}/v3`;

  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      ASAAS_BASE_URL: asaasUrl,
      BILLING_INTERVAL_MINUTES: '0',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  billing = app.get(BillingService);
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'cobranca@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  cookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  asaas?.close();
});

describe('Configuração do Asaas no painel', () => {
  it('guarda a chave cifrada, nunca devolve, e testa a conta', async () => {
    await psend('put', '/billing/settings', settings).expect(200);
    const r = await pget('/billing').expect(200);
    expect(r.body.settings.hasApiKey).toBe(true);
    expect(r.body.settings.keyReadable).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(API_KEY);
    const [row] = await ownerQuery<{ k: Buffer }>(
      `SELECT api_key_enc AS k FROM platform_billing_settings`,
    );
    expect(row!.k.toString('latin1')).not.toContain('aact');
    const t = await psend('post', '/billing/test').expect(200);
    expect(t.body).toMatchObject({ ok: true, accountName: 'Comandou Tecnologia', balance: 123.45 });
  });

  it('registra o webhook no Asaas com o token guardado', async () => {
    await ownerQuery(
      `UPDATE platform_contract_settings SET notify_email = 'david@comandou.test' WHERE id`,
    );
    const r = await psend('post', '/billing/webhook/register').expect(200);
    expect(r.body.url).toMatch(/\/api\/v1\/platform\/billing\/asaas\/webhook$/);
    const tok = await psend('post', '/billing/webhook/token').expect(200);
    expect(fake.webhooks[0]!.authToken).toBe(tok.body.token);
    expect(tok.body.token.length).toBeGreaterThanOrEqual(32);
  });
});

describe('Ciclo: 7 dias de teste, pagou +30 dias, não pagou bloqueia', () => {
  let trialEnd: Date;
  let ownerA = '';
  let token = '';
  let firstPay = '';

  it('assinatura nova com o Asaas ligado já nasce em cobrança automática', async () => {
    await ownerQuery(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
       VALUES ($1, $2, 'trialing', now() + interval '7 days')`,
      [fx.tenantA, plans.basic],
    );
    expect((await sub(fx.tenantA)).billing_mode).toBe('asaas');
    expect((await sub(fx.tenantB)).billing_mode).toBe('manual');
    trialEnd = (await sub(fx.tenantA)).trial_ends_at!;
    ownerA = await tenantLogin(HOST_A, 'admin@bl-a.test');
    token = (await psend('post', '/billing/webhook/token').expect(200)).body.token;
  });

  it('a fatura sai 5 dias antes do fim do teste e vence no último dia', async () => {
    await billing.runCycle(new Date(trialEnd.getTime() - 6 * DAY));
    expect(fake.payments.size).toBe(0);
    await billing.runCycle(new Date(trialEnd.getTime() - 4 * DAY));
    expect(fake.payments.size).toBe(1);
    // Rodar de novo não duplica.
    await billing.runCycle(new Date(trialEnd.getTime() - 3 * DAY));
    expect(fake.payments.size).toBe(1);
    const p = [...fake.payments.values()][0]!;
    firstPay = p.id;
    expect(p.value).toBe(90);
    expect(p.billingType).toBe('UNDEFINED');
    expect(fake.customers[0]).toMatchObject({ cpfCnpj: '11222333000181' });
    // Restaurante manual não recebe cobrança nem bloqueio, mesmo com teste vencido.
    expect((await sub(fx.tenantB)).block_reason).toBeNull();
  });

  it('o restaurante vê quanto falta, a fatura e paga por Pix ou boleto', async () => {
    const r = await tget(HOST_A, ownerA, '/subscription/billing').expect(200);
    expect(r.body.subscription.status).toBe('trialing');
    expect(r.body.subscription.daysLeft).toBe(7);
    expect(r.body.billing.auto).toBe(true);
    expect(r.body.invoices).toHaveLength(1);
    expect(r.body.invoices[0].status).toBe('pending');
    const pay = await tget(
      HOST_A,
      ownerA,
      `/subscription/invoices/${r.body.invoices[0].id}/pay`,
    ).expect(200);
    expect(pay.body.pix.payload).toContain(firstPay);
    expect(pay.body.boleto.line).toContain(firstPay);
    // B não enxerga a fatura de A.
    const ownerB = await tenantLogin(HOST_B, 'admin@bl-b.test');
    await tget(HOST_B, ownerB, `/subscription/invoices/${r.body.invoices[0].id}/pay`).expect(404);
    const nb = await tget(HOST_B, ownerB, '/subscription/billing').expect(200);
    expect(nb.body.invoices).toHaveLength(0);
  });

  it('webhook sem token é recusado; pagamento confirmado soma 30 dias uma vez só', async () => {
    const ev = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: firstPay } };
    await hook(undefined, ev).expect(403);
    await hook('token-errado-'.padEnd(43, 'x'), ev).expect(403);
    fake.payments.get(firstPay)!.status = 'RECEIVED';
    fake.payments.get(firstPay)!.billingType = 'PIX';
    await hook(token, ev).expect(200);
    const s1 = await sub(fx.tenantA);
    expect(s1.status).toBe('active');
    expect(s1.current_period_end!.getTime()).toBe(trialEnd.getTime() + 30 * DAY);
    const dup = await hook(token, ev).expect(200);
    expect(dup.body.duplicate).toBe(true);
    await hook(token, { ...ev, id: 'evt_2', event: 'PAYMENT_CONFIRMED' }).expect(200);
    expect((await sub(fx.tenantA)).current_period_end!.getTime()).toBe(
      trialEnd.getTime() + 30 * DAY,
    );
    const r = await tget(HOST_A, ownerA, '/subscription/billing').expect(200);
    expect(r.body.invoices[0]).toMatchObject({ status: 'paid', billingType: 'PIX' });
  });

  it('não pagou até o fim: bloqueia sozinho, só lê e paga; pagou, libera na hora', async () => {
    const end = (await sub(fx.tenantA)).current_period_end!;
    await billing.runCycle(new Date(end.getTime() + 60_000));
    const s = await sub(fx.tenantA);
    expect(s.block_reason).toBe('payment');
    expect(s.status).toBe('past_due');
    const product = { categoryId: fx.catA, name: 'Bloqueado', price: '10.00' };
    const blocked = await tpost(HOST_A, ownerA, '/products', product).expect(403);
    expect(blocked.body.code).toBe('billing_blocked');
    // Venda nova fica bloqueada (pedido e comanda)...
    const newOrder = await tpost(HOST_A, ownerA, '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(403);
    expect(newOrder.body.code).toBe('billing_blocked');
    await tpost(HOST_A, ownerA, '/tabs', { customerName: 'Bloqueio' }).expect(403);
    // ...mas o que termina a venda já feita passa do bloqueio (aqui cai no 404 do pedido).
    const none = '00000000-0000-4000-8000-000000000000';
    const moved = await tpost(HOST_A, ownerA, `/orders/${none}/status`, { to: 'ready' });
    expect(moved.status).not.toBe(403);
    const fiscal = await tpost(HOST_A, ownerA, `/fiscal/documents/${none}/print`, {});
    expect(fiscal.status).not.toBe(403);
    // Ler e entrar continuam funcionando.
    await tget(HOST_A, ownerA, '/products').expect(200);
    await tenantLogin(HOST_A, 'admin@bl-a.test');
    const n = await tget(HOST_A, ownerA, '/subscription/notice').expect(200);
    expect(n.body.level).toBe('blocked');
    // Loja online também não aceita pedido (qualquer gravação).
    const second = [...fake.payments.values()].find((p) => p.id !== firstPay)!;
    expect(second.value).toBe(90);
    second.status = 'RECEIVED';
    await hook(token, {
      id: 'evt_3',
      event: 'PAYMENT_RECEIVED',
      payment: { id: second.id },
    }).expect(200);
    const after = await sub(fx.tenantA);
    expect(after.block_reason).toBeNull();
    expect(after.status).toBe('active');
    expect(after.current_period_end!.getTime()).toBe(end.getTime() + 30 * DAY);
    await tpost(HOST_A, ownerA, '/products', product).expect(201);
  });

  it('subir de plano: só o administrador, vale na hora e cobra a diferença proporcional', async () => {
    const waiter = await tenantLogin(HOST_A, 'garcom@bl-a.test');
    await tpost(HOST_A, waiter, '/subscription/upgrade', { planId: plans.pro }).expect(403);
    const q = await tget(HOST_A, ownerA, `/subscription/plans/${plans.pro}/quote`).expect(200);
    expect(q.body.days).toBeGreaterThan(0);
    const r = await tpost(HOST_A, ownerA, '/subscription/upgrade', { planId: plans.pro }).expect(
      200,
    );
    expect(r.body.charge).toBe(q.body.amount);
    expect((await sub(fx.tenantA)).plan_id).toBe(plans.pro);
    const inv = await ownerQuery<{ kind: string; amount: string; status: string }>(
      `SELECT kind, amount::text AS amount, status FROM billing_invoices
        WHERE tenant_id = $1 AND kind = 'upgrade'`,
      [fx.tenantA],
    );
    expect(inv[0]).toMatchObject({ kind: 'upgrade', amount: q.body.amount, status: 'pending' });
    await tpost(HOST_A, ownerA, '/subscription/upgrade', { planId: plans.basic }).expect(409);
  });

  it('painel: baixa manual e cancelamento de fatura', async () => {
    const [inv] = await ownerQuery<{ id: string }>(
      `SELECT id FROM billing_invoices WHERE tenant_id = $1 AND kind = 'upgrade'`,
      [fx.tenantA],
    );
    const [sent] = await ownerQuery<{ provider_id: string }>(
      `SELECT provider_id FROM billing_invoices WHERE id = $1`,
      [inv!.id],
    );
    await psend('post', `/billing/invoices/${inv!.id}/paid`).expect(200);
    // A baixa vai também para o Asaas: o cliente não recebe mais a cobrança.
    expect(fake.payments.get(sent!.provider_id)!.status).toBe('RECEIVED_IN_CASH');
    // Conferir no Asaas depois mantém a baixa.
    await billing.sync(inv!.id);
    expect(
      (await ownerQuery(`SELECT status FROM billing_invoices WHERE id = $1`, [inv!.id]))[0],
    ).toMatchObject({ status: 'paid' });
    await psend('post', `/billing/invoices/${inv!.id}/cancel`).expect(409);
    const v = await pget(`/billing/tenants/${fx.tenantA}`).expect(200);
    expect(v.body.invoices.find((i: { id: string }) => i.id === inv!.id).status).toBe('paid');
    const o = await pget('/billing').expect(200);
    expect(o.body.tenants.find((t: { id: string }) => t.id === fx.tenantA).billingMode).toBe(
      'asaas',
    );
  });
});

describe('Baixa sem depender só do webhook', () => {
  let token = '';
  let monthly = '';
  let payId = '';
  let before = 0;

  it('envio que caiu no meio não cria cobrança em dobro no Asaas', async () => {
    token = (await psend('post', '/billing/webhook/token').expect(200)).body.token;
    const [s] = await ownerQuery<{ id: string }>(
      `SELECT id FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'`,
      [fx.tenantA],
    );
    const [inv] = await ownerQuery<{ id: string }>(
      `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, description, amount, due_date,
                                     environment, last_error)
       VALUES ($1, $2, 'manual', 'Avulsa que caiu', 25.00, current_date + 3, 'sandbox', 'timeout')
       RETURNING id`,
      [fx.tenantA, s!.id],
    );
    // O Asaas chegou a criar a cobrança, mas a resposta se perdeu.
    const orphan = `pay_${fake.payments.size + 1}`;
    fake.payments.set(orphan, {
      id: orphan,
      customer: fake.customers[0]!.id,
      status: 'PENDING',
      value: 25,
      dueDate: '2099-01-01',
      description: 'Avulsa que caiu',
      externalReference: inv!.id,
      billingType: 'UNDEFINED',
    });
    const size = fake.payments.size;
    await billing.runCycle();
    expect(fake.payments.size).toBe(size);
    const [row] = await ownerQuery<{ provider_id: string; last_error: string | null }>(
      `SELECT provider_id, last_error FROM billing_invoices WHERE id = $1`,
      [inv!.id],
    );
    expect(row).toMatchObject({ provider_id: orphan, last_error: null });
  });

  it('webhook perdido: o ciclo confere no Asaas e libera os 30 dias', async () => {
    before = (await sub(fx.tenantA)).current_period_end!.getTime();
    await psend('post', `/billing/tenants/${fx.tenantA}/charge`).expect(200);
    const [inv] = await ownerQuery<{ id: string; provider_id: string }>(
      `SELECT id, provider_id FROM billing_invoices
        WHERE tenant_id = $1 AND kind = 'monthly' AND status = 'pending'`,
      [fx.tenantA],
    );
    monthly = inv!.id;
    payId = inv!.provider_id;
    fake.payments.get(payId)!.status = 'RECEIVED';
    fake.payments.get(payId)!.paymentDate = new Date().toISOString().slice(0, 10);
    // Nenhum aviso chega; só o ciclo.
    const r = await billing.runCycle();
    expect(r!.synced).toBeGreaterThanOrEqual(1);
    const [row] = await ownerQuery<{ status: string }>(
      `SELECT status FROM billing_invoices WHERE id = $1`,
      [monthly],
    );
    expect(row!.status).toBe('paid');
    expect((await sub(fx.tenantA)).current_period_end!.getTime()).toBe(before + 30 * DAY);
  });

  it('estorno depois de pago tira os 30 dias que o pagamento liberou', async () => {
    fake.payments.get(payId)!.status = 'REFUNDED';
    await hook(token, {
      id: 'evt_refund',
      event: 'PAYMENT_REFUNDED',
      payment: { id: payId },
    }).expect(200);
    expect((await sub(fx.tenantA)).current_period_end!.getTime()).toBe(before);
    const [row] = await ownerQuery<{ status: string; applied_at: Date | null }>(
      `SELECT status, applied_at FROM billing_invoices WHERE id = $1`,
      [monthly],
    );
    expect(row).toMatchObject({ status: 'refunded', applied_at: null });
    const audit = await ownerQuery(
      `SELECT 1 FROM platform_audit_log WHERE action = 'platform.billing_payment_reverted' AND entity_id = $1`,
      [monthly],
    );
    expect(audit).toHaveLength(1);
  });

  it('aviso que chega antes de gravar o id da cobrança acha a fatura pelo externalReference', async () => {
    const [s] = await ownerQuery<{ id: string }>(
      `SELECT id FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'`,
      [fx.tenantA],
    );
    const [inv] = await ownerQuery<{ id: string }>(
      `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, description, amount, due_date, environment)
       VALUES ($1, $2, 'manual', 'Avulsa corrida', 30.00, current_date + 3, 'sandbox') RETURNING id`,
      [fx.tenantA, s!.id],
    );
    const id = `pay_${fake.payments.size + 1}`;
    fake.payments.set(id, {
      id,
      customer: fake.customers[0]!.id,
      status: 'CONFIRMED',
      value: 30,
      dueDate: '2099-01-01',
      description: 'Avulsa corrida',
      externalReference: inv!.id,
      billingType: 'CREDIT_CARD',
    });
    await hook(token, {
      id: 'evt_race',
      event: 'PAYMENT_CONFIRMED',
      payment: { id, externalReference: inv!.id },
    }).expect(200);
    const [row] = await ownerQuery<{ status: string; provider_id: string }>(
      `SELECT status, provider_id FROM billing_invoices WHERE id = $1`,
      [inv!.id],
    );
    expect(row).toMatchObject({ status: 'paid', provider_id: id });
  });
});

describe('Contrato reassinado todo ano', () => {
  it('contrato vencido sem renovação bloqueia depois da tolerância; o novo libera', async () => {
    const [c] = await ownerQuery<{ id: string }>(
      `INSERT INTO tenant_contracts (tenant_id, number, status, content, content_hash, pdf, pdf_sha256,
                                     signed_pdf, signed_pdf_sha256, signed_at, valid_until)
       VALUES ($1, 'CMD-2025-0999', 'signed', '{}', repeat('a', 64), '\\x00', repeat('b', 64),
               '\\x00', repeat('c', 64), now() - interval '1 year', current_date - 20)
       RETURNING id`,
      [fx.tenantB],
    );
    await billing.runCycle();
    expect((await sub(fx.tenantB)).block_reason).toBe('contract');
    const ownerB = await tenantLogin(HOST_B, 'admin@bl-b.test');
    const r = await tpost(HOST_B, ownerB, '/products', {
      categoryId: fx.catB,
      name: 'X',
      price: '1.00',
    }).expect(403);
    expect(r.body.reason).toBe('contract');
    await ownerQuery(
      `INSERT INTO tenant_contracts (tenant_id, number, status, content, content_hash, pdf, pdf_sha256,
                                     signed_pdf, signed_pdf_sha256, signed_at, valid_until)
       VALUES ($1, 'CMD-2024-0998', 'signed', '{}', repeat('a', 64), '\\x00', repeat('b', 64),
               '\\x00', repeat('c', 64), now(), current_date + 360)`,
      [fx.tenantB],
    );
    await billing.refresh(fx.tenantB);
    expect((await sub(fx.tenantB)).block_reason).toBeNull();
    expect(c).toBeTruthy();
  });
});
