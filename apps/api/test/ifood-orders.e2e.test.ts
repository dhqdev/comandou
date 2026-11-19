import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelOutboxService } from '../src/integrations/channels/channel-outbox.service';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
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
