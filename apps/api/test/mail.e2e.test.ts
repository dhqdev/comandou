import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/bootstrap';
import { seal } from '../src/common/secret-box';
import { inboundSignature } from '../src/mail/inbound';
import { MailService } from '../src/mail/mail.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * Super Admin › E-mail: configuração sem devolver chaves, caixa do domínio, e-mail que chega pelo
 * Worker da Cloudflare (assinado), resposta na mesma conversa, anexos, regras, fila que tenta de
 * novo, agenda com convite .ics e a página pública de agendamento sem horário duplicado.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const TOTP = newTotpSecret();
const DOMAIN = `mail${randomBytes(3).toString('hex')}.test`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let cookie = '';
let mail: Awaited<ReturnType<typeof fakeMail>>;
let secret = '';
let mailboxId = '';
let threadId = '';
let firstMessageId = '';

const pget = (url: string) =>
  http.get(`/api/v1/platform/mail${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put' | 'patch' | 'delete', url: string, body: object = {}) =>
  http[method](`/api/v1/platform/mail${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);

/** O que o Worker da Cloudflare faz: manda o e-mail cru com a assinatura. */
function deliver(
  raw: string,
  from: string,
  to: string,
  opts: { secret?: string; host?: string } = {},
) {
  const body = Buffer.from(raw.replace(/\n/g, '\r\n'));
  const ts = String(Math.floor(Date.now() / 1000));
  return http
    .post('/api/v1/platform/mail/inbound')
    .set('Host', opts.host ?? ADMIN_HOST)
    .set('Content-Type', 'message/rfc822')
    .set('X-Comandou-Timestamp', ts)
    .set('X-Comandou-From', from)
    .set('X-Comandou-To', to)
    .set('X-Comandou-Signature', inboundSignature(opts.secret ?? secret, ts, from, to, body))
    .send(body);
}

beforeAll(async () => {
  await ownerQuery(
    `UPDATE mail_settings SET provider = 'none', from_address = '', inbound_secret_enc = NULL`,
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
  await ownerQuery(`UPDATE mail_settings SET inbound_secret_enc = NULL`);
  await app?.close();
});

describe('Super Admin › E-mail', () => {
  it('só o painel enxerga; sem sessão, 401; no endereço de um restaurante, 404', async () => {
    await http.get('/api/v1/platform/mail').set('Host', ADMIN_HOST).expect(401);
    await http.get('/api/v1/platform/mail').set('Host', 'loja.comandou.test').expect(404);
  });

  it('salva o provedor e nunca devolve a chave', async () => {
    const r = await psend('put', '/settings', {
      provider: 'resend',
      fromAddress: `nao-responda@${DOMAIN}`,
      fromName: 'Comandou',
      replyTo: '',
      cfAccountId: '',
      resendKey: 're_chave_secreta_999',
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
    }).expect(200);
    expect(r.body).toMatchObject({ provider: 'resend', resendKeySet: true, ready: true });
    expect(JSON.stringify(r.body)).not.toContain('re_chave_secreta_999');
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE data::text LIKE '%re_chave_secreta%'`,
    );
    expect(audit!.n).toBe(0);
    // A partir daqui o envio sai pelo Resend falso.
    mail = await fakeMail(app, KEY, `nao-responda@${DOMAIN}`);
  });

  it('cria o domínio e a caixa; endereço repetido é recusado', async () => {
    const d = await psend('post', '/domains', { domain: DOMAIN }).expect(201);
    await psend('post', '/domains', { domain: DOMAIN }).expect(409);
    await psend('post', '/domains', { domain: 'sem ponto' }).expect(400);
    const m = await psend('post', '/mailboxes', {
      domainId: d.body.id,
      local: 'contato',
      displayName: 'Comandou Contato',
    }).expect(201);
    mailboxId = m.body.id;
    expect(m.body.address).toBe(`contato@${DOMAIN}`);
    await psend('post', '/mailboxes', { domainId: d.body.id, local: 'contato' }).expect(409);
  });

  it('recebimento: sem segredo, assinatura errada ou outro endereço são recusados', async () => {
    const raw = `From: Ana <ana@cliente.test>\nTo: contato@${DOMAIN}\nSubject: Oi\n\ncorpo`;
    await deliver(raw, 'ana@cliente.test', `contato@${DOMAIN}`, { secret: 'qualquer' }).expect(403);
    const s = await psend('post', '/settings/inbound-secret').expect(200);
    secret = s.body.secret;
    expect(s.body.url).toBe('http://admin.comandou.test/api/v1/platform/mail/inbound');
    await deliver(raw, 'ana@cliente.test', `contato@${DOMAIN}`, { secret: 'errado' }).expect(403);
    await deliver(raw, 'ana@cliente.test', `contato@${DOMAIN}`, {
      host: 'loja.comandou.test',
    }).expect(404);
    const r = await deliver(raw, 'ana@cliente.test', `ninguem@${DOMAIN}`).expect(200);
    expect(r.body).toEqual({ action: 'reject', reason: 'Esta caixa de e-mail não existe' });
  });

  it('guarda o e-mail que chega, com anexo, e não duplica a mesma entrega', async () => {
    const raw = [
      'From: Ana Cliente <ana@cliente.test>',
      `To: contato@${DOMAIN}`,
      'Subject: =?UTF-8?B?UGVkaWRvIGRlIG9yw6dhbWVudG8=?=',
      'Message-ID: <msg-1@cliente.test>',
      'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Quero um <b>orçamento</b></p><script>alert(1)</script>',
      '--b1',
      'Content-Type: text/plain; name="lista.txt"',
      'Content-Disposition: attachment; filename="lista.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('10 mesas').toString('base64'),
      '--b1--',
      '',
    ].join('\n');
    expect((await deliver(raw, 'ana@cliente.test', `contato@${DOMAIN}`).expect(200)).body).toEqual({
      action: 'store',
    });
    await deliver(raw, 'ana@cliente.test', `contato@${DOMAIN}`).expect(200);
    const list = await pget(`/mailboxes/${mailboxId}/threads?folder=inbox`).expect(200);
    expect(list.body.threads).toHaveLength(1);
    const t = list.body.threads[0];
    expect(t).toMatchObject({
      subject: 'Pedido de orçamento',
      unread: true,
      attachments: true,
      count: 1,
    });
    threadId = t.threadId;
    const th = await pget(`/mailboxes/${mailboxId}/threads/${threadId}`).expect(200);
    const m = th.body.messages[0];
    firstMessageId = m.id;
    expect(m.from).toEqual({ email: 'ana@cliente.test', name: 'Ana Cliente' });
    expect(m.auth).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
    expect(m.attachments).toHaveLength(1);
    // A moldura nunca leva o script.
    const h = await pget(`/messages/${m.id}/html`).expect(200);
    expect(h.body.html).toContain('<b>orçamento</b>');
    expect(h.body.html).not.toContain('<script');
    // O anexo baixa (texto de fora nunca abre no navegador).
    const a = await pget(`/attachments/${m.attachments[0].id}`).expect(200);
    expect(a.headers['content-type']).toBe('application/octet-stream');
    expect(a.headers['content-disposition']).toContain('attachment;');
    // Abrir marcou como lido.
    const again = await pget(`/mailboxes/${mailboxId}/threads?folder=inbox`).expect(200);
    expect(again.body.threads[0].unread).toBe(false);
    expect((await pget('/unread').expect(200)).body.unread).toBe(0);
  });

  it('responde na mesma conversa, com In-Reply-To e o remetente da caixa', async () => {
    const d = await psend('post', '/drafts', {
      mailboxId,
      to: 'Ana Cliente <ana@cliente.test>',
      subject: 'Re: Pedido de orçamento',
      text: 'Olá, Ana! Segue o orçamento.',
      replyTo: firstMessageId,
    }).expect(201);
    expect(d.body.threadId).toBe(threadId);
    const file = Buffer.from('%PDF-1.4 teste');
    await http
      .post(`/api/v1/platform/mail/drafts/${d.body.id}/attachments`)
      .set('Host', ADMIN_HOST)
      .set(CSRF)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('orçamento.pdf'))
      .set('X-File-Type', 'application/pdf')
      .send(file)
      .expect(201);
    const before = mail.sent.length;
    const s = await psend('post', `/drafts/${d.body.id}/send`).expect(200);
    expect(s.body).toMatchObject({ sent: true, error: null });
    const out = mail.sent[before]!.body;
    expect(out.from).toBe(`"Comandou Contato" <contato@${DOMAIN}>`);
    expect(out.to).toEqual(['ana@cliente.test']);
    expect(out.headers).toMatchObject({ 'In-Reply-To': '<msg-1@cliente.test>' });
    expect(out.attachments?.[0]).toMatchObject({
      filename: 'orçamento.pdf',
      content_type: 'application/pdf',
    });
    const th = await pget(`/mailboxes/${mailboxId}/threads/${threadId}`).expect(200);
    expect(th.body.messages.map((m: { direction: string }) => m.direction)).toEqual(['in', 'out']);
    expect(th.body.messages[1].sendStatus).toBe('sent');
    // Enviado não volta a ser rascunho.
    await psend('post', `/drafts/${d.body.id}/send`).expect(404);
    // A resposta dela cai na mesma conversa.
    const sentId = (
      await ownerQuery<{ rfc_id: string }>(`SELECT rfc_id FROM mail_messages WHERE id = $1`, [
        d.body.id,
      ])
    )[0]!.rfc_id;
    await deliver(
      `From: ana@cliente.test\nTo: contato@${DOMAIN}\nSubject: Re: Re: Pedido\nMessage-ID: <msg-2@cliente.test>\nIn-Reply-To: ${sentId}\n\nFechado!`,
      'ana@cliente.test',
      `contato@${DOMAIN}`,
    ).expect(200);
    const th2 = await pget(`/mailboxes/${mailboxId}/threads/${threadId}`).expect(200);
    expect(th2.body.messages).toHaveLength(3);
  });

  it('provedor fora do ar: fica na fila, tenta de novo e sai depois', async () => {
    mail.state.fail = 503;
    const d = await psend('post', '/drafts', {
      mailboxId,
      to: 'bruno@cliente.test',
      subject: 'Teste da fila',
      text: 'oi',
    }).expect(201);
    const s = await psend('post', `/drafts/${d.body.id}/send`).expect(200);
    expect(s.body.sent).toBe(false);
    const [o] = await ownerQuery<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM mail_outbox WHERE message_id = $1`,
      [d.body.id],
    );
    expect(o).toEqual({ status: 'queued', attempts: 1 });
    mail.state.fail = null;
    await ownerQuery(`UPDATE mail_outbox SET next_attempt_at = now() WHERE message_id = $1`, [
      d.body.id,
    ]);
    expect(await app.get(MailService).drain()).toBeGreaterThanOrEqual(1);
    const [m] = await ownerQuery<{ send_status: string }>(
      `SELECT send_status FROM mail_messages WHERE id = $1`,
      [d.body.id],
    );
    expect(m!.send_status).toBe('sent');
  });

  it('regra manda para o spam e regra de recusa devolve ao remetente', async () => {
    await psend('post', '/rules', {
      name: 'Promoções',
      field: 'from',
      op: 'ends_with',
      value: '@promo.test',
      action: 'spam',
    }).expect(201);
    await psend('post', '/rules', {
      name: 'Bloqueado',
      field: 'subject',
      op: 'contains',
      value: 'cassino',
      action: 'reject',
    }).expect(201);
    await deliver(
      `From: x@promo.test\nTo: contato@${DOMAIN}\nSubject: Oferta\n\noi`,
      'x@promo.test',
      `contato@${DOMAIN}`,
    ).expect(200);
    const spam = await pget(`/mailboxes/${mailboxId}/threads?folder=spam`).expect(200);
    expect(spam.body.threads.map((t: { subject: string }) => t.subject)).toEqual(['Oferta']);
    const r = await deliver(
      `From: y@z.test\nTo: contato@${DOMAIN}\nSubject: Ganhe no Cassino\n\noi`,
      'y@z.test',
      `contato@${DOMAIN}`,
    ).expect(200);
    expect(r.body.action).toBe('reject');
  });

  it('agenda: convite com .ics e a resposta do convidado volta para o evento', async () => {
    const before = mail.sent.length;
    const e = await psend('post', '/events', {
      mailboxId,
      title: 'Apresentação do Comandou',
      startsAt: '2030-03-10T13:00:00.000Z',
      endsAt: '2030-03-10T14:00:00.000Z',
      attendees: [{ email: 'dono@pizzaria.test', name: 'Dono' }],
    }).expect(201);
    const invite = mail.sent[before]!.body;
    expect(invite.to).toEqual(['dono@pizzaria.test']);
    const ics = Buffer.from(invite.attachments![0]!.content, 'base64').toString();
    expect(ics).toContain('METHOD:REQUEST');
    const uid = /UID:(.+)\r\n/.exec(ics)![1]!;
    await deliver(
      [
        `From: dono@pizzaria.test`,
        `To: contato@${DOMAIN}`,
        'Subject: Aceito: Apresentação',
        'MIME-Version: 1.0',
        'Content-Type: text/calendar; method=REPLY; charset=utf-8',
        '',
        'BEGIN:VCALENDAR',
        'METHOD:REPLY',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'ATTENDEE;PARTSTAT=ACCEPTED:mailto:dono@pizzaria.test',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
      'dono@pizzaria.test',
      `contato@${DOMAIN}`,
    ).expect(200);
    const list = await pget('/events?from=2030-03-01T00:00:00Z&to=2030-04-01T00:00:00Z').expect(
      200,
    );
    const ev = list.body.find((x: { id: string }) => x.id === e.body.id);
    expect(ev.attendees[0].status).toBe('accepted');
    const c = mail.sent.length;
    await psend('delete', `/events/${e.body.id}`).expect(200);
    const cancel = Buffer.from(mail.sent[c]!.body.attachments![0]!.content, 'base64').toString();
    expect(cancel).toContain('METHOD:CANCEL');
  });

  it('página de agendamento: mostra horários livres e não deixa marcar o mesmo duas vezes', async () => {
    const all = Object.fromEntries(
      ['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [['09:00', '12:00']]]),
    );
    await psend('post', '/booking-pages', {
      slug: `demo-${DOMAIN.slice(4, 10)}`,
      title: 'Demonstração',
      durationMin: 60,
      minNoticeHours: 0,
      daysAhead: 30,
      availability: all,
      mailboxId,
    }).expect(201);
    const slug = `demo-${DOMAIN.slice(4, 10)}`;
    const pub = (u: string) => http.get(`/api/v1/public/booking/${u}`).set('Host', 'comandou.test');
    expect((await pub(slug).expect(200)).body).toMatchObject({
      title: 'Demonstração',
      durationMin: 60,
    });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const slots = (await pub(`${slug}/slots?date=${day}`).expect(200)).body.slots as string[];
    expect(slots).toHaveLength(3);
    const book = (start: string, email: string) =>
      http
        .post(`/api/v1/public/booking/${slug}`)
        .set('Host', 'comandou.test')
        .set(CSRF)
        .send({ start, name: 'Carla Souza', email });
    await book(slots[0]!, 'carla@cliente.test').expect(201);
    await book(slots[0]!, 'outra@cliente.test').expect(409);
    const left = (await pub(`${slug}/slots?date=${day}`).expect(200)).body.slots;
    expect(left).toEqual(slots.slice(1));
    // Horário fora da janela também é recusado.
    await book(`${day}T03:00:00.000Z`, 'carla2@cliente.test').expect(409);
  });
});
