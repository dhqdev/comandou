import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Cardápio online: loja pública, fotos, pedido do cliente com análise/aceite, acompanhamento e
 * cancelamento pelo cliente. Sempre pela API HTTP real, com dois restaurantes.
 */
const HOST_A = 'loja-a.comandou.test';
const HOST_B = 'loja-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `store-key-${Date.now()}-${++seq}`;
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

type Who = 'adminA' | 'adminB' | 'waiterA';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const get = (w: Who, url: string) =>
  http.get(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]);
const post = (w: Who, url: string, body: object = {}) =>
  http.post(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);
const patch = (w: Who, url: string, body: object) =>
  http.patch(`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]).set(CSRF).send(body);

/** Cliente final: sem cookie. */
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object, idem?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
};

const customer = {
  customerName: 'Maria Cliente',
  customerPhone: '(11) 98888-7777',
  paymentMethod: 'pix',
};
const address = { street: 'Rua das Flores', number: '120', district: 'Centro' };

/** WebP mínimo válido o suficiente para a checagem de assinatura. */
const FAKE_WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(14, 1),
]);

beforeAll(async () => {
  fx = await seedTwoTenants('loja');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@loja-a.test');
  cookies.adminB = await login(HOST_B, 'admin@loja-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@loja-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('Loja online: configurações e fotos', () => {
  it('começa com padrões; garçom só abre/fecha e liga o aceite automático', async () => {
    const s = (await get('adminA', '/store/settings').expect(200)).body;
    expect(s).toMatchObject({ enabled: true, isOpen: true, autoAccept: false });
    await patch('waiterA', '/store/settings', { deliveryFee: '7.00' }).expect(403);
    await patch('waiterA', '/store/settings', { isOpen: false }).expect(200);
    const s2 = (
      await patch('adminA', '/store/settings', {
        isOpen: true,
        deliveryFee: '7.00',
        minOrder: '20.00',
        etaMin: 25,
        etaMax: 40,
      }).expect(200)
    ).body;
    expect(s2).toMatchObject({ deliveryFee: '7.00', minOrder: '20.00', etaMin: 25 });
    await patch('adminA', '/store/settings', { etaMin: 60, etaMax: 30 }).expect(422);
  });

  it('envia foto, liga ao produto e serve com cache; outro restaurante não vê', async () => {
    const bad = await http
      .post('/api/v1/media')
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA)
      .set(CSRF)
      .set('Content-Type', 'image/webp')
      .send(Buffer.from('não é imagem'));
    expect(bad.status).toBe(422);
    const up = await http
      .post('/api/v1/media?w=800&h=600')
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA)
      .set(CSRF)
      .set('Content-Type', 'image/webp')
      .send(FAKE_WEBP);
    expect(up.status).toBe(201);
    const media = up.body as { id: string; url: string };
    expect(media.url).toBe(`/api/v1/media/${media.id}`);
    const img = await pub.get(`/media/${media.id}`).expect(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
    await pub.get(`/media/${media.id}`, HOST_B).expect(404);
    await patch('adminA', `/products/${fx.prodA}`, { imageId: media.id }).expect(200);
    // Foto de outro restaurante não pode ser ligada (FK por restaurante).
    const res = await patch('adminB', `/products/${fx.prodB}`, { imageId: media.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await patch('adminA', `/categories/${fx.catA}`, { imageId: media.id }).expect(200);
  });
});

describe('Cardápio público e pedido do cliente', () => {
  it('mostra o cardápio sem login, com foto, sem dados internos', async () => {
    const m = (await pub.get('/store').expect(200)).body;
    expect(m.restaurant.name).toContain('Restaurante A');
    expect(m.store).toMatchObject({ isOpen: true, deliveryFee: '7.00', minOrder: '20.00' });
    const p = m.categories.flatMap((c: { products: { id: string }[] }) => c.products)[0];
    expect(p).toMatchObject({ id: fx.prodA, name: 'X-Burguer A', price: '25.90' });
    expect(p.imageUrl).toMatch(/^\/api\/v1\/media\//);
    expect(JSON.stringify(m)).not.toMatch(/ncm|sectorId|cfop/);
  });

  let tk: string;
  let number: number;
  it('cria o pedido em análise com taxa e preços do servidor; reenvio não duplica', async () => {
    tk = token();
    const body = {
      ...customer,
      channel: 'delivery',
      token: tk,
      address,
      items: [{ productId: fx.prodA, quantity: 2 }],
    };
    await pub.post('/store/orders', body).expect(422); // sem Idempotency-Key
    const k = key();
    const r1 = await pub.post('/store/orders', body, k).expect(201);
    expect(r1.body.status).toBe('awaiting');
    number = r1.body.number;
    const r2 = await pub.post('/store/orders', body, k).expect(201);
    expect(r2.body.number).toBe(number);

    const st = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(st).toMatchObject({
      number,
      step: 'awaiting',
      canCancel: true,
      subtotal: '51.80',
      deliveryFee: '7.00',
      total: '58.80',
      paymentHint: 'pix',
    });
    expect(st.deliveryAddress).toContain('Rua das Flores, 120');
    await pub.get(`/store/orders/${tk}`, HOST_B).expect(404);
  });

  it('pedido em análise não vai para a cozinha; aceitar leva para "novo"', async () => {
    const orders = (await get('adminA', '/orders?active=true').expect(200)).body as {
      id: string;
      number: number;
      status: string;
      source: string;
    }[];
    const o = orders.find((x) => x.number === number)!;
    expect(o).toMatchObject({ status: 'awaiting', source: 'online' });
    const kds = (await get('adminA', '/kitchen?sectorId=none').expect(200)).body;
    expect(kds.orders.some((x: { number: number }) => x.number === number)).toBe(false);

    await post('waiterA', `/orders/${o.id}/status`, { to: 'new' }).expect(201);
    const st = (await pub.get(`/store/orders/${tk}`).expect(200)).body;
    expect(st).toMatchObject({ step: 'accepted', canCancel: false });
    expect(st.timeline.accepted).toBeTruthy();
    // Depois de aceito o cliente não cancela sozinho.
    await pub.post(`/store/orders/${tk}/cancel`, {}).expect(409);
  });

  it('cliente cancela enquanto está em análise; restaurante recusa com motivo', async () => {
    const t1 = token();
    await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'pickup',
          token: t1,
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    await pub.post(`/store/orders/${t1}/cancel`, {}).expect(200);
    expect((await pub.get(`/store/orders/${t1}`).expect(200)).body.step).toBe('cancelled');

    const t2 = token();
    const r = await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'pickup',
          token: t2,
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    const list = (await get('adminA', '/orders?status=awaiting').expect(200)).body as {
      id: string;
      number: number;
    }[];
    const o = list.find((x) => x.number === r.body.number)!;
    await post('waiterA', `/orders/${o.id}/status`, { to: 'cancelled' }).expect(422);
    await post('waiterA', `/orders/${o.id}/status`, {
      to: 'cancelled',
      reason: 'Sem entregador agora',
    }).expect(201);
    const st = (await pub.get(`/store/orders/${t2}`).expect(200)).body;
    expect(st).toMatchObject({ step: 'cancelled', cancelReason: 'Sem entregador agora' });
  });

  it('respeita pedido mínimo, loja fechada e aceite automático', async () => {
    await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'delivery',
          token: token(),
          address,
          items: [{ productId: fx.prodA, quantity: 0.5 }],
        },
        key(),
      )
      .expect(400);
    await patch('adminA', '/store/settings', { minOrder: '30.00' }).expect(200);
    await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'pickup',
          token: token(),
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(422);
    await patch('adminA', '/store/settings', { minOrder: '0.00', isOpen: false }).expect(200);
    await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'pickup',
          token: token(),
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(409);
    await patch('adminA', '/store/settings', { isOpen: true, autoAccept: true }).expect(200);
    const r = await pub
      .post(
        '/store/orders',
        {
          ...customer,
          channel: 'pickup',
          token: token(),
          items: [{ productId: fx.prodA, quantity: 1 }],
        },
        key(),
      )
      .expect(201);
    expect(r.body.status).toBe('new');
  });

  it('loja desativada some do público', async () => {
    await patch('adminA', '/store/settings', { enabled: false }).expect(200);
    await pub.get('/store').expect(404);
    await patch('adminA', '/store/settings', { enabled: true }).expect(200);
  });
});
