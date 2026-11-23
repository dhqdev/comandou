import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Pedido pela mesa do começo ao fim: o cliente confirma que está no restaurante (localização perto
 * do ponto da loja), o pedido pronto chega na mesa ("Entreguei" do garçom ou "Já peguei" do
 * cliente) e a comanda paga inteira pelo Pix do cardápio fecha sozinha.
 * Arquivo próprio: o pedido público tem limite por minuto.
 */
const HOST = 'serve-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
/** Ponto da loja (Praça da Sé) e lugares a ~30 m, ~400 m e ~9 km dele. */
const STORE = { lat: -23.55052, lng: -46.633308 };
const NEAR = { lat: -23.5503, lng: -46.6331, accuracy: 20 };
const BLOCKS_AWAY = { lat: -23.5469, lng: -46.633308 };
const FAR = { lat: -23.62, lng: -46.69, accuracy: 15 };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `serve-key-${Date.now()}-${++seq}`;
const token = () => randomBytes(24).toString('base64url');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function login(email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}

type Who = 'adminA' | 'waiterA';
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookies[w]!);
const post = (w: Who, url: string, body: object = {}, idem?: string) => {
  const r = http.post(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookies[w]!).set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const patch = (w: Who, url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookies[w]!).set(CSRF).send(body);

/** Cliente final, com a conta aberta (o Pix pelo cardápio pede). */
const shopper = { cookie: '' };
const pub = {
  get: (url: string) => http.get(`/api/v1${url}`).set('Host', HOST),
  post: (url: string, body: object = {}, idem?: string) => {
    const r = http.post(`/api/v1${url}`).set('Host', HOST).set(CSRF);
    if (shopper.cookie) r.set('Cookie', shopper.cookie);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
  upload: (url: string, file: Buffer, type: string) =>
    http.post(`/api/v1${url}`).set('Host', HOST).set(CSRF).set('Content-Type', type).send(file),
};

let tableId = '';
let sessionId = '';
const atTable = (extra: object = {}) => ({
  channel: 'table',
  tableId,
  token: token(),
  customerName: 'Lia da Mesa',
  // Pedido da mesa pelo celular pede o CPF (0.235).
  customerCpf: '529.982.247-25',
  items: [{ productId: fx.prodA, quantity: 1 }],
  presence: NEAR,
  ...extra,
});

beforeAll(async () => {
  fx = await seedTwoTenants('serve');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login('admin@serve-a.test');
  cookies.waiterA = await login('garcom@serve-a.test');
  await patch('adminA', '/store/settings', {
    enabled: true,
    isOpen: true,
    autoAccept: true,
    storeLat: STORE.lat,
    storeLng: STORE.lng,
    pixEnabled: true,
    pixKeyType: 'cpf',
    pixKey: '529.982.247-25',
    pixName: 'Bar da Se',
    pixCity: 'Sao Paulo',
  }).expect(200);
  tableId = (await post('adminA', '/tables', { label: 'S1' }).expect(201)).body.id;
  const reg = (await post('adminA', '/cash-registers', { name: 'Caixa S' }).expect(201)).body;
  sessionId = (
    await post('adminA', '/cash/sessions', { registerId: reg.id, openingAmount: '0.00' }).expect(
      201,
    )
  ).body.id;
  const su = await pub
    .post('/store/account/signup', { name: 'Lia', phone: '11955554444', password: 'segredo1' })
    .expect(201);
  const raw = su.headers['set-cookie'] as unknown as string[];
  shopper.cookie = raw.find((c) => c.startsWith('cm_cid='))!.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

describe('Pedido pela mesa até a mesa', () => {
  it('confere se o cliente está no restaurante antes de pedir', async () => {
    const menu = (await pub.get(`/store?mesa=${tableId}`).expect(200)).body;
    expect(menu.table).toMatchObject({ label: 'S1', confirmLocation: true, selfPickup: false });

    const here = (await pub.post('/store/table-presence', NEAR).expect(200)).body;
    expect(here.ok).toBe(true);
    expect(here.distanceM).toBeLessThan(60);
    const far = (await pub.post('/store/table-presence', FAR).expect(200)).body;
    expect(far).toMatchObject({ ok: false });
    expect(far.distanceM).toBeGreaterThan(5000);
    // A precisão que o celular informa entra na conta (o GPS dentro do salão erra).
    const fuzzy = { ...BLOCKS_AWAY, accuracy: 300 };
    expect((await pub.post('/store/table-presence', fuzzy).expect(200)).body.ok).toBe(true);
    const sharp = { ...BLOCKS_AWAY, accuracy: 10 };
    expect((await pub.post('/store/table-presence', sharp).expect(200)).body.ok).toBe(false);

    // O pedido confere de novo: sem a localização ou longe, não entra.
    const none = await pub
      .post('/store/orders', atTable({ presence: undefined }), key())
      .expect(428);
    expect(none.body).toMatchObject({ code: 'table_location' });
    const away = await pub.post('/store/orders', atTable({ presence: FAR }), key()).expect(428);
    expect(away.body.message).toMatch(/não está no restaurante/);
    await pub.post('/store/orders', atTable(), key()).expect(201);

    // Desligada, a mesa pede sem localização (como antes).
    await patch('adminA', '/store/settings', { tableCheckLocation: false }).expect(200);
    expect((await pub.get(`/store?mesa=${tableId}`).expect(200)).body.table.confirmLocation).toBe(
      false,
    );
    await pub.post('/store/orders', atTable({ presence: undefined }), key()).expect(201);
    await patch('adminA', '/store/settings', { tableCheckLocation: true }).expect(200);
  });

  it('garçom leva o pedido pronto; pago pelo Pix, conclui e a mesa se libera', async () => {
    // Fecha a comanda do teste anterior (dois pedidos "pagar no fim").
    const first = (await get('adminA', '/tables').expect(200)).body.find(
      (t: { id: string }) => t.id === tableId,
    );
    const old = (await get('adminA', `/tabs/${first.tabId}`).expect(200)).body;
    for (const o of old.orders)
      await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    await post(
      'adminA',
      `/tabs/${old.id}/payments`,
      { cashSessionId: sessionId, method: 'cash', amount: old.balance },
      key(),
    ).expect(201);
    await post('adminA', `/tabs/${old.id}/close`).expect(201);

    const body = atTable({ paymentMethod: 'pix' });
    const r = await pub.post('/store/orders', body, key()).expect(201);
    expect(r.body).toMatchObject({ status: 'new', pixStatus: 'waiting' });
    const list = (await get('adminA', '/orders?active=true').expect(200)).body;
    const o = list.find((x: { number: number }) => x.number === r.body.number);

    // Ainda na cozinha: o garçom não entrega (nem aparece nos prontos para levar).
    expect((await get('waiterA', '/orders?toServe=true').expect(200)).body).toHaveLength(0);
    const early = await post('waiterA', `/orders/${o.id}/served`).expect(409);
    expect(early.body.message).toMatch(/em preparo/);

    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const ready = (await get('waiterA', '/orders?toServe=true').expect(200)).body;
    expect(ready.map((x: { id: string }) => x.id)).toEqual([o.id]);
    expect(ready[0]).toMatchObject({ tableLabel: 'S1', servedAt: null });

    const served = (await post('waiterA', `/orders/${o.id}/served`).expect(200)).body;
    // Pix ainda não aprovado: entregue, mas a conta segue aberta.
    expect(served.status).toBe('ready');
    expect(served.servedAt).toBeTruthy();
    expect((await get('waiterA', '/orders?toServe=true').expect(200)).body).toHaveLength(0);
    // Tocar de novo não muda nada.
    await post('waiterA', `/orders/${o.id}/served`).expect(200);
    const track = (await pub.get(`/store/orders/${body.token}`).expect(200)).body;
    expect(track.step).toBe('completed');
    expect(track.timeline.completed).toBeTruthy();

    await pub.upload(`/store/orders/${body.token}/pix-receipt`, PNG, 'image/png').expect(200);
    const rid = (await get('adminA', `/orders/${o.id}`).expect(200)).body.pixReceipt.id;
    const ok = (
      await post(
        'adminA',
        `/orders/${o.id}/pix-receipts/${rid}/approve`,
        { cashSessionId: sessionId },
        key(),
      ).expect(200)
    ).body;
    // Pago e entregue: o pedido conclui e a comanda (paga inteira pelo Pix) fecha sozinha.
    expect(ok).toMatchObject({ status: 'completed', paymentStatus: 'paid' });
    expect((await get('adminA', `/tabs/${o.tabId}`).expect(200)).body.status).toBe('closed');
    const table = (await get('adminA', '/tables').expect(200)).body.find(
      (t: { id: string }) => t.id === tableId,
    );
    expect(table.tabId).toBeNull();
  });

  it('pagar no fim: entregue fica na conta da mesa; a gerência marca o que a cozinha esqueceu', async () => {
    const r = await pub.post('/store/orders', atTable(), key()).expect(201);
    const list = (await get('adminA', '/orders?active=true').expect(200)).body;
    const o = list.find((x: { number: number }) => x.number === r.body.number);
    // Gerente entrega o que ainda estava "em produção": fica pronto e entregue de uma vez.
    const s = (await post('adminA', `/orders/${o.id}/served`).expect(200)).body;
    expect(s).toMatchObject({ status: 'ready', paymentStatus: 'unpaid' });
    expect(s.servedAt).toBeTruthy();
    expect((await get('adminA', `/tabs/${o.tabId}`).expect(200)).body.status).toBe('open');
    // Pedido de entrega não é "entregue na mesa".
    const pickup = await pub
      .post(
        '/store/orders',
        {
          channel: 'pickup',
          token: token(),
          customerName: 'Lia',
          customerPhone: '11955554444',
          paymentMethod: 'cash',
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    const p = (await get('adminA', '/orders?active=true').expect(200)).body.find(
      (x: { number: number }) => x.number === pickup.body.number,
    );
    await post('adminA', `/orders/${p.id}/served`).expect(409);
  });

  it('cliente busca no balcão e avisa que pegou', async () => {
    const body = atTable();
    await pub.post('/store/orders', body, key()).expect(201);
    // Desligado: o garçom é quem leva.
    await pub.post(`/store/orders/${body.token}/picked-up`).expect(409);
    await patch('adminA', '/store/settings', { tableSelfPickup: true }).expect(200);
    const list = (await get('adminA', '/orders?active=true').expect(200)).body;
    const o = list.find((x: { channel: string; servedAt: string | null; status: string }) => {
      return x.channel === 'table' && !x.servedAt && x.status === 'new';
    });
    let track = (await pub.get(`/store/orders/${body.token}`).expect(200)).body;
    expect(track).toMatchObject({ selfPickup: true, canPickUp: false, step: 'accepted' });
    // Ainda na cozinha: o cliente não "pega".
    await pub.post(`/store/orders/${body.token}/picked-up`).expect(409);
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    track = (await pub.get(`/store/orders/${body.token}`).expect(200)).body;
    expect(track).toMatchObject({ step: 'ready', canPickUp: true });
    await pub.post(`/store/orders/${body.token}/picked-up`).expect(200);
    track = (await pub.get(`/store/orders/${body.token}`).expect(200)).body;
    expect(track).toMatchObject({ step: 'completed', canPickUp: false });
    const after = (await get('adminA', `/orders/${o.id}`).expect(200)).body;
    expect(after.servedAt).toBeTruthy();
  });
});
