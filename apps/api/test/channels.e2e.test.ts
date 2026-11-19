import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bootstrap';
import { ENV, type Env } from '../src/config/env';
import { DatabaseService } from '../src/database/database.service';
import { ChannelRegistry } from '../src/integrations/channels/channel-adapter';
import { ChannelInboxService } from '../src/integrations/channels/channel-inbox.service';
import { ChannelMetrics } from '../src/integrations/channels/channel-metrics';
import { ChannelOutboxService } from '../src/integrations/channels/channel-outbox.service';
import { ChannelPoller } from '../src/integrations/channels/channel-poller.service';
import { ChannelStoreStateService } from '../src/integrations/channels/channel-store-state.service';
import { ChannelStoresService } from '../src/integrations/channels/channel-stores.service';
import { testEnv } from './env';
import { FAKE_CHANNEL, FakeChannelAdapter, FakeChannelServer, sampleOrder } from './fake-channel';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Camada dos aplicativos de delivery (ADR 0015, Fase 1) com um aplicativo falso: loja ligada a um
 * restaurante só, polling com trava (duas réplicas, só uma busca), ack só depois de gravar, evento
 * repetido e fora de ordem, queda no meio, banco do restaurante em manutenção, caixa de saída em
 * ordem com repetição, item sem vínculo, limite de consultas e isolamento entre restaurantes.
 */
const HOST_A = 'ch-a.comandou.test';
const HOST_B = 'ch-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const STORE_A = 'loja-a';
const STORE_B = 'loja-b';

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let fake: FakeChannelServer;
let poller: ChannelPoller;
let inbox: ChannelInboxService;
let outbox: ChannelOutboxService;
let stores: ChannelStoresService;
let db: DatabaseService;
let storeA = '';
let storeB = '';
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

/** Polling + tratamento até não sobrar evento pendente (o que a varredura faria). */
async function cycle() {
  const s = await poller.tick();
  for (const t of [fx.tenantA, fx.tenantB]) {
    await waitFor(async () => {
      await inbox.process(t);
      const [r] = await ownerQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM channel_inbox
          WHERE tenant_id = $1 AND status = 'pending'
            AND (next_attempt_at <= now() OR last_error IS NULL)`,
        [t],
      );
      return r!.n === 0;
    });
  }
  return s;
}

const appOrders = (tenant: string, externalId?: string) =>
  ownerQuery<{ id: string; status: string; total: string; discount: string; surcharge: string }>(
    `SELECT o.id, o.status, o.total::text, o.discount::text, o.surcharge::text
       FROM orders o JOIN channel_orders c ON c.order_id = o.id
      WHERE o.tenant_id = $1 AND ($2::text IS NULL OR c.external_id = $2)`,
    [tenant, externalId ?? null],
  );

beforeAll(async () => {
  fake = new FakeChannelServer();
  await fake.start();
  fx = await seedTwoTenants('ch');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      CHANNELS_POLL_MIN_SECONDS: '0',
      CHANNELS_LEASE_SECONDS: '5',
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  app.get(ChannelRegistry).register(new FakeChannelAdapter(fake, app.get(ChannelMetrics)));
  poller = app.get(ChannelPoller);
  inbox = app.get(ChannelInboxService);
  outbox = app.get(ChannelOutboxService);
  stores = app.get(ChannelStoresService);
  db = app.get(DatabaseService);
  cookies.adminA = await login(HOST_A, 'admin@ch-a.test');
  cookies.adminB = await login(HOST_B, 'admin@ch-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@ch-a.test');
});
afterAll(async () => {
  await app?.close();
  await fake?.stop();
});

describe('Canais: lojas ligadas', () => {
  it('liga a loja num restaurante só', async () => {
    const credential = `${FAKE_CHANNEL}:central`;
    storeA = (
      await stores.connect(fx.tenantA, null, {
        channel: FAKE_CHANNEL,
        storeId: STORE_A,
        name: 'Loja A',
        credential,
      })
    ).id;
    storeB = (
      await stores.connect(fx.tenantB, null, {
        channel: FAKE_CHANNEL,
        storeId: STORE_B,
        name: 'Loja B',
        credential,
      })
    ).id;
    await expect(
      stores.connect(fx.tenantB, null, {
        channel: FAKE_CHANNEL,
        storeId: STORE_A,
        name: 'Roubo',
        credential,
      }),
    ).rejects.toThrow(/outro restaurante/);
  });

  it('sem receber pedidos, a loja não entra no polling', async () => {
    fake.push({ id: 'e0', kind: 'order.created', storeId: STORE_A, orderId: 'P0' });
    const s = await poller.tick();
    expect(s.credentials).toBe(0);
    expect(fake.polls).toBe(0);
  });

  it('garçom não mexe; gerente liga o recebimento', async () => {
    await send('patch', 'waiterA', `/channels/stores/${storeA}`, { receiveOrders: true }).expect(
      403,
    );
    await send('patch', 'adminA', `/channels/stores/${storeA}`, { receiveOrders: true }).expect(
      200,
    );
    await send('patch', 'adminB', `/channels/stores/${storeB}`, { receiveOrders: true }).expect(
      200,
    );
    // Restaurante B não mexe na loja de A.
    await send('patch', 'adminB', `/channels/stores/${storeA}`, { autoAccept: true }).expect(404);
    const view = (await get('adminA', '/channels').expect(200)).body as {
      channels: {
        id: string;
        available: boolean;
        stores: { id: string; receiveOrders: boolean }[];
      }[];
    };
    const card = view.channels.find((c) => c.id === FAKE_CHANNEL)!;
    expect(card.available).toBe(true);
    expect(card.stores).toEqual([expect.objectContaining({ id: storeA, receiveOrders: true })]);
    expect(view.channels.find((c) => c.id === 'ifood')).toMatchObject({ label: 'iFood' });
  });
});

describe('Canais: pedido chegando', () => {
  it('evento repetido entra uma vez só; ack depois de gravar', async () => {
    fake.orders.set('P0', sampleOrder('P0', STORE_A, { linkedProductId: fx.prodA }));
    fake.push({ id: 'e0', kind: 'order.created', storeId: STORE_A, orderId: 'P0' });
    fake.push({ id: 'e0b', kind: 'order.created', storeId: STORE_A, orderId: 'P0' });
    const s = await cycle();
    expect(s.polled).toBe(1);
    expect(fake.acked('e0') && fake.acked('e0b')).toBe(true);
    const orders = await appOrders(fx.tenantA, 'P0');
    expect(orders).toHaveLength(1);
    // Desconto do restaurante reduz; o do aplicativo não (volta no repasse).
    expect(orders[0]).toMatchObject({
      status: 'awaiting',
      total: '64.79',
      discount: '3.00',
      surcharge: '0.99',
    });
    const [link] = await ownerQuery<Record<string, unknown>>(
      `SELECT prepaid, customer_total::text, channel_discount::text, unlinked_items, menu_difference::text
         FROM channel_orders WHERE external_id = 'P0'`,
    );
    expect(link).toMatchObject({
      prepaid: true,
      customer_total: '62.79',
      channel_discount: '2.00',
      unlinked_items: 1,
      menu_difference: '0.00',
    });
    const items = await ownerQuery<{ name: string; linked: boolean; product_id: string }>(
      `SELECT oi.name, ci.linked, oi.product_id FROM channel_order_items ci
         JOIN order_items oi ON oi.id = ci.order_item_id WHERE ci.order_id = $1 ORDER BY ci.linked DESC`,
      [orders[0]!.id],
    );
    expect(items[0]).toMatchObject({ name: 'X-Burguer A', linked: true, product_id: fx.prodA });
    expect(items[1]).toMatchObject({ name: 'Refrigerante lata', linked: false });
    expect(fake.lookups.get('P0')).toBe(1);
    // Evento repetido de novo (o aplicativo mandou outra vez): nada muda.
    fake.push({ id: 'e0', kind: 'order.created', storeId: STORE_A, orderId: 'P0' });
    await cycle();
    expect(await appOrders(fx.tenantA, 'P0')).toHaveLength(1);
  });

  it('o pedido aparece com o selo do aplicativo e as ações', async () => {
    const [o] = await appOrders(fx.tenantA, 'P0');
    const d = (await get('adminA', `/orders/${o!.id}`).expect(200)).body;
    expect(d).toMatchObject({ source: 'app', appChannel: FAKE_CHANNEL, externalCode: 'P0' });
    expect(d.app).toMatchObject({ externalId: 'P0', prepaid: true, unlinkedItems: 1 });
    expect(d.app.unlinked).toHaveLength(1);
  });

  it('aceitar no Comandou vai para o aplicativo pela caixa de saída', async () => {
    const [o] = await appOrders(fx.tenantA, 'P0');
    await send('post', 'adminA', `/orders/${o!.id}/status`, { to: 'new' }).expect(201);
    await waitFor(() => fake.actions.some((a) => a.orderId === 'P0' && a.action === 'confirm'));
    const [row] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
      [o!.id],
    );
    expect(row!.status).toBe('sent');
    // O aplicativo confirma: a ação fica "confirmada" e não é mandada de novo.
    fake.push({ id: 'e1', kind: 'order.confirmed', storeId: STORE_A, orderId: 'P0' });
    await cycle();
    const [after] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
      [o!.id],
    );
    expect(after!.status).toBe('confirmed');
    expect(fake.actions.filter((a) => a.orderId === 'P0' && a.action === 'confirm')).toHaveLength(
      1,
    );
  });

  it('pedido de aplicativo aceito não se cancela direto: pede ao aplicativo', async () => {
    const [o] = await appOrders(fx.tenantA, 'P0');
    await send('post', 'adminA', `/orders/${o!.id}/status`, {
      to: 'cancelled',
      reason: 'teste',
    }).expect(409);
    await send('post', 'adminA', `/orders/${o!.id}/status`, {
      to: 'cancel_requested',
      reason: 'Acabou o pão',
    }).expect(201);
    await waitFor(() => fake.actions.some((a) => a.action === 'request_cancellation'));
    expect(fake.actions.find((a) => a.action === 'request_cancellation')!.body).toEqual({
      reason: 'Acabou o pão',
    });
    // O aplicativo cancela: vale (vindo dele).
    fake.push({ id: 'e2', kind: 'order.cancelled', storeId: STORE_A, orderId: 'P0' });
    await cycle();
    expect((await appOrders(fx.tenantA, 'P0'))[0]!.status).toBe('cancelled');
  });

  it('fora de ordem: anda para a frente e ignora o atrasado', async () => {
    fake.orders.set('P1', sampleOrder('P1', STORE_A));
    const t = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
    // Chegam "pronto" e "confirmado" antes do "criado"; o "preparando" chega por último.
    fake.push({
      id: 'p1-ready',
      kind: 'order.ready',
      storeId: STORE_A,
      orderId: 'P1',
      occurredAt: t(3),
    });
    fake.push({
      id: 'p1-conf',
      kind: 'order.confirmed',
      storeId: STORE_A,
      orderId: 'P1',
      occurredAt: t(2),
    });
    await cycle();
    expect((await appOrders(fx.tenantA, 'P1'))[0]!.status).toBe('ready');
    fake.push({
      id: 'p1-prep',
      kind: 'order.preparing',
      storeId: STORE_A,
      orderId: 'P1',
      occurredAt: t(1),
    });
    fake.push({
      id: 'p1-new',
      kind: 'order.created',
      storeId: STORE_A,
      orderId: 'P1',
      occurredAt: t(0),
    });
    await cycle();
    const [o] = await appOrders(fx.tenantA, 'P1');
    expect(o!.status).toBe('ready');
    // Mudança vinda do aplicativo não volta para ele.
    const [n] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_outbox WHERE order_id = $1`,
      [o!.id],
    );
    expect(n!.n).toBe(0);
    // Concluído pelo aplicativo: fecha sem pedir pagamento no caixa (o repasse acerta).
    fake.push({ id: 'p1-done', kind: 'order.concluded', storeId: STORE_A, orderId: 'P1' });
    await cycle();
    expect((await appOrders(fx.tenantA, 'P1'))[0]!.status).toBe('completed');
  });

  it('cancelado antes de chegar não vira pedido', async () => {
    fake.orders.set('P2', sampleOrder('P2', STORE_A));
    fake.push({ id: 'p2-x', kind: 'order.cancelled', storeId: STORE_A, orderId: 'P2' });
    await cycle();
    expect(await appOrders(fx.tenantA, 'P2')).toHaveLength(0);
    expect(fake.lookups.get('P2')).toBeUndefined();
  });
});

describe('Canais: falhas', () => {
  it('queda no meio: o evento pego e não terminado volta sozinho', async () => {
    fake.orders.set('P3', sampleOrder('P3', STORE_A, { linkedProductId: fx.prodA }));
    fake.push({ id: 'p3-new', kind: 'order.created', storeId: STORE_A, orderId: 'P3' });
    // Só o polling (grava e confirma), sem tratar. Com Redis (CI), gravar o evento já põe o
    // tratamento na fila e o worker trataria antes da "queda" simulada: segura o aviso aqui.
    const kick = vi.spyOn(inbox, 'kick').mockImplementation(() => undefined);
    try {
      await poller.tick();
    } finally {
      kick.mockRestore();
    }
    expect(fake.acked('p3-new')).toBe(true);
    // Simula a réplica que pegou o evento e caiu: reserva de 2 min, sem terminar.
    await ownerQuery(
      `UPDATE channel_inbox SET attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
        WHERE event_id = 'p3-new'`,
    );
    await inbox.process(fx.tenantA);
    expect(await appOrders(fx.tenantA, 'P3')).toHaveLength(0);
    // Passados os 2 minutos, a varredura trata.
    await ownerQuery(`UPDATE channel_inbox SET next_attempt_at = now() WHERE event_id = 'p3-new'`);
    await poller.sweep();
    expect(await appOrders(fx.tenantA, 'P3')).toHaveLength(1);
  });

  it('aplicativo fora do ar ao buscar o pedido: tenta de novo depois', async () => {
    fake.orders.set('P4', sampleOrder('P4', STORE_A));
    fake.failNext.order!.push(503);
    fake.push({ id: 'p4-new', kind: 'order.created', storeId: STORE_A, orderId: 'P4' });
    await poller.tick();
    await waitFor(async () => {
      await inbox.process(fx.tenantA);
      const [r] = await ownerQuery<{ attempts: number; last_error: string | null }>(
        `SELECT attempts, last_error FROM channel_inbox WHERE event_id = 'p4-new'`,
      );
      return r!.attempts >= 1 && !!r!.last_error;
    });
    expect(await appOrders(fx.tenantA, 'P4')).toHaveLength(0);
    await ownerQuery(`UPDATE channel_inbox SET next_attempt_at = now() WHERE event_id = 'p4-new'`);
    await inbox.process(fx.tenantA);
    expect(await appOrders(fx.tenantA, 'P4')).toHaveLength(1);
  });

  it('nunca consulta o mesmo pedido mais de 10 vezes', async () => {
    await ownerQuery(
      `INSERT INTO channel_order_lookups (tenant_id, channel, external_id, lookups) VALUES ($1, $2, 'P5', 10)`,
      [fx.tenantA, FAKE_CHANNEL],
    );
    fake.orders.set('P5', sampleOrder('P5', STORE_A));
    fake.push({ id: 'p5-new', kind: 'order.created', storeId: STORE_A, orderId: 'P5' });
    await poller.tick();
    let err = '';
    await waitFor(async () => {
      await inbox.process(fx.tenantA);
      const [r] = await ownerQuery<{ last_error: string | null }>(
        `SELECT last_error FROM channel_inbox WHERE event_id = 'p5-new'`,
      );
      err = r?.last_error ?? '';
      return !!err;
    });
    expect(err).toMatch(/10 vezes/);
    expect(fake.lookups.get('P5')).toBeUndefined();
  });

  it('banco do restaurante em manutenção: grava os outros e não confirma os dele', async () => {
    await ownerQuery(
      `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES ($1, 'comandou_tst_ch_manut', 'moving')`,
      [fx.tenantA],
    );
    db.router.forget();
    try {
      fake.orders.set('P6', sampleOrder('P6', STORE_A));
      fake.orders.set('Q1', sampleOrder('Q1', STORE_B));
      fake.push({ id: 'p6-new', kind: 'order.created', storeId: STORE_A, orderId: 'P6' });
      fake.push({ id: 'q1-new', kind: 'order.created', storeId: STORE_B, orderId: 'Q1' });
      await poller.tick();
      expect(fake.acked('q1-new')).toBe(true);
      expect(fake.acked('p6-new')).toBe(false);
    } finally {
      await ownerQuery(`DELETE FROM tenant_databases WHERE tenant_id = $1`, [fx.tenantA]);
      db.router.forget();
    }
    await cycle();
    expect(fake.acked('p6-new')).toBe(true);
    expect(await appOrders(fx.tenantA, 'P6')).toHaveLength(1);
    expect(await appOrders(fx.tenantB, 'Q1')).toHaveLength(1);
  });

  it('ação recusada pelo aplicativo (4xx) não se repete; 5xx repete', async () => {
    const [o] = await appOrders(fx.tenantA, 'P3');
    fake.failNext.action!.push(503);
    await send('post', 'adminA', `/orders/${o!.id}/status`, { to: 'new' }).expect(201);
    await waitFor(async () => {
      const [r] = await ownerQuery<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
        [o!.id],
      );
      return r?.status === 'pending' && r.attempts === 1;
    });
    await ownerQuery(`UPDATE integration_outbox SET next_attempt_at = now() WHERE order_id = $1`, [
      o!.id,
    ]);
    await outbox.deliver(fx.tenantA);
    const [ok] = await ownerQuery<{ status: string }>(
      `SELECT status FROM integration_outbox WHERE order_id = $1 AND action = 'confirm'`,
      [o!.id],
    );
    expect(ok!.status).toBe('sent');

    fake.failNext.action!.push(400);
    await send('post', 'adminA', `/orders/${o!.id}/status`, { to: 'in_production' }).expect(201);
    await waitFor(async () => {
      const [r] = await ownerQuery<{ status: string; last_error: string }>(
        `SELECT status, last_error FROM integration_outbox WHERE order_id = $1 AND action = 'start_preparation'`,
        [o!.id],
      );
      return r?.status === 'failed';
    });
    const probs = (await get('adminA', '/channels/problems').expect(200)).body;
    expect(probs.actions).toHaveLength(1);
    // Tentar de novo pela tela.
    await send('post', 'adminA', `/channels/actions/${probs.actions[0].id}/retry`).expect(200);
    await waitFor(() =>
      fake.actions.some((a) => a.orderId === 'P3' && a.action === 'start_preparation'),
    );
  });
});

describe('Canais: polling com trava', () => {
  it('duas réplicas: só uma busca; se ela sair, a outra assume', async () => {
    const env = app.get<Env>(ENV);
    const make = () =>
      new ChannelPoller(
        env,
        db,
        app.get(ChannelRegistry),
        inbox,
        outbox,
        app.get(ChannelMetrics),
        app.get(ChannelStoreStateService),
      );
    const r1 = make();
    const r2 = make();
    // A réplica principal do teste segura a trava de antes: solta.
    await db.queryUnscoped('SELECT app_channel_lease_release($1)', [poller.holder]);
    const before = fake.polls;
    const [a, b] = await Promise.all([r1.tick(), r2.tick()]);
    expect(a.polled + b.polled).toBe(1);
    expect(fake.polls - before).toBe(1);
    const winner = a.polled ? r1 : r2;
    const loser = a.polled ? r2 : r1;
    expect((await loser.tick()).polled).toBe(0);
    await winner.onModuleDestroy();
    expect((await loser.tick()).polled).toBe(1);
    await loser.onModuleDestroy();
  });

  it('nunca busca antes do intervalo mínimo, nem com outra réplica', async () => {
    const env = { ...app.get<Env>(ENV), CHANNELS_POLL_MIN_SECONDS: 3600 };
    const p = new ChannelPoller(
      env,
      db,
      app.get(ChannelRegistry),
      inbox,
      outbox,
      app.get(ChannelMetrics),
      app.get(ChannelStoreStateService),
    );
    await db.queryUnscoped('SELECT app_channel_lease_release($1)', [poller.holder]);
    const before = fake.polls;
    expect((await p.tick()).polled).toBe(0);
    expect(fake.polls).toBe(before);
    await p.onModuleDestroy();
  });

  it('lojas em lotes de até 100', async () => {
    const extra = Array.from({ length: 120 }, (_, i) => `extra-${String(i).padStart(3, '0')}`);
    for (const s of extra) {
      const r = await stores.connect(fx.tenantB, null, {
        channel: FAKE_CHANNEL,
        storeId: s,
        name: s,
        credential: `${FAKE_CHANNEL}:central`,
      });
      await stores.setOptions(fx.tenantB, (await adminOf(fx.tenantB))!, r.id, {
        receiveOrders: true,
      });
    }
    const n = fake.polledStores.length;
    await poller.tick();
    const sizes = fake.polledStores.slice(n).map((s) => s.length);
    expect(sizes).toEqual([100, 22]);
  });
});

async function adminOf(tenant: string) {
  const [r] = await ownerQuery<{ user_id: string }>(
    `SELECT user_id FROM memberships WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`,
    [tenant],
  );
  return r?.user_id;
}

describe('Canais: itens sem vínculo e isolamento', () => {
  it('lista os itens sem vínculo e o vínculo vale para os próximos pedidos', async () => {
    const list = (await get('adminA', '/channels/unlinked').expect(200)).body as {
      channel: string;
      itemKey: string;
      name: string;
    }[];
    const soda = list.find((x) => x.name === 'Refrigerante lata')!;
    expect(soda).toBeTruthy();
    // B não liga item a produto de A.
    await send('post', 'adminB', '/channels/links', {
      channel: soda.channel,
      itemKey: soda.itemKey,
      productId: fx.prodA,
    }).expect(404);
    await send('post', 'waiterA', '/channels/links', {
      channel: soda.channel,
      itemKey: soda.itemKey,
      productId: fx.prodA,
    }).expect(403);
    await send('post', 'adminA', '/channels/links', {
      channel: soda.channel,
      itemKey: soda.itemKey,
      productId: fx.prodA,
    }).expect(200);
    const after = (await get('adminA', '/channels/unlinked').expect(200)).body as {
      itemKey: string;
    }[];
    expect(after.some((x) => x.itemKey === soda.itemKey)).toBe(false);
    fake.orders.set('P7', sampleOrder('P7', STORE_A));
    fake.push({ id: 'p7-new', kind: 'order.created', storeId: STORE_A, orderId: 'P7' });
    await cycle();
    const [o] = await appOrders(fx.tenantA, 'P7');
    const items = await ownerQuery<{ linked: boolean; name: string }>(
      `SELECT linked, name FROM channel_order_items WHERE order_id = $1 ORDER BY name`,
      [o!.id],
    );
    expect(items.find((i) => i.name === 'Refrigerante lata')!.linked).toBe(true);
  });

  it('cada restaurante só vê os pedidos e as lojas dele', async () => {
    const b = (await get('adminB', '/channels').expect(200)).body as {
      channels: { id: string; stores: { id: string }[] }[];
    };
    const ids = b.channels.find((c) => c.id === FAKE_CHANNEL)!.stores.map((s) => s.id);
    expect(ids).toContain(storeB);
    expect(ids).not.toContain(storeA);
    const [aOrder] = await appOrders(fx.tenantA, 'P7');
    await get('adminB', `/orders/${aOrder!.id}`).expect(404);
    const leaked = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM channel_orders WHERE tenant_id = $1 AND store_id = $2`,
      [fx.tenantB, STORE_A],
    );
    expect(leaked[0]!.n).toBe(0);
  });

  it('a limpeza apaga o evento cru depois de 90 dias', async () => {
    await ownerQuery(
      `UPDATE channel_inbox SET received_at = now() - interval '91 days', payload = '{"x":1}'
        WHERE event_id = 'p7-new'`,
    );
    await ownerQuery(`SELECT app_purge_expired()`);
    const [r] = await ownerQuery<{ payload: unknown }>(
      `SELECT payload FROM channel_inbox WHERE event_id = 'p7-new'`,
    );
    expect(r!.payload).toBeNull();
  });
});
