import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ChannelFinanceService } from '../src/integrations/channels/channel-finance.service';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelOutboxService } from '../src/integrations/channels/channel-outbox.service';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
import { ChannelUsageService } from '../src/integrations/channels/channel-usage.service';
import { testEnv } from './env';
import { FakeIfoodServer, ifoodSample } from './fake-ifood';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Pedidos do iFood de ponta a ponta (ADR 0015, Fase 2) contra um iFood falso: a loja ligada no
 * cardápio entra nos canais, o polling leva x-polling-merchants e faz ack do que gravou, o pedido
 * entra com os valores do iFood e o pago no app fora da gaveta, as ações do Comandou viram as
 * chamadas da Order API, o cancelamento do iFood zera o pago no app e o token vencido é renovado.
 */
const HOST_A = 'io-a.comandou.test';
const HOST_B = 'io-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const MERCHANT = 'abcd1111-2222-4333-8444-555555555555';
const OTHER_MERCHANT = 'ffff1111-2222-4333-8444-555555555555';

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let ifood: FakeIfoodServer;
let poller: ChannelPoller;
let inbox: ChannelInboxService;
let outbox: ChannelOutboxService;
let storeRef = '';
const cookies: Record<string, string> = {};

const hostOf = (who: string) => (who.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (method: 'post' | 'patch', w: string, url: string, body?: object) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body ?? {});

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

async function waitFor(check: () => Promise<boolean> | boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Uma rodada de polling e o tratamento do que chegou (o que a varredura faria). */
async function cycle() {
  const s = await poller.tick();
  await waitFor(async () => {
    await inbox.process(fx.tenantA);
    const [r] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM channel_inbox
        WHERE tenant_id = $1 AND status = 'pending'
          AND (next_attempt_at <= now() OR last_error IS NULL)`,
      [fx.tenantA],
    );
    return r!.n === 0;
  });
  return s;
}

/** Espera a caixa de saída mandar tudo o que está na fila. */
async function flush() {
  await waitFor(async () => {
    await outbox.deliver(fx.tenantA);
    const [r] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_outbox WHERE tenant_id = $1 AND status IN ('pending','sending')`,
      [fx.tenantA],
    );
    return r!.n === 0;
  });
}

const orderOf = async (externalId: string) => {
  const [o] = await ownerQuery<{
    id: string;
    status: string;
    total: string;
    discount: string;
    paid_amount: string;
    payment_status: string;
    external_code: string;
    confirm_by: Date | null;
  }>(
    `SELECT o.id, o.status, o.total::text, o.discount::text, o.paid_amount::text, o.payment_status,
            o.external_code, c.confirm_by
       FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE o.tenant_id = $1 AND c.external_id = $2`,
    [fx.tenantA, externalId],
  );
  return o!;
};

const ID = (n: number) => `0e0e0e0e-0000-4000-8000-00000000000${n}`;
const placed = (n: number, ev = `ev-plc-${n}`) =>
  ifood.push({ id: ev, code: 'PLC', fullCode: 'PLACED', orderId: ID(n), merchantId: MERCHANT });
const event = (n: number, code: string, fullCode: string, ev: string) =>
  ifood.push({ id: ev, code, fullCode, orderId: ID(n), merchantId: MERCHANT });
const sample = (n: number, over: Parameters<typeof ifoodSample>[0] = {}) =>
  ifood.orders.set(
    ID(n),
    ifoodSample({
      id: ID(n),
      displayId: `48${n}0`,
      createdAt: new Date().toISOString(),
      merchant: { id: MERCHANT.toUpperCase(), name: 'Loja iFood' },
      ...over,
    }),
  );

beforeAll(async () => {
  ifood = new FakeIfoodServer();
  await ifood.start();
  ifood.merchants.set(MERCHANT, 'Loja iFood A');
  ifood.merchants.set(OTHER_MERCHANT, 'Loja iFood B');
  fx = await seedTwoTenants('io');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      IFOOD_API_URL: ifood.url,
      IFOOD_CLIENT_ID: 'cliente-ifood',
      IFOOD_CLIENT_SECRET: 'segredo-ifood',
      CHANNELS_POLL_MIN_SECONDS: '0',
      CHANNELS_LEASE_SECONDS: '5',
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  poller = app.get(ChannelPoller);
  inbox = app.get(ChannelInboxService);
  outbox = app.get(ChannelOutboxService);
  cookies.adminA = await login(HOST_A, 'admin@io-a.test');
  cookies.adminB = await login(HOST_B, 'admin@io-b.test');
});
afterAll(async () => {
  await app?.close();
  await ifood?.stop();
  // As lojas deste arquivo saem do polling: os outros arquivos contam as credenciais do banco todo.
  if (fx)
    await ownerQuery(
      `UPDATE channel_store_claims SET receive_orders = false WHERE tenant_id = ANY($1::uuid[])`,
      [[fx.tenantA, fx.tenantB]],
    );
});

describe('iFood: loja nos canais', () => {
  it('a loja ligada no iFood aparece em Aplicativos de delivery, sem receber pedidos ainda', async () => {
    await send('post', 'adminA', '/ifood/connections', { merchantId: MERCHANT }).expect(201);
    const view = (await get('adminA', '/channels').expect(200)).body as {
      channels: {
        id: string;
        available: boolean;
        stores: { id: string; storeId: string; receiveOrders: boolean }[];
      }[];
    };
    const card = view.channels.find((c) => c.id === 'ifood')!;
    expect(card.available).toBe(true);
    expect(card.stores).toHaveLength(1);
    expect(card.stores[0]).toMatchObject({ storeId: MERCHANT, receiveOrders: false });
    storeRef = card.stores[0]!.id;
    // Sem "Receber pedidos", a loja nem entra no polling.
    placed(9, 'ev-cedo');
    await poller.tick();
    expect(ifood.polls).toHaveLength(0);
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, { receiveOrders: true }).expect(
      200,
    );
    // Outro restaurante não vê a loja.
    const b = (await get('adminB', '/channels').expect(200)).body as {
      channels: { id: string; stores: unknown[] }[];
    };
    expect(b.channels.find((c) => c.id === 'ifood')!.stores).toHaveLength(0);
  });

  it('loja ligada antes (só cardápio) entra nos canais ao abrir a tela', async () => {
    await send('post', 'adminB', '/ifood/connections', { merchantId: OTHER_MERCHANT }).expect(201);
    // Simula uma loja de antes da Fase 2: some da camada de canais.
    await ownerQuery(`DELETE FROM channel_stores WHERE tenant_id = $1`, [fx.tenantB]);
    await ownerQuery(`DELETE FROM channel_store_claims WHERE tenant_id = $1`, [fx.tenantB]);
    const b = (await get('adminB', '/channels').expect(200)).body as {
      channels: { id: string; stores: { storeId: string }[] }[];
    };
    expect(b.channels.find((c) => c.id === 'ifood')!.stores.map((s) => s.storeId)).toEqual([
      OTHER_MERCHANT,
    ]);
    const [claim] = await ownerQuery<{ credential: string }>(
      `SELECT credential FROM channel_store_claims WHERE channel = 'ifood' AND store_id = $1`,
      [OTHER_MERCHANT],
    );
    expect(claim!.credential).toBe('ifood:central');
  });
});

describe('iFood: pedido pago no aplicativo', () => {
  it('chega sozinho, em análise, com os valores do iFood e o pago fora do caixa', async () => {
    sample(9);
    sample(1);
    placed(1);
    const sum = await cycle();
    expect(sum.polled).toBe(1);
    // x-polling-merchants com a loja e ack do que foi gravado.
    expect(ifood.polls.at(-1)!.merchants).toBe(MERCHANT);
    expect(ifood.acked('ev-plc-1')).toBe(true);
    expect(ifood.acked('ev-cedo')).toBe(true);
    expect(ifood.lookups.get(ID(1))).toBe(1);
    const o = await orderOf(ID(1));
    expect(o).toMatchObject({
      status: 'awaiting',
      total: '64.79',
      discount: '3.00',
      paid_amount: '64.79',
      payment_status: 'paid',
      external_code: '4810',
    });
    // Prazo do iFood para aceitar: 8 minutos.
    expect(o.confirm_by!.getTime() - Date.now()).toBeGreaterThan(7 * 60_000);
    const pays = await ownerQuery<{
      method: string;
      app_method: string;
      app_brand: string;
      cash_session_id: string | null;
      created_by: string | null;
    }>(
      `SELECT method, app_method, app_brand, cash_session_id, created_by FROM payments WHERE order_id = $1`,
      [o.id],
    );
    expect(pays).toEqual([
      {
        method: 'app',
        app_method: 'credit',
        app_brand: 'VISA',
        cash_session_id: null,
        created_by: null,
      },
    ]);
    const [mov] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM cash_movements WHERE order_id = $1`,
      [o.id],
    );
    expect(mov!.n).toBe(0);
    // Na tela do pedido: "Pago no iFood".
    const d = (await get('adminA', `/orders/${o.id}`).expect(200)).body as {
      payments: { method: string; appChannel: string; appMethod: string }[];
    };
    expect(d.payments[0]).toMatchObject({
      method: 'app',
      appChannel: 'ifood',
      appMethod: 'credit',
    });
  });

  it('itens e valores de pedido do iFood não mudam no Comandou', async () => {
    const o = await orderOf(ID(1));
    const d = (await get('adminA', `/orders/${o.id}`).expect(200)).body as {
      items: { id: string }[];
    };
    await send('patch', 'adminA', `/orders/${o.id}/adjustments`, {
      discount: '10.00',
      reason: 'teste de desconto',
    }).expect(409);
    await send('post', 'adminA', `/orders/${o.id}/items/${d.items[0]!.id}/cancel`, {
      reason: 'teste',
    }).expect(409);
  });

  it('aceitar no Comandou confirma no iFood; o CONFIRMED marca a ação como confirmada', async () => {
    const o = await orderOf(ID(1));
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    await flush();
    expect(ifood.actions.filter((a) => a.orderId === ID(1)).map((a) => a.verb)).toEqual([
      'confirm',
    ]);
    event(1, 'CFM', 'CONFIRMED', 'ev-cfm-1');
    await cycle();
    const [row] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
      [o.id],
    );
    expect(row!.status).toBe('confirmed');
  });

  it('preparo e pronto vão para o iFood; entregador do iFood leva e o iFood conclui', async () => {
    const o = await orderOf(ID(1));
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'in_production' }).expect(201);
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await flush();
    expect(ifood.actions.filter((a) => a.orderId === ID(1)).map((a) => a.verb)).toEqual([
      'confirm',
      'startPreparation',
      'readyToPickup',
    ]);
    event(1, 'DSP', 'DISPATCHED', 'ev-dsp-1');
    event(1, 'CON', 'CONCLUDED', 'ev-con-1');
    await cycle();
    expect((await orderOf(ID(1))).status).toBe('completed');
    // Entrega do iFood: o Comandou não manda "saiu" nem "entregue".
    expect(ifood.actions.some((a) => a.orderId === ID(1) && a.verb === 'dispatch')).toBe(false);
  });
});

describe('iFood: dinheiro na entrega e cancelamentos', () => {
  it('token vencido: pede outro e segue; dinheiro na entrega deixa só o cupom do iFood como pago', async () => {
    sample(2, {
      benefits: [
        { value: 5, target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'IFOOD', value: 5 }] },
      ],
      total: { subTotal: 61.8, deliveryFee: 5, benefits: 5, orderAmount: 61.8 },
      payments: {
        prepaid: 0,
        pending: 61.8,
        methods: [
          {
            value: 61.8,
            method: 'CASH',
            type: 'OFFLINE',
            prepaid: false,
            cash: { changeFor: 100 },
          },
        ],
      },
      delivery: { deliveredBy: 'MERCHANT', deliveryAddress: { formattedAddress: 'Rua B, 20' } },
    });
    const before = ifood.tokensIssued;
    ifood.expireToken();
    placed(2);
    await cycle();
    expect(ifood.tokensIssued).toBe(before + 1);
    const o = await orderOf(ID(2));
    // Total do Comandou 66,80; o iFood paga 5,00 (frete grátis dele); o cliente paga 61,80 na entrega.
    expect(o).toMatchObject({ total: '66.80', paid_amount: '5.00', payment_status: 'partial' });
    const [co] = await ownerQuery<{ change_for: string; prepaid: boolean; delivered_by: string }>(
      `SELECT change_for::text, prepaid, delivered_by FROM channel_orders WHERE order_id = $1`,
      [o.id],
    );
    expect(co).toEqual({ change_for: '100.00', prepaid: false, delivered_by: 'merchant' });
  });

  it('recusar no Comandou: pede o cancelamento ao iFood com o código e zera o pago no app', async () => {
    const o = await orderOf(ID(2));
    await send('post', 'adminA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'Acabou o pão',
    }).expect(201);
    const after = await orderOf(ID(2));
    expect(after).toMatchObject({
      status: 'cancelled',
      paid_amount: '0.00',
      payment_status: 'unpaid',
    });
    await flush();
    const call = ifood.actions.find((a) => a.orderId === ID(2))!;
    expect(call.verb).toBe('requestCancellation');
    expect(call.body).toEqual({ reason: 'Acabou o pão', cancellationCode: '509' });
    event(2, 'CAN', 'CANCELLED', 'ev-can-2');
    await cycle();
    expect((await orderOf(ID(2))).status).toBe('cancelled');
  });

  it('cancelado pelo iFood depois de aceito: cancela, devolve o estoque e zera o pago no app', async () => {
    sample(3);
    placed(3);
    await cycle();
    const o = await orderOf(ID(3));
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    event(3, 'CAN', 'CANCELLED', 'ev-can-3');
    await cycle();
    expect(await orderOf(ID(3))).toMatchObject({
      status: 'cancelled',
      paid_amount: '0.00',
      payment_status: 'unpaid',
    });
    const [p] = await ownerQuery<{ amount: string; refunded_amount: string; refunds: number }>(
      `SELECT p.amount::text, p.refunded_amount::text,
              (SELECT count(*)::int FROM payment_refunds r WHERE r.payment_id = p.id) AS refunds
         FROM payments p WHERE p.order_id = $1`,
      [o.id],
    );
    expect(p).toEqual({ amount: '64.79', refunded_amount: '64.79', refunds: 0 });
  });

  it('evento que o Comandou não conhece: ack e fica ignorado', async () => {
    ifood.push({
      id: 'ev-novo',
      code: 'XPTO',
      fullCode: 'ALGUM_EVENTO_NOVO',
      orderId: ID(3),
      merchantId: MERCHANT,
    });
    await cycle();
    expect(ifood.acked('ev-novo')).toBe(true);
    const [r] = await ownerQuery<{ status: string }>(
      `SELECT status FROM channel_inbox WHERE event_id = 'ev-novo'`,
    );
    expect(r!.status).toBe('ignored');
  });

  it('nunca passa de 10 consultas do mesmo pedido', async () => {
    placed(4);
    // O iFood não acha o pedido: cada tentativa conta.
    for (let i = 0; i < 14; i++) {
      await poller.tick();
      await ownerQuery(
        `UPDATE channel_inbox SET next_attempt_at = now() WHERE tenant_id = $1 AND status = 'pending'`,
        [fx.tenantA],
      );
      await inbox.process(fx.tenantA);
    }
    expect(ifood.lookups.get(ID(4))).toBeLessThanOrEqual(10);
  });
});

describe('iFood: motivo do cancelamento, cancelamento negado e negociação', () => {
  const inFive = () => new Date(Date.now() + 5 * 60_000).toISOString();
  const dispute = (ev: string, meta: Record<string, unknown>) =>
    ifood.push({
      id: ev,
      code: 'HSD',
      fullCode: 'HANDSHAKE_DISPUTE',
      orderId: ID(5),
      merchantId: MERCHANT,
      metadata: meta,
    });
  const disputesOf = async (orderId: string) =>
    (await get('adminA', `/orders/${orderId}`).expect(200)).body.app.disputes as {
      id: string;
      kind: string;
      status: string;
      message: string | null;
      timeoutAction: string | null;
      alternatives: { id: string; type: string; maxAmount?: string; minutes?: number[] }[];
      acceptReasons: string[];
      outcome: string | null;
    }[];

  it('motivos por pedido vêm do iFood; o código escolhido vai no pedido de cancelamento', async () => {
    sample(5);
    placed(5);
    await cycle();
    const o = await orderOf(ID(5));
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    await send('post', 'adminA', `/orders/${o.id}/status`, { to: 'in_production' }).expect(201);
    await flush();
    ifood.cancelReasons.set(ID(5), [
      { cancelCodeId: '503', description: 'ITEM INDISPONIVEL' },
      { cancelCodeId: '<script>', description: 'código estranho fica de fora' },
    ]);
    const r = await get('adminA', `/channels/orders/${o.id}/cancel-reasons`).expect(200);
    expect(r.body.reasons).toEqual([{ code: '503', label: 'Item indisponivel' }]);
    // Código fora do formato nem passa da validação.
    await send('post', 'adminA', `/orders/${o.id}/status`, {
      to: 'cancel_requested',
      channelReason: '<script>',
    }).expect(400);
    await send('post', 'adminA', `/orders/${o.id}/status`, {
      to: 'cancel_requested',
      reason: 'Acabou o queijo',
      channelReason: '503',
    }).expect(201);
    await flush();
    const call = ifood.actions.find((a) => a.orderId === ID(5) && a.verb === 'requestCancellation');
    expect(call!.body).toEqual({ reason: 'Acabou o queijo', cancellationCode: '503' });
  });

  it('o iFood nega o cancelamento: o pedido volta para onde estava', async () => {
    event(5, 'CARF', 'CANCELLATION_REQUEST_FAILED', 'ev-carf-5');
    await cycle();
    const o = await orderOf(ID(5));
    expect(o.status).toBe('in_production');
    const [h] = await ownerQuery<{ reason: string }>(
      `SELECT reason FROM order_status_history WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
      [o.id],
    );
    expect(h!.reason).toMatch(/cancelamento negado/);
  });

  it('depois da negativa, pedir o cancelamento de novo chega ao iFood', async () => {
    const o = await orderOf(ID(5));
    const before = ifood.actions.filter(
      (a) => a.orderId === ID(5) && a.verb === 'requestCancellation',
    ).length;
    await send('post', 'adminA', `/orders/${o.id}/status`, {
      to: 'cancel_requested',
      reason: 'Acabou o queijo de novo',
      channelReason: '503',
    }).expect(201);
    await flush();
    const calls = ifood.actions.filter(
      (a) => a.orderId === ID(5) && a.verb === 'requestCancellation',
    );
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)!.body).toEqual({
      reason: 'Acabou o queijo de novo',
      cancellationCode: '503',
    });
  });

  it('negociação aberta aparece no pedido com prazo, alternativas e motivos (sem dados do cliente)', async () => {
    dispute('ev-hsd-1', {
      disputeId: 'disp-1',
      action: 'CANCELLATION',
      message: 'Demorou demais',
      timeoutAction: 'ACCEPT_CANCELLATION',
      expiresAt: inFive(),
      evidences: [{ url: 'https://foto.example/cliente.jpg' }],
      alternatives: [
        { id: 'alt-1', type: 'REFUND', metadata: { maxAmount: { value: 1000, currency: 'BRL' } } },
        {
          id: 'alt-2',
          type: 'ADDITIONAL_TIME',
          metadata: {
            allowedsAdditionalTimeInMinutes: [10, 20],
            allowedsAdditionalTimeReasons: ['HIGH_STORE_DEMAND'],
          },
        },
      ],
      metadata: { acceptCancellationReasons: ['CUSTOMER_REQUEST'] },
    });
    // Repetido (mesmo id de evento) não abre outra.
    await cycle();
    const o = await orderOf(ID(5));
    const [d] = await disputesOf(o.id);
    expect(d).toMatchObject({
      kind: 'CANCELLATION',
      status: 'open',
      message: 'Demorou demais',
      timeoutAction: 'ACCEPT_CANCELLATION',
      acceptReasons: ['CUSTOMER_REQUEST'],
      alternatives: [
        { id: 'alt-1', type: 'REFUND', maxAmount: '10.00' },
        { id: 'alt-2', type: 'ADDITIONAL_TIME', minutes: [10, 20] },
      ],
    });
    const [raw] = await ownerQuery<{ payload: unknown }>(
      `SELECT payload FROM channel_inbox WHERE event_id = 'ev-hsd-1'`,
    );
    expect(JSON.stringify(raw!.payload)).not.toContain('foto.example');
    const detail = await get('adminA', `/orders/${o.id}`).expect(200);
    expect(detail.body.appDisputeUntil).toBeTruthy();
  });

  it('a pessoa propõe um reembolso dentro do limite; responder de novo não vale', async () => {
    const o = await orderOf(ID(5));
    const [d] = await disputesOf(o.id);
    const url = `/channels/disputes/${d!.id}/decision`;
    await send('post', 'adminA', url, { decision: 'accept' }).expect(422);
    await send('post', 'adminA', url, {
      decision: 'alternative',
      alternativeId: 'alt-1',
      amount: '15.00',
    }).expect(422);
    await send('post', 'adminA', url, {
      decision: 'alternative',
      alternativeId: 'alt-9',
      amount: '5.00',
    }).expect(422);
    await send('post', 'adminA', url, {
      decision: 'alternative',
      alternativeId: 'alt-1',
      amount: '8.50',
    }).expect(200);
    await send('post', 'adminA', url, { decision: 'reject', reason: 'Não' }).expect(409);
    await flush();
    expect(ifood.disputeCalls).toEqual([
      {
        disputeId: 'disp-1',
        verb: 'alternatives',
        altId: 'alt-1',
        body: { type: 'REFUND', metadata: { amount: { value: '850', currency: 'BRL' } } },
      },
    ]);
    // O iFood encerra: fica "resolvido" e a ação, confirmada.
    ifood.push({
      id: 'ev-hss-1',
      code: 'HSS',
      fullCode: 'HANDSHAKE_SETTLEMENT',
      orderId: ID(5),
      merchantId: MERCHANT,
      metadata: { disputeId: 'disp-1', status: 'ALTERNATIVE_ACCEPTED' },
    });
    await cycle();
    const [after] = await disputesOf(o.id);
    expect(after).toMatchObject({ status: 'settled', outcome: 'ALTERNATIVE_ACCEPTED' });
    const [act] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'dispute_alternative'`,
      [o.id],
    );
    expect(act!.status).toBe('confirmed');
    expect((await get('adminA', `/orders/${o.id}`)).body.appDisputeUntil).toBeNull();
  });

  it('recusar manda o motivo; prazo vencido não aceita resposta; outro restaurante não vê', async () => {
    dispute('ev-hsd-2', {
      disputeId: 'disp-2',
      action: 'PARTIAL_CANCELLATION',
      expiresAt: inFive(),
    });
    dispute('ev-hsd-3', {
      disputeId: 'disp-3',
      action: 'CANCELLATION',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await cycle();
    const o = await orderOf(ID(5));
    const list = await disputesOf(o.id);
    const d2 = list.find((d) => d.kind === 'PARTIAL_CANCELLATION')!;
    const d3 = list.find((d) => d.status === 'open' && d.kind === 'CANCELLATION')!;
    await send('post', 'adminB', `/channels/disputes/${d2.id}/decision`, {
      decision: 'reject',
      reason: 'x',
    }).expect(404);
    await send('post', 'adminA', `/channels/disputes/${d2.id}/decision`, {
      decision: 'reject',
      reason: '',
    }).expect(400);
    await send('post', 'adminA', `/channels/disputes/${d2.id}/decision`, {
      decision: 'reject',
      reason: 'O pedido já saiu para entrega',
    }).expect(200);
    await send('post', 'adminA', `/channels/disputes/${d3.id}/decision`, {
      decision: 'accept',
    }).expect(409);
    await flush();
    expect(ifood.disputeCalls.at(-1)).toEqual({
      disputeId: 'disp-2',
      verb: 'reject',
      body: { reason: 'O pedido já saiu para entrega' },
    });
  });
});

describe('iFood: loja aberta, fechada ou pausada', () => {
  type StoreView = {
    id: string;
    channelState: string | null;
    stateTitle: string | null;
    stateError: string | null;
    pausedHere: boolean;
    pauseUntil: string | null;
    pauseReason: string | null;
    pauseByStore: boolean;
    followStoreOpen: boolean;
    openingHours: { day: number; start: string; minutes: number }[] | null;
  };
  const storeA = async () =>
    (
      (await get('adminA', '/channels').expect(200)).body as {
        channels: { id: string; stores: StoreView[] }[];
      }
    ).channels
      .find((c) => c.id === 'ifood')!
      .stores.find((s) => s.id === storeRef)!;
  const stale = () =>
    ownerQuery(`UPDATE channel_stores SET state_at = NULL WHERE id = $1`, [storeRef]);
  const pauses = () => ifood.interruptions.get(MERCHANT) ?? [];

  it('lê a situação e os horários do iFood, no máximo uma vez por minuto', async () => {
    ifood.status.set(MERCHANT, [
      { operation: 'TAKEOUT', available: false, state: 'CLOSED' },
      {
        operation: 'DELIVERY',
        salesChannel: 'IFOOD',
        available: true,
        state: 'WARNING',
        message: { title: 'Loja aberta', subtitle: 'Raio de entrega reduzido' },
        validations: [{ id: 'is-connected', state: 'OK' }],
      },
    ]);
    ifood.hours.set(MERCHANT, {
      storeId: MERCHANT,
      shifts: [{ dayOfWeek: 'MONDAY', start: '10:00:00', duration: 720 }],
    });
    // Horários: no máximo a cada 6 horas (a primeira tela já leu, vazio).
    await ownerQuery(`UPDATE channel_stores SET hours_at = NULL WHERE id = $1`, [storeRef]);
    await stale();
    const before = ifood.statusReads;
    const s = await storeA();
    expect(s).toMatchObject({
      channelState: 'warning',
      stateTitle: 'Loja aberta',
      stateError: null,
      followStoreOpen: true,
      openingHours: [{ day: 1, start: '10:00', minutes: 720 }],
    });
    await storeA();
    expect(ifood.statusReads - before).toBe(1);
  });

  it('pausar só no iFood cria a interrupção; reabrir tira a pausa', async () => {
    await send('post', 'adminA', `/channels/stores/${storeRef}/pause`, {
      minutes: 30,
      reason: 'x',
    }).expect(400);
    const r = await send('post', 'adminA', `/channels/stores/${storeRef}/pause`, {
      minutes: 30,
      reason: 'Falta de gás',
    }).expect(200);
    expect(pauses()).toHaveLength(1);
    const p = pauses()[0]!;
    expect(p.description).toBe('Falta de gás');
    const mins = (Date.parse(p.end) - Date.parse(p.start)) / 60_000;
    expect(Math.round(mins)).toBe(30);
    expect(r.body.until).toBe(p.end);
    ifood.status.set(MERCHANT, [{ operation: 'DELIVERY', available: false, state: 'CLOSED' }]);
    await stale();
    expect(await storeA()).toMatchObject({
      channelState: 'paused',
      pausedHere: true,
      pauseReason: 'Falta de gás',
      pauseByStore: false,
    });
    ifood.status.set(MERCHANT, [{ operation: 'DELIVERY', available: true, state: 'OK' }]);
    await send('post', 'adminA', `/channels/stores/${storeRef}/resume`).expect(200);
    expect(pauses()).toHaveLength(0);
    expect(await storeA()).toMatchObject({
      channelState: 'open',
      pausedHere: false,
      pauseUntil: null,
    });
  });

  it('fechar a loja no Comandou pausa no iFood (até 7 dias); reabrir tira a pausa', async () => {
    await send('patch', 'adminA', '/store/settings', { isOpen: false }).expect(200);
    await waitFor(() => pauses().length === 1);
    const p = pauses()[0]!;
    expect(p.description).toBe('Loja fechada no Comandou');
    expect(Math.round((Date.parse(p.end) - Date.parse(p.start)) / 3_600_000)).toBe(7 * 24);
    await waitFor(async () => (await storeA()).pauseByStore);
    await send('patch', 'adminA', '/store/settings', { isOpen: true }).expect(200);
    await waitFor(() => pauses().length === 0);
    await waitFor(async () => !(await storeA()).pausedHere);
  });

  it('pausa feita no portal fica; quem desliga "seguir a loja" não pausa junto', async () => {
    // Pausa do próprio restaurante no portal: o Comandou mostra, mas não tira ao reabrir.
    const end = new Date(Date.now() + 3600_000).toISOString();
    pauses().push({
      id: 'portal-1',
      description: 'Fechado para reforma',
      start: new Date().toISOString(),
      end,
    });
    ifood.status.set(MERCHANT, [{ operation: 'DELIVERY', available: false, state: 'CLOSED' }]);
    await stale();
    expect(await storeA()).toMatchObject({
      channelState: 'paused',
      pausedHere: false,
      pauseReason: 'Fechado para reforma',
      pauseUntil: end,
    });
    await send('patch', 'adminA', `/channels/stores/${storeRef}`, {
      followStoreOpen: false,
    }).expect(200);
    const calls = ifood.interruptionCalls.length;
    await send('patch', 'adminA', '/store/settings', { isOpen: false }).expect(200);
    await send('patch', 'adminA', '/store/settings', { isOpen: true }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(ifood.interruptionCalls.length).toBe(calls);
    expect(pauses().map((x) => x.id)).toEqual(['portal-1']);
    pauses().length = 0;
  });

  it('iFood fora do ar: guarda o aviso sem repetir; pausa recusada vira mensagem clara', async () => {
    ifood.failNext.status!.push(503);
    await stale();
    const s = await storeA();
    expect(s.stateError).toMatch(/Não deu para ler a situação/);
    ifood.failNext.pause!.push(400);
    const r = await send('post', 'adminA', `/channels/stores/${storeRef}/pause`, {
      minutes: 15,
      reason: 'Muitos pedidos',
    }).expect(409);
    expect(r.body.message).toMatch(/recusou \(400\)/);
    // O PDV vê a situação das lojas que recebem pedidos; o garçom não pausa.
    const pdv = await get('adminA', '/channels/stores/state').expect(200);
    expect(pdv.body).toHaveLength(1);
    expect(pdv.body[0]).toMatchObject({ id: storeRef, channel: 'ifood' });
  });
});

describe('iFood: entrega', () => {
  type DriverView = {
    deliveredBy: string;
    status: string | null;
    name: string | null;
    vehicle: string | null;
    eta: string | null;
    pickupEta: string | null;
    fee: string | null;
    pickupCode: string | null;
    canRequest: boolean;
    canCancel: boolean;
  };
  const driverOf = async (orderId: string, who = 'adminA') =>
    (await get(who, `/channels/orders/${orderId}/driver`).expect(200)).body as DriverView;
  const delivery = (n: number, code: string, fullCode: string, ev: string, meta = {}) =>
    ifood.push({ id: ev, code, fullCode, orderId: ID(n), merchantId: MERCHANT, metadata: meta });
  let courierId = '';

  /** Pedido aceito e pronto no Comandou. */
  const readyOrder = async (n: number, deliveredBy: 'IFOOD' | 'MERCHANT') => {
    sample(n, {
      delivery: { ...ifoodSample().delivery!, deliveredBy },
    } as Parameters<typeof ifoodSample>[0]);
    placed(n);
    await cycle();
    const o = await orderOf(ID(n));
    for (const to of ['new', 'in_production', 'ready'])
      await send('post', 'adminA', `/orders/${o.id}/status`, { to }).expect(201);
    await flush();
    return o.id;
  };

  beforeAll(async () => {
    const c = await send('post', 'adminA', '/couriers', { name: 'Motoboy da Loja' }).expect(201);
    courierId = c.body.id;
  });

  it('entregador do iFood: quem vem, quando chega e o código de coleta; o motoboy da loja não sai', async () => {
    const id = await readyOrder(6, 'IFOOD');
    delivery(6, 'ADR', 'ASSIGN_DRIVER', 'ev-adr-6', {
      workerName: 'João da Silva',
      workerPhone: '11999990000',
      workerVehicleType: 'MOTORCYCLE',
    });
    delivery(6, 'AAO', 'ARRIVED_AT_ORIGIN', 'ev-aao-6');
    await cycle();
    // Evento atrasado não volta a situação.
    delivery(6, 'GTO', 'GOING_TO_ORIGIN', 'ev-gto-6');
    await cycle();
    const eta = new Date(Date.now() + 25 * 60_000).toISOString();
    ifood.tracking.set(ID(6), { expectedDelivery: eta, latitude: -23.5, longitude: -46.6 });
    const reads = ifood.trackingReads;
    const d = await driverOf(id);
    expect(d).toMatchObject({
      deliveredBy: 'channel',
      status: 'at_store',
      name: 'João',
      vehicle: 'Moto',
      eta,
      pickupCode: '7788',
      canRequest: false,
      canCancel: false,
    });
    // No máximo uma leitura do rastreio a cada 30 s.
    await driverOf(id);
    expect(ifood.trackingReads - reads).toBe(1);
    // Nada do telefone do entregador guardado.
    const [row] = await ownerQuery<Record<string, unknown>>(
      `SELECT * FROM channel_orders WHERE order_id = $1`,
      [id],
    );
    expect(JSON.stringify(row)).not.toContain('99999');
    const order = (await get('adminA', `/orders/${id}`).expect(200)).body;
    expect(order.appDriverStatus).toBe('at_store');
    // O motoboy da loja não leva pedido do entregador do iFood (nem aparece para ele pegar).
    const r = await send('post', 'adminA', `/orders/${id}/dispatch`, { courierId }).expect(409);
    expect(r.body.message).toMatch(/entregador do aplicativo/);
    // Outro restaurante não vê.
    await get('adminB', `/channels/orders/${id}/driver`).expect(404);
  });

  it('entrega da loja: chamar entregador do iFood com a cotação guardada e cancelar', async () => {
    const id = await readyOrder(7, 'MERCHANT');
    expect(await driverOf(id)).toMatchObject({
      deliveredBy: 'merchant',
      status: null,
      canRequest: true,
    });
    ifood.quotes.set(ID(7), {
      id: 'quote-7',
      quote: { grossValue: 9.99, netValue: 8.49 },
      deliveryTime: { min: 1200, max: 1800 },
      distance: 2300,
      expirationAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const q = await send('post', 'adminA', `/channels/orders/${id}/driver/quote`).expect(200);
    expect(q.body).toMatchObject({ id: 'quote-7', fee: '8.49', minMinutes: 20, maxMinutes: 30 });
    // Cotação que não é a guardada não vale.
    await send('post', 'adminA', `/channels/orders/${id}/driver`, { quoteId: 'outra' }).expect(409);
    await send('post', 'adminA', `/channels/orders/${id}/driver`, { quoteId: 'quote-7' }).expect(
      200,
    );
    expect(
      ifood.shippingCalls.find((c) => c.orderId === ID(7) && c.verb === 'requestDriver')?.body,
    ).toEqual({ quoteId: 'quote-7' });
    expect(await driverOf(id)).toMatchObject({
      status: 'requested',
      fee: '8.49',
      canRequest: false,
      canCancel: true,
    });
    // Com entregador do iFood chamado, o motoboy da loja não sai.
    await send('post', 'adminA', `/orders/${id}/dispatch`, { courierId }).expect(409);
    // O iFood achou alguém.
    delivery(7, 'ADR', 'ASSIGN_DRIVER', 'ev-adr-7', {
      workerName: 'Ana',
      workerVehicleType: 'BICYCLE',
    });
    await cycle();
    expect(await driverOf(id)).toMatchObject({
      status: 'assigned',
      name: 'Ana',
      vehicle: 'Bicicleta',
    });
    // Cancelar o entregador: vai o motivo; depois o motoboy da loja pode sair.
    await send('post', 'adminA', `/channels/orders/${id}/driver/cancel`, { reason: '' }).expect(
      400,
    );
    await send('post', 'adminA', `/channels/orders/${id}/driver/cancel`, {
      reason: 'Meu entregador vai levar',
    }).expect(200);
    expect(
      ifood.shippingCalls.find((c) => c.orderId === ID(7) && c.verb === 'cancelRequestDriver')
        ?.body,
    ).toEqual({ reason: 'Meu entregador vai levar' });
    expect(await driverOf(id)).toMatchObject({ status: 'cancelled', fee: null, canRequest: true });
    await send('post', 'adminA', `/orders/${id}/dispatch`, { courierId }).expect(201);
    await flush();
    // Saiu com o motoboy da loja: o iFood fica sabendo.
    expect(ifood.actions.some((a) => a.orderId === ID(7) && a.verb === 'dispatch')).toBe(true);
    // Depois que saiu, não dá para chamar entregador.
    await send('post', 'adminA', `/channels/orders/${id}/driver/quote`).expect(409);
  });

  it('iFood sem entregador ou sem Sob Demanda: mensagem clara, sem repetir; aviso de falha', async () => {
    const id = await readyOrder(8, 'MERCHANT');
    const before = ifood.shippingCalls.length;
    const r = await send('post', 'adminA', `/channels/orders/${id}/driver/quote`).expect(422);
    expect(r.body.message).toMatch(/recusou \(400\)/);
    ifood.failNext.shipping!.push(403);
    const r2 = await send('post', 'adminA', `/channels/orders/${id}/driver/quote`).expect(409);
    expect(r2.body.message).toMatch(/Sob Demanda/);
    ifood.failNext.shipping!.push(503);
    const r3 = await send('post', 'adminA', `/channels/orders/${id}/driver/quote`).expect(422);
    expect(r3.body.message).toMatch(/não respondeu/);
    // Uma chamada por clique (4xx e 5xx não se repetem aqui).
    expect(ifood.shippingCalls.length - before).toBe(1);
    // O iFood avisa que não achou entregador: fica na tela e dá para chamar de novo.
    await ownerQuery(`UPDATE channel_orders SET driver_status = 'requested' WHERE order_id = $1`, [
      id,
    ]);
    delivery(8, 'RDF', 'REQUEST_DRIVER_FAILED', 'ev-rdf-8');
    await cycle();
    expect(await driverOf(id)).toMatchObject({ status: 'request_failed', canRequest: true });
    // Aviso de entrega de pedido que não está aqui: ack e ignora.
    ifood.push({
      id: 'ev-adr-x',
      code: 'ADR',
      fullCode: 'ASSIGN_DRIVER',
      orderId: '0e0e0e0e-0000-4000-8000-0000000000ff',
      merchantId: MERCHANT,
    });
    await cycle();
    expect(ifood.acked('ev-adr-x')).toBe(true);
    const [ig] = await ownerQuery<{ status: string }>(
      `SELECT status FROM channel_inbox WHERE event_id = 'ev-adr-x'`,
    );
    expect(ig!.status).toBe('ignored');
  });
});

describe('iFood: repasse', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const plus = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const entryOf = async (payoutId: string) => {
    const [r] = await ownerQuery<{
      id: string;
      status: string;
      amount: string;
      due: string;
      category: string;
      counterparty: string;
      description: string;
    }>(
      `SELECT e.id, e.status, e.amount::text, to_char(e.due_date, 'YYYY-MM-DD') AS due, e.category,
              e.counterparty, e.description
         FROM channel_payouts p JOIN finance_entries e ON e.id = p.entry_id WHERE p.id = $1`,
      [payoutId],
    );
    return r!;
  };
  const settlement = (amount: number, date: string, status: string, over = {}) => ({
    startDateCalculation: plus(-14),
    endDateCalculation: plus(-8),
    closingItems: [
      {
        type: 'REPASSE',
        originalPaymentAmount: amount,
        originalPaymentDate: date,
        status,
        accountDetails: {
          bankName: 'Banco X',
          accountNumber: '12345-6',
          document: '12.345.678/0001-90',
        },
        ...over,
      },
    ],
  });

  it('lê vendas e repasses do iFood, guarda o que cada pedido rende e cria a conta a receber', async () => {
    const id6 = (await orderOf(ID(6))).id;
    const id7 = (await orderOf(ID(7))).id;
    ifood.sales.set(MERCHANT, [
      {
        id: ID(6),
        shortId: '4860',
        createdAt: new Date().toISOString(),
        saleGrossValue: { bag: 61.8, deliveryFee: 5, serviceFee: 0.99 },
        benefits: { totalValue: 5 },
        billingSummary: {
          saleBalance: 52.1,
          billingEntries: [
            { type: 'COMMISSION', value: -8 },
            { type: 'PAYMENT_FEE', value: -2.07 },
            { type: 'PROMOTION', value: -4.63 },
          ],
        },
      },
      // Venda que o iFood ainda não fechou: saldo 0 e sem lançamentos.
      {
        id: ID(7),
        saleGrossValue: { bag: 61.8, deliveryFee: 5 },
        billingSummary: { saleBalance: 0, billingEntries: [] },
      },
      // Pedido que não passou pelo Comandou: ignorado.
      { id: 'fora-do-comandou', saleGrossValue: { bag: 10 }, billingSummary: { saleBalance: 8 } },
    ]);
    ifood.settlements.set(MERCHANT, [
      settlement(310.5, plus(-10), 'PAID'),
      settlement(420.75, plus(5), 'SCHEDULED', {
        type: 'ANTECIPACAO',
        anticipatedPaymentAmount: 410.2,
        anticipatedPaymentDate: plus(2),
        feeAmount: 10.55,
      }),
    ]);
    const r = await send('post', 'adminA', '/channels/finance/refresh').expect(200);
    expect(r.body.read).toBe(1);
    const sales = ifood.financeCalls.find((c) => c.kind === 'sales')!;
    expect(sales.query).toMatchObject({ beginSalesDate: plus(-7), endSalesDate: today, page: '1' });
    const sett = ifood.financeCalls.find((c) => c.kind === 'settlements')!;
    expect(sett.query).toEqual({ beginPaymentDate: plus(-35), endPaymentDate: plus(35) });

    // O que o pedido rende (só com a permissão do Financeiro; outro restaurante não vê).
    const f6 = (await get('adminA', `/channels/orders/${id6}/finance`).expect(200)).body;
    expect(f6).toMatchObject({ gross: '66.80', net: '52.10', fees: '14.70' });
    expect(f6.entries).toEqual([
      { label: 'Comissão do iFood', amount: '-8.00' },
      { label: 'Taxa de pagamento', amount: '-2.07' },
      { label: 'Promoção da loja', amount: '-4.63' },
    ]);
    const f7 = (await get('adminA', `/channels/orders/${id7}/finance`).expect(200)).body;
    expect(f7).toMatchObject({ gross: '66.80', net: null, fees: null });
    await get('adminB', `/channels/orders/${id6}/finance`).expect(404);

    // Repasses: nada da conta bancária guardado; cada um vira conta a receber "Repasse de vendas".
    const rows = await ownerQuery<Record<string, unknown>>(
      `SELECT * FROM channel_payouts WHERE tenant_id = $1 ORDER BY expected_date`,
      [fx.tenantA],
    );
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/12345-6|Banco X|0001-90/);
    const view = (
      await get('adminA', `/channels/finance?from=${plus(-30)}&to=${plus(30)}`).expect(200)
    ).body as {
      payouts: {
        id: string;
        amount: string;
        status: string;
        expectedDate: string;
        entryStatus: string;
        originalDate: string | null;
        anticipationFee: string | null;
      }[];
      sales: { channel: string; closed: number; net: string; fees: string }[];
      stores: { financeAt: string | null; financeError: string | null }[];
    };
    const [early, late] = [...view.payouts].sort((a, b) =>
      a.expectedDate.localeCompare(b.expectedDate),
    );
    expect(early).toMatchObject({ amount: '310.50', status: 'paid', expectedDate: plus(-10) });
    // Antecipado: cai antes, com o valor antecipado e a taxa da antecipação.
    expect(late).toMatchObject({
      amount: '410.20',
      status: 'scheduled',
      expectedDate: plus(2),
      originalDate: plus(5),
      anticipationFee: '10.55',
    });
    // Pago pelo iFood há mais de 2 dias: baixa sozinha; o agendado fica a receber.
    expect(await entryOf(early!.id)).toMatchObject({
      status: 'paid',
      amount: '310.50',
      due: plus(-10),
      category: 'Repasse de vendas',
      counterparty: 'iFood',
    });
    const lateEntry = await entryOf(late!.id);
    expect(lateEntry).toMatchObject({ status: 'open', amount: '410.20', due: plus(2) });
    expect(lateEntry.description).toMatch(/^Antecipação iFood .* · Loja iFood A$/);
    expect(view.sales.find((s) => s.channel === 'ifood')).toMatchObject({
      closed: 1,
      net: '52.10',
      fees: '14.70',
    });
    expect(view.stores[0]).toMatchObject({ financeError: null });
    expect(view.stores[0]!.financeAt).toBeTruthy();

    // Atualizar de novo logo em seguida: não chama o iFood (no máximo a cada 5 minutos).
    const calls = ifood.financeCalls.length;
    expect((await send('post', 'adminA', '/channels/finance/refresh').expect(200)).body.read).toBe(
      0,
    );
    expect(ifood.financeCalls.length).toBe(calls);
    // Outro restaurante não vê os repasses.
    const b = (
      await get('adminB', `/channels/finance?from=${plus(-30)}&to=${plus(30)}`).expect(200)
    ).body as { payouts: unknown[] };
    expect(b.payouts).toHaveLength(0);
    await get('adminA', `/channels/finance?from=${plus(1)}&to=${plus(-1)}`).expect(400);
  });

  it('o iFood mudou o valor do repasse: troca a conta aberta; repasse que falhou cancela', async () => {
    const [late] = await ownerQuery<{ id: string; entry_id: string }>(
      `SELECT id, entry_id FROM channel_payouts WHERE tenant_id = $1 AND status = 'scheduled'`,
      [fx.tenantA],
    );
    ifood.settlements.set(MERCHANT, [
      settlement(310.5, plus(-10), 'PAID'),
      settlement(420.75, plus(5), 'SCHEDULED', {
        type: 'ANTECIPACAO',
        anticipatedPaymentAmount: 405.9,
        anticipatedPaymentDate: plus(2),
        feeAmount: 14.85,
      }),
    ]);
    await ownerQuery(
      `UPDATE channel_stores SET finance_at = now() - interval '7 hours' WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    await app.get(ChannelFinanceService).refreshTenant(fx.tenantA);
    const [old] = await ownerQuery<{ status: string; cancel_reason: string }>(
      `SELECT status, cancel_reason FROM finance_entries WHERE id = $1`,
      [late!.entry_id],
    );
    expect(old).toMatchObject({ status: 'cancelled' });
    expect(old!.cancel_reason).toMatch(/mudou o valor/);
    expect(await entryOf(late!.id)).toMatchObject({ status: 'open', amount: '405.90' });
    // Mesmo repasse lido de novo, sem mudança: não cria outra conta.
    const [{ n: before }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance_entries WHERE tenant_id = $1 AND category = 'Repasse de vendas'`,
      [fx.tenantA],
    );
    await ownerQuery(`UPDATE channel_stores SET finance_at = NULL WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    await app.get(ChannelFinanceService).refreshTenant(fx.tenantA);
    const [{ n: after }] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM finance_entries WHERE tenant_id = $1 AND category = 'Repasse de vendas'`,
      [fx.tenantA],
    );
    expect(after).toBe(before);
    // O iFood avisou que não pagou: a conta aberta é cancelada.
    ifood.settlements.set(MERCHANT, [
      settlement(310.5, plus(-10), 'PAID'),
      settlement(420.75, plus(5), 'FAILED', {
        type: 'ANTECIPACAO',
        anticipatedPaymentAmount: 405.9,
        anticipatedPaymentDate: plus(2),
        feeAmount: 14.85,
      }),
    ]);
    await ownerQuery(`UPDATE channel_stores SET finance_at = NULL WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    await app.get(ChannelFinanceService).refreshTenant(fx.tenantA);
    const e = await entryOf(late!.id);
    expect(e.status).toBe('cancelled');
    // A conta já paga não muda.
    const [paid] = await ownerQuery<{ status: string }>(
      `SELECT e.status FROM channel_payouts p JOIN finance_entries e ON e.id = p.entry_id
        WHERE p.tenant_id = $1 AND p.status = 'paid'`,
      [fx.tenantA],
    );
    expect(paid!.status).toBe('paid');
  });

  it('erro do iFood fica na loja e não para a varredura; DRE com a venda e a taxa do aplicativo', async () => {
    ifood.failNext.finance!.push(500, 500);
    await ownerQuery(`UPDATE channel_stores SET finance_at = NULL WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    await app.get(ChannelFinanceService).refreshTenant(fx.tenantA);
    const [st] = await ownerQuery<{ finance_error: string | null }>(
      `SELECT finance_error FROM channel_stores WHERE tenant_id = $1 AND channel = 'ifood'`,
      [fx.tenantA],
    );
    expect(st!.finance_error).toMatch(/financeiro/);

    const dre = (await get('adminA', `/finance/dre?from=${today}&to=${today}`).expect(200))
      .body as {
      dre: { lines: { id: string; value: string }[] };
    };
    const line = (id: string) => dre.dre.lines.find((l) => l.id === id)?.value;
    const [{ total }] = await ownerQuery<{ total: string }>(
      `SELECT COALESCE(sum(amount - refunded_amount), 0)::numeric(14,2)::text AS total
         FROM payments WHERE tenant_id = $1 AND method = 'app'`,
      [fx.tenantA],
    );
    expect(Number(total)).toBeGreaterThan(0);
    expect(line('sales_app_ifood')).toBe(total);
    expect(line('app_fees')).toBe('-14.70');
  });
});

describe('iFood: avaliações', () => {
  type Review = {
    id: string;
    externalId: string;
    orderId: string | null;
    displayCode: string | null;
    score: number;
    comment: string | null;
    customerName: string | null;
    canReply: boolean;
    reply: string | null;
    replyFrom: string | null;
    repliedByName: string | null;
  };
  const list = async (pending = false) =>
    (await get('adminA', `/channels/reviews${pending ? '?pending=1' : ''}`).expect(200)).body as {
      reviews: Review[];
      stores: {
        score: number | null;
        count: number | null;
        pending: number;
        error: string | null;
      }[];
    };
  const reread = async () => {
    await ownerQuery(`UPDATE channel_stores SET reviews_at = NULL WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    await send('post', 'adminA', '/channels/reviews/refresh').expect(200);
  };

  it('lê as avaliações, liga ao pedido e guarda só o primeiro nome do cliente', async () => {
    const id6 = (await orderOf(ID(6))).id;
    ifood.reviews.set(MERCHANT, [
      {
        id: 'rev-1',
        score: 2,
        comment: 'A pizza chegou fria',
        customerName: 'Maria Cliente Silva',
        createdAt: new Date().toISOString(),
        status: 'NOT_REPLIED',
        order: { id: ID(6), shortId: '4860' },
        replies: [],
      },
      {
        id: 'rev-2',
        score: 5,
        comment: 'Tudo ótimo',
        customerName: 'João',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        status: 'REPLIED',
        order: { id: ID(1), shortId: '4810' },
        replies: [{ text: 'Obrigado!', from: 'MERCHANT', createdAt: new Date().toISOString() }],
      },
      {
        id: 'rev-3',
        score: 4,
        createdAt: new Date().toISOString(),
        status: 'CREATED',
        order: { id: 'fora-do-comandou', shortId: '9999' },
      },
    ]);
    ifood.reviewSummary.set(MERCHANT, { score: 4.3, validReviewsCount: 12 });
    const r = await send('post', 'adminA', '/channels/reviews/refresh').expect(200);
    expect(r.body.read).toBe(1);
    const call = ifood.reviewCalls.find((c) => c.kind === 'reviews')!;
    expect(call.query).toMatchObject({ page: '1', pageSize: '50', sort: 'DESC' });
    const since = Date.now() - Date.parse(call.query.dateFrom!);
    expect(Math.round(since / 86_400_000)).toBe(30);

    const v = await list();
    expect(v.reviews.map((x) => x.externalId).sort()).toEqual(['rev-1', 'rev-2', 'rev-3']);
    const r1 = v.reviews.find((x) => x.externalId === 'rev-1')!;
    expect(r1).toMatchObject({
      orderId: id6,
      displayCode: '4860',
      score: 2,
      comment: 'A pizza chegou fria',
      customerName: 'Maria',
      canReply: true,
      reply: null,
    });
    expect(v.reviews.find((x) => x.externalId === 'rev-2')).toMatchObject({
      reply: 'Obrigado!',
      replyFrom: 'portal',
      canReply: false,
    });
    expect(v.reviews.find((x) => x.externalId === 'rev-3')).toMatchObject({
      orderId: null,
      displayCode: '9999',
      canReply: false,
    });
    expect(v.stores[0]).toMatchObject({ score: 4.3, count: 12, pending: 1, error: null });
    expect((await list(true)).reviews.map((x) => x.externalId)).toEqual(['rev-1']);
    const rows = await ownerQuery(`SELECT * FROM channel_reviews WHERE tenant_id = $1`, [
      fx.tenantA,
    ]);
    expect(JSON.stringify(rows)).not.toContain('Silva');
    // Na gaveta do pedido.
    const o = (await get('adminA', `/channels/orders/${id6}/reviews`).expect(200)).body as Review[];
    expect(o.map((x) => x.externalId)).toEqual(['rev-1']);
    // Outro restaurante não vê.
    expect(
      ((await get('adminB', '/channels/reviews').expect(200)).body as { reviews: unknown[] })
        .reviews,
    ).toHaveLength(0);
    // Logo em seguida não lê de novo.
    const n = ifood.reviewCalls.length;
    expect((await send('post', 'adminA', '/channels/reviews/refresh').expect(200)).body.read).toBe(
      0,
    );
    expect(ifood.reviewCalls.length).toBe(n);
  });

  it('resposta escrita por uma pessoa vai ao iFood uma vez; a leitura seguinte não apaga', async () => {
    const r1 = (await list()).reviews.find((x) => x.externalId === 'rev-1')!;
    await send('post', 'adminA', `/channels/reviews/${r1.id}/reply`, { text: 'curta' }).expect(400);
    await send('post', 'adminB', `/channels/reviews/${r1.id}/reply`, {
      text: 'Resposta de outro restaurante',
    }).expect(404);
    const text = 'Sentimos muito, Maria! Vamos rever a embalagem para chegar quentinha.';
    await send('post', 'adminA', `/channels/reviews/${r1.id}/reply`, { text }).expect(200);
    expect(ifood.reviewAnswers).toEqual([
      { merchant: MERCHANT, reviewId: 'rev-1', body: { text } },
    ]);
    const after = (await list()).reviews.find((x) => x.id === r1.id)!;
    expect(after).toMatchObject({
      reply: text,
      replyFrom: 'comandou',
      canReply: false,
      repliedByName: expect.any(String),
    });
    await send('post', 'adminA', `/channels/reviews/${r1.id}/reply`, { text }).expect(409);
    expect(ifood.reviewAnswers).toHaveLength(1);
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'channel.review_replied'`,
      [fx.tenantA],
    );
    expect(audit!.n).toBe(1);
    // Avaliação que não aceita resposta (CREATED) não vai ao iFood.
    const r3 = (await list()).reviews.find((x) => x.externalId === 'rev-3')!;
    await send('post', 'adminA', `/channels/reviews/${r3.id}/reply`, { text }).expect(409);
    await reread();
    expect((await list()).reviews.find((x) => x.id === r1.id)).toMatchObject({
      reply: text,
      replyFrom: 'comandou',
    });
  });

  it('respondida no portal antes: 409 do iFood marca como respondida; erro de leitura fica na loja', async () => {
    ifood.reviews.get(MERCHANT)!.push({
      id: 'rev-4',
      score: 3,
      createdAt: new Date().toISOString(),
      status: 'NOT_REPLIED',
    });
    await reread();
    const r4 = (await list()).reviews.find((x) => x.externalId === 'rev-4')!;
    expect(r4.canReply).toBe(true);
    ifood.reviews.get(MERCHANT)!.find((x) => x.id === 'rev-4')!.status = 'REPLIED';
    const res = await send('post', 'adminA', `/channels/reviews/${r4.id}/reply`, {
      text: 'Obrigado pela avaliação!',
    }).expect(409);
    expect(res.body.message).toMatch(/já foi respondida/);
    expect((await list()).reviews.find((x) => x.id === r4.id)!.canReply).toBe(false);

    ifood.failNext.review!.push(500, 500);
    await reread();
    expect((await list()).stores[0]!.error).toMatch(/avaliações/);
  });
});

describe('iFood: uso contado para o Super Admin', () => {
  it('pollings, acks, chamadas e consultas por pedido vão para channel_usage, sem loja nem pedido', async () => {
    await app.get(ChannelUsageService).flush();
    const rows = await ownerQuery<{ metric: string; label: string; n: number }>(
      `SELECT metric, label, sum(count)::int AS n FROM channel_usage WHERE channel = 'ifood'
        GROUP BY 1, 2`,
    );
    const n = (metric: string, label: string) =>
      rows.find((r) => r.metric === metric && r.label === label)?.n ?? 0;
    expect(n('request', 'events:polling|2xx')).toBeGreaterThan(0);
    expect(n('request', 'events:ack|2xx')).toBeGreaterThan(0);
    expect(n('request', 'orders:details|2xx')).toBeGreaterThan(0);
    expect(n('poll', 'with_events')).toBeGreaterThan(0);
    expect(n('poll_acked', 'all')).toBeGreaterThan(0);
    expect(n('ack', 'ok')).toBeGreaterThan(0);
    expect(n('order_lookup', '1')).toBeGreaterThan(0);
    // Nada que identifique loja, pedido ou cliente nos rótulos.
    for (const r of rows) {
      expect(r.label).not.toContain(MERCHANT);
      expect(r.label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});
