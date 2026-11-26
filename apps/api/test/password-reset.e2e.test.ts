import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { LifecycleMailService } from '../src/billing/lifecycle-mail.service';
import { createApp } from '../src/bootstrap';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery, PASSWORD, seedTwoTenants, type Fixture } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * "Esqueci minha senha" com código por e-mail (equipe do restaurante e Super Admin) e os avisos
 * automáticos de teste grátis e cobrança. O Resend é trocado por uma função (mail-fake).
 */
const HOST = 'nsenha-a.comandou.test';
const OTHER = 'nsenha-b.comandou.test';
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const ADMIN_EMAIL = 'raiz@nsenha.test';
const SECRET = newTotpSecret();

let app: INestApplication;
let http: ReturnType<typeof request>;
let mail: Awaited<ReturnType<typeof fakeMail>>;
let fx: Fixture;

const post = (url: string, body: object, host = HOST) =>
  http.post(`/api/v1${url}`).set('Host', host).set(CSRF).send(body);

/** Último código que "chegou" para o endereço (vem no começo do assunto). */
function lastCode(to: string) {
  const m = [...mail.sent].reverse().find((x) => x.body.to.includes(to));
  return /^(\d{6}) é o seu código/.exec(m?.body.subject ?? '')?.[1] ?? null;
}

beforeAll(async () => {
  fx = await seedTwoTenants('nsenha');
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
  mail = await fakeMail(app, KEY);
});
afterAll(async () => {
  await mail?.off();
  await app?.close();
});

describe('Esqueci minha senha da equipe', () => {
  const email = 'admin@nsenha-a.test';

  it('manda o código no assunto e na prévia, sem mudar a senha ainda', async () => {
    const r = await post('/auth/password-reset/request', { email }).expect(200);
    expect(r.body).toEqual({ minutes: 15 });
    const m = mail.sent.at(-1)!.body;
    expect(m.to).toEqual([email]);
    const code = lastCode(email)!;
    expect(code).toMatch(/^\d{6}$/);
    // Na prévia (preheader) e no corpo, sem espaço no meio: dá para copiar de uma vez.
    expect(m.html).toContain(`Código ${code} para criar uma nova senha`);
    expect(m.html).toContain(`>${code}</div>`);
    // A capa vai embutida no e-mail (cid:), não por link do site.
    expect(m.html).toContain('src="cid:hero-codigo@comandou"');
    expect(m.attachments?.map((a) => a.content_id)).toContain('hero-codigo@comandou');
    // Sem botão que abre página: o código se copia no próprio e-mail.
    expect(m.html).not.toContain('/codigo#');
    // A fila não guarda o código depois de enviado.
    const [o] = await ownerQuery<{ html: string | null; sensitive: boolean }>(
      `SELECT html, sensitive FROM mail_outbox WHERE kind = 'auth.password_reset'
        ORDER BY created_at DESC LIMIT 1`,
    );
    expect(o).toEqual({ html: null, sensitive: true });
    await post('/auth/login', { email, password: PASSWORD }).expect(200);
  });

  it('e-mail que não é da equipe deste restaurante: avisa na hora e nada sai', async () => {
    const before = mail.sent.length;
    for (const e of ['ninguem@nsenha-a.test', 'admin@nsenha-b.test', 'x@pin.comandou.invalid']) {
      const r = await post('/auth/password-reset/request', { email: e }).expect(404);
      expect(r.body.message).toMatch(
        /^Este e-mail não é de nenhuma conta deste restaurante\. Confira/,
      );
    }
    expect(mail.sent.length).toBe(before);
  });

  it('código errado conta tentativa; o certo troca a senha, tira dos aparelhos e já entra', async () => {
    const login = await post('/auth/login', { email, password: PASSWORD }).expect(200);
    const oldCookie = login.headers['set-cookie']!;
    await post('/auth/password-reset/request', { email }).expect(200);
    const code = lastCode(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    await post('/auth/password-reset/verify', { email, code: wrong }).expect(401);
    // O código de um restaurante não vale no outro.
    await post('/auth/password-reset/verify', { email, code }, OTHER).expect(401);
    const v = await post('/auth/password-reset/verify', { email, code: ` ${code} ` }).expect(200);
    expect(v.body.token).toEqual(expect.any(String));
    // Usado: o mesmo código não confere de novo.
    await post('/auth/password-reset/verify', { email, code }).expect(401);

    const done = await post('/auth/password-reset/complete', {
      token: v.body.token,
      password: 'nova-senha-forte-1',
    }).expect(200);
    expect(done.body.user).toMatchObject({ name: 'Admin A', role: 'owner' });
    const cookie = done.headers['set-cookie']!;
    await http.get('/api/v1/auth/me').set('Host', HOST).set('Cookie', cookie).expect(200);
    // A sessão antiga saiu; a senha antiga não vale; a nova vale.
    await http.get('/api/v1/auth/me').set('Host', HOST).set('Cookie', oldCookie).expect(401);
    await post('/auth/login', { email, password: PASSWORD }).expect(401);
    await post('/auth/login', { email, password: 'nova-senha-forte-1' }).expect(200);
    // Token usado não grava de novo.
    await post('/auth/password-reset/complete', {
      token: v.body.token,
      password: 'outra-senha-forte-2',
    }).expect(401);
    // Aviso de segurança.
    await expect.poll(() => mail.sent.at(-1)!.body.subject).toContain('foi trocada');
    expect(mail.sent.at(-1)!.body.to).toEqual([email]);
    await ownerQuery(`UPDATE users SET password_hash = $2 WHERE email = $1`, [
      email,
      await hashPassword(PASSWORD),
    ]);
  });

  it('5 tentativas erradas matam o código', async () => {
    await post('/auth/password-reset/request', { email }).expect(200);
    const code = lastCode(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await post('/auth/password-reset/verify', { email, code: wrong }).expect(401);
    await post('/auth/password-reset/verify', { email, code }).expect(401);
  });

  it('no máximo 5 códigos por hora para a mesma conta', async () => {
    await ownerQuery(`DELETE FROM staff_password_resets WHERE tenant_id = $1`, [fx.tenantA]);
    const garcom = 'garcom@nsenha-a.test';
    const before = mail.sent.length;
    for (let i = 0; i < 5; i++)
      await post('/auth/password-reset/request', { email: garcom }).expect(200);
    const r = await post('/auth/password-reset/request', { email: garcom }).expect(429);
    expect(r.body.message).toContain('5 códigos na última hora');
    expect(mail.sent.length - before).toBe(5);
  });
});

describe('Esqueci minha senha do Super Admin', () => {
  beforeAll(async () => {
    const [{ id }] = await ownerQuery<{ id: string }>(
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ($1, 'Raiz', $2, '\\x00') RETURNING id`,
      [ADMIN_EMAIL, await hashPassword('senha-antiga-do-painel')],
    );
    await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
      id,
      seal(KEY, SECRET, totpContext(id)),
    ]);
  });

  it('troca a senha pelo código, mas o login continua pedindo o autenticador', async () => {
    const wrong = await post(
      '/platform/auth/password-reset/request',
      { email: 'outro@nsenha.test' },
      ADMIN_HOST,
    ).expect(404);
    expect(wrong.body.message).toContain('não é de nenhum administrador');
    await post('/platform/auth/password-reset/request', { email: ADMIN_EMAIL }, ADMIN_HOST).expect(
      200,
    );
    const code = lastCode(ADMIN_EMAIL)!;
    expect(mail.sent.at(-1)!.body.html).toContain('Super Admin do Comandou');
    // Só no host do painel.
    await post('/platform/auth/password-reset/verify', { email: ADMIN_EMAIL, code }).expect(404);
    const v = await post(
      '/platform/auth/password-reset/verify',
      { email: ADMIN_EMAIL, code },
      ADMIN_HOST,
    ).expect(200);
    await post(
      '/platform/auth/password-reset/complete',
      { token: v.body.token, password: 'curta' },
      ADMIN_HOST,
    ).expect(400);
    await post(
      '/platform/auth/password-reset/complete',
      { token: v.body.token, password: 'senha-nova-do-painel' },
      ADMIN_HOST,
    ).expect(200);
    const login = (password: string, codeNow: string) =>
      post('/platform/auth/login', { email: ADMIN_EMAIL, password, code: codeNow }, ADMIN_HOST);
    await login('senha-nova-do-painel', '').expect(401);
    await login('senha-antiga-do-painel', totpCode(SECRET, totpStep())).expect(401);
    await login('senha-nova-do-painel', totpCode(SECRET, totpStep())).expect(200);
  });
});

describe('Avisos de teste grátis e cobrança', () => {
  it('saem uma vez só: teste acabando, mensalidade vencendo e pagamento recebido', async () => {
    const [plan] = await ownerQuery<{ id: string }>(
      `INSERT INTO plans (code, name, price_monthly, trial_days)
       VALUES ('ns-plano', 'Plano NS', 149.90, 7) RETURNING id`,
    );
    await ownerQuery(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now()
        WHERE tenant_id = ANY($1) AND status <> 'cancelled'`,
      [[fx.tenantA, fx.tenantB]],
    );
    await ownerQuery(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
       VALUES ($1, $3, 'trialing', now() + interval '20 hours'),
              ($2, $3, 'trialing', now() - interval '20 days')`,
      [fx.tenantA, fx.tenantB, plan!.id],
    );
    await ownerQuery(
      `INSERT INTO tenant_profiles (tenant_id, billing_email, contact_name)
       VALUES ($1, 'financeiro@nsenha-b.test', 'Bia Financeiro')
       ON CONFLICT (tenant_id) DO UPDATE SET billing_email = EXCLUDED.billing_email,
                                             contact_name = EXCLUDED.contact_name`,
      [fx.tenantB],
    );
    const [s] = await ownerQuery<{ id: string }>(
      `UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '2 days'
        WHERE tenant_id = $1 AND status <> 'cancelled' RETURNING id`,
      [fx.tenantB],
    );
    // Vencimento em dias de Brasília: entre 21h e meia-noite o dia do banco (UTC) já é o seguinte.
    await ownerQuery(
      `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, description, amount, due_date, invoice_url)
       VALUES ($1, $2, 'manual', 'Mensalidade do Comandou', 149.90,
               (now() AT TIME ZONE 'America/Sao_Paulo')::date + 2, 'https://pagar.test/x'),
              ($1, $2, 'manual', 'Mensalidade anterior', 149.90, current_date - 28, NULL)`,
      [fx.tenantB, s!.id],
    );
    await ownerQuery(
      `UPDATE billing_invoices SET status = 'paid', paid_at = now() - interval '1 hour'
        WHERE subscription_id = $1 AND description = 'Mensalidade anterior'`,
      [s!.id],
    );

    const svc = app.get(LifecycleMailService);
    // Outros arquivos de teste deixam restaurantes no banco: confere só os destes dois.
    const ours = (from: number) =>
      mail.sent
        .slice(from)
        .filter((m) => /nsenha-[ab]\.test$/.test(m.body.to[0]!))
        .map((m) => [m.body.to[0], m.body.subject]);
    const before = mail.sent.length;
    expect(await svc.run()).toBeGreaterThanOrEqual(3);
    expect(ours(before)).toEqual(
      expect.arrayContaining([
        ['admin@nsenha-a.test', 'Seu teste grátis do Comandou acaba amanhã'],
        [
          'financeiro@nsenha-b.test',
          expect.stringMatching(/^Sua mensalidade do Comandou vence em 2 dias/),
        ],
        ['financeiro@nsenha-b.test', 'Pagamento recebido. Obrigado!'],
      ]),
    );
    expect(ours(before)).toHaveLength(3);
    const due = mail.sent.slice(before).find((m) => /vence em 2/.test(m.body.subject))!.body;
    expect(due.html).toContain('149,90');
    expect(due.html).toContain('https://pagar.test/x');
    expect(due.html).toContain('Oi, Bia!');
    // Rodar de novo não repete.
    const again = mail.sent.length;
    await svc.run();
    expect(ours(again)).toEqual([]);

    // Desligado no painel: nada sai.
    await ownerQuery(`UPDATE mail_settings SET lifecycle_enabled = false`);
    await ownerQuery(
      `UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE tenant_id = $1
          AND status <> 'cancelled'`,
      [fx.tenantA],
    );
    const off = mail.sent.length;
    expect(await svc.run()).toBe(0);
    expect(mail.sent.length).toBe(off);
    await ownerQuery(`UPDATE mail_settings SET lifecycle_enabled = true`);
    await svc.run();
    expect(ours(off)).toEqual([
      ['admin@nsenha-a.test', expect.stringMatching(/^Seu teste grátis terminou/)],
    ]);
  });
});
