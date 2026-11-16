import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { seal } from '../src/common/secret-box';
import { CUSTOMER_EMAIL_SECRET_CONTEXT } from '../src/store/customer-mail.service';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Esqueci minha senha do cliente pelo e-mail (webhook do n8n em Super Admin › Site), na loja sem
 * WhatsApp conectado: vai um código, não uma senha nova, com o nome do restaurante.
 */
const HOST = 'mail-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = 'segredo-clientes-123';

let app: INestApplication;
let http: ReturnType<typeof request>;
let hook: Server;
let hookUrl = '';
const received: { headers: IncomingHttpHeaders; body: Record<string, string> }[] = [];

const post = (url: string, body: object) =>
  http.post(`/api/v1${url}`).set('Host', HOST).set(CSRF).send(body);

beforeAll(async () => {
  await seedTwoTenants('mail');
  hook = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(raw) });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/webhook/comandou-clientes`;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await ownerQuery(
    `UPDATE platform_site_settings SET customer_email_webhook_url = '', customer_email_token_enc = NULL`,
  );
  await app?.close();
  await new Promise((r) => hook?.close(r));
});

describe('Esqueci minha senha por e-mail', () => {
  it('sem webhook e sem WhatsApp, manda falar com o restaurante', async () => {
    await post('/store/account/signup', {
      name: 'Joana Lima',
      phone: '11977776666',
      email: 'joana@cliente.test',
      password: 'segredo1',
    }).expect(201);
    await post('/store/account/signup', {
      name: 'Sem Email',
      phone: '11966665555',
      password: 'segredo1',
    }).expect(201);
    const r = await post('/store/account/password/forgot', { phone: '11977776666' }).expect(200);
    expect(r.body).toEqual({ channel: 'restaurant' });
  });

  it('com webhook, o código vai para o e-mail da conta com o nome do restaurante', async () => {
    await ownerQuery(
      `UPDATE platform_site_settings SET customer_email_webhook_url = $1, customer_email_token_enc = $2`,
      [hookUrl, seal(KEY, SECRET, CUSTOMER_EMAIL_SECRET_CONTEXT)],
    );
    const r = await post('/store/account/password/forgot', { phone: '11977776666' }).expect(200);
    expect(r.body).toEqual({ channel: 'email' });
    expect(received).toHaveLength(1);
    const m = received[0]!;
    expect(m.headers['x-comandou-token']).toBe(SECRET);
    expect(m.body.event).toBe('customer.password_reset');
    expect(m.body.to).toBe('joana@cliente.test');
    expect(m.body.fromName).toBeTruthy();
    expect(m.body.subject).toContain(m.body.fromName);
    const code = /(\d{6}) é o seu código/.exec(m.body.subject)![1]!;
    expect(m.body.html).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(m.body).not.toHaveProperty('password');

    // A senha antiga continua valendo até usar o código.
    await post('/store/account/login', { phone: '11977776666', password: 'segredo1' }).expect(200);
    await post('/store/account/password/reset', {
      phone: '11977776666',
      code,
      password: 'novasenha9',
    }).expect(200);
    await post('/store/account/login', { phone: '11977776666', password: 'novasenha9' }).expect(
      200,
    );
    // Código usado não vale de novo.
    await post('/store/account/password/reset', {
      phone: '11977776666',
      code,
      password: 'outrasenha9',
    }).expect(401);
  });

  it('conta sem e-mail ou celular sem conta: mesma resposta e nada é enviado', async () => {
    const before = received.length;
    for (const phone of ['11966665555', '11900001111'])
      expect((await post('/store/account/password/forgot', { phone }).expect(200)).body).toEqual({
        channel: 'email',
      });
    expect(received.length).toBe(before);
  });
});
