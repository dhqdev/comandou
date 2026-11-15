import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { SiteService } from '../src/platform/site/site.service';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';

/**
 * Site público: o visitante cria o próprio restaurante de teste, entra já logado, recebe o login
 * por e-mail (webhook) e, se o teste vencer sem contratação, o restaurante é suspenso.
 */
const SITE_HOST = 'comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const EMAIL = `dona-${randomBytes(4).toString('hex')}@site.test`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let hook: Server;
const received: { headers: Record<string, unknown>; body: Record<string, string> }[] = [];
let created: {
  token: string;
  entry: string;
  slug: string;
  url: string;
  email: string;
  password: string;
  trialDays: number;
};

const post = (path: string, body: object) =>
  http.post(`/api/v1/public/site/${path}`).set('Host', SITE_HOST).set(CSRF).send(body);

beforeAll(async () => {
  hook = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(raw) });
      res.end('{}');
    });
  });
  await new Promise<void>((ok) => hook.listen(0, '127.0.0.1', ok));
  const port = (hook.address() as AddressInfo).port;
  await ownerQuery(
    `UPDATE platform_site_settings SET signup_enabled = true, trial_days = 3, daily_limit = 1000,
            email_webhook_url = $1, email_token_enc = NULL`,
    [`http://127.0.0.1:${port}/webhook/boas-vindas`],
  );
  app = await createApp(
    testEnv({
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      TENANT_DATABASE_MODE: 'shared',
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await ownerQuery(`UPDATE platform_site_settings SET email_webhook_url = ''`);
  await app?.close();
  await new Promise((ok) => hook.close(ok));
});

describe('Teste criado pelo site', () => {
  it('diz que o domínio base é o site e que o cadastro está aberto', async () => {
    const r = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
    expect(r.body).toMatchObject({ site: true, signup: true, trialDays: 3 });
    const t = await http.get('/api/v1/public/site').set('Host', 'pizzaria.com').expect(200);
    expect(t.body.site).toBe(false);
  });

  it('recusa cadastro de robô e e-mail inválido', async () => {
    const base = { restaurant: 'Cantina Site', name: 'Dona Site', email: EMAIL };
    await post('trials', { ...base, company: 'preenchido' }).expect(400);
    await post('trials', { ...base, email: 'sem-arroba' }).expect(400);
  });

  it('cria o restaurante com teste de 3 dias e devolve o login uma vez', async () => {
    const r = await post('trials', {
      restaurant: 'Cantina Site',
      name: 'Dona Site',
      email: EMAIL,
      phone: '(11) 98888-7777',
      source: { kind: 'text', value: 'Lasanha 42\nNhoque 38\nRefrigerante 7' },
    }).expect(201);
    created = r.body;
    expect(created.slug).toMatch(/^cantina-site/);
    expect(created.url).toBe(`http://${created.slug}.comandou.test`);
    expect(created.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(created.trialDays).toBe(3);

    const [row] = await ownerQuery<{ status: string; days: number; source_kind: string }>(
      `SELECT t.status, ts.source_kind,
              round(extract(epoch FROM (ts.trial_ends_at - ts.created_at)) / 86400)::int AS days
         FROM trial_signups ts JOIN tenants t ON t.id = ts.tenant_id WHERE t.slug = $1`,
      [created.slug],
    );
    expect(row).toEqual({ status: 'provisioned', days: 3, source_kind: 'text' });
    // A senha nunca fica em texto puro e nada dela vai para a auditoria.
    const [leak] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE data::text LIKE $1`,
      [`%${created.password}%`],
    );
    expect(leak!.n).toBe(0);
  });

  it('não cria um segundo teste com o mesmo e-mail', async () => {
    await post('trials', { restaurant: 'Outra Cantina', name: 'Dona Site', email: EMAIL }).expect(
      409,
    );
  });

  it('acompanha a criação e manda o e-mail de boas-vindas pelo webhook', async () => {
    const r = await http
      .get(`/api/v1/public/site/trials/${created.token}`)
      .set('Host', SITE_HOST)
      .expect(200);
    expect(r.body).toMatchObject({ state: 'ready', url: created.url });
    for (let i = 0; i < 40 && !received.length; i++) await new Promise((ok) => setTimeout(ok, 50));
    expect(received).toHaveLength(1);
    const mail = received[0]!.body;
    expect(mail).toMatchObject({
      event: 'trial.welcome',
      to: EMAIL,
      loginEmail: EMAIL,
      password: created.password,
      url: created.url,
    });
    expect(mail.html).toContain(created.password);
    expect(mail.subject).toContain('Cantina Site');
    // Saiu: a senha guardada é apagada e o e-mail não sai de novo.
    const [row] = await ownerQuery<{ pending: boolean; sent: boolean }>(
      `SELECT pending_enc IS NOT NULL AS pending, email_sent_at IS NOT NULL AS sent
         FROM trial_signups WHERE email = $1`,
      [EMAIL],
    );
    expect(row).toEqual({ pending: false, sent: true });
    await app.get(SiteService).deliverPending();
    expect(received).toHaveLength(1);
    await http
      .get(`/api/v1/public/site/trials/${'x'.repeat(43)}`)
      .set('Host', SITE_HOST)
      .expect(404);
  });

  it('abre o restaurante novo já logado, uma única vez', async () => {
    const host = `${created.slug}.comandou.test`;
    // O link só vale no restaurante dele.
    const r = await http
      .post('/api/v1/auth/entry')
      .set('Host', host)
      .set(CSRF)
      .send({ token: created.entry })
      .expect(200);
    const cookie = (r.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_sid='))!
      .split(';')[0]!;
    const me = await http
      .get('/api/v1/auth/me')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user).toMatchObject({ email: EMAIL, role: 'owner' });
    await http
      .post('/api/v1/auth/entry')
      .set('Host', host)
      .set(CSRF)
      .send({ token: created.entry })
      .expect(401);
    // E a senha do e-mail entra pelo login normal.
    await http
      .post('/api/v1/auth/login')
      .set('Host', host)
      .set(CSRF)
      .send({ email: EMAIL, password: created.password })
      .expect(200);
    // Os primeiros passos recebem a origem do cardápio informada no site.
    const sg = await http
      .get('/api/v1/menu-import/signup')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(sg.body.trial).toMatchObject({ sourceKind: 'text' });
    expect(sg.body.trial.sourceValue).toContain('Lasanha 42');
  });

  it('suspende o restaurante quando o teste vence sem contratação', async () => {
    const svc = app.get(SiteService);
    expect(await svc.expireTrials()).toBe(0);
    await ownerQuery(
      `UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour'
        WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1)`,
      [created.slug],
    );
    await ownerQuery(
      `UPDATE trial_signups SET trial_ends_at = now() - interval '1 hour' WHERE email = $1`,
      [EMAIL],
    );
    expect(await svc.expireTrials()).toBe(1);
    const [t] = await ownerQuery<{ status: string }>(`SELECT status FROM tenants WHERE slug = $1`, [
      created.slug,
    ]);
    expect(t!.status).toBe('suspended');
    expect(await svc.expireTrials()).toBe(0);
  });

  it('a tela do painel exige a sessão do Super Admin', async () => {
    await http.get('/api/v1/platform/site').set('Host', 'admin.comandou.test').expect(401);
    await http.get('/api/v1/platform/site').set('Host', SITE_HOST).expect(404);
  });
});
