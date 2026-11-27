import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';

/**
 * Site com IA no comandou.com: só liga com a chave do OpenRouter, respeita os limites de tokens
 * e de sites por visitante do Super Admin, registra o consumo e leva o rascunho para os
 * primeiros passos do restaurante criado.
 */
const SITE_HOST = 'comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const EMAIL = `ia-${randomBytes(4).toString('hex')}@site.test`;

const AI_REPLY = {
  store: {
    name: 'Cantina da Nona',
    tagline: 'Massa fresca todo dia',
    about: null,
    brandColor: '#b23a1e',
    accentColor: '#f2b705',
    hours: [],
  },
  suggested: false,
  categories: [
    {
      name: 'Massas',
      items: [
        { name: 'Lasanha', description: 'Bolonhesa e queijo gratinado', price: '42.00' },
        { name: 'Nhoque', description: 'Ao sugo', price: '38.00' },
      ],
    },
    { name: 'Bebidas', items: [{ name: 'Refrigerante', description: 'Lata', price: '7.00' }] },
  ],
};

/** Cardápio enviado em foto ou PDF (o modelo de ler o cardápio). */
const MENU_REPLY = {
  store: { name: null, whatsapp: '(11) 98888-7777', address: 'Rua das Flores, 10', hours: [] },
  categories: [
    {
      name: 'Lanches',
      items: [
        { name: 'X-Burger', description: 'Pão, carne e queijo', price: '28.90' },
        { name: 'X-Salada', description: null, price: '32.00' },
      ],
    },
    { name: 'Bebidas', items: [{ name: 'Coca-Cola lata', description: null, price: '7.00' }] },
  ],
};
/** Estoque sugerido (o modelo da conversa). */
const STOCK_REPLY = {
  items: [
    { i: 0, qty: 30, min: 6 },
    { i: 1, qty: 25, min: 5 },
    { i: 2, qty: 48, min: 10 },
  ],
};

let app: INestApplication;
let http: ReturnType<typeof request>;
let ai: Server;
let calls = 0;
/** Chave que cada chamada ao OpenRouter usou (cabeçalho Authorization). */
const auths: string[] = [];
let before: { owner: Buffer | null; clients: Buffer | null; enabled: boolean };
/** O plano do site precisa ter dias de teste para o cadastro abrir. */
let plan: { id: string; trial_days: number };

const post = (path: string, body: object) =>
  http.post(`/api/v1/public/site/${path}`).set('Host', SITE_HOST).set(CSRF).send(body);

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls++;
      auths.push(String(req.headers.authorization ?? ''));
      const system = String(
        (JSON.parse(raw || '{}') as { messages?: { content?: unknown }[] }).messages?.[0]
          ?.content ?? '',
      );
      const reply = system.includes('estoque inicial')
        ? STOCK_REPLY
        : system.startsWith('Você lê cardápios')
          ? MENU_REPLY
          : AI_REPLY;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0012 },
        }),
      );
    });
  });
  await new Promise<void>((ok) => ai.listen(0, '127.0.0.1', ok));
  const [k] = await ownerQuery<{ owner: Buffer | null; clients: Buffer | null; enabled: boolean }>(
    `SELECT owner_api_key_enc AS owner, api_key_enc AS clients, enabled FROM platform_ai_settings`,
  );
  before = k!;
  // Plano padrão só deste arquivo: o restaurante do site nasce nele, com os dias de teste dele.
  await ownerQuery(`UPDATE plans SET is_default = false WHERE is_default`);
  [plan] = await ownerQuery<{ id: string; trial_days: number }>(
    `INSERT INTO plans (code, name, price_monthly, trial_days, is_default, active)
     VALUES ($1, 'Site', 400, 5, true, true) RETURNING id, trial_days`,
    [`site-ia-${randomBytes(3).toString('hex')}`],
  );
  await ownerQuery(`UPDATE platform_ai_settings SET owner_api_key_enc = NULL, api_key_enc = NULL`);
  await ownerQuery(
    `UPDATE platform_site_settings SET signup_enabled = true, daily_limit = 1000, email_webhook_url = ''`,
  );
  await ownerQuery(
    `UPDATE platform_site_ai_settings SET enabled = true, api_key_enc = NULL, per_ip_daily = 2,
            daily_tokens = 400000, monthly_tokens = 5000000`,
  );
  app = await createApp(
    testEnv({
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      TENANT_DATABASE_MODE: 'shared',
      OPENROUTER_BASE_URL: `http://127.0.0.1:${(ai.address() as AddressInfo).port}`,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await ownerQuery(
    `UPDATE platform_ai_settings SET owner_api_key_enc = $1, api_key_enc = $2, enabled = $3`,
    [before?.owner ?? null, before?.clients ?? null, before?.enabled ?? false],
  );
  await ownerQuery(
    `UPDATE platform_site_ai_settings SET per_ip_daily = 4, daily_tokens = 400000,
            first_steps_tokens = 400000`,
  );
  if (plan)
    await ownerQuery(`UPDATE plans SET is_default = false, active = false WHERE id = $1`, [
      plan.id,
    ]);
  await app?.close();
  await new Promise((ok) => ai.close(ok));
});

describe('Site com IA', () => {
  let claim: string;

  it('fica desligado enquanto não houver chave do OpenRouter', async () => {
    const r = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
    expect(r.body.ai).toBe(false);
    await post('ai', { kind: 'text', value: 'Lasanha 42\nNhoque 38' }).expect(503);
    expect(calls).toBe(0);
  });

  it('com a sua chave de Tokens, monta a loja e registra o consumo', async () => {
    await ownerQuery(`UPDATE platform_ai_settings SET owner_api_key_enc = $1`, [
      seal(KEY, 'sk-or-dono', 'ai:openrouter:owner'),
    ]);
    const c = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
    expect(c.body.ai).toBe(true);
    const r = await post('ai', {
      kind: 'text',
      value: 'Lasanha 42\nNhoque 38\nRefrigerante 7',
    }).expect(200);
    expect(r.body.site).toMatchObject({
      name: 'Cantina da Nona',
      tagline: 'Massa fresca todo dia',
      brandColor: '#b23a1e',
      items: 3,
    });
    expect(r.body.tokens).toBe(1500);
    expect(r.body.claim).toMatch(/^[A-Za-z0-9_-]{32}$/);
    claim = r.body.claim;
    const [g] = await ownerQuery<{ status: string; items: number; tokens: number }>(
      `SELECT status, items, prompt_tokens + completion_tokens AS tokens
         FROM site_ai_generations WHERE id = $1`,
      [r.body.id],
    );
    expect(g).toEqual({ status: 'ok', items: 3, tokens: 1500 });
    const [u] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_ai_usage WHERE source = 'site_ia'`,
    );
    expect(u!.n).toBeGreaterThan(0);
  });

  it('leva o rascunho para o restaurante criado e para os primeiros passos', async () => {
    const r = await post('trials', {
      restaurant: 'Cantina da Nona',
      name: 'Dona Nona',
      email: EMAIL,
      source: { kind: 'text', value: 'Lasanha 42\nNhoque 38\nRefrigerante 7' },
      aiSite: claim,
    }).expect(201);
    const [row] = await ownerQuery<{ linked: boolean; owner: boolean }>(
      `SELECT ts.ai_generation_id IS NOT NULL AS linked, g.tenant_id = ts.tenant_id AS owner
         FROM trial_signups ts JOIN site_ai_generations g ON g.id = ts.ai_generation_id
        WHERE ts.email = $1`,
      [EMAIL],
    );
    expect(row).toEqual({ linked: true, owner: true });
    // O mesmo rascunho não vai para um segundo restaurante.
    await post('trials', {
      restaurant: 'Cantina Copiada',
      name: 'Outra Pessoa',
      email: `copia-${EMAIL}`,
      aiSite: claim,
    }).expect(201);
    const [copy] = await ownerQuery<{ linked: boolean }>(
      `SELECT ai_generation_id IS NOT NULL AS linked FROM trial_signups WHERE email = $1`,
      [`copia-${EMAIL}`],
    );
    expect(copy!.linked).toBe(false);

    const host = `${r.body.slug}.comandou.test`;
    const e = await http
      .post('/api/v1/auth/entry')
      .set('Host', host)
      .set(CSRF)
      .send({ token: r.body.entry })
      .expect(200);
    const cookie = (e.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('cm_sid='))!
      .split(';')[0]!;
    const sg = await http
      .get('/api/v1/menu-import/signup')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(sg.body.trial.aiSite).toBe(true);
    const d = await http
      .get('/api/v1/menu-import/site-draft')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(d.body).toMatchObject({ found: true, items: 3 });
    expect(d.body.store).toMatchObject({ name: 'Cantina da Nona', brandColor: '#b23a1e' });
    expect(d.body.categories[0].items[0]).toMatchObject({ name: 'Lasanha', price: '42.00' });
  });

  it('respeita o limite de sites por visitante', async () => {
    await post('ai', { kind: 'text', value: 'Pizza 50\nRefrigerante 8' }).expect(200);
    const r = await post('ai', { kind: 'text', value: 'Pastel 12\nCaldo de cana 9' }).expect(429);
    expect(r.body.code).toBe('site_ai_limit');
  });

  it('para sozinho quando o limite de tokens do dia acaba', async () => {
    await ownerQuery(`UPDATE platform_site_ai_settings SET daily_tokens = 1000, per_ip_daily = 50`);
    const c = await http.get('/api/v1/public/site').set('Host', SITE_HOST).expect(200);
    expect(c.body.ai).toBe(false);
    const n = calls;
    await post('ai', { kind: 'text', value: 'Coxinha 9\nSuco 10' }).expect(503);
    expect(calls).toBe(n);
  });

  it('a seção do painel exige a sessão do Super Admin', async () => {
    await http.get('/api/v1/platform/site-ai').set('Host', 'admin.comandou.test').expect(401);
    await http.get('/api/v1/platform/site-ai').set('Host', SITE_HOST).expect(404);
  });
});

describe('Criação pelo site com a chave do sistema', () => {
  const SESSION = randomBytes(18).toString('base64url');
  const MENU_EMAIL = `cardapio-${randomBytes(4).toString('hex')}@site.test`;
  let siteClaim: string;
  let menuClaim: string;
  let tenantId: string;
  let cookie: string;
  let host: string;
  const pdf = Buffer.from('%PDF-1.4\n% cardapio de teste\n%%EOF\n');
  const menu = (query = '') =>
    http
      .post(`/api/v1/public/site/menu?sessao=${SESSION}${query}`)
      .set('Host', SITE_HOST)
      .set(CSRF)
      .set('Content-Type', 'application/pdf')
      .send(pdf);

  beforeAll(async () => {
    // As duas chaves salvas: a criação tem de sair da do sistema (a sua).
    await ownerQuery(
      `UPDATE platform_ai_settings SET owner_api_key_enc = $1, api_key_enc = $2, enabled = true`,
      [
        seal(KEY, 'sk-or-dono', 'ai:openrouter:owner'),
        seal(KEY, 'sk-or-restaurantes', 'ai:openrouter'),
      ],
    );
    await ownerQuery(
      `UPDATE platform_site_ai_settings SET daily_tokens = 0, per_ip_daily = 50,
              first_steps_tokens = 400000`,
    );
  });

  it('monta o site, lê o cardápio enviado e sugere o estoque pela chave do sistema', async () => {
    const s = await post('ai', { kind: 'text', value: 'Lasanha 42\nNhoque 38', session: SESSION });
    expect(s.status).toBe(200);
    expect(auths.at(-1)).toBe('Bearer sk-or-dono');
    siteClaim = s.body.claim;

    const m = await menu().expect(200);
    expect(auths.at(-1)).toBe('Bearer sk-or-dono');
    expect(m.body.claim).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(m.body.menu).toMatchObject({ items: 3, stockPending: true });
    expect(m.body.menu.categories[0].items[0]).toMatchObject({ name: 'X-Burger', price: '28.90' });
    menuClaim = m.body.claim;
    // Mais uma página do mesmo cardápio: junta (item repetido não entra duas vezes).
    const m2 = await menu(`&rascunho=${menuClaim}`).expect(200);
    expect(m2.body.claim).toBe(menuClaim);
    expect(m2.body.menu.items).toBe(3);
    // Arquivo que não é PDF nem foto nem chega na IA.
    const n0 = calls;
    await http
      .post('/api/v1/public/site/menu')
      .set('Host', SITE_HOST)
      .set(CSRF)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('não é pdf'))
      .expect(422);
    expect(calls).toBe(n0);

    const st = await post('stock', { claim: menuClaim }).expect(200);
    expect(auths.at(-1)).toBe('Bearer sk-or-dono');
    expect(st.body.menu.stockPending).toBe(false);
    expect(st.body.menu.categories[0].items[0].stock).toEqual({ qty: 30, min: 6 });
    expect(st.body.menu.categories[1].items[0].stock).toEqual({ qty: 48, min: 10 });
    // Pedir de novo não chama a IA: o estoque já está no rascunho.
    const n1 = calls;
    await post('stock', { claim: menuClaim }).expect(200);
    expect(calls).toBe(n1);
    await post('stock', { claim: 'x'.repeat(32) }).expect(422);

    const rows = await ownerQuery<{ step: string; key: string }>(
      `SELECT u.step, u.key_kind AS key FROM platform_ai_usage u
         JOIN site_ai_generations g ON g.id = u.generation_id
        WHERE g.session = $1 ORDER BY u.id`,
      [SESSION],
    );
    expect(rows.map((r) => r.step)).toEqual(['site', 'cardapio', 'cardapio', 'estoque']);
    expect(rows.every((r) => r.key === 'owner')).toBe(true);
  });

  it('o cadastro leva o cardápio com o estoque e os primeiros passos saem da chave do sistema', async () => {
    const r = await post('trials', {
      restaurant: 'Lanchonete do Site',
      name: 'Ana do Site',
      email: MENU_EMAIL,
      source: { kind: 'text', value: 'Lasanha 42\nNhoque 38' },
      aiSite: siteClaim,
      aiMenu: menuClaim,
      session: SESSION,
    }).expect(201);
    const [t] = await ownerQuery<{ tenant_id: string; menu: boolean; session: string }>(
      `SELECT tenant_id, menu_generation_id IS NOT NULL AS menu, site_session AS session
         FROM trial_signups WHERE email = $1`,
      [MENU_EMAIL],
    );
    expect(t).toMatchObject({ menu: true, session: SESSION });
    tenantId = t!.tenant_id;
    host = `${r.body.slug}.comandou.test`;
    const e = await http
      .post('/api/v1/auth/entry')
      .set('Host', host)
      .set(CSRF)
      .send({ token: r.body.entry })
      .expect(200);
    cookie = (e.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('cm_sid='))!
      .split(';')[0]!;
    const get = (path: string) =>
      http.get(`/api/v1${path}`).set('Host', host).set('Cookie', cookie);

    const sg = await get('/menu-import/signup').expect(200);
    expect(sg.body.trial).toMatchObject({ aiSite: true, aiMenu: true });
    // O cardápio enviado vale mais que o do site; a loja do site fica, o menu completa o contato.
    const d = await get('/menu-import/site-draft').expect(200);
    expect(d.body).toMatchObject({ found: true, items: 3, suggested: false });
    expect(d.body.store).toMatchObject({ name: 'Cantina da Nona', whatsapp: '11988887777' });
    expect(d.body.categories[0].items[0]).toMatchObject({
      name: 'X-Burger',
      price: '28.90',
      stock: { qty: 30, min: 6 },
    });

    const st = await get('/menu-import').expect(200);
    expect(st.body).toMatchObject({ enabled: true, creation: true });
    await http
      .post('/api/v1/menu-import/text')
      .set('Host', host)
      .set('Cookie', cookie)
      .set(CSRF)
      .send({ text: 'Pastel 12\nCaldo de cana 9\nCoxinha 8' })
      .expect(200);
    expect(auths.at(-1)).toBe('Bearer sk-or-dono');
    // Nada no limite do restaurante: o gasto fica no extrato do sistema, com a etapa.
    const [own] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_usage WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(own!.n).toBe(0);
    const [mine] = await ownerQuery<{ step: string; key: string }>(
      `SELECT step, key_kind AS key FROM platform_ai_usage WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(mine).toEqual({ step: 'texto', key: 'owner' });
  });

  it('acabou o limite dos primeiros passos: volta a gastar do limite do restaurante', async () => {
    await ownerQuery(`UPDATE platform_site_ai_settings SET first_steps_tokens = 1`);
    const st = await http
      .get('/api/v1/menu-import')
      .set('Host', host)
      .set('Cookie', cookie)
      .expect(200);
    expect(st.body.creation).toBe(false);
    await http
      .post('/api/v1/menu-import/text')
      .set('Host', host)
      .set('Cookie', cookie)
      .set(CSRF)
      .send({ text: 'Pastel 12\nCaldo de cana 9\nCoxinha 8' })
      .expect(200);
    expect(auths.at(-1)).toBe('Bearer sk-or-restaurantes');
    const [own] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_usage WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(own!.n).toBe(1);
  });

  it('a aba Criação do Super Admin soma o gasto de cada etapa', async () => {
    const ADMIN_HOST = 'admin.comandou.test';
    const SECRET = newTotpSecret();
    const email = `criacao-${randomBytes(3).toString('hex')}@plataforma.test`;
    const [{ id }] = await ownerQuery<{ id: string }>(
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ($1, 'Criação', $2, '\\x00') RETURNING id`,
      [email, await hashPassword('senha-super-admin-123')],
    );
    await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
      id,
      seal(KEY, SECRET, totpContext(id)),
    ]);
    const login = await http
      .post('/api/v1/platform/auth/login')
      .set('Host', ADMIN_HOST)
      .set(CSRF)
      .send({ email, password: 'senha-super-admin-123', code: totpCode(SECRET, totpStep()) })
      .expect(200);
    const admin = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_admin='))!
      .split(';')[0]!;
    const r = await http
      .get(`/api/v1/platform/site/creation/${tenantId}`)
      .set('Host', ADMIN_HOST)
      .set('Cookie', admin)
      .expect(200);
    expect(r.body.steps.map((s: { step: string }) => s.step)).toEqual([
      'site',
      'cardapio',
      'estoque',
      'texto',
    ]);
    expect(r.body.steps.find((s: { step: string }) => s.step === 'cardapio').calls).toBe(2);
    expect(r.body.total.calls).toBe(5);
    expect(r.body.clientsKey).toBe(false);
    expect(r.body.firstSteps).toMatchObject({ budget: 1, open: false });
    const d = await http
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set('Host', ADMIN_HOST)
      .set('Cookie', admin)
      .expect(200);
    expect(d.body.fromSite).toBe(true);
  });
});
