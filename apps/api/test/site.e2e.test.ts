import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { SiteService } from '../src/platform/site/site.service';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * Site público: o visitante cria o próprio restaurante de teste, entra já logado, recebe o login
 * por e-mail (envio do próprio Comandou) e, se o teste vencer sem contratação, o restaurante é suspenso.
 */
const SITE_HOST = 'comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const EMAIL = `dona-${randomBytes(4).toString('hex')}@site.test`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let mail: Awaited<ReturnType<typeof fakeMail>>;
let created: {
  token: string;
  entry: string;
  slug: string;
  url: string;
  email: string;
  password: string;
  trialDays: number;
};
/** O que outros testes deixaram ligado (IA dos restaurantes e cobrança automática). */
let before: { ai: Buffer | null; billing: boolean };
/** Sessão do dono no restaurante criado (entrou pelo link do cadastro). */
let session = '';
/** O plano em que o restaurante do site nasce: os dias de teste vêm dele (Super Admin › Preço). */
let plan: { id: string; trial_days: number };

const post = (path: string, body: object) =>
  http.post(`/api/v1/public/site/${path}`).set('Host', SITE_HOST).set(CSRF).send(body);

beforeAll(async () => {
  // Sem IA e sem cobrança automática, como numa instalação que acabou de abrir o site.
  const [ai] = await ownerQuery<{ key: Buffer | null }>(
    `SELECT api_key_enc AS key FROM platform_ai_settings`,
  );
  const [bill] = await ownerQuery<{ enabled: boolean }>(
    `SELECT enabled FROM platform_billing_settings`,
  );
  before = { ai: ai?.key ?? null, billing: !!bill?.enabled };
  await ownerQuery(`UPDATE platform_ai_settings SET api_key_enc = NULL`);
  await ownerQuery(`UPDATE platform_billing_settings SET enabled = false`);
  // Plano padrão só deste arquivo: o restaurante do site nasce nele, com os dias de teste dele.
  await ownerQuery(`UPDATE plans SET is_default = false WHERE is_default`);
  [plan] = await ownerQuery<{ id: string; trial_days: number }>(
    `INSERT INTO plans (code, name, price_monthly, trial_days, is_default, active)
     VALUES ($1, 'Site', 400, 5, true, true) RETURNING id, trial_days`,
    [`site-${randomBytes(3).toString('hex')}`],
  );
  // O campo antigo do site (3 dias) não manda mais: vale o do plano (5).
  await ownerQuery(
    `UPDATE platform_site_settings SET signup_enabled = true, trial_days = 3, daily_limit = 1000`,
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
  mail = await fakeMail(app, KEY);
});

afterAll(async () => {
  await mail?.off();
  if (plan)
    await ownerQuery(`UPDATE plans SET is_default = false, active = false WHERE id = $1`, [
      plan.id,
    ]);
  if (before) {
    await ownerQuery(`UPDATE platform_ai_settings SET api_key_enc = $1`, [before.ai]);
    await ownerQuery(`UPDATE platform_billing_settings SET enabled = $1`, [before.billing]);
  }
  await app?.close();
});

describe('Teste criado pelo site', () => {
  it('diz que o domínio base é o site e que o cadastro está aberto', async () => {
    const r = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
    expect(r.body).toMatchObject({ site: true, signup: true, trialDays: 5 });
    const t = await http.get('/api/v1/public/site').set('Host', 'pizzaria.com').expect(200);
    expect(t.body.site).toBe(false);
  });

  it('recusa cadastro de robô e e-mail inválido', async () => {
    const base = { restaurant: 'Cantina Site', name: 'Dona Site', email: EMAIL };
    await post('trials', { ...base, company: 'preenchido' }).expect(400);
    await post('trials', { ...base, email: 'sem-arroba' }).expect(400);
  });

  it('cria o restaurante com os dias de teste do plano e devolve o login uma vez', async () => {
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
    expect(created.trialDays).toBe(5);

    const [row] = await ownerQuery<{ status: string; days: number; source_kind: string }>(
      `SELECT t.status, ts.source_kind,
              round(extract(epoch FROM (ts.trial_ends_at - ts.created_at)) / 86400)::int AS days
         FROM trial_signups ts JOIN tenants t ON t.id = ts.tenant_id WHERE t.slug = $1`,
      [created.slug],
    );
    expect(row).toEqual({ status: 'provisioned', days: 5, source_kind: 'text' });
    const [sub] = await ownerQuery<{ status: string; days: number }>(
      `SELECT s.status, round(extract(epoch FROM (s.trial_ends_at - now())) / 86400)::int AS days
         FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
        WHERE t.slug = $1 AND s.status <> 'cancelled'`,
      [created.slug],
    );
    expect(sub).toEqual({ status: 'trialing', days: 5 });
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

  it('acompanha a criação e manda o e-mail de boas-vindas pelo envio do Comandou', async () => {
    const r = await http
      .get(`/api/v1/public/site/trials/${created.token}`)
      .set('Host', SITE_HOST)
      .expect(200);
    expect(r.body).toMatchObject({ state: 'ready', url: created.url });
    for (let i = 0; i < 40 && !mail.sent.length; i++) await new Promise((ok) => setTimeout(ok, 50));
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!.body;
    expect(m.to).toEqual([EMAIL]);
    expect(m.html).toContain(created.password);
    expect(m.html).toContain(created.url);
    expect(m.subject).toContain('Cantina Site');
    // O Resend responde antes de a fila e o teste marcarem "enviado" (o envio corre depois da
    // resposta da tela): espera o teste marcar o e-mail como enviado, que vem por último.
    const signup = () =>
      ownerQuery<{ pending: boolean; sent: boolean }>(
        `SELECT pending_enc IS NOT NULL AS pending, email_sent_at IS NOT NULL AS sent
           FROM trial_signups WHERE email = $1`,
        [EMAIL],
      );
    let [row] = await signup();
    for (let i = 0; i < 60 && !row?.sent; i++) {
      await new Promise((ok) => setTimeout(ok, 50));
      [row] = await signup();
    }
    // Saiu: a senha guardada é apagada e o e-mail não sai de novo.
    expect(row).toEqual({ pending: false, sent: true });
    // Na fila não fica a senha depois de enviado.
    const [o] = await ownerQuery<{ status: string; leak: boolean }>(
      `SELECT status, (COALESCE(html, '') || COALESCE(body_text, '')) LIKE $1 OR body_enc IS NOT NULL AS leak
         FROM mail_outbox WHERE kind = 'trial.welcome' ORDER BY created_at DESC LIMIT 1`,
      [`%${created.password}%`],
    );
    expect(o).toEqual({ status: 'sent', leak: false });
    await app.get(SiteService).deliverPending();
    expect(mail.sent).toHaveLength(1);
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
    session = cookie;
  });

  it('sem IA, os itens escritos no site viram itens nos primeiros passos', async () => {
    const host = `${created.slug}.comandou.test`;
    const st = await http
      .get('/api/v1/menu-import')
      .set('Host', host)
      .set('Cookie', session)
      .expect(200);
    expect(st.body.enabled).toBe(false);
    const r = await http
      .post('/api/v1/menu-import/text')
      .set('Host', host)
      .set('Cookie', session)
      .set(CSRF)
      .send({ text: 'Massas\nLasanha - bolonhesa 42\nNhoque 38\n\nBebidas\nRefrigerante 7' })
      .expect(200);
    expect(r.body).toMatchObject({ items: 3, tokens: 0, withoutAi: true });
    expect(r.body.categories).toEqual([
      {
        name: 'Massas',
        items: [
          { name: 'Lasanha', description: 'bolonhesa', price: '42.00' },
          { name: 'Nhoque', description: null, price: '38.00' },
        ],
      },
      { name: 'Bebidas', items: [{ name: 'Refrigerante', description: null, price: '7.00' }] },
    ]);
  });

  it('a conversa da criação leva o combinado e o sistema aplica sem perguntar (0.282)', async () => {
    const email = `conversa-${randomBytes(4).toString('hex')}@site.test`;
    const setup = {
      categories: [
        {
          name: 'Pizzas',
          items: [
            { name: 'Calabresa', description: 'Molho, calabresa e cebola', price: '49.90' },
            { name: 'Margherita', description: null, price: null },
          ],
        },
        { name: 'Bebidas', items: [{ name: 'Guaraná lata', description: null, price: '7.00' }] },
      ],
      store: {
        brandColor: '#AA2200',
        accentColor: '#ffcc00',
        logoUrl: null,
        whatsapp: '(11) 97777-6666',
        address: 'Rua das Flores, 120, Centro',
      },
      sell: { delivery: false, pickup: true, tables: true },
      eta: { min: 15, max: 30 },
    };
    const r = await post('trials', {
      restaurant: 'Pizzaria Conversa',
      name: 'Dono Conversa',
      email,
      source: { kind: 'compose', value: 'conversa' },
      setup,
    }).expect(201);
    const host = `${r.body.slug}.comandou.test`;
    const entry = await http
      .post('/api/v1/auth/entry')
      .set('Host', host)
      .set(CSRF)
      .send({ token: r.body.entry })
      .expect(200);
    const cookie = (entry.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_sid='))!
      .split(';')[0]!;
    const sg = await http
      .get('/api/v1/menu-import/signup')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(sg.body.trial).toMatchObject({ aiSite: true, setup: true });
    const d = await http
      .get('/api/v1/menu-import/site-draft')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(d.body).toMatchObject({
      found: true,
      items: 3,
      setup: { delivery: false, pickup: true, tables: true, etaMin: 15, etaMax: 30 },
    });
    expect(d.body.categories.map((c: { name: string }) => c.name)).toEqual(['Pizzas', 'Bebidas']);
    expect(d.body.categories[0].items[0]).toMatchObject({ name: 'Calabresa', price: '49.90' });
    expect(d.body.store).toMatchObject({
      brandColor: '#aa2200',
      accentColor: '#ffcc00',
      whatsapp: '11977776666',
      address: 'Rua das Flores, 120, Centro',
    });
  });

  it('avisa no topo do sistema nos últimos dias do teste', async () => {
    const host = `${created.slug}.comandou.test`;
    const far = await http
      .get('/api/v1/subscription/notice')
      .set('Host', host)
      .set('Cookie', session)
      .expect(200);
    expect(far.body.level).toBe('none');
    await ownerQuery(
      `UPDATE subscriptions SET trial_ends_at = now() + interval '2 days'
        WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1) AND status <> 'cancelled'`,
      [created.slug],
    );
    const near = await http
      .get('/api/v1/subscription/notice')
      .set('Host', host)
      .set('Cookie', session)
      .expect(200);
    expect(near.body).toMatchObject({ level: 'info', trial: { daysLeft: 2 } });
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

  it('plano sem dias de teste: o cadastro pelo site fica fechado', async () => {
    await ownerQuery(`UPDATE plans SET trial_days = 0 WHERE id = $1`, [plan.id]);
    try {
      const r = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
      expect(r.body).toMatchObject({ signup: false, trialDays: 0, ai: false });
      await post('trials', {
        restaurant: 'Sem Teste',
        name: 'Dona Site',
        email: `sem-teste-${EMAIL}`,
      }).expect(503);
    } finally {
      await ownerQuery(`UPDATE plans SET trial_days = 5 WHERE id = $1`, [plan.id]);
    }
  });

  it('a tela do painel exige a sessão do Super Admin', async () => {
    await http.get('/api/v1/platform/site').set('Host', 'admin.comandou.test').expect(401);
    await http.get('/api/v1/platform/site').set('Host', SITE_HOST).expect(404);
  });

  it('dois cadastros ao mesmo tempo com o mesmo e-mail criam um restaurante só', async () => {
    const email = `dupla-${randomBytes(4).toString('hex')}@site.test`;
    const svc = app.get(SiteService);
    const body = {
      restaurant: 'Cantina Dupla',
      name: 'Dona Dupla',
      email,
      source: { kind: 'none' as const, value: '' },
    };
    const results = await Promise.allSettled([
      svc.create(body, '10.0.0.1'),
      svc.create(body, '10.0.0.2'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as { status?: number }).status).toBe(409);
    const [n] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM trial_signups WHERE email = $1`,
      [email],
    );
    expect(n!.n).toBe(1);
  });
});
