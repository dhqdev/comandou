import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Cadastro do cliente no cardápio com o WhatsApp da loja ligado: a conta só nasce com o código
 * que chegou no celular (ninguém cadastra o número de outra pessoa). Sem WhatsApp, segue como era.
 */
const HOST_A = 'sc-a.comandou.test';
const HOST_B = 'sc-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const GW_TOKEN = 'token-interno-gateway-cadastro-123';

const gwSent: { tenant: string; to: string; text: string }[] = [];
let app: INestApplication;
let gateway: Server;
let fx: Fixture;
let http: ReturnType<typeof request>;
let admin = '';

const pub = (url: string, body: object, host = HOST_A) =>
  http.post(`/api/v1${url}`).set('Host', host).set(CSRF).send(body);

beforeAll(async () => {
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (req.headers.authorization !== `Bearer ${GW_TOKEN}`) return send(401, {});
      const m = /^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(start|messages))?$/.exec(req.url!);
      if (!m) return send(404, {});
      if (m[2] === 'messages') {
        const b = JSON.parse(raw || '{}') as { to: string; text: string };
        gwSent.push({ tenant: m[1]!, ...b });
        return send(200, { id: `BAE${gwSent.length}` });
      }
      send(200, { status: 'connected', phone: '5511999990000' });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  fx = await seedTwoTenants('sc');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST_A)
    .set(CSRF)
    .send({ email: 'admin@sc-a.test', password: PASSWORD });
  admin = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  await http
    .put('/api/v1/messaging/settings')
    .set('Host', HOST_A)
    .set(CSRF)
    .set('Cookie', admin)
    .send({ provider: 'baileys', enabled: true })
    .expect(200);
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => gateway?.close(r));
});

describe('cadastro com código no WhatsApp', () => {
  const body = { name: 'Rita Cliente', phone: '(11) 97654-3210', password: 'segredo-da-rita' };

  it('sem o código, a conta não nasce', async () => {
    const r = await pub('/store/account/signup', body).expect(422);
    expect(r.body.code).toBe('phone_code_required');
  });

  it('o código chega no WhatsApp do número; errado não vale, certo cria a conta', async () => {
    const asked = await pub('/store/account/signup/code', { phone: body.phone }).expect(200);
    expect(asked.body.channel).toBe('whatsapp');
    const msg = gwSent.at(-1)!;
    expect(msg.tenant).toBe(fx.tenantA);
    expect(msg.text).toMatch(/confirmar o celular/);
    const code = /^(\d{6})/.exec(msg.text)![1]!;
    const wrong = code === '000000' ? '111111' : '000000';
    await pub('/store/account/signup', { ...body, code: wrong }).expect(401);
    const ok = await pub('/store/account/signup', { ...body, code }).expect(201);
    expect(ok.body.customer.name).toBe('Rita Cliente');
    const [c] = await ownerQuery<{ verified: boolean }>(
      `SELECT phone_verified_at IS NOT NULL AS verified FROM customers
        WHERE tenant_id = $1 AND phone = '11976543210'`,
      [fx.tenantA],
    );
    expect(c!.verified).toBe(true);
    // O código é de uso único.
    await pub('/store/account/signup', { ...body, phone: body.phone, code }).expect(401);
  });

  it('sem WhatsApp na loja, o cadastro segue sem código', async () => {
    const asked = await pub('/store/account/signup/code', { phone: body.phone }, HOST_B).expect(
      200,
    );
    expect(asked.body.channel).toBe('none');
    await pub('/store/account/signup', body, HOST_B).expect(201);
  });
});
