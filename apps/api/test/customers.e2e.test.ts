import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Conta do cliente no cardápio online, banners/destaques e a aba Clientes do restaurante.
 * Sempre pela API HTTP real, com dois restaurantes (a conta de um não existe no outro).
 */
const HOST_A = 'conta-a.comandou.test';
const HOST_B = 'conta-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const staff: Record<string, string> = {};
let seq = 0;
const key = () => `conta-key-${Date.now()}-${++seq}`;
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

/** Cliente final (cookie opcional da conta). */
const c = {
  get: (url: string, cookie?: string, host = HOST_A) => {
    const r = http.get(`/api/v1${url}`).set('Host', host);
    return cookie ? r.set('Cookie', cookie) : r;
  },
  send: (
    method: 'post' | 'patch' | 'delete',
    url: string,
    body: object,
    cookie?: string,
    host = HOST_A,
  ) => {
    const r = http[method](`/api/v1${url}`).set('Host', host).set(CSRF);
    if (cookie) r.set('Cookie', cookie);
    return r.send(body);
  },
};
const admin = {
  get: (url: string, who = 'adminA') =>
    http
      .get(`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who]),
  send: (method: 'post' | 'patch' | 'delete', url: string, body: object, who = 'adminA') =>
    http[method](`/api/v1${url}`)
      .set('Host', who === 'adminB' ? HOST_B : HOST_A)
      .set('Cookie', staff[who])
      .set(CSRF)
      .send(body),
};

beforeAll(async () => {
  fx = await seedTwoTenants('conta');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  staff.adminA = await staffLogin(HOST_A, 'admin@conta-a.test');
  staff.adminB = await staffLogin(HOST_B, 'admin@conta-b.test');
  staff.waiterA = await staffLogin(HOST_A, 'garcom@conta-a.test');
});
afterAll(async () => {
  await app?.close();
});

let maria: string;
let addressId: string;

describe('Conta do cliente', () => {
  it('sem conta, /store/account responde sem erro', async () => {
    const r = await c.get('/store/account').expect(200);
    expect(r.body).toEqual({ customer: null, addresses: [] });
  });

  it('cria conta com telefone e senha; o cookie é só do cliente', async () => {
    await c
      .send('post', '/store/account/signup', {
        name: 'Maria',
        phone: '11 9888',
        password: 'segredo1',
      })
      .expect(400);
    await c
      .send('post', '/store/account/signup', { name: 'Maria', phone: '11988887777', password: '1' })
      .expect(400);
    const r = await c
      .send('post', '/store/account/signup', {
        name: 'Maria Cliente',
        phone: '+55 (11) 98888-7777',
        email: 'maria@cliente.test',
        password: 'segredo1',
      })
      .expect(201);
    maria = cookieFrom(r, 'cm_cid')!;
    expect(maria).toBeTruthy();
    expect(cookieFrom(r, 'cm_sid')).toBeUndefined();
    expect(r.body.customer).toMatchObject({ name: 'Maria Cliente', phone: '11988887777' });
    expect(JSON.stringify(r.body)).not.toContain('password');
    // Mesmo telefone (escrito de outro jeito) não cria outra conta.
    await c
      .send('post', '/store/account/signup', {
        name: 'Outra',
        phone: '(11) 98888-7777',
        password: 'segredo2',
      })
      .expect(409);
    // A conta do cliente não abre o sistema da equipe.
    await c.get('/auth/me', maria).expect(401);
  });

  it('entra com a senha certa; errada dá 401; conta de A não existe em B', async () => {
    await c
      .send('post', '/store/account/login', { phone: '11988887777', password: 'errada' })
      .expect(401);
    await c
      .send(
        'post',
        '/store/account/login',
        { phone: '11988887777', password: 'segredo1' },
        undefined,
        HOST_B,
      )
      .expect(401);
    const r = await c
      .send('post', '/store/account/login', { phone: '(11) 98888-7777', password: 'segredo1' })
      .expect(200);
    expect(cookieFrom(r, 'cm_cid')).toBeTruthy();
    // Cookie de A apresentado em B: sem conta.
    expect((await c.get('/store/account', maria, HOST_B).expect(200)).body.customer).toBeNull();
  });

  it('edita dados e endereços (o primeiro vira padrão)', async () => {
    const p = await c
      .send('patch', '/store/account', { name: 'Maria C.', marketingOptIn: true }, maria)
      .expect(200);
    expect(p.body.customer).toMatchObject({ name: 'Maria C.', marketingOptIn: true });
    await c.send('patch', '/store/account', { name: 'X' }).expect(401);

    const a1 = await c
      .send(
        'post',
        '/store/account/addresses',
        { label: 'Casa', street: 'Rua das Flores', number: '120', district: 'Centro' },
        maria,
      )
      .expect(201);
    expect(a1.body.isDefault).toBe(true);
    addressId = a1.body.id;
    const a2 = await c
      .send(
        'post',
        '/store/account/addresses',
        { label: 'Trabalho', street: 'Av. Paulista', number: '1000', district: 'Bela Vista' },
        maria,
      )
      .expect(201);
    await c
      .send('patch', `/store/account/addresses/${a2.body.id}`, { isDefault: true }, maria)
      .expect(200);
    const acc = (await c.get('/store/account', maria).expect(200)).body;
    expect(acc.addresses.map((x: { label: string }) => x.label)).toEqual(['Trabalho', 'Casa']);
    await c.send('delete', `/store/account/addresses/${a2.body.id}`, {}, maria).expect(200);
    const acc2 = (await c.get('/store/account', maria).expect(200)).body;
    expect(acc2.addresses).toHaveLength(1);
    expect(acc2.addresses[0]).toMatchObject({ id: addressId, isDefault: true });
  });

  it('pedido com a conta aberta entra no histórico; cliente vê e cancela o seu', async () => {
    const r = await c
      .send(
        'post',
        '/store/orders',
        {
          channel: 'pickup',
          token: token(),
          customerName: 'Maria C.',
          customerPhone: '(11) 98888-7777',
          paymentMethod: 'pix',
          items: [{ productId: fx.prodA, quantity: 2 }],
        },
        maria,
      )
      .set('Idempotency-Key', key())
      .expect(201);
    const hist = (await c.get('/store/account/orders', maria).expect(200)).body;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ number: r.body.number, step: 'awaiting', total: '51.80' });
    expect(hist[0].items[0]).toMatchObject({ name: 'X-Burguer A', quantity: 2 });
    const det = (await c.get(`/store/account/orders/${hist[0].id}`, maria).expect(200)).body;
    expect(det).toMatchObject({ number: r.body.number, canCancel: true });
    await c.get(`/store/account/orders/${hist[0].id}`).expect(401);

    // Outro cliente não vê nem cancela o pedido da Maria.
    const joao = cookieFrom(
      await c
        .send('post', '/store/account/signup', {
          name: 'João',
          phone: '11977776666',
          password: 'segredo3',
        })
        .expect(201),
      'cm_cid',
    )!;
    await c.get(`/store/account/orders/${hist[0].id}`, joao).expect(404);
    await c.send('post', `/store/account/orders/${hist[0].id}/cancel`, {}, joao).expect(404);
    await c.send('post', `/store/account/orders/${hist[0].id}/cancel`, {}, maria).expect(200);
    expect((await c.get('/store/account/orders', maria).expect(200)).body[0].step).toBe(
      'cancelled',
    );
  });

  it('trocar a senha exige a atual; sair encerra a sessão', async () => {
    await c
      .send('post', '/store/account/password', { current: 'x', next: 'nova-senha' }, maria)
      .expect(401);
    await c
      .send('post', '/store/account/password', { current: 'segredo1', next: 'nova-senha' }, maria)
      .expect(200);
    expect((await c.get('/store/account', maria).expect(200)).body.customer).toBeTruthy();
    await c.send('post', '/store/account/logout', {}, maria).expect(204);
    expect((await c.get('/store/account', maria).expect(200)).body.customer).toBeNull();
    const r = await c
      .send('post', '/store/account/login', { phone: '11988887777', password: 'nova-senha' })
      .expect(200);
    maria = cookieFrom(r, 'cm_cid')!;
  });
});

describe('Aba Clientes (equipe)', () => {
  it('lista com totais e busca; garçom não vê; outro restaurante não vê', async () => {
    const l = (await admin.get('/customers').expect(200)).body;
    expect(l.summary).toMatchObject({ total: 2, new30: 2 });
    const m = l.customers.find((x: { name: string }) => x.name === 'Maria C.');
    expect(m).toMatchObject({ phone: '11988887777', orders: 0, blocked: false });
    expect(JSON.stringify(l)).not.toContain('password');
    const s = (await admin.get('/customers?search=98888').expect(200)).body;
    expect(s.customers).toHaveLength(1);
    expect(
      (await admin.get('/customers?search=jo%C3%A3o').expect(200)).body.customers,
    ).toHaveLength(1);
    await http
      .get('/api/v1/customers')
      .set('Host', HOST_A)
      .set('Cookie', staff.waiterA)
      .expect(403);
    expect((await admin.get('/customers', 'adminB').expect(200)).body.customers).toHaveLength(0);
    await admin.get(`/customers/${m.id}`, 'adminB').expect(404);
  });

  it('detalhe com endereços e pedidos; bloquear derruba a sessão do cliente', async () => {
    const l = (await admin.get('/customers?search=Maria').expect(200)).body;
    const id = l.customers[0].id;
    const d = (await admin.get(`/customers/${id}`).expect(200)).body;
    expect(d.addresses).toHaveLength(1);
    expect(d.orders).toHaveLength(1);
    const u = (
      await admin.send('patch', `/customers/${id}`, { staffNotes: 'Cliente VIP', blocked: true })
    ).body;
    expect(u).toMatchObject({ staffNotes: 'Cliente VIP', blocked: true });
    expect((await c.get('/store/account', maria).expect(200)).body.customer).toBeNull();
    await c
      .send('post', '/store/account/login', { phone: '11988887777', password: 'nova-senha' })
      .expect(403);
    await admin.send('patch', `/customers/${id}`, { blocked: false }).expect(200);
    await c
      .send('post', '/store/account/login', { phone: '11988887777', password: 'nova-senha' })
      .expect(200);
  });
});

describe('Personalização do cardápio', () => {
  it('aparência, destaque e banners aparecem no cardápio público', async () => {
    await admin
      .send('patch', '/store/settings', {
        theme: 'dark',
        headline: 'Fome de quê?',
        featuredTitle: 'Os queridinhos',
      })
      .expect(200);
    await admin
      .send('patch', `/products/${fx.prodA}`, { featured: true, badge: 'Picante' })
      .expect(200);
    await admin
      .send('post', '/store/banners', { title: 'Combo', targetType: 'product', targetId: fx.prodB })
      .expect(404); // produto de outro restaurante
    await admin
      .send('post', '/store/banners', { title: 'Sem destino', targetType: 'product' })
      .expect(422);
    const b = await admin
      .send('post', '/store/banners', {
        title: 'Combo do dia',
        subtitle: 'Burguer + fritas',
        tag: '20% OFF',
        cta: 'Pedir agora',
        targetType: 'product',
        targetId: fx.prodA,
      })
      .expect(201);
    await admin.send('post', '/store/banners', { title: 'Inativo', active: false }).expect(201);
    await http
      .post('/api/v1/store/banners')
      .set('Host', HOST_A)
      .set('Cookie', staff.waiterA)
      .set(CSRF)
      .send({ title: 'x' })
      .expect(403);

    const m = (await c.get('/store').expect(200)).body;
    expect(m.appearance).toMatchObject({
      theme: 'dark',
      headline: 'Fome de quê?',
      featuredTitle: 'Os queridinhos',
      accountsEnabled: true,
    });
    expect(m.banners).toHaveLength(1);
    expect(m.banners[0]).toMatchObject({
      id: b.body.id,
      title: 'Combo do dia',
      tag: '20% OFF',
      targetType: 'product',
      targetId: fx.prodA,
    });
    const p = m.categories.flatMap((x: { products: unknown[] }) => x.products)[0];
    expect(p).toMatchObject({ featured: true, badge: 'Picante' });
    expect(m.popular).toEqual([]); // o único pedido foi cancelado
    // B não vê nada de A.
    expect((await c.get('/store', undefined, HOST_B).expect(200)).body.banners).toHaveLength(0);

    await admin.send('patch', `/store/banners/${b.body.id}`, { active: false }).expect(200);
    expect((await c.get('/store').expect(200)).body.banners).toHaveLength(0);
    await admin.send('delete', `/store/banners/${b.body.id}`, {}).expect(200);
    expect((await admin.get('/store/banners').expect(200)).body).toHaveLength(1);
  });

  it('restaurante pode desligar as contas', async () => {
    await admin.send('patch', '/store/settings', { accountsEnabled: false }).expect(200);
    await c
      .send('post', '/store/account/signup', {
        name: 'Ana',
        phone: '11955554444',
        password: 'segredo4',
      })
      .expect(403);
    await admin.send('patch', '/store/settings', { accountsEnabled: true }).expect(200);
  });
});
