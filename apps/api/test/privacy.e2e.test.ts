import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * LGPD: o cliente baixa e apaga os próprios dados no cardápio, e a equipe atende pelo cadastro ou
 * pelo telefone. Pedidos ficam (prazo fiscal), sem nome, telefone, endereço e CPF.
 */
const HOST_A = 'lgpd-a.comandou.test';
const HOST_B = 'lgpd-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const staff: Record<string, string> = {};
let seq = 0;
const key = () => `lgpd-key-${Date.now()}-${++seq}`;
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

const post = (url: string, body: object, cookie?: string, host = HOST_A) => {
  const r = http.post(`/api/v1${url}`).set('Host', host).set(CSRF);
  if (cookie) r.set('Cookie', cookie);
  return r.send(body);
};
const get = (url: string, cookie?: string, host = HOST_A) => {
  const r = http.get(`/api/v1${url}`).set('Host', host);
  return cookie ? r.set('Cookie', cookie) : r;
};

async function order(phone: string, name: string, cookie?: string) {
  const r = await post(
    '/store/orders',
    {
      channel: 'pickup',
      token: token(),
      customerName: name,
      customerPhone: phone,
      paymentMethod: 'pix',
      items: [{ productId: fx.prodA, quantity: 1 }],
    },
    cookie,
  )
    .set('Idempotency-Key', key())
    .expect(201);
  const [o] = await ownerQuery<{ id: string }>(
    `SELECT id FROM orders WHERE tenant_id = $1 AND number = $2`,
    [fx.tenantA, r.body.number],
  );
  return o.id;
}
const finish = (id: string, cpf: string | null = null) =>
  ownerQuery(
    `UPDATE orders SET status = 'completed', payment_status = 'paid', tax_document = $2 WHERE id = $1`,
    [id, cpf],
  );

beforeAll(async () => {
  fx = await seedTwoTenants('lgpd');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  staff.adminA = await staffLogin(HOST_A, 'admin@lgpd-a.test');
  staff.adminB = await staffLogin(HOST_B, 'admin@lgpd-b.test');
  staff.waiterA = await staffLogin(HOST_A, 'garcom@lgpd-a.test');
});
afterAll(async () => {
  await app?.close();
});

describe('LGPD pelo cliente (cardápio)', () => {
  let ana: string;
  let anaId: string;
  const orders: string[] = [];

  it('baixa os dados da conta, do telefone e da conversa no WhatsApp', async () => {
    const r = await post('/store/account/signup', {
      name: 'Ana Titular',
      phone: '11966665555',
      email: 'ana@lgpd.test',
      password: 'segredo-ana1',
    }).expect(201);
    ana = cookieFrom(r, 'cm_cid')!;
    anaId = r.body.customer.id;
    await post(
      '/store/account/addresses',
      { street: 'Rua A', number: '1', district: 'Centro' },
      ana,
    ).expect(201);
    orders.push(await order('(11) 96666-5555', 'Ana Titular', ana));
    // Pedido sem a conta, com o telefone escrito de outro jeito: é da mesma pessoa.
    orders.push(await order('+55 11 96666-5555', 'Ana', undefined));
    // Conversa com a IA do WhatsApp (o número chega sem o nono dígito).
    await ownerQuery(
      `INSERT INTO ai_customer_chats (tenant_id, phone, name) VALUES ($1, '551166665555', 'Ana');
       `.trim(),
      [fx.tenantA],
    );
    await ownerQuery(
      `INSERT INTO ai_customer_messages (tenant_id, phone, role, content)
       VALUES ($1, '551166665555', 'user', 'Quero uma pizza')`,
      [fx.tenantA],
    );

    await post('/store/account/privacy/export', {}).expect(401);
    const e = (await post('/store/account/privacy/export', {}, ana).expect(200)).body;
    expect(e.conta).toMatchObject({ name: 'Ana Titular', phone: '11966665555' });
    expect(e.enderecos).toHaveLength(1);
    expect(e.pedidos).toHaveLength(2);
    expect(e.pedidos[0].itens[0]).toMatchObject({ item: 'X-Burguer A', quantidade: 1 });
    expect(e.conversaNoWhatsApp).toEqual([
      expect.objectContaining({ quem: 'user', texto: 'Quero uma pizza' }),
    ]);
    expect(JSON.stringify(e)).not.toContain('password');
  });

  it('apagar fica travado com pedido em andamento e pede senha e APAGAR', async () => {
    await post(
      '/store/account/privacy/erase',
      { password: 'segredo-ana1', confirm: 'sim' },
      ana,
    ).expect(400);
    await post(
      '/store/account/privacy/erase',
      { password: 'errada', confirm: 'APAGAR' },
      ana,
    ).expect(422);
    const blocked = await post(
      '/store/account/privacy/erase',
      { password: 'segredo-ana1', confirm: 'apagar' },
      ana,
    ).expect(409);
    expect(blocked.body.message).toContain('pedido em andamento');
    expect((await get('/store/account', ana).expect(200)).body.customer).toBeTruthy();
  });

  it('apaga a conta; pedidos ficam sem nome, telefone e CPF', async () => {
    await finish(orders[0], '12345678909');
    await finish(orders[1]);
    const r = await post(
      '/store/account/privacy/erase',
      { password: 'segredo-ana1', confirm: 'APAGAR' },
      ana,
    ).expect(200);
    expect(r.body).toMatchObject({ status: 'ok', account: true, orders: 2, chats: 1 });
    expect(r.headers['set-cookie']?.[0]).toMatch(/^cm_cid=;/);
    expect((await get('/store/account', ana).expect(200)).body.customer).toBeNull();

    expect(await ownerQuery(`SELECT 1 FROM customers WHERE id = $1`, [anaId])).toHaveLength(0);
    const left = await ownerQuery<{
      customer_name: string;
      customer_phone: string | null;
      tax_document: string | null;
      customer_id: string | null;
      total: string;
    }>(
      `SELECT customer_name, customer_phone, tax_document, customer_id, total::text
         FROM orders WHERE id = ANY($1)`,
      [orders],
    );
    expect(left).toHaveLength(2);
    for (const o of left)
      expect(o).toMatchObject({
        customer_name: 'Cliente removido',
        customer_phone: null,
        tax_document: null,
        customer_id: null,
        total: '25.90',
      });
    expect(
      await ownerQuery(`SELECT 1 FROM ai_customer_chats WHERE tenant_id = $1`, [fx.tenantA]),
    ).toHaveLength(0);
    // O registro do atendimento não guarda nome nem telefone.
    const log = await ownerQuery<{ kind: string; requested_by: string; summary: unknown }>(
      `SELECT kind, requested_by, summary FROM privacy_requests WHERE tenant_id = $1 ORDER BY created_at`,
      [fx.tenantA],
    );
    expect(log.map((l) => l.kind)).toEqual(['export', 'erase']);
    expect(log.every((l) => l.requested_by === 'customer')).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/6666|Ana/);
    // Entrar de novo com o mesmo telefone: a conta não existe mais.
    await post('/store/account/login', { phone: '11966665555', password: 'segredo-ana1' }).expect(
      401,
    );
  });
});

describe('LGPD pela equipe', () => {
  let bruno: string;

  it('só dono e gerente atendem; outro restaurante não acha nada', async () => {
    bruno = await order('11955554444', 'Bruno Sem Conta');
    await post('/privacy/phone/export', { phone: '11955554444' }, staff.waiterA).expect(403);
    await post('/privacy/phone/export', { phone: '11955554444' }).expect(401);
    await get('/privacy/requests', staff.waiterA).expect(403);
    const b = (
      await post('/privacy/phone/export', { phone: '11955554444' }, staff.adminB, HOST_B).expect(
        200,
      )
    ).body;
    expect(b.pedidos).toHaveLength(0);
    await post('/privacy/phone/export', { phone: '123' }, staff.adminA).expect(422);
  });

  it('exporta e apaga pelo telefone quem pediu sem conta', async () => {
    const e = (
      await post('/privacy/phone/export', { phone: '(11) 95555-4444' }, staff.adminA).expect(200)
    ).body;
    expect(e.conta).toBeNull();
    expect(e.pedidos).toEqual([
      expect.objectContaining({ nome: 'Bruno Sem Conta', telefone: '11955554444' }),
    ]);
    await post(
      '/privacy/phone/erase',
      { phone: '11955554444', confirm: 'APAGAR' },
      staff.adminA,
    ).expect(409);
    // Outro restaurante tentando apagar o mesmo telefone não mexe no pedido de A.
    await finish(bruno);
    await post(
      '/privacy/phone/erase',
      { phone: '11955554444', confirm: 'APAGAR' },
      staff.adminB,
      HOST_B,
    ).expect(200);
    expect(
      (await ownerQuery(`SELECT customer_name FROM orders WHERE id = $1`, [bruno]))[0],
    ).toEqual({ customer_name: 'Bruno Sem Conta' });

    const r = await post(
      '/privacy/phone/erase',
      { phone: '11955554444', confirm: 'APAGAR' },
      staff.adminA,
    ).expect(200);
    expect(r.body).toMatchObject({ status: 'ok', account: false, orders: 1 });
    expect(
      (
        await ownerQuery(`SELECT customer_name, customer_phone FROM orders WHERE id = $1`, [bruno])
      )[0],
    ).toEqual({ customer_name: 'Cliente removido', customer_phone: null });
  });

  it('apaga pelo cadastro do cliente e mostra o histórico sem dado pessoal', async () => {
    const r = await post('/store/account/signup', {
      name: 'Carla',
      phone: '11944443333',
      password: 'segredo-carla',
    }).expect(201);
    const id = r.body.customer.id as string;
    await post(
      `/privacy/customers/${id}/erase`,
      { confirm: 'APAGAR' },
      staff.adminB,
      HOST_B,
    ).expect(404);
    await post(`/privacy/customers/${id}/export`, {}, staff.adminA).expect(200);
    await post(`/privacy/customers/${id}/erase`, { confirm: 'APAGAR' }, staff.adminA).expect(200);
    await get(`/customers/${id}`, staff.adminA).expect(404);

    const h = (await get('/privacy/requests', staff.adminA).expect(200)).body as {
      kind: string;
      requestedBy: string;
      actorName: string | null;
    }[];
    expect(h[0]).toMatchObject({ kind: 'erase', requestedBy: 'staff' });
    expect(h[0].actorName).toBeTruthy();
    expect(JSON.stringify(h)).not.toMatch(/4444|3333|Carla|Bruno/);
  });
});
