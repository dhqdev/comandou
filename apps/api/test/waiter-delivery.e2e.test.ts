import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { findZone, findZoneFor, insidePolygon, distanceM, Zone } from '../src/delivery/zones';
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
        `${u.searchParams.get('q')} ${u.searchParams.get('street')}`.includes('Inexistente')
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
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      GEOCODER_URL: geoUrl,
      PHOTON_URL: '',
      INTEGRATIONS_KEY: Buffer.alloc(32, 7).toString('base64'),
    }),
    {
      logger: false,
    },
  );
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
  it('taxa por bairro: fora do desenho, vale a área com o nome do bairro', () => {
    const sm = zone({ id: 'sm', name: 'Parque São Martinho', position: 2 });
    const centro = zone({
      id: 'c',
      name: 'Centro',
      polygon: [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
    });
    const out: [number, number] = [-23.0, -46.0];
    expect(findZoneFor([centro, sm], out, 'Loteamento Parque São Martinho')?.id).toBe('sm');
    expect(findZoneFor([centro, sm], out, 'Pq. S. Martinho')?.id).toBe('sm');
    expect(findZoneFor([centro, sm], out, 'Jardim Centro Oeste')).toBeUndefined();
    expect(
      findZoneFor([centro, { ...sm, active: false }], out, 'Parque São Martinho'),
    ).toBeUndefined();
    // Dentro de um desenho, o ponto manda (o bairro não troca a área).
    expect(findZoneFor([centro, sm], [-23.55, -46.63], 'Centro')?.id).toBe('sm');
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

  it('pede a conta já dividida: o caixa recebe em quantas partes', async () => {
    const table = (await post('adminA', '/tables', { label: 'M-div' }).expect(201)).body;
    const tab = (await post('waiterA', '/tabs', { tableId: table.id }).expect(201)).body;
    const r = (
      await post('waiterA', `/tabs/${tab.id}/bill-request`, {
        requested: true,
        splitParts: 4,
      }).expect(201)
    ).body;
    expect(r.billSplitParts).toBe(4);
    await post('waiterA', `/tabs/${tab.id}/bill-request`, {
      requested: true,
      splitParts: 99,
    }).expect(400);
    const off = (
      await post('waiterA', `/tabs/${tab.id}/bill-request`, { requested: false }).expect(201)
    ).body;
    expect(off.billSplitParts).toBeNull();
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
    expect(q3).toMatchObject({ covered: false, zone: null, areas: ['Até 1 km', 'Bairro vizinho'] });
    // Ponto fora do desenho, mas o bairro tem o nome de uma área: vale a área (taxa por bairro).
    const q4 = (
      await pub
        .post('/store/delivery-quote', { lat: -22.9, lng: -43.2, district: 'Lot. Bairro Vizinho' })
        .expect(201)
    ).body;
    expect(q4).toMatchObject({ covered: true, fee: '8.50', zone: { name: 'Bairro vizinho' } });
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
    // Mesmo ponto, com o bairro de uma área: o pedido passa pela área do bairro (mínimo 40,00).
    const byName = await pub
      .post(
        '/store/orders',
        {
          ...base,
          token: tk(),
          address: { ...addr, district: 'Loteamento Bairro Vizinho', lat: -22.9, lng: -43.2 },
        },
        key(),
      )
      .expect(422);
    expect(byName.body.message).toContain('mínimo');
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

  it('localiza o endereço do cliente em etapas e nunca deixa sem ponto', async () => {
    const r = (
      await pub.get('/store/locate?street=Rua%20Teste&number=10&district=Centro').expect(200)
    ).body;
    expect(r).toMatchObject({ lat: -23.55, lng: -46.63, precision: 'street' });
    // Rua que o mapa não conhece: fica o bairro, para o cliente arrastar o pino.
    const d = (
      await pub
        .get('/store/locate?street=Rua%20Inexistente&number=5&district=Loteamento%20Centro')
        .expect(200)
    ).body;
    expect(d).toMatchObject({ precision: 'district' });
    await pub.get('/store/locate?number=5').expect(400);
  });

  it('pino longe do endereço digitado não barateia a entrega', async () => {
    const near = ((await get('adminA', '/delivery-zones').expect(200)).body.zones as {
      id: string;
      name: string;
    }[]).find((z) => z.name === 'Até 1 km')!;
    const promo = (
      await post('adminA', '/delivery-zones', {
        name: 'Promo',
        kind: 'polygon',
        polygon: [
          [-23.69, -46.81],
          [-23.69, -46.79],
          [-23.71, -46.79],
          [-23.71, -46.81],
        ],
        fee: '0.50',
        position: 5,
      }).expect(201)
    ).body;
    // O cardápio achou o endereço digitado no mapa (dentro da área de 3,00).
    await pub.get('/store/locate?street=Rua%20Teste&number=10&district=Centro').expect(200);
    const tk = () => randomBytes(24).toString('base64url');
    const order = (extra: object = {}) =>
      pub.post(
        '/store/orders',
        {
          customerName: 'Bia',
          customerPhone: '(11) 96666-1212',
          paymentMethod: 'cash',
          channel: 'delivery',
          items: [{ productId: fx.prodA, quantity: 1 }],
          token: tk(),
          address: { street: 'Rua Teste', number: '10', district: 'Centro', lat: -23.7, lng: -46.8 },
          ...extra,
        },
        key(),
      );
    const ok = (await order().expect(201)).body;
    const [o] = await ownerQuery<{ delivery_fee: string }>(
      `SELECT delivery_fee::text FROM orders WHERE tenant_id = $1 AND number = $2`,
      [fx.tenantA, ok.number],
    );
    expect(o!.delivery_fee).toBe('3.00');
    // Endereço digitado fora das áreas e o pino dentro de uma: pede para conferir.
    await patch('adminA', `/delivery-zones/${near.id}`, { active: false }).expect(200);
    await pub.get('/store/locate?street=Rua%20Teste&number=10&district=Centro').expect(200);
    const bad = await order().expect(422);
    expect(bad.body.message).toContain('longe do endereço');
    await patch('adminA', `/delivery-zones/${near.id}`, { active: true }).expect(200);
    await del('adminA', `/delivery-zones/${promo.id}`).expect(200);
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
    const seenOf = async (id: string) =>
      (
        (await get('adminA', '/couriers').expect(200)).body as {
          id: string;
          linkSeenAt: string | null;
        }[]
      ).find((c) => c.id === id)!.linkSeenAt;
    expect(await seenOf(c1.id)).toBeNull();
    // Copiar link: devolve o mesmo link (sem trocar), só para quem gerencia entregas.
    expect((await get('adminA', `/couriers/${c1.id}/link`).expect(200)).body).toEqual({
      path: l1.path,
    });
    await get('waiterA', `/couriers/${c1.id}/link`).expect(403);
    // Cor do entregador no mapa e no calendário de pagamento.
    await patch('adminA', `/couriers/${c2.id}`, { color: 'vermelho' }).expect(400);
    expect(
      (await patch('adminA', `/couriers/${c2.id}`, { color: '#1C7ED6' }).expect(200)).body,
    ).toMatchObject({ color: '#1C7ED6', linkCopyable: true });

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
    // Abrir o link marca o entregador como visto (situação "disponível" em Entregas).
    expect(await seenOf(c1.id)).toBeTruthy();
    expect(await seenOf(c2.id)).toBeNull();
    await pub.get(`/courier-app/${t1}`, HOST_B).expect(404);
    await pub.get('/courier-app/link-que-nao-existe-123456').expect(404);

    // Não mexe na corrida de outro entregador.
    await pub.post(`/courier-app/${t1}/deliveries/${d2.id}/complete`, {}).expect(403);
    await pub
      .post(`/courier-app/${t1}/deliveries/${d1.id}/location`, { lat: -23.5, lng: -46.6 })
      .expect(201);
    // Rastreio ao vivo: velocidade/rumo/precisão opcionais; ponto impreciso não entra no trajeto.
    await pub
      .post(`/courier-app/${t1}/deliveries/${d1.id}/location`, {
        lat: -23.501,
        lng: -46.601,
        accuracy: 12,
        speed: 8.5,
        heading: 270,
      })
      .expect(201);
    await pub
      .post(`/courier-app/${t1}/deliveries/${d1.id}/location`, {
        lat: -23.6,
        lng: -46.7,
        accuracy: 900,
      })
      .expect(201);
    await pub
      .post(`/courier-app/${t1}/deliveries/${d1.id}/location`, { lat: 0, lng: 0, heading: 400 })
      .expect(400);
    const live = (await get('adminA', `/deliveries/live-map?ids=${d1.id},${d2.id}`).expect(200))
      .body;
    expect(live.trails[d1.id]).toEqual([
      [-23.5, -46.6],
      [-23.501, -46.601],
    ]);
    expect(live.trails[d2.id]).toEqual([]);
    const [row] = (await get('adminA', '/deliveries?scope=active').expect(200)).body.filter(
      (x: { id: string }) => x.id === d1.id,
    );
    expect(row).toMatchObject({ lastLat: '-23.600000', lastHeading: 270, lastAccuracy: 900 });
    await get('adminA', '/deliveries/live-map?ids=nao-e-uuid').expect(400);
    // Pelo link também só conclui com o código do cliente.
    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d1.id],
    );
    await pub.post(`/courier-app/${t1}/deliveries/${d1.id}/complete`, {}).expect(422);
    await pub.post(`/courier-app/${t1}/deliveries/${d1.id}/complete`, { code }).expect(201);
    await pub.post(`/courier-app/${t1}/deliveries/${d1.id}/complete`, { code }).expect(409);
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
    expect(await seenOf(c1.id)).toBeNull(); // link novo: ainda não aberto
    expect((await get('adminA', `/couriers/${c1.id}/link`).expect(200)).body).toEqual({
      path: l1b.path,
    });
    const t1b = l1b.path.split('/').pop();
    await pub.get(`/courier-app/${t1b}`).expect(200);
    await patch('adminA', `/couriers/${c1.id}`, { active: false }).expect(200);
    await pub.get(`/courier-app/${t1b}`).expect(403);
    await del('adminA', `/couriers/${c2.id}/link`).expect(200);
    await pub.get(`/courier-app/${t2}`).expect(404);
    expect((await get('adminA', `/couriers/${c2.id}/link`).expect(200)).body).toEqual({
      path: null,
    });
  });

  it('entregador pega sozinho o pedido pronto; histórico e perfil com score', async () => {
    const link = async (name: string) => {
      const c = (await post('adminA', '/couriers', { name }).expect(201)).body;
      const l = (await post('adminA', `/couriers/${c.id}/link`).expect(201)).body;
      return l.path.split('/').pop() as string;
    };
    const rui = await link('Rui Pega');
    const ana = await link('Ana Corre');
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua C, 3',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    // Só aparece para pegar depois de pronto.
    const before = (await pub.get(`/courier-app/${rui}/available`).expect(200)).body;
    expect(before.some((x: { orderId: string }) => x.orderId === o.id)).toBe(false);
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    const list = (await pub.get(`/courier-app/${rui}/available`).expect(200)).body;
    const mine = list.find((x: { orderId: string }) => x.orderId === o.id);
    expect(mine).toMatchObject({ deliveryAddress: 'Rua C, 3', items: 1 });
    expect(mine.readyAt).toBeTruthy();
    expect(mine.customerPhone).toBeUndefined();
    await pub.get(`/courier-app/${rui}/available`, HOST_B).expect(404);

    const d = (await pub.post(`/courier-app/${rui}/orders/${o.id}/claim`, {}).expect(201)).body;
    expect(d).toMatchObject({ status: 'out', courierName: 'Rui Pega', orderId: o.id });
    // Dois ao mesmo tempo: só o primeiro leva.
    await pub.post(`/courier-app/${ana}/orders/${o.id}/claim`, {}).expect(409);
    const after = (await pub.get(`/courier-app/${ana}/available`).expect(200)).body;
    expect(after.some((x: { orderId: string }) => x.orderId === o.id)).toBe(false);
    // O painel vê a corrida como qualquer outra.
    const active = (await get('adminA', '/deliveries?scope=active').expect(200)).body;
    expect(active.some((x: { id: string }) => x.id === d.id)).toBe(true);

    const [{ code }] = await ownerQuery<{ code: string }>(
      `SELECT confirm_code AS code FROM deliveries WHERE id = $1`,
      [d.id],
    );
    await pub.post(`/courier-app/${rui}/deliveries/${d.id}/complete`, { code }).expect(201);
    const hist = (await pub.get(`/courier-app/${rui}/history`).expect(200)).body;
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0]).toMatchObject({ id: d.id, status: 'delivered' });
    expect(hist.next).toBeNull();
    expect((await pub.get(`/courier-app/${ana}/history`).expect(200)).body.items).toEqual([]);
    const prof = (await pub.get(`/courier-app/${rui}/profile`).expect(200)).body;
    expect(prof).toMatchObject({
      name: 'Rui Pega',
      delivered: 1,
      failed: 0,
      today: 1,
      score: null,
      level: 'novo',
    });
    // Login que não é de um entregador cadastrado não pega corrida.
    await get('adminA', '/deliveries/available').expect(403);
    await get('waiterA', '/deliveries/profile').expect(403);
  });

  it('entregador com login: ativo na Equipe é ativo em Entregas, sem passo extra', async () => {
    const m = (
      await post('adminA', '/users', {
        email: 'moto-equipe@wd-a.test',
        name: 'Moto Equipe',
        password: PASSWORD,
        role: 'driver',
      }).expect(201)
    ).body;
    const userId = m.id as string;
    cookies.moto = await login(HOST_A, 'moto-equipe@wd-a.test');
    const courier = async () =>
      (await get('adminA', '/couriers').expect(200)).body.find(
        (c: { userId: string | null }) => c.userId === userId,
      ) as { id: string; active: boolean };
    const c = await courier();
    expect(c.active).toBe(true);
    await get('moto', '/deliveries/available').expect(200);
    // Abrir o app marca o entregador como visto; cadastrar a mesma pessoa de novo é recusado.
    expect((await courier()) as unknown as { appSeenAt: string | null }).toMatchObject({
      appSeenAt: null,
    });
    await get('moto', '/deliveries?scope=active').expect(200);
    expect(((await courier()) as unknown as { appSeenAt: string | null }).appSeenAt).toBeTruthy();
    const dup = await post('adminA', '/couriers', { name: 'De novo', userId }).expect(409);
    expect(dup.body.message).toMatch(/já está na lista/);
    // Em Entregas não dá para desligar só o cadastro: o acesso é da Equipe.
    await patch('adminA', `/couriers/${c.id}`, { active: false }).expect(409);
    await patch('adminA', `/couriers/${c.id}`, { phone: '11999990000' }).expect(200);
    // Cadastro desligado por versão antiga: voltar o acesso na Equipe religa.
    await ownerQuery(`UPDATE couriers SET active = false WHERE id = $1`, [c.id]);
    await patch('adminA', `/users/${userId}`, { status: 'revoked' }).expect(200);
    expect((await courier()).active).toBe(false);
    await patch('adminA', `/users/${userId}`, { status: 'active' }).expect(200);
    expect((await courier()).active).toBe(true);
    // Deixou de ser entregador: sai da lista de quem leva o pedido.
    await patch('adminA', `/users/${userId}`, { role: 'waiter' }).expect(200);
    expect((await courier()).active).toBe(false);
  });

  it('Equipe › Abrir: o administrador vê a prévia do app do entregador, só leitura', async () => {
    const m = (
      await post('adminA', '/users', {
        email: 'moto-previa@wd-a.test',
        name: 'Moto Prévia',
        password: PASSWORD,
        role: 'driver',
      }).expect(201)
    ).body;
    const userId = m.id as string;
    cookies.motoPrev = await login(HOST_A, 'moto-previa@wd-a.test');
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua Prévia, 9',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('adminA', `/orders/${o.id}/status`, { to: 'ready' }).expect(201);
    // Antes de pegar: o pedido aparece em Disponíveis na prévia, como no app dele.
    const before = (await get('adminA', `/deliveries/preview/${userId}`).expect(200)).body;
    expect(before.courier).toEqual({ name: 'Moto Prévia' });
    expect(before.available.some((x: { orderId: string }) => x.orderId === o.id)).toBe(true);
    expect(before.deliveries).toEqual([]);
    const d = (await post('motoPrev', `/orders/${o.id}/claim`).expect(201)).body;

    const p = (await get('adminA', `/deliveries/preview/${userId}`).expect(200)).body;
    expect(p.deliveries.map((x: { id: string }) => x.id)).toEqual([d.id]);
    expect(p.profile).toMatchObject({ name: 'Moto Prévia', delivered: 0 });
    expect(p.earnings).toBeTruthy();
    expect(p.courier.id).toBeUndefined();
    const h = (await get('adminA', `/deliveries/preview/${userId}/history`).expect(200)).body;
    expect(h).toMatchObject({ items: [], next: null });

    // Só quem gerencia a equipe: caixa, garçom e o próprio entregador não abrem a prévia.
    await get('cashierA', `/deliveries/preview/${userId}`).expect(403);
    await get('waiterA', `/deliveries/preview/${userId}`).expect(403);
    await get('motoPrev', `/deliveries/preview/${userId}`).expect(403);
    await get('motoPrev', `/deliveries/preview/${userId}/history`).expect(403);
    // Outro restaurante não acha o entregador; quem não é entregador não tem prévia.
    await get('adminB', `/deliveries/preview/${userId}`).expect(404);
    const [w] = await ownerQuery<{ id: string }>(
      `SELECT id FROM users WHERE email = 'garcom@wd-a.test'`,
    );
    await get('adminA', `/deliveries/preview/${w.id}`).expect(404);
    await get('adminA', '/deliveries/preview/nao-e-uuid').expect(400);
  });
});
