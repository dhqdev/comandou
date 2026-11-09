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
 * QR Code colado na mesa: o cliente abre o cardápio já com a mesa escolhida e o pedido cai na
 * comanda dela. Pela API HTTP real, com dois restaurantes (arquivo próprio: o pedido público tem
 * limite por minuto e os testes da loja online já usam a cota).
 */
const HOST_A = 'mesaqr-a.comandou.test';
const HOST_B = 'mesaqr-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `mesa-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');

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

type Who = 'adminA' | 'cashierA';
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookies[w]);
const post = (w: Who, url: string, body: object = {}) =>
  http.post(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookies[w]).set(CSRF).send(body);
const patch = (w: Who, url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', HOST_A).set('Cookie', cookies[w]).set(CSRF).send(body);

/** Cliente final: sem cookie. */
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object, idem?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
};

beforeAll(async () => {
  fx = await seedTwoTenants('mesaqr');
  const [cx] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@mesaqr-a.test', 'Caixa', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    cx!.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@mesaqr-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@mesaqr-a.test');
  // Loja online ligada e aberta, com aceite pelo restaurante (como sai do cadastro).
  await patch('adminA', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: false,
  }).expect(200);
});

afterAll(async () => {
  await app?.close();
});

describe('Pedido pela mesa (QR Code colado na mesa)', () => {
  let table: { id: string; label: string };
  const atTable = (extra: object = {}) => ({
    channel: 'table',
    tableId: table.id,
    token: token(),
    customerName: 'Ana na Mesa',
    items: [{ productId: fx.prodA, quantity: 2 }],
    ...extra,
  });

  it('cardápio com a mesa escolhida usa os preços do salão; mesa de outro restaurante não vale', async () => {
    table = (await post('adminA', '/tables', { label: 'QR1' }).expect(201)).body;
    await patch('adminA', '/salon/settings', { serviceFeePercent: '10' }).expect(200);
    // Delivery 10% mais caro: a mesa continua no preço do Principal.
    const menus = (await get('adminA', '/menus').expect(200)).body as {
      id: string;
      kind: string;
      active: boolean;
    }[];
    const delivery = menus.find((m) => m.kind === 'delivery' && m.active)!;
    await post('adminA', `/menus/${delivery.id}/price-adjust`, {
      percent: 10,
      rounding: 'none',
    }).expect(201);
    const priceOf = (m: { categories: { products: { id: string; price: string }[] }[] }) =>
      m.categories.flatMap((c) => c.products).find((p) => p.id === fx.prodA)!.price;

    const plain = (await pub.get('/store').expect(200)).body;
    expect(plain.table).toBeNull();
    expect(priceOf(plain)).toBe('28.49');
    const m = (await pub.get(`/store?mesa=${table.id}`).expect(200)).body;
    expect(m.table).toEqual({
      id: table.id,
      label: 'QR1',
      serviceFeePercent: '10.00',
      // Sem o ponto da loja no mapa não há com o que conferir a localização.
      confirmLocation: false,
      selfPickup: false,
    });
    expect(priceOf(m)).toBe('25.90');
    // Mesa inexistente, id torto ou de outro restaurante: cardápio normal, sem mesa.
    for (const bad of [randomUUIDLike(), 'nao-e-uuid'])
      expect((await pub.get(`/store?mesa=${bad}`).expect(200)).body.table).toBeNull();
    expect((await pub.get(`/store?mesa=${table.id}`, HOST_B).expect(200)).body.table).toBeNull();
  });

  it('pedido do cliente cai na comanda da mesa (aberta no nome dele), sem telefone nem pagamento', async () => {
    const body = atTable();
    // Mesa obrigatória no pedido de mesa; telefone e pagamento obrigatórios fora dela.
    await pub.post('/store/orders', { ...body, tableId: undefined }, key()).expect(400);
    await pub
      .post(
        '/store/orders',
        { ...body, channel: 'pickup', tableId: undefined, customerPhone: undefined },
        key(),
      )
      .expect(400);
    const r = await pub.post('/store/orders', body, key()).expect(201);
    expect(r.body.status).toBe('awaiting');

    const tables = (await get('adminA', '/tables').expect(200)).body as {
      id: string;
      tabId: string | null;
      tabCustomer: string | null;
    }[];
    const t = tables.find((x) => x.id === table.id)!;
    expect(t.tabId).toBeTruthy();
    expect(t.tabCustomer).toBe('Ana na Mesa');
    const tab = (await get('adminA', `/tabs/${t.tabId}`).expect(200)).body;
    expect(tab.orders).toHaveLength(1);
    expect(tab.orders[0]).toMatchObject({
      channel: 'table',
      status: 'awaiting',
      source: 'online',
      subtotal: '51.80',
      surcharge: '5.18',
      total: '56.98',
    });

    const st = (await pub.get(`/store/orders/${body.token}`).expect(200)).body;
    expect(st).toMatchObject({
      channel: 'table',
      step: 'awaiting',
      tableLabel: 'QR1',
      surcharge: '5.18',
      total: '56.98',
      paymentHint: null,
      deliveryFee: '0.00',
    });

    // Segundo pedido da mesma mesa entra na mesma comanda.
    const again = atTable({ items: [{ productId: fx.prodA, quantity: 1 }] });
    await pub.post('/store/orders', again, key()).expect(201);
    const tab2 = (await get('adminA', `/tabs/${t.tabId}`).expect(200)).body;
    expect(tab2.orders).toHaveLength(2);
  });

  it('conta não fecha com pedido do cliente esperando aceite; aceito, segue o fluxo da mesa', async () => {
    const tables = (await get('adminA', '/tables').expect(200)).body as {
      id: string;
      tabId: string;
    }[];
    const tabId = tables.find((x) => x.id === table.id)!.tabId;
    const closing = await post('adminA', `/tabs/${tabId}/close`).expect(409);
    expect(closing.body.message).toMatch(/espera aceite/);
    const tab = (await get('adminA', `/tabs/${tabId}`).expect(200)).body as {
      orders: { id: string; status: string }[];
    };
    for (const o of tab.orders)
      await post('cashierA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    const after = await post('adminA', `/tabs/${tabId}/close`).expect(409);
    expect(after.body.message).not.toMatch(/espera aceite/);
  });

  it('mesa desativada, loja fechada e loja que aceita sozinho', async () => {
    await patch('adminA', '/store/settings', { isOpen: false }).expect(200);
    const closed = await pub.post('/store/orders', atTable(), key()).expect(409);
    expect(closed.body.message).toMatch(/Chame o garçom/);
    await patch('adminA', '/store/settings', { isOpen: true, autoAccept: true }).expect(200);
    const ok = await pub.post('/store/orders', atTable(), key()).expect(201);
    expect(ok.body.status).toBe('new');
    // Outro restaurante não recebe pedido na mesa de A.
    await pub.post('/store/orders', atTable(), key(), HOST_B).expect(404);
    const other = (await post('adminA', '/tables', { label: 'QR2' }).expect(201)).body;
    await patch('adminA', `/tables/${other.id}`, { active: false }).expect(200);
    await pub.post('/store/orders', atTable({ tableId: other.id }), key()).expect(404);
    await patch('adminA', '/store/settings', { autoAccept: false }).expect(200);
    await patch('adminA', '/salon/settings', { serviceFeePercent: '0' }).expect(200);
  });
});

/** UUID v4 aleatório (mesa que não existe). */
function randomUUIDLike() {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
