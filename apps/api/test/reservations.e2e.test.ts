import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Reservas de mesa (cardápio online + agenda da equipe) e calendário de vendas do mês.
 * Sempre pela API HTTP real, com dois restaurantes.
 */
const HOST_A = 'resv-a.comandou.test';
const HOST_B = 'resv-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
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
/** Cliente final: reserva só com a conta aberta (cookie cm_cid). */
const shopper = { cookie: '' };
const pub = {
  get: (url: string, host = HOST_A) => http.get(`/api/v1${url}`).set('Host', host),
  post: (url: string, body: object = {}, host = HOST_A) => {
    const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
    if (shopper.cookie && host === HOST_A) r.set('Cookie', shopper.cookie);
    return r.send(body);
  },
};

/** Data local (fuso do restaurante, São Paulo) daqui a N dias. */
function localDate(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

beforeAll(async () => {
  fx = await seedTwoTenants('resv');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@resv-a.test');
  cookies.adminB = await login(HOST_B, 'admin@resv-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@resv-a.test');
  const su = await pub
    .post('/store/account/signup', {
      name: 'Joana Cliente',
      phone: '11977771234',
      password: 'segredo1',
    })
    .expect(201);
  const raw = su.headers['set-cookie'] as unknown as string[];
  shopper.cookie = raw.find((c) => c.startsWith('cm_cid='))!.split(';')[0]!;
});
afterAll(async () => {
  await app?.close();
});

describe('Reservas', () => {
  const day = localDate(3);
  let slot: { time: string; startsAt: string; remaining: number | null };
  let clientToken: string;

  it('começam desligadas; só quem gerencia configura', async () => {
    expect((await pub.get('/store/reservations/config').expect(200)).body).toEqual({
      enabled: false,
    });
    await pub.get(`/store/reservations/availability?date=${day}`).expect(404);
    await patch('waiterA', '/reservations/settings', { enabled: true }).expect(403);
    const s = (
      await patch('adminA', '/reservations/settings', {
        enabled: true,
        opensAt: '19:00',
        closesAt: '21:00',
        slotMinutes: 30,
        durationMinutes: 60,
        capacity: 6,
        maxParty: 6,
        minAdvanceMinutes: 0,
        note: 'Tolerância de 15 minutos',
      }).expect(200)
    ).body;
    expect(s).toMatchObject({ enabled: true, opensAt: '19:00', capacity: 6 });
    const cfg = (await pub.get('/store/reservations/config').expect(200)).body;
    expect(cfg).toMatchObject({
      enabled: true,
      maxParty: 6,
      note: 'Tolerância de 15 minutos',
      needsAccount: true,
    });
    // Restaurante B continua sem reservas.
    expect((await pub.get('/store/reservations/config', HOST_B).expect(200)).body.enabled).toBe(
      false,
    );
  });

  it('lista os horários do dia no fuso do restaurante', async () => {
    const a = (await pub.get(`/store/reservations/availability?date=${day}`).expect(200)).body;
    expect(a.slots.map((s: { time: string }) => s.time)).toEqual([
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
    ]);
    slot = a.slots[2];
    expect(slot).toMatchObject({ remaining: 6, available: true });
    // 19:00 em São Paulo = 22:00 UTC.
    expect(new Date(a.slots[0].startsAt).getUTCHours()).toBe(22);
  });

  it('cliente reserva; reenviar o mesmo token não duplica', async () => {
    clientToken = token();
    const body = {
      token: clientToken,
      name: 'Joana Cliente',
      phone: '(11) 97777-1234',
      partySize: 4,
      startsAt: slot.startsAt,
      occasion: 'Aniversário',
    };
    // Reserva só com cadastro: sem a conta aberta, o cardápio pede o login.
    const cookie = shopper.cookie;
    shopper.cookie = '';
    const anon = await pub.post('/store/reservations', body).expect(403);
    expect(anon.body).toMatchObject({ code: 'login_required' });
    shopper.cookie = cookie;
    const r = (await pub.post('/store/reservations', body).expect(201)).body;
    expect(r).toMatchObject({ status: 'pending', partySize: 4, canCancel: true });
    expect(r.code).toMatch(/^[A-Z0-9]{5}$/);
    const again = (await pub.post('/store/reservations', body).expect(201)).body;
    expect(again.code).toBe(r.code);
    const list = (
      await get(
        'adminA',
        `/reservations?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())}`,
      ).expect(200)
    ).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Joana Cliente',
      phone: '11977771234',
      source: 'online',
    });
    // Restaurante B não vê.
    const listB = (
      await get(
        'adminB',
        `/reservations?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())}`,
      ).expect(200)
    ).body;
    expect(listB).toHaveLength(0);
  });

  it('respeita a capacidade, o tamanho do grupo e os horários válidos', async () => {
    const a = (await pub.get(`/store/reservations/availability?date=${day}`).expect(200)).body;
    const at = (t: string) => a.slots.find((s: { time: string }) => s.time === t);
    // 4 de 6 lugares ocupados das 20:00 às 21:00: 19:30 e 20:30 se sobrepõem.
    expect(at('19:30').remaining).toBe(2);
    expect(at('20:00').remaining).toBe(2);
    expect(at('19:00').remaining).toBe(6);
    const base = { name: 'Pedro', phone: '11966665555', occasion: null };
    await pub
      .post('/store/reservations', {
        ...base,
        token: token(),
        partySize: 3,
        startsAt: slot.startsAt,
      })
      .expect(409);
    await pub
      .post('/store/reservations', {
        ...base,
        token: token(),
        partySize: 7,
        startsAt: slot.startsAt,
      })
      .expect(422);
    // Horário fora da grade.
    const off = new Date(Date.parse(slot.startsAt) + 10 * 60_000).toISOString();
    await pub
      .post('/store/reservations', { ...base, token: token(), partySize: 2, startsAt: off })
      .expect(422);
    await pub
      .post('/store/reservations', {
        ...base,
        token: token(),
        partySize: 2,
        startsAt: at('19:00').startsAt,
      })
      .expect(201);
  });

  it('equipe confirma, marca mesa e o cliente acompanha e cancela pelo link', async () => {
    const [table] = await ownerQuery<{ id: string }>(
      `INSERT INTO dining_tables (tenant_id, label, seats) VALUES ($1, 'R1', 4) RETURNING id`,
      [fx.tenantA],
    );
    const list = (
      await get(
        'adminA',
        `/reservations?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())}`,
      ).expect(200)
    ).body as { id: string; name: string }[];
    const joana = list.find((r) => r.name === 'Joana Cliente')!;
    const up = (
      await patch('adminA', `/reservations/${joana.id}`, {
        status: 'confirmed',
        tableId: table!.id,
      }).expect(200)
    ).body;
    expect(up).toMatchObject({ status: 'confirmed', tableLabel: 'R1' });
    const view = (await pub.get(`/store/reservations/${clientToken}`).expect(200)).body;
    expect(view).toMatchObject({ status: 'confirmed', tableLabel: 'R1', canCancel: true });
    expect(view.phone).toBeUndefined();
    const c = (await pub.post(`/store/reservations/${clientToken}/cancel`).expect(200)).body;
    expect(c).toMatchObject({ status: 'cancelled', canCancel: false });
    // O lugar volta a ficar livre.
    const a = (await pub.get(`/store/reservations/availability?date=${day}`).expect(200)).body;
    expect(a.slots.find((s: { time: string }) => s.time === '20:00').remaining).toBe(6);
  });

  it('equipe lança reserva por telefone sem passar pelas regras do cardápio', async () => {
    const r = (
      await post('adminA', '/reservations', {
        name: 'Grupo da firma',
        phone: '11955554444',
        partySize: 20,
        startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        staffNotes: 'Juntar mesas do fundo',
      }).expect(201)
    ).body;
    expect(r).toMatchObject({ status: 'confirmed', source: 'staff', partySize: 20 });
    // Reservas ficam com caixa/gerente: o app do garçom não mexe nelas.
    await get('waiterA', '/reservations').expect(403);
    await post('adminA', '/reservations', {
      name: 'X',
      phone: '123',
      partySize: 2,
      startsAt: new Date().toISOString(),
    }).expect(422);
  });
});

describe('Reservas × mesas', () => {
  // Duração das reservas configurada acima: 60 minutos.
  const base = Date.now() + 5 * 86_400_000;
  const at = (min: number) => new Date(base + min * 60_000).toISOString();
  let mesa: string;
  const staff = (name: string, startsAt: string, extra: object = {}) =>
    post('adminA', '/reservations', {
      name,
      phone: '11955550000',
      partySize: 2,
      startsAt,
      tableId: mesa,
      ...extra,
    });

  beforeAll(async () => {
    const [t] = await ownerQuery<{ id: string }>(
      `INSERT INTO dining_tables (tenant_id, label, seats) VALUES ($1, 'M9', 4) RETURNING id`,
      [fx.tenantA],
    );
    mesa = t!.id;
  });

  it('a mesma mesa não fica com duas reservas no mesmo horário', async () => {
    const a = (await staff('Ana', at(0)).expect(201)).body;
    // Começa durante a reserva da Ana (que vai até +60 min).
    const clash = await staff('Bruno', at(30)).expect(409);
    expect(clash.body.code).toBe('table_reserved');
    expect(clash.body.message).toContain('M9');
    expect(clash.body.message).toContain('Ana');
    // Termina dentro da reserva da Ana.
    await staff('Bruno', at(-30)).expect(409);
    // Logo depois (encostado) não conflita.
    const b = (await staff('Bruno', at(60)).expect(201)).body;
    // Sem mesa, entra (a equipe escolhe a mesa depois).
    const c = (await staff('Carla', at(0), { tableId: null }).expect(201)).body;
    // Marcar a mesa ocupada na Carla, ou mover a do Bruno para cima da Ana, é barrado.
    await patch('adminA', `/reservations/${c.id}`, { tableId: mesa }).expect(409);
    await patch('adminA', `/reservations/${b.id}`, { startsAt: at(15) }).expect(409);
    // Mexer em outra coisa da reserva da Ana não se bloqueia sozinha.
    await patch('adminA', `/reservations/${a.id}`, { partySize: 3 }).expect(200);
    // Cancelou a da Ana: a mesa libera; reabrir a da Ana agora conflita com a Carla.
    await patch('adminA', `/reservations/${a.id}`, { status: 'cancelled' }).expect(200);
    await patch('adminA', `/reservations/${c.id}`, { tableId: mesa }).expect(200);
    const reopen = await patch('adminA', `/reservations/${a.id}`, { status: 'confirmed' });
    expect(reopen.status).toBe(409);
    // "Não veio" também libera a mesa.
    await patch('adminA', `/reservations/${c.id}`, { status: 'no_show' }).expect(200);
    await patch('adminA', `/reservations/${a.id}`, { status: 'confirmed' }).expect(200);
  });

  it('duas pessoas marcando a mesma mesa ao mesmo tempo: só uma fica', async () => {
    const t = at(600);
    const tries = await Promise.all(Array.from({ length: 5 }, (_, i) => staff(`Corrida ${i}`, t)));
    const codes = tries.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
  });

  it('grupo chega com a mesa ocupada: avisa; ao fechar a conta, a reserva termina', async () => {
    const [t] = await ownerQuery<{ id: string }>(
      `INSERT INTO dining_tables (tenant_id, label, seats) VALUES ($1, 'M10', 4) RETURNING id`,
      [fx.tenantA],
    );
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const r = (await staff('Dani', soon, { tableId: t!.id }).expect(201)).body;
    // O salão mostra a reserva na mesa livre.
    const tables = (await get('adminA', '/tables').expect(200)).body as {
      id: string;
      reservationName: string | null;
      reservationStatus: string | null;
    }[];
    expect(tables.find((x) => x.id === t!.id)).toMatchObject({
      reservationName: 'Dani',
      reservationStatus: 'confirmed',
    });
    // Outro cliente sentou na mesa antes.
    const tab = (await post('adminA', '/tabs', { tableId: t!.id }).expect(201)).body;
    const busy = await patch('adminA', `/reservations/${r.id}`, { status: 'seated' }).expect(409);
    expect(busy.body.code).toBe('table_busy');
    expect(busy.body.message).toContain(`#${tab.number}`);
    // A equipe confere que a comanda é do grupo e segue.
    await patch('adminA', `/reservations/${r.id}`, {
      status: 'seated',
      tableBusyOk: true,
    }).expect(200);
    // Conta fechada: a reserva conclui sozinha e a mesa fica livre na agenda.
    await post('adminA', `/tabs/${tab.id}/close`).expect(201);
    const list = (
      await get(
        'adminA',
        `/reservations?from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`,
      ).expect(200)
    ).body as { id: string; status: string }[];
    expect(list.find((x) => x.id === r.id)?.status).toBe('completed');
  });

  it('chegar numa mesa livre não pede confirmação', async () => {
    const [t] = await ownerQuery<{ id: string }>(
      `INSERT INTO dining_tables (tenant_id, label, seats) VALUES ($1, 'M11', 4) RETURNING id`,
      [fx.tenantA],
    );
    const r = (
      await staff('Edu', new Date(Date.now() + 20 * 60_000).toISOString(), {
        tableId: t!.id,
      }).expect(201)
    ).body;
    await patch('adminA', `/reservations/${r.id}`, { status: 'seated' }).expect(200);
    // Mesa da reserva sentada: outra reserva no mesmo horário continua barrada.
    await staff('Fábio', new Date(Date.now() + 40 * 60_000).toISOString(), {
      tableId: t!.id,
    }).expect(409);
  });
});

describe('Calendário de vendas', () => {
  it('soma faturamento, custo pela ficha técnica e lucro por dia', async () => {
    const [item] = await ownerQuery<{ id: string }>(
      `INSERT INTO stock_items (tenant_id, name, unit, quantity, avg_cost, allow_negative)
       VALUES ($1, 'Pão calendário', 'un', 100, 2.5, true) RETURNING id`,
      [fx.tenantA],
    );
    await ownerQuery(
      `INSERT INTO product_recipes (tenant_id, product_id, stock_item_id, quantity) VALUES ($1,$2,$3,2)`,
      [fx.tenantA, fx.prodA, item!.id],
    );
    await post('adminA', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 2 }],
    }).expect(201);
    const month = localDate(0).slice(0, 7);
    await get('waiterA', `/reports/calendar?month=${month}`).expect(403);
    await get('adminA', '/reports/calendar?month=2026-13').expect(400);
    const cal = (await get('adminA', `/reports/calendar?month=${month}`).expect(200)).body;
    const today = cal.days.find((d: { day: string }) => d.day === cal.today);
    // 2 × 25,90 = 51,80; custo 2 × (2 × 2,50) = 10,00.
    expect(today).toMatchObject({ orders: 1, revenue: '51.80', cost: '10.00' });
    expect(cal.topProducts[0]).toMatchObject({
      name: 'X-Burguer A',
      cost: '10.00',
      hasRecipe: true,
    });
    expect(cal.coverage.withoutRecipe).toBe('0.00');
    expect(cal.expenses).toMatchObject({ paid: '0.00', count: 0 });
    // Restaurante B não vê as vendas de A.
    const calB = (await get('adminB', `/reports/calendar?month=${month}`).expect(200)).body;
    expect(calB.days).toHaveLength(0);
  });

  it('análise do período: totais, comparação, produtos, mapa e clientes', async () => {
    await post('adminA', '/orders', {
      channel: 'delivery',
      customerName: 'Joana',
      customerPhone: '11988887777',
      deliveryAddress: 'Rua A, 1',
      items: [{ productId: fx.prodA, quantity: 1 }],
    }).expect(201);
    const today = localDate(0);
    const from = localDate(-6);
    const qs = `from=${from}&to=${today}`;
    await get('waiterA', `/reports/insights?${qs}`).expect(403);
    await get('adminA', `/reports/insights?from=${today}&to=${from}`).expect(400);
    await get('adminA', '/reports/insights?from=2020-01-01&to=2026-01-01').expect(400);
    const r = (await get('adminA', `/reports/insights?${qs}`).expect(200)).body;
    expect(r.days).toBe(7);
    expect(r.totals.orders).toBeGreaterThanOrEqual(2);
    expect(Number(r.totals.cost)).toBeGreaterThan(0);
    expect(r.previous).toMatchObject({ orders: expect.any(Number) });
    expect(r.products[0]).toMatchObject({ name: 'X-Burguer A', hasRecipe: true });
    expect(r.heat.length).toBeGreaterThan(0);
    expect(r.daily.some((d: { day: string }) => d.day === today)).toBe(true);
    expect(r.customers.identified).toBeGreaterThanOrEqual(1);
    expect(r.customers.new).toBeGreaterThanOrEqual(1);
    // Filtro de canal: só delivery.
    const del = (await get('adminA', `/reports/insights?${qs}&channel=delivery`).expect(200)).body;
    expect(del.channel).toBe('delivery');
    expect(del.totals.orders).toBeLessThan(r.totals.orders);
    expect(del.idle).toEqual([]);
    // Restaurante B não vê as vendas de A.
    const rb = (await get('adminB', `/reports/insights?${qs}`).expect(200)).body;
    expect(rb.totals.orders).toBe(0);
    expect(rb.products).toHaveLength(0);
  });
});
