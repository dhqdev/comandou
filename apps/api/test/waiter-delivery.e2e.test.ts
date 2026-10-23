import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { findZone, insidePolygon, distanceM, Zone } from '../src/delivery/zones';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Garçom (pedir a conta), link do entregador sem login e áreas de entrega no mapa
 * (taxa por área no cardápio online). Sempre pela API HTTP real, com dois restaurantes.
 */
const HOST_A = 'wd-a.comandou.test';
const HOST_B = 'wd-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
let geo: Server;
const geoQueries: string[] = [];
const cookies: Record<string, string> = {};
let seq = 0;
const key = () => `wd-key-${Date.now()}-${++seq}`;

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
const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (method: 'post' | 'patch' | 'delete', w: string, url: string, body: object = {}) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const post = (w: string, url: string, body: object = {}) => send('post', w, url, body);
const patch = (w: string, url: string, body: object) => send('patch', w, url, body);
const del = (w: string, url: string) => send('delete', w, url);
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object, idem?: string, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body);
  },
};

beforeAll(async () => {
  // Nominatim falso: responde um ponto fixo para qualquer busca.
  geo = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    geoQueries.push(u.searchParams.get('q') ?? '');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        u.searchParams.get('q')?.includes('Inexistente')
          ? []
          : [
              {
                lat: '-23.550000',
                lon: '-46.630000',
                display_name: 'Rua Teste, Centro, São Paulo',
              },
            ],
      ),
    );
  });
  await new Promise<void>((r) => geo.listen(0, '127.0.0.1', r));
  const geoUrl = `http://127.0.0.1:${(geo.address() as AddressInfo).port}`;

  fx = await seedTwoTenants('wd');
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('caixa@wd-a.test', 'Caixa', $1) RETURNING id`,
    [await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,'cashier')`, [
    fx.tenantA,
    u.id,
  ]);
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000', GEOCODER_URL: geoUrl }), {
    logger: false,
  });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@wd-a.test');
  cookies.adminB = await login(HOST_B, 'admin@wd-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@wd-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@wd-a.test');
});
afterAll(async () => {
  await app?.close();
  geo?.close();
});

describe('Geometria das áreas', () => {
  const square: [number, number][] = [
    [-23.54, -46.64],
    [-23.54, -46.62],
    [-23.56, -46.62],
    [-23.56, -46.64],
  ];
  const zone = (z: Partial<Zone>): Zone => ({
    id: 'z',
    name: 'z',
    color: '#000000',
    kind: 'polygon',
    polygon: square,
    centerLat: null,
    centerLng: null,
    radiusM: null,
    fee: '5.00',
    minOrder: null,
    etaMin: null,
    etaMax: null,
    active: true,
    position: 0,
    ...z,
  });
  it('ponto dentro e fora do polígono; distância em metros', () => {
    expect(insidePolygon([-23.55, -46.63], square)).toBe(true);
    expect(insidePolygon([-23.53, -46.63], square)).toBe(false);
    const d = distanceM([-23.55, -46.63], [-23.55, -46.62]);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1050);
  });
  it('vale a área ativa de menor posição', () => {
    const near = zone({
      id: 'perto',
      kind: 'radius',
      polygon: null,
      centerLat: '-23.55',
      centerLng: '-46.63',
      radiusM: 500,
      position: 0,
    });
    const far = zone({ id: 'longe', position: 1 });
    expect(findZone([far, near], [-23.55, -46.63])?.id).toBe('perto');
    expect(findZone([far, near], [-23.545, -46.625])?.id).toBe('longe');
    expect(findZone([far, { ...near, active: false }], [-23.55, -46.63])?.id).toBe('longe');
    expect(findZone([far, near], [-23.0, -46.0])).toBeUndefined();
  });
});

describe('Garçom: pedir a conta', () => {
  it('marca e desmarca; o salão mostra a mesa em pagamento', async () => {
    const table = (await post('adminA', '/tables', { label: 'M1' }).expect(201)).body;
    const tab = (await post('waiterA', '/tabs', { tableId: table.id }).expect(201)).body;
    const r = (
      await post('waiterA', `/tabs/${tab.id}/bill-request`, { requested: true }).expect(201)
    ).body;
    expect(r.billRequestedAt).toBeTruthy();
    const tables = (await get('waiterA', '/tables').expect(200)).body as {
      id: string;
      billRequestedAt: string | null;
      tabPaid: string;
    }[];
    expect(tables.find((t) => t.id === table.id)).toMatchObject({ tabPaid: '0' });
    expect(tables.find((t) => t.id === table.id)!.billRequestedAt).toBeTruthy();
    await post('adminB', `/tabs/${tab.id}/bill-request`, { requested: true }).expect(404);
    const off = (
      await post('waiterA', `/tabs/${tab.id}/bill-request`, { requested: false }).expect(201)
    ).body;
    expect(off.billRequestedAt).toBeNull();
  });
});

describe('Áreas de entrega e taxa por área', () => {
  let zoneId = '';
  it('só quem configura a loja cria áreas; outro restaurante não vê', async () => {
    await post('waiterA', '/delivery-zones', { name: 'X', kind: 'radius', fee: '1.00' }).expect(
      403,
    );
    await get('waiterA', '/delivery-zones').expect(403);
    await post('adminA', '/delivery-zones', {
      name: 'Sem pontos',
      kind: 'polygon',
      fee: '1.00',
    }).expect(422);
    await patch('adminA', '/store/settings', {
      storeLat: -23.55,
      storeLng: -46.63,
      deliveryFee: '9.00',
    }).expect(200);
    const near = (
      await post('adminA', '/delivery-zones', {
        name: 'Até 1 km',
        kind: 'radius',
        centerLat: -23.55,
        centerLng: -46.63,
        radiusM: 1000,
        fee: '3.00',
        etaMin: 20,
        etaMax: 30,
        position: 0,
      }).expect(201)
    ).body;
    expect(near).toMatchObject({
      kind: 'radius',
      radiusM: 1000,
      fee: '3.00',
      centerLat: '-23.550000',
    });
    const far = (
      await post('adminA', '/delivery-zones', {
        name: 'Bairro vizinho',
        kind: 'polygon',
        polygon: [
          [-23.5, -46.7],
          [-23.5, -46.56],
          [-23.6, -46.56],
          [-23.6, -46.7],
        ],
        fee: '8.50',
        minOrder: '40.00',
        position: 1,
      }).expect(201)
    ).body;
    zoneId = far.id;
    const list = (await get('cashierA', '/delivery-zones').expect(200)).body;
    expect(list.zones).toHaveLength(2);
    expect(list.store).toMatchObject({ lat: '-23.550000', lng: '-46.630000' });
    expect((await get('adminB', '/delivery-zones').expect(200)).body.zones).toHaveLength(0);
    await patch('adminB', `/delivery-zones/${far.id}`, { fee: '0.00' }).expect(404);
    await del('adminB', `/delivery-zones/${far.id}`).expect(404);
  });

  it('cardápio sabe que há áreas e a cotação devolve a taxa da área', async () => {
    const m = (await pub.get('/store').expect(200)).body;
    expect(m.store.deliveryZones).toBe(true);
    expect((await pub.get('/store', HOST_B).expect(200)).body.store.deliveryZones).toBe(false);
    const q1 = (await pub.post('/store/delivery-quote', { lat: -23.551, lng: -46.631 }).expect(201))
      .body;
    expect(q1).toMatchObject({
      covered: true,
      fee: '3.00',
      zone: { name: 'Até 1 km' },
      etaMin: 20,
    });
    const q2 = (await pub.post('/store/delivery-quote', { lat: -23.58, lng: -46.6 }).expect(201))
      .body;
    expect(q2).toMatchObject({ covered: true, fee: '8.50', minOrder: '40.00' });
    const q3 = (await pub.post('/store/delivery-quote', { lat: -22.9, lng: -43.2 }).expect(201))
      .body;
    expect(q3).toMatchObject({ covered: false, zone: null });
    // Sem áreas, vale a taxa fixa da loja.
    const qb = (
      await pub
        .post('/store/delivery-quote', { lat: -22.9, lng: -43.2 }, undefined, HOST_B)
        .expect(201)
    ).body;
    expect(qb).toMatchObject({ covered: true, zone: null });
  });

  it('pedido online: taxa da área, mínimo da área, fora da área recusa', async () => {
    const base = {
      customerName: 'Ana',
      customerPhone: '(11) 97777-6666',
      paymentMethod: 'pix',
      channel: 'delivery',
      items: [{ productId: fx.prodA, quantity: 1 }],
    };
    const addr = { street: 'Rua A', number: '1', district: 'Centro' };
    const tk = () => randomBytes(24).toString('base64url');
    // Sem coordenadas, com áreas cadastradas: precisa confirmar no mapa.
    await pub.post('/store/orders', { ...base, token: tk(), address: addr }, key()).expect(422);
    // Fora de todas as áreas.
    const out = await pub
      .post(
        '/store/orders',
        { ...base, token: tk(), address: { ...addr, lat: -22.9, lng: -43.2 } },
        key(),
      )
      .expect(422);
    expect(out.body.message).toContain('Ainda não entregamos');
    // Área perto: taxa 3,00.
    const ok = (
      await pub
        .post(
          '/store/orders',
          { ...base, token: tk(), address: { ...addr, lat: -23.551, lng: -46.631 } },
          key(),
        )
        .expect(201)
    ).body;
    const [o] = await ownerQuery<{ delivery_fee: string; delivery_lat: string }>(
      `SELECT delivery_fee::text, delivery_lat::text FROM orders WHERE tenant_id = $1 AND number = $2`,
      [fx.tenantA, ok.number],
    );
    expect(o).toMatchObject({ delivery_fee: '3.00', delivery_lat: '-23.551000' });
    // Área longe: mínimo de 40,00 (o pedido tem 25,90).
    const min = await pub
      .post(
        '/store/orders',
        { ...base, token: tk(), address: { ...addr, lat: -23.58, lng: -46.6 } },
        key(),
      )
      .expect(422);
    expect(min.body.message).toContain('mínimo');
    // Desativar a área longe tira a cobertura dela.
    await patch('adminA', `/delivery-zones/${zoneId}`, { active: false }).expect(200);
    await pub
      .post(
        '/store/orders',
        { ...base, token: tk(), address: { ...addr, lat: -23.58, lng: -46.6 } },
        key(),
      )
      .expect(422);
    await del('adminA', `/delivery-zones/${zoneId}`).expect(200);
  });

  it('busca de endereço passa pela API (com cache) e responde vazio quando não acha', async () => {
    const r = (await pub.get('/store/geocode?q=Rua%20Teste%2010%20Centro').expect(200)).body;
    expect(r[0]).toMatchObject({ lat: -23.55, lng: -46.63 });
    const before = geoQueries.length;
    await pub.get('/store/geocode?q=Rua%20Teste%2010%20Centro').expect(200);
    expect(geoQueries.length).toBe(before); // veio do cache
    expect((await pub.get('/store/geocode?q=Rua%20Inexistente').expect(200)).body).toEqual([]);
    await pub.get('/store/geocode?q=ab').expect(400);
    await get('waiterA', '/geocode?q=Rua%20Teste').expect(403);
    await get('adminA', '/geocode?q=Rua%20Teste%2099').expect(200);
  });
});

describe('Link do entregador (sem login)', () => {
  it('gera link, mostra só as corridas dele, conclui e para de funcionar ao trocar', async () => {
    const c1 = (await post('adminA', '/couriers', { name: 'Zé Moto' }).expect(201)).body;
    const c2 = (await post('adminA', '/couriers', { name: 'Lia Bike' }).expect(201)).body;
    await post('waiterA', `/couriers/${c1.id}/link`).expect(403);
    const l1 = (await post('adminA', `/couriers/${c1.id}/link`).expect(201)).body;
    expect(l1.path).toMatch(/^\/entregador\/[A-Za-z0-9_-]{32}$/);
    const t1 = l1.path.split('/').pop();
    const l2 = (await post('cashierA', `/couriers/${c2.id}/link`).expect(201)).body;
    const t2 = l2.path.split('/').pop();
    const couriers = (await get('adminA', '/couriers').expect(200)).body as {
      id: string;
      linkCreatedAt: string;
    }[];
    expect(couriers.find((c) => c.id === c1.id)!.linkCreatedAt).toBeTruthy();

    const mk = async (courierId: string) => {
      const o = (
        await post('adminA', '/orders', {
          channel: 'delivery',
          deliveryAddress: 'Rua B, 2',
          items: [{ productId: fx.prodA, quantity: 1 }],
        }).expect(201)
      ).body;
      await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
      return (await post('adminA', `/orders/${o.id}/dispatch`, { courierId }).expect(201)).body
        .delivery as { id: string };
    };
    const d1 = await mk(c1.id);
    const d2 = await mk(c2.id);

    const home = (await pub.get(`/courier-app/${t1}`).expect(200)).body;
    expect(home.courier.name).toBe('Zé Moto');
    expect(home.deliveries.map((d: { id: string }) => d.id)).toEqual([d1.id]);
    expect(home.deliveries[0]).toMatchObject({ deliveryAddress: 'Rua B, 2', status: 'out' });
    await pub.get(`/courier-app/${t1}`, HOST_B).expect(404);
    await pub.get('/courier-app/link-que-nao-existe-123456').expect(404);

    // Não mexe na corrida de outro entregador.
    await pub.post(`/courier-app/${t1}/deliveries/${d2.id}/complete`, {}).expect(403);
    await pub
      .post(`/courier-app/${t1}/deliveries/${d1.id}/location`, { lat: -23.5, lng: -46.6 })
      .expect(201);
    await pub.post(`/courier-app/${t1}/deliveries/${d1.id}/complete`, {}).expect(201);
    await pub.post(`/courier-app/${t1}/deliveries/${d1.id}/complete`, {}).expect(409);
    await pub
      .post(`/courier-app/${t2}/deliveries/${d2.id}/fail`, { reason: 'Cliente ausente' })
      .expect(201);
    const [h] = await ownerQuery<{ status: string }>(
      `SELECT status FROM orders WHERE id = (SELECT order_id FROM deliveries WHERE id = $1)`,
      [d2.id],
    );
    expect(h.status).toBe('ready');

    // Trocar o link invalida o anterior; revogar e desativar bloqueiam.
    const l1b = (await post('adminA', `/couriers/${c1.id}/link`).expect(201)).body;
    await pub.get(`/courier-app/${t1}`).expect(404);
    const t1b = l1b.path.split('/').pop();
    await pub.get(`/courier-app/${t1b}`).expect(200);
    await patch('adminA', `/couriers/${c1.id}`, { active: false }).expect(200);
    await pub.get(`/courier-app/${t1b}`).expect(403);
    await del('adminA', `/couriers/${c2.id}/link`).expect(200);
    await pub.get(`/courier-app/${t2}`).expect(404);
  });
});
