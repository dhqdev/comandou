import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { pointsFor } from '../src/loyalty/loyalty.service';
import { testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Programa de fidelidade: o dono configura, o cliente com conta ganha pontos ao concluir o
 * pedido, troca por desconto ou produto grátis e recebe de volta se o pedido for cancelado.
 */
const HOST_A = 'fid-a.comandou.test';
const HOST_B = 'fid-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const staff: Record<string, string> = {};
let seq = 0;
const key = () => `fid-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

async function staffLogin(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieFrom(res, 'cm_sid')!;
}

const admin = {
  get: (url: string, who = 'adminA') =>
    http
      .get(`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who]!),
  send: (method: 'post' | 'patch' | 'delete', url: string, body: object, who = 'adminA') =>
    http[method](`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who]!)
      .set(CSRF)
      .send(body),
};
const client = {
  get: (url: string, cookie?: string) => {
    const r = http.get(`/api/v1${url}`).set('Host', HOST_A);
    return cookie ? r.set('Cookie', cookie) : r;
  },
  order: (cookie: string | undefined, extra: object = {}, quantity = 2) => {
    const r = http
      .post('/api/v1/store/orders')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Idempotency-Key', key());
    if (cookie) r.set('Cookie', cookie);
    return r.send({
      channel: 'pickup',
      token: token(),
      customerName: 'Ana',
      customerPhone: '(11) 96666-5555',
      paymentMethod: 'pix',
      items: [{ productId: fx.prodA, quantity }],
      ...extra,
    });
  },
};

/** Corpo da transição: concluir sem pagamento só como "a receber" (o teste não passa pelo caixa). */
const step = (to: string) =>
  to === 'completed' ? { to, receivable: true, reason: 'Fiado do teste' } : { to };

/** Leva o pedido até "concluído" pela equipe. */
async function complete(number: number) {
  const list = (await admin.get('/orders?active=true').expect(200)).body as {
    id: string;
    number: number;
  }[];
  const o = list.find((x) => x.number === number)!;
  for (const to of ['new', 'ready', 'completed'])
    await admin.send('post', `/orders/${o.id}/status`, step(to)).expect(201);
  return o.id;
}

beforeAll(async () => {
  fx = await seedTwoTenants('fid');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  staff.adminA = await staffLogin(HOST_A, 'admin@fid-a.test');
  staff.adminB = await staffLogin(HOST_B, 'admin@fid-b.test');
  staff.waiterA = await staffLogin(HOST_A, 'garcom@fid-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Regra de pontos', () => {
  it('pontos por real arredondam para baixo; carimbo exige o mínimo', () => {
    const s = { mode: 'points' as const, pointsPerReal: '1.00', stampMinOrder: '0.00' };
    expect(pointsFor(s, 5180)).toBe(51);
    expect(pointsFor({ ...s, pointsPerReal: '0.50' }, 5180)).toBe(25);
    expect(pointsFor({ ...s, pointsPerReal: '2.00' }, 99)).toBe(1);
    expect(pointsFor({ ...s, mode: 'stamps', stampMinOrder: '30.00' }, 2999)).toBe(0);
    expect(pointsFor({ ...s, mode: 'stamps', stampMinOrder: '30.00' }, 3000)).toBe(1);
    expect(pointsFor(s, 0)).toBe(0);
  });
});

let ana: string;
let anaId: string;
let discountReward: string;
let productReward: string;

describe('Programa de fidelidade', () => {
  it('desligado por padrão; só gerente configura', async () => {
    expect((await client.get('/store/loyalty').expect(200)).body).toEqual({ enabled: false });
    await admin.send('patch', '/loyalty', { enabled: true }, 'waiterA').expect(403);
    const r = await admin
      .send('patch', '/loyalty', { enabled: true, mode: 'points', pointsPerReal: '1.00' })
      .expect(200);
    expect(r.body).toMatchObject({ enabled: true, mode: 'points', pointsPerReal: '1.00' });
    // Outro restaurante continua desligado.
    expect((await admin.get('/loyalty', 'adminB').expect(200)).body.settings.enabled).toBe(false);
  });

  it('recompensas: desconto em reais e produto grátis', async () => {
    await admin
      .send('post', '/loyalty/rewards', { name: 'Sem valor', cost: 10, kind: 'discount' })
      .expect(422);
    discountReward = (
      await admin
        .send('post', '/loyalty/rewards', {
          name: 'R$ 10 de desconto',
          cost: 50,
          kind: 'discount',
          amount: '10.00',
        })
        .expect(201)
    ).body.id;
    productReward = (
      await admin
        .send('post', '/loyalty/rewards', {
          name: 'X-Burguer grátis',
          cost: 80,
          kind: 'product',
          productId: fx.prodA,
        })
        .expect(201)
    ).body.id;
    // Produto de outro restaurante não serve.
    await admin
      .send('post', '/loyalty/rewards', {
        name: 'Pizza',
        cost: 10,
        kind: 'product',
        productId: fx.prodB,
      })
      .expect(422);
    const pub = (await client.get('/store/loyalty').expect(200)).body;
    expect(pub).toMatchObject({ enabled: true, mode: 'points', account: null });
    expect(pub.rewards).toHaveLength(2);
    expect(pub.rewards[1]).toMatchObject({ name: 'X-Burguer grátis', amount: '25.90' });
  });

  it('pedido concluído rende pontos uma vez; em andamento aparece como "a receber"', async () => {
    const r = await http
      .post('/api/v1/store/account/signup')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ name: 'Ana Fiel', phone: '11966665555', password: 'segredo1' })
      .expect(201);
    ana = cookieFrom(r, 'cm_cid')!;
    anaId = r.body.customer.id;
    const o = await client.order(ana).expect(201);
    const before = (await client.get('/store/loyalty', ana).expect(200)).body.account;
    expect(before).toMatchObject({ balance: 0, pending: 51 });
    await complete(o.body.number);
    const after = (await client.get('/store/loyalty', ana).expect(200)).body.account;
    expect(after).toMatchObject({ balance: 51, pending: 0 });
    expect(after.history[0]).toMatchObject({
      kind: 'earn',
      points: 51,
      orderNumber: o.body.number,
    });
  });

  it('pedido sem conta não pontua; resgate exige conta e saldo', async () => {
    const o = await client.order(undefined).expect(201);
    await complete(o.body.number);
    await client.order(undefined, { rewardId: discountReward }).expect(422);
    await client.order(ana, { rewardId: productReward }).expect(422);
  });

  it('troca pontos por desconto; cancelar devolve os pontos', async () => {
    const o = await client.order(ana, { rewardId: discountReward }).expect(201);
    const hist = (await client.get('/store/account/orders', ana).expect(200)).body;
    expect(hist[0]).toMatchObject({ number: o.body.number, total: '41.80' });
    expect((await client.get('/store/loyalty', ana).expect(200)).body.account.balance).toBe(1);
    // Sem saldo para outra troca.
    await client.order(ana, { rewardId: discountReward }).expect(422);
    await http
      .post(`/api/v1/store/account/orders/${hist[0].id}/cancel`)
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', ana)
      .send({})
      .expect(200);
    const acc = (await client.get('/store/loyalty', ana).expect(200)).body.account;
    expect(acc.balance).toBe(51);
    expect(acc.history[0]).toMatchObject({ kind: 'refund', points: 50 });
  });

  it('ajuste manual pela equipe; relatório soma o período', async () => {
    await admin
      .send('post', `/loyalty/customers/${anaId}/adjust`, { points: -100, note: 'Correção' })
      .expect(422);
    const adj = await admin
      .send('post', `/loyalty/customers/${anaId}/adjust`, { points: 40, note: 'Cortesia' })
      .expect(201);
    expect(adj.body.balance).toBe(91);
    // Produto grátis: sai o preço base do X-Burguer.
    const o = await client.order(ana, { rewardId: productReward }).expect(201);
    const hist = (await client.get('/store/account/orders', ana).expect(200)).body;
    expect(hist[0]).toMatchObject({ number: o.body.number, total: '25.90' });
    await complete(o.body.number);
    // Ganha pelo que pagou (25,90 → 25 pontos): 91 - 80 + 25.
    expect((await client.get('/store/loyalty', ana).expect(200)).body.account.balance).toBe(36);

    const rep = (await admin.get('/loyalty/report?days=30').expect(200)).body;
    expect(rep).toMatchObject({
      members: 1,
      outstanding: 36,
      earned: 76,
      redeemed: 80,
      redemptions: 1,
      discount: '25.90',
      orders: 2,
    });
    expect(rep.top[0]).toMatchObject({ name: 'Ana Fiel', balance: 36 });
    await admin.get('/loyalty/report', 'waiterA').expect(403);
    // Outro restaurante não vê os clientes de A.
    await admin.get(`/loyalty/customers/${anaId}`, 'adminB').expect(404);
  });

  it('pedido do balcão com o celular do cliente também pontua', async () => {
    const o = await admin
      .send('post', '/orders', {
        channel: 'counter',
        customerPhone: '+55 11 96666-5555',
        items: [{ productId: fx.prodA, quantity: 1 }],
      })
      .set('Idempotency-Key', key())
      .expect(201);
    for (const to of ['ready', 'completed'])
      await admin.send('post', `/orders/${o.body.id}/status`, step(to)).expect(201);
    expect((await client.get('/store/loyalty', ana).expect(200)).body.account.balance).toBe(61);
  });

  it('cliente escolhido no PDV só pontua se a loja contar os pedidos do balcão', async () => {
    await admin.send('patch', '/loyalty', { countStaffOrders: false }).expect(200);
    const o = await admin
      .send('post', '/orders', {
        channel: 'counter',
        customerId: anaId,
        items: [{ productId: fx.prodA, quantity: 1 }],
      })
      .set('Idempotency-Key', key())
      .expect(201);
    for (const to of ['ready', 'completed'])
      await admin.send('post', `/orders/${o.body.id}/status`, step(to)).expect(201);
    expect((await client.get('/store/loyalty', ana).expect(200)).body.account.balance).toBe(61);
    await admin.send('patch', '/loyalty', { countStaffOrders: true }).expect(200);
  });

  it('Nova venda: cliente escolhido já traz o PIN e troca a recompensa no pedido', async () => {
    const view = (await admin.get(`/loyalty/customers/${anaId}/pin`).expect(200)).body;
    expect(view.pin).toMatch(/^\d{6}$/);
    expect(view).toMatchObject({ customer: { id: anaId }, balance: 61 });
    expect((await admin.get(`/loyalty/pin/${view.pin}`).expect(200)).body.customer.id).toBe(anaId);
    // Garçom não vê o PIN nem usa os pontos; sem cliente não há de quem tirar os pontos.
    await admin.get(`/loyalty/customers/${anaId}/pin`, 'waiterA').expect(403);
    const sale = (extra: object, who = 'adminA') =>
      http
        .post('/api/v1/orders')
        .set('Host', HOST_A)
        .set('Cookie', staff[who]!)
        .set(CSRF)
        .set('Idempotency-Key', key())
        .send({ channel: 'counter', items: [{ productId: fx.prodA, quantity: 1 }], ...extra });
    await sale({ customerId: anaId, rewardId: discountReward }, 'waiterA').expect(403);
    await sale({ rewardId: discountReward }).expect(422);
    const o = await sale({ customerId: anaId, rewardId: discountReward }).expect(201);
    expect(o.body).toMatchObject({ subtotal: '25.90', discount: '10.00', total: '15.90' });
    expect((await admin.get(`/loyalty/customers/${anaId}/pin`).expect(200)).body.balance).toBe(11);
    await admin
      .send('post', `/orders/${o.body.id}/status`, { to: 'cancelled', reason: 'Teste' })
      .expect(201);
    expect((await admin.get(`/loyalty/customers/${anaId}/pin`).expect(200)).body.balance).toBe(61);
  });

  it('Nova venda mostra os pontos de cada item só quando a venda da equipe pontua', async () => {
    const pointsOf = async (who = 'adminA') => {
      const cats = (await admin.get('/menu?channel=counter', who).expect(200)).body as {
        products: { id: string; price: string; points: number | null }[];
      }[];
      return cats.flatMap((c) => c.products);
    };
    const ppr = Number((await admin.get('/loyalty').expect(200)).body.settings.pointsPerReal);
    const a = (await pointsOf()).find((p) => p.id === fx.prodA)!;
    expect(a.points).toBe(Math.floor(Number(a.price) * ppr));
    await admin.send('patch', '/loyalty', { countStaffOrders: false }).expect(200);
    expect((await pointsOf()).find((p) => p.id === fx.prodA)!.points).toBeNull();
    await admin.send('patch', '/loyalty', { countStaffOrders: true }).expect(200);
    // Outro restaurante, programa desligado: nenhum item mostra pontos.
    expect((await pointsOf('adminB')).every((p) => p.points === null)).toBe(true);
  });

  it('pontos vencem depois de N dias sem comprar', async () => {
    await admin.send('patch', '/loyalty', { expiryDays: 30 }).expect(200);
    await ownerQuery(
      `UPDATE loyalty_entries SET created_at = created_at - interval '40 days' WHERE customer_id = $1`,
      [anaId],
    );
    const acc = (await client.get('/store/loyalty', ana).expect(200)).body.account;
    expect(acc.balance).toBe(0);
    expect(acc.history[0]).toMatchObject({ kind: 'expire', points: -61 });
  });

  it('produto grátis vendido por peso: desconta o que o cliente leva, no preço do cardápio', async () => {
    await admin.send('patch', '/loyalty', { expiryDays: null }).expect(200);
    const [w] = await ownerQuery<{ id: string }>(
      `INSERT INTO products (tenant_id, category_id, name, price, sold_by_weight)
       VALUES ($1, $2, 'Açaí no peso', '50.00', true) RETURNING id`,
      [fx.tenantA, fx.catA],
    );
    const reward = (
      await admin
        .send('post', '/loyalty/rewards', {
          name: 'Açaí grátis',
          cost: 10,
          kind: 'product',
          productId: w!.id,
        })
        .expect(201)
    ).body.id;
    await admin
      .send('post', `/loyalty/customers/${anaId}/adjust`, { points: 100, note: 'Teste' })
      .expect(201);
    // Cardápio de entrega com o açaí mais barato: é esse preço que o cliente vê e que sai.
    const [m] = await ownerQuery<{ id: string }>(
      `INSERT INTO menus (tenant_id, name, kind) VALUES ($1, 'Entrega', 'delivery') RETURNING id`,
      [fx.tenantA],
    );
    await ownerQuery(
      `INSERT INTO menu_items (tenant_id, menu_id, product_id, price)
       VALUES ($1, $2, $3, NULL), ($1, $2, $4, '40.00')`,
      [fx.tenantA, m!.id, fx.prodA, w!.id],
    );
    try {
      const pub = (await client.get('/store/loyalty', ana).expect(200)).body;
      expect(pub.rewards.find((r: { id: string }) => r.id === reward)).toMatchObject({
        amount: '40.00',
      });
      const o = await client
        .order(ana, {
          rewardId: reward,
          items: [
            { productId: fx.prodA, quantity: 1 },
            { productId: w!.id, quantity: 0.3 },
          ],
        })
        .expect(201);
      // 25,90 + 300 g a 40,00 o quilo (12,00); a recompensa tira só os 12,00 do açaí.
      const [saved] = await ownerQuery<{ subtotal: string; discount: string; total: string }>(
        `SELECT subtotal::text, discount::text, total::text FROM orders
          WHERE tenant_id = $1 AND number = $2`,
        [fx.tenantA, o.body.number],
      );
      expect(saved).toEqual({ subtotal: '37.90', discount: '12.00', total: '25.90' });
    } finally {
      await ownerQuery(`UPDATE menus SET active = false WHERE id = $1`, [m!.id]);
    }
  });
});
