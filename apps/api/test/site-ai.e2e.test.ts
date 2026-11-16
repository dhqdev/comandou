import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { seal } from '../src/common/secret-box';
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

let app: INestApplication;
let http: ReturnType<typeof request>;
let ai: Server;
let calls = 0;
let before: { owner: Buffer | null; clients: Buffer | null };

const post = (path: string, body: object) =>
  http.post(`/api/v1/public/site/${path}`).set('Host', SITE_HOST).set(CSRF).send(body);

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls++;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(AI_REPLY) } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0012 },
        }),
      );
    });
  });
  await new Promise<void>((ok) => ai.listen(0, '127.0.0.1', ok));
  const [k] = await ownerQuery<{ owner: Buffer | null; clients: Buffer | null }>(
    `SELECT owner_api_key_enc AS owner, api_key_enc AS clients FROM platform_ai_settings`,
  );
  before = k!;
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
  await ownerQuery(`UPDATE platform_ai_settings SET owner_api_key_enc = $1, api_key_enc = $2`, [
    before?.owner ?? null,
    before?.clients ?? null,
  ]);
  await ownerQuery(`UPDATE platform_site_ai_settings SET per_ip_daily = 4, daily_tokens = 400000`);
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
