import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery, seedTwoTenants } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * Esqueci minha senha do cliente pelo e-mail (envio do próprio Comandou, Super Admin › E-mail), na
 * loja sem WhatsApp conectado: vai um código, não uma senha nova, com o nome do restaurante. O
 * código sai cifrado da fila e não fica guardado depois de enviado.
 */
const HOST = 'mail-a.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');

let app: INestApplication;
let http: ReturnType<typeof request>;
let mail: Awaited<ReturnType<typeof fakeMail>> | null = null;

const post = (url: string, body: object) =>
  http.post(`/api/v1${url}`).set('Host', HOST).set(CSRF).send(body);

beforeAll(async () => {
  await seedTwoTenants('mail');
  await ownerQuery(`UPDATE mail_settings SET provider = 'none', from_address = ''`);
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
  await mail?.off();
  await app?.close();
});

describe('Esqueci minha senha por e-mail', () => {
  it('sem e-mail configurado e sem WhatsApp, manda falar com o restaurante', async () => {
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

  it('com o envio configurado, o código vai para o e-mail da conta com o nome do restaurante', async () => {
    mail = await fakeMail(app, KEY);
    const r = await post('/store/account/password/forgot', { phone: '11977776666' }).expect(200);
    expect(r.body).toEqual({ channel: 'email' });
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!.body;
    expect(m.to).toEqual(['joana@cliente.test']);
    // Remetente: o nome do restaurante com o endereço do Comandou.
    const [t] = await ownerQuery<{ name: string }>(
      `SELECT name FROM tenants WHERE slug = 'mail-a'`,
    );
    expect(m.from).toBe(`"${t!.name}" <nao-responda@comandou.test>`);
    expect(m.subject).toContain(t!.name);
    const code = /(\d{6}) é o seu código/.exec(m.subject)![1]!;
    expect(m.html).toContain(`>${code}</div>`);
    // Saiu: na fila não fica nada do código.
    const [o] = await ownerQuery<{
      status: string;
      html: string | null;
      enc: boolean;
      sensitive: boolean;
    }>(
      `SELECT status, html, body_enc IS NOT NULL AS enc, sensitive FROM mail_outbox
        WHERE kind = 'customer.password_reset' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(o).toEqual({ status: 'sent', html: null, enc: false, sensitive: true });

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
    const before = mail!.sent.length;
    for (const phone of ['11966665555', '11900001111'])
      expect((await post('/store/account/password/forgot', { phone }).expect(200)).body).toEqual({
        channel: 'email',
      });
    expect(mail!.sent.length).toBe(before);
  });
});
