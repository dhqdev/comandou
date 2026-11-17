import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/bootstrap';
import { seal } from '../src/common/secret-box';
import { MailService } from '../src/mail/mail.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * Super Admin › E-mail: configuração do Resend sem devolver a chave, e-mail de teste, fila que
 * tenta de novo quando o Resend está fora e a tela de envios com reenviar e cancelar.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const TOTP = newTotpSecret();
const DOMAIN = `mail${randomBytes(3).toString('hex')}.test`;
const FROM = `nao-responda@${DOMAIN}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let cookie = '';
let mail: Awaited<ReturnType<typeof fakeMail>>;
const pget = (url: string) =>
  http.get(`/api/v1/platform/mail${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put' | 'patch' | 'delete', url: string, body: object = {}) =>
  http[method](`/api/v1/platform/mail${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);

beforeAll(async () => {
  await ownerQuery(
    `UPDATE mail_settings SET provider = 'none', from_address = '', resend_key_enc = NULL`,
  );
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('email@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, TOTP, totpContext(id)),
  ]);
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
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'email@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(TOTP, totpStep()),
    })
    .expect(200);
  cookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await mail?.off();
  await app?.close();
});

describe('Super Admin › E-mail', () => {
  it('só o painel enxerga; sem sessão, 401; no endereço de um restaurante, 404', async () => {
    await http.get('/api/v1/platform/mail').set('Host', ADMIN_HOST).expect(401);
    await http.get('/api/v1/platform/mail').set('Host', 'loja.comandou.test').expect(404);
  });

  it('as rotas antigas (caixas, agenda, agendamento, recebimento) não existem mais', async () => {
    await pget('/unread').expect(404);
    await pget('/booking-pages').expect(404);
    await psend('post', '/inbound').expect(404);
    await http.get('/api/v1/public/booking/qualquer').expect(404);
  });

  it('ligado sem remetente é recusado', async () => {
    await psend('put', '/settings', {
      enabled: true,
      fromAddress: '',
      fromName: 'Comandou',
      replyTo: '',
    }).expect(422);
  });

  it('salva o Resend e nunca devolve a chave', async () => {
    const r = await psend('put', '/settings', {
      enabled: true,
      fromAddress: FROM,
      fromName: 'Comandou',
      replyTo: '',
      resendKey: 're_chave_secreta_999',
    }).expect(200);
    expect(r.body).toMatchObject({ enabled: true, resendKeySet: true, ready: true });
    expect(JSON.stringify(r.body)).not.toContain('re_chave_secreta_999');
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE data::text LIKE '%re_chave_secreta%'`,
    );
    expect(audit!.n).toBe(0);
    // Salvar de novo sem a chave mantém a que estava.
    const again = await psend('put', '/settings', {
      enabled: true,
      fromAddress: FROM,
      fromName: 'Comandou',
      replyTo: `contato@${DOMAIN}`,
    }).expect(200);
    expect(again.body).toMatchObject({ resendKeySet: true, replyTo: `contato@${DOMAIN}` });
    // A partir daqui o envio sai pelo Resend falso.
    mail = await fakeMail(app, KEY, FROM);
  });

  it('e-mail de teste sai pelo Resend com a chave e o remetente salvos', async () => {
    const before = mail.sent.length;
    await psend('post', '/settings/test', { to: 'david@cliente.test' }).expect(200);
    const sent = mail.sent[before]!;
    expect(sent.url).toBe('https://api.resend.com/emails');
    expect(sent.authorization).toBe('Bearer re_teste_123');
    expect(sent.body).toMatchObject({
      to: ['david@cliente.test'],
      subject: 'Teste do e-mail do Comandou',
    });
    expect(sent.body.from).toContain(FROM);
  });

  it('Resend fora do ar: fica na fila, aparece em Envios e sai depois', async () => {
    mail.state.fail = 503;
    const service = app.get(MailService);
    const r = await service.send({
      kind: 'test',
      to: [{ email: 'bruno@cliente.test' }],
      subject: 'Teste da fila',
      text: 'oi',
    });
    expect(r).toMatchObject({ ok: false, queued: true });
    const list = await pget('/outbox?status=queued').expect(200);
    expect(list.body.rows.some((o: { id: string }) => o.id === r.id)).toBe(true);
    mail.state.fail = null;
    await ownerQuery(`UPDATE mail_outbox SET next_attempt_at = now() WHERE id = $1`, [r.id]);
    expect(await service.drain()).toBeGreaterThanOrEqual(1);
    const [o] = await ownerQuery<{ status: string; provider: string }>(
      `SELECT status, provider FROM mail_outbox WHERE id = $1`,
      [r.id],
    );
    expect(o).toEqual({ status: 'sent', provider: 'resend' });
  });

  it('recusa definitiva falha na hora; reenviar e cancelar', async () => {
    mail.state.fail = 422;
    const service = app.get(MailService);
    const r = await service.send({
      kind: 'test',
      to: [{ email: 'carla@cliente.test' }],
      subject: 'Recusado',
      text: 'oi',
    });
    expect(r).toMatchObject({ ok: false, queued: false });
    mail.state.fail = null;
    const retry = await psend('post', `/outbox/${r.id}/retry`).expect(200);
    expect(retry.body).toMatchObject({ sent: true });
    await psend('post', `/outbox/${r.id}/cancel`).expect(409);

    const queued = await service.enqueue(null, {
      kind: 'test',
      to: [{ email: 'dani@cliente.test' }],
      subject: 'Cancelar',
      text: 'oi',
    });
    await psend('post', `/outbox/${queued}/cancel`).expect(200);
    const [c] = await ownerQuery<{ status: string }>(
      `SELECT status FROM mail_outbox WHERE id = $1`,
      [queued],
    );
    expect(c!.status).toBe('cancelled');
  });

  it('desligado: nenhum e-mail sai', async () => {
    await psend('put', '/settings', {
      enabled: false,
      fromAddress: FROM,
      fromName: 'Comandou',
      replyTo: '',
    }).expect(200);
    expect(await app.get(MailService).ready()).toBe(false);
    await psend('post', '/settings/test', { to: 'david@cliente.test' }).expect(422);
  });
});
