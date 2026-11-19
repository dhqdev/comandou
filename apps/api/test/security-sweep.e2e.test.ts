import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { roleHas, type Permission, type Role } from '@comandou/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { PERMISSION, PUBLIC, SKIP_CSRF, SKIP_TENANT } from '../src/common/decorators';
import { randomBytes } from 'node:crypto';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Varredura de segurança de TODAS as rotas da API, descobertas sozinhas (rota nova entra no
 * teste sem ninguém lembrar). Confere, rota por rota:
 *
 * - sem sessão, com a sessão de outro restaurante e pelo endereço errado (painel, site), nada
 *   protegido responde;
 * - cada perfil da equipe só passa onde tem a permissão (garçom, cozinha, entregador);
 * - parâmetros com injeção (SQL, caminho de arquivo) e corpo hostil (protótipo, ids de outro
 *   restaurante, números absurdos, HTML) nunca viram erro 500 nem mexem no outro restaurante;
 * - a lista de rotas públicas e sem proteção contra CSRF é a revisada: rota pública nova faz
 *   este teste falhar até alguém conferir limite, validação e dono e acrescentar aqui.
 *
 * Guia: docs/security.md (varredura) e a skill comandou-seguranca.
 */

const A = 'swp-a.comandou.test';
const B = 'swp-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const ZERO = '00000000-0000-4000-8000-000000000000';

interface Route {
  method: string;
  path: string;
  pub: boolean;
  skipTenant: boolean;
  skipCsrf: boolean;
  perms: Permission[] | undefined;
  guards: string[];
  handler: string;
}

let app: INestApplication;
let fx: Fixture;
const routes: Route[] = [];

/** Rotas abertas (sem sessão da equipe) no endereço do restaurante. Cada uma foi revisada. */
const PUBLIC_TENANT_ROUTES = [
  // Entrar, PIN, nova senha, acesso de suporte e primeiro acesso do teste grátis.
  'POST /api/v1/auth/entry',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/password-reset/complete',
  'POST /api/v1/auth/password-reset/request',
  'POST /api/v1/auth/password-reset/verify',
  'POST /api/v1/auth/pin',
  'POST /api/v1/auth/support',
  // App do entregador por link (token longo, só as corridas dele).
  'GET /api/v1/courier-app/:token',
  'GET /api/v1/courier-app/:token/available',
  'POST /api/v1/courier-app/:token/deliveries/:id/complete',
  'POST /api/v1/courier-app/:token/deliveries/:id/fail',
  'POST /api/v1/courier-app/:token/deliveries/:id/location',
  'GET /api/v1/courier-app/:token/earnings',
  'GET /api/v1/courier-app/:token/history',
  'POST /api/v1/courier-app/:token/orders/:id/claim',
  'GET /api/v1/courier-app/:token/profile',
  'GET /api/v1/health/site',
  'GET /api/v1/media/:id',
  // Agente de impressão (token do agente no cabeçalho).
  'POST /api/v1/print-agent/claim',
  'POST /api/v1/print-agent/heartbeat',
  'POST /api/v1/print-agent/jobs/:id/result',
  // Cardápio online: visitante e conta do cliente (cookie próprio, conferido em cada rota).
  'GET /api/v1/store',
  'GET /api/v1/store/account',
  'PATCH /api/v1/store/account',
  'POST /api/v1/store/account/addresses',
  'DELETE /api/v1/store/account/addresses/:id',
  'PATCH /api/v1/store/account/addresses/:id',
  'GET /api/v1/store/account/cart',
  'PUT /api/v1/store/account/cart',
  'POST /api/v1/store/account/login',
  'POST /api/v1/store/account/logout',
  'GET /api/v1/store/account/orders',
  'GET /api/v1/store/account/orders/:id',
  'POST /api/v1/store/account/orders/:id/cancel',
  'POST /api/v1/store/account/orders/:id/pay/card',
  'POST /api/v1/store/account/orders/:id/pay/pix',
  'POST /api/v1/store/account/orders/:id/picked-up',
  'POST /api/v1/store/account/orders/:id/pix-receipt',
  'POST /api/v1/store/account/password',
  'POST /api/v1/store/account/password/forgot',
  'POST /api/v1/store/account/password/reset',
  'DELETE /api/v1/store/account/photo',
  'GET /api/v1/store/account/photo',
  'PUT /api/v1/store/account/photo',
  'POST /api/v1/store/account/signup',
  'GET /api/v1/store/branding',
  'GET /api/v1/store/cep',
  'GET /api/v1/store/cep/:cep',
  'GET /api/v1/store/chat',
  'POST /api/v1/store/chat/files',
  'GET /api/v1/store/chat/files/:id',
  'GET /api/v1/store/chat/messages',
  'POST /api/v1/store/chat/messages',
  'POST /api/v1/store/chat/read',
  'POST /api/v1/store/chat/start',
  'POST /api/v1/store/chat/typing',
  'GET /api/v1/store/chat/unread',
  'POST /api/v1/store/delivery-quote',
  'GET /api/v1/store/geocode',
  'GET /api/v1/store/locate',
  'GET /api/v1/store/loyalty',
  'GET /api/v1/store/manifest',
  'GET /api/v1/store/models/:id/:file',
  'POST /api/v1/store/orders',
  'GET /api/v1/store/orders/:token',
  'POST /api/v1/store/orders/:token/cancel',
  'GET /api/v1/store/orders/:token/pay',
  'POST /api/v1/store/orders/:token/pay/card',
  'POST /api/v1/store/orders/:token/pay/pix',
  'POST /api/v1/store/orders/:token/picked-up',
  'POST /api/v1/store/orders/:token/pix-receipt',
  'POST /api/v1/store/pagbank/notify',
  'POST /api/v1/store/pixel',
  'GET /api/v1/store/preview',
  'GET /api/v1/store/products/:id/reviews',
  'DELETE /api/v1/store/products/:id/reviews',
  'PUT /api/v1/store/products/:id/reviews',
  'POST /api/v1/store/products/:id/reviews/:reviewId/like',
  'GET /api/v1/store/region',
  'POST /api/v1/store/reservations',
  'GET /api/v1/store/reservations/:token',
  'POST /api/v1/store/reservations/:token/cancel',
  'GET /api/v1/store/reservations/availability',
  'GET /api/v1/store/reservations/config',
  'GET /api/v1/store/site',
  'GET /api/v1/store/status',
  'POST /api/v1/store/table-presence',
  'GET /api/v1/tenant',
  'GET /api/v1/track/:token',
];

/** Rotas sem restaurante e sem a guarda do painel: cada uma confere um token próprio ou é aberta. */
const OPEN_WITHOUT_TENANT = [
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
  'GET /api/v1/internal/traefik', // token do Traefik na query
  'POST /api/v1/internal/whatsapp/inbound', // token do gateway, antes de ler o corpo
  'GET /api/v1/metrics', // token do Prometheus
  'GET /api/v1/public/plans',
  'GET /api/v1/public/site',
  'POST /api/v1/public/site/ai',
  'POST /api/v1/public/site/preview',
  'POST /api/v1/public/site/trials',
  'GET /api/v1/public/site/trials/:token',
];

/** Escrita sem o cabeçalho anti-CSRF: só quem chama de fora com token ou assinatura. */
const SKIP_CSRF_ROUTES = [
  'POST /api/v1/internal/whatsapp/inbound',
  'POST /api/v1/platform/billing/asaas/webhook',
  'POST /api/v1/platform/channels/webhooks/rappi/:hook',
  'POST /api/v1/store/pagbank/notify',
];

const key = (r: Route) => `${r.method} ${r.path}`;
const fill = (p: string, v: string) => p.replace(/:[A-Za-z_]+/g, v);
/** Rotas que encerram a sessão de quem chama (ficam por último em cada volta). */
const ENDS_SESSION = /\/(logout|password|sessions\/revoke)(\/|$)|\/auth\/password$/;

function discover(a: INestApplication) {
  const scan = new MetadataScanner();
  const refl = a.get(Reflector);
  const wrappers = [...a.get(ModulesContainer).values()].flatMap((m) => [
    ...m.controllers.values(),
  ]);
  for (const w of wrappers) {
    const inst = w.instance as Record<string, unknown> | undefined;
    if (!inst) continue;
    const cls = w.metatype as unknown as object;
    const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    for (const name of scan.getAllMethodNames(Object.getPrototypeOf(inst))) {
      const h = inst[name] as object;
      const sub = Reflect.getMetadata(PATH_METADATA, h) as string | string[] | undefined;
      if (sub === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number];
      const meta = <T>(k: string) =>
        refl.getAllAndOverride<T>(k, [h as never, cls as never]) as T | undefined;
      const guards = [
        ...((Reflect.getMetadata(GUARDS_METADATA, cls) as { name: string }[]) ?? []),
        ...((Reflect.getMetadata(GUARDS_METADATA, h) as { name: string }[]) ?? []),
      ].map((g) => g.name);
      for (const c of base)
        for (const p of ([] as string[]).concat(sub))
          routes.push({
            method,
            path: `/api/v1/${c}/${p}`.replace(/\/+/g, '/').replace(/\/$/, ''),
            pub: !!meta<boolean>(PUBLIC),
            skipTenant: !!meta<boolean>(SKIP_TENANT),
            skipCsrf: !!meta<boolean>(SKIP_CSRF),
            perms: meta<Permission[]>(PERMISSION),
            guards,
            handler: `${(cls as { name: string }).name}.${name}`,
          });
    }
  }
  routes.sort((x, y) => Number(ENDS_SESSION.test(x.path)) - Number(ENDS_SESSION.test(y.path)));
}

const http = () => request(app.getHttpServer());

async function call(
  method: string,
  url: string,
  host: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const m = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let r = http()[m](url).set('Host', host).set(CSRF);
  if (cookie) r = r.set('Cookie', cookie);
  if (body !== undefined && !['get', 'delete'].includes(m)) r = r.send(body as object);
  const res = await r.timeout(15_000);
  return { status: res.status, body: res.body };
}

async function login(host: string, email: string): Promise<string> {
  const r = await http()
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(r.status, `login ${email}`).toBe(200);
  return ((r.headers['set-cookie'] as unknown as string[]) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Sessões que continuam valendo durante a varredura (rota de sair derruba, entramos de novo). */
class Sessions {
  private cookies = new Map<string, string>();
  constructor(private readonly users: Record<string, [string, string]>) {}
  async get(who: string): Promise<string> {
    const [host, email] = this.users[who]!;
    let c = this.cookies.get(who);
    if (c) {
      const me = await http().get('/api/v1/auth/me').set('Host', host).set('Cookie', c);
      if (me.status === 200) return c;
    }
    c = await login(host, email);
    this.cookies.set(who, c);
    return c;
  }
}

let sessions: Sessions;

beforeAll(async () => {
  fx = await seedTwoTenants('swp');
  // Cozinha e entregador no restaurante A (o garçom já vem do seedTwoTenants).
  for (const role of ['kitchen', 'driver'] as const) {
    const [u] = await ownerQuery<{ id: string }>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [`${role}@swp-a.test`, `Perfil ${role}`, await hashPassword(PASSWORD)],
    );
    await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [
      fx.tenantA,
      u!.id,
      role,
    ]);
  }
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '100000',
      RATE_LIMIT_PER_MINUTE: '100000',
      // Painel ligado (banco da plataforma e chave), para as rotas do Super Admin responderem.
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: randomBytes(32).toString('base64'),
    }),
    { logger: false },
  );
  await app.init();
  discover(app);
  sessions = new Sessions({
    admin: [A, 'admin@swp-a.test'],
    otherTenant: [B, 'admin@swp-b.test'],
    waiter: [A, 'garcom@swp-a.test'],
    kitchen: [A, 'kitchen@swp-a.test'],
    driver: [A, 'driver@swp-a.test'],
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

/** Rota do restaurante que exige sessão da equipe. */
const isStaff = (r: Route) => !r.pub && !r.skipTenant;
const isPlatform = (r: Route) => r.guards.includes('PlatformHostGuard');
/** 429 vem antes da sessão (limite curto de algumas rotas): também é "não entrou". */
const blocked = (s: number, ...ok: number[]) => ok.includes(s) || s === 429;

describe('Inventário de rotas', () => {
  it('descobriu as rotas da API', () => {
    expect(routes.length).toBeGreaterThan(600);
    expect(routes.some((r) => r.method === 'ALL')).toBe(false);
  });

  it('toda rota pública do restaurante é uma das revisadas', () => {
    const found = routes
      .filter((r) => r.pub && !r.skipTenant && !isPlatform(r))
      .map(key)
      .sort();
    const novas = found.filter((k) => !PUBLIC_TENANT_ROUTES.includes(k));
    const sumiram = PUBLIC_TENANT_ROUTES.filter((k) => !found.includes(k));
    expect(
      novas,
      'rota pública nova: revise limite, validação e dono e acrescente na lista',
    ).toEqual([]);
    expect(sumiram, 'rota saiu: tire da lista').toEqual([]);
  });

  it('rota sem restaurante tem a guarda do painel ou é uma das abertas revisadas', () => {
    const found = routes
      .filter((r) => r.skipTenant && !isPlatform(r))
      .map(key)
      .sort();
    expect(found).toEqual([...OPEN_WITHOUT_TENANT].sort());
  });

  it('rota do painel que não é de entrar exige a sessão do Super Admin', () => {
    const semSessao = routes.filter(
      (r) =>
        isPlatform(r) &&
        !r.guards.includes('PlatformSessionGuard') &&
        !/^\/api\/v1\/(platform\/(auth|receive|sign|billing\/asaas|channels\/webhooks)|pagbank\/connect)\b/.test(
          r.path,
        ),
    );
    expect(semSessao.map(key)).toEqual([]);
  });

  it('só os webhooks listados dispensam o cabeçalho anti-CSRF', () => {
    expect(
      routes
        .filter((r) => r.skipCsrf)
        .map(key)
        .sort(),
    ).toEqual([...SKIP_CSRF_ROUTES].sort());
  });
});

describe('Varredura de acesso (todas as rotas)', () => {
  it('sem sessão, nenhuma rota da equipe responde (401)', async () => {
    const wrong: string[] = [];
    for (const r of routes.filter(isStaff)) {
      const { status } = await call(r.method, fill(r.path, ZERO), A, undefined, {});
      if (!blocked(status, 401)) wrong.push(`${key(r)} → ${status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a sessão de outro restaurante não vale aqui (401), nem com cookie trocado de nome', async () => {
    const other = await sessions.get('otherTenant');
    const wrong: string[] = [];
    for (const r of routes.filter(isStaff)) {
      const { status } = await call(r.method, fill(r.path, ZERO), A, other, {});
      if (!blocked(status, 401)) wrong.push(`${key(r)} → ${status}`);
    }
    expect(wrong).toEqual([]);
  });

  it.each(['waiter', 'kitchen', 'driver'] as const)(
    'perfil %s só entra onde tem permissão (403 no resto)',
    async (role: Role) => {
      const wrong: string[] = [];
      for (const r of routes.filter((x) => isStaff(x) && x.perms?.length)) {
        if (r.perms!.some((p) => roleHas(role, p))) continue;
        const cookie = await sessions.get(role);
        const { status } = await call(r.method, fill(r.path, ZERO), A, cookie, {});
        if (!blocked(status, 403)) wrong.push(`${key(r)} → ${status}`);
      }
      expect(wrong).toEqual([]);
    },
  );

  it('rotas do painel não respondem no endereço do restaurante nem sem a sessão do painel', async () => {
    const admin = await sessions.get('admin');
    const wrong: string[] = [];
    for (const r of routes.filter(isPlatform)) {
      const url = fill(r.path, ZERO);
      // No endereço do restaurante, nem com a sessão do dono: a rota "não existe".
      const t = await call(r.method, url, A, admin, {});
      if (!blocked(t.status, 404)) wrong.push(`${key(r)} no restaurante → ${t.status}`);
      // No painel, com o cookie do restaurante: só as rotas de entrar/assinar respondem.
      if (r.guards.includes('PlatformSessionGuard')) {
        const p = await call(r.method, url, 'admin.comandou.test', admin, {});
        if (!blocked(p.status, 401)) wrong.push(`${key(r)} no painel → ${p.status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rotas da equipe não respondem no endereço do site nem do painel', async () => {
    const admin = await sessions.get('admin');
    const wrong: string[] = [];
    for (const r of routes.filter(isStaff)) {
      for (const host of ['comandou.test', 'admin.comandou.test', 'swp-a.comandou.test.evil.com']) {
        const { status } = await call(r.method, fill(r.path, ZERO), host, admin, {});
        if (status < 400 || status >= 500) wrong.push(`${key(r)} em ${host} → ${status}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('Entradas hostis (todas as rotas, como administrador)', () => {
  const PARAMS = [
    "1' OR '1'='1",
    '1; DROP TABLE orders; --',
    '..%2F..%2F..%2Fetc%2Fpasswd',
    '%00',
    '9'.repeat(400),
    '-1',
    '1e999',
    '%E2%80%AE',
  ];
  const hostileBody = () => ({
    __proto__: { isAdmin: true, role: 'owner' },
    constructor: { prototype: { polluted: true } },
    id: fx.prodB,
    tenantId: fx.tenantB,
    tenant_id: fx.tenantB,
    userId: ZERO,
    role: 'owner',
    name: '<img src=x onerror=alert(1)>',
    email: "a'@b.c",
    phone: '1'.repeat(5000),
    amount: -1e308,
    price: 'NaN',
    quantity: 1e400,
    items: [{ productId: fx.prodB, quantity: -5 }],
    url: 'http://[::ffff:169.254.169.254]/latest/meta-data',
    date: '9999-99-99',
    nested: JSON.parse('{"a":{"b":{"c":{"d":{"e":{"f":[[[[[[[[[1]]]]]]]]]}}}}}}'),
  });
  const ALLOWED_5XX = new Set([501, 503]); // "ainda não configurado" (IA, PagBank, nota fiscal)

  it('nenhum parâmetro com injeção derruba a API (sem 500)', async () => {
    const wrong: string[] = [];
    for (const r of routes.filter((x) => x.path.includes(':'))) {
      for (const v of PARAMS) {
        const cookie = isStaff(r) ? await sessions.get('admin') : undefined;
        const host = isPlatform(r) ? 'admin.comandou.test' : A;
        const { status, body } = await call(r.method, fill(r.path, v), host, cookie, {});
        if (status >= 500 && !ALLOWED_5XX.has(status))
          wrong.push(`${key(r)} [${v}] → ${status} ${JSON.stringify(body).slice(0, 160)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('corpo hostil não derruba a API, não polui o protótipo e não mexe no outro restaurante', async () => {
    const before = await ownerQuery<{ n: string }>(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS n FROM (
         SELECT id, name, price FROM products WHERE tenant_id = $1
         UNION ALL SELECT id, name, NULL FROM categories WHERE tenant_id = $1) t`,
      [fx.tenantB],
    );
    const wrong: string[] = [];
    for (const r of routes.filter((x) => ['POST', 'PUT', 'PATCH'].includes(x.method))) {
      const cookie = isStaff(r) ? await sessions.get('admin') : undefined;
      const host = isPlatform(r) ? 'admin.comandou.test' : A;
      const { status, body } = await call(
        r.method,
        fill(r.path, ZERO),
        host,
        cookie,
        hostileBody(),
      );
      if (status >= 500 && !ALLOWED_5XX.has(status))
        wrong.push(`${key(r)} → ${status} ${JSON.stringify(body).slice(0, 160)}`);
    }
    expect(wrong).toEqual([]);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const after = await ownerQuery<{ n: string }>(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS n FROM (
         SELECT id, name, price FROM products WHERE tenant_id = $1
         UNION ALL SELECT id, name, NULL FROM categories WHERE tenant_id = $1) t`,
      [fx.tenantB],
    );
    expect(after[0]!.n).toBe(before[0]!.n);
    // Nada do restaurante A foi gravado apontando para o B.
    const cross = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM products WHERE tenant_id = $1 AND category_id = $2`,
      [fx.tenantA, fx.catB],
    );
    expect(cross[0]!.n).toBe(0);
  });
});

describe('Sessão, cabeçalhos e CSRF', () => {
  it('toda resposta da API sai sem cache, com CSP fechada e sem dizer o servidor', async () => {
    const admin = await sessions.get('admin');
    for (const [url, cookie] of [
      ['/api/v1/auth/me', admin],
      ['/api/v1/customers', admin],
      ['/api/v1/store', undefined],
      ['/api/v1/rota-que-nao-existe', undefined],
    ] as const) {
      let r = http().get(url).set('Host', A);
      if (cookie) r = r.set('Cookie', cookie);
      const res = await r;
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['content-security-policy'], url).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['x-powered-by'], url).toBeUndefined();
      expect(JSON.stringify(res.body), url).not.toMatch(/at .*\.ts:\d+|node_modules|stack/);
    }
  });

  it('a prévia do link (única página HTML) só roda o próprio script', async () => {
    const res = await http()
      .get('/api/v1/store/preview?p=/pedir')
      .set('Host', A)
      .set('User-Agent', 'WhatsApp/2.0');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(
      /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/,
    );
  });

  it('cookie de sessão: HttpOnly, SameSite, só deste endereço; sair invalida no servidor', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .set('Host', A)
      .set(CSRF)
      .set('Cookie', 'cm_sid=valor-escolhido-pelo-atacante')
      .send({ email: 'admin@swp-a.test', password: PASSWORD });
    expect(res.status).toBe(200);
    const raw = ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
      c.startsWith('cm_sid='),
    )!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).not.toMatch(/Domain=/i);
    const cookie = raw.split(';')[0]!;
    // Fixação de sessão: o valor plantado antes do login não vira sessão.
    expect(cookie).not.toBe('cm_sid=valor-escolhido-pelo-atacante');
    expect(cookie.length).toBeGreaterThan(40);
    const me = () => http().get('/api/v1/auth/me').set('Host', A).set('Cookie', cookie);
    expect((await me()).status).toBe(200);
    await http()
      .post('/api/v1/auth/logout')
      .set('Host', A)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    expect((await me()).status).toBe(401);
  });

  it('escrita sem o cabeçalho de proteção ou de outra origem é recusada', async () => {
    const admin = await sessions.get('admin');
    const post = () =>
      http().post('/api/v1/categories').set('Host', A).set('Cookie', admin).send({ name: 'CSRF' });
    expect((await post()).status).toBe(403);
    expect((await post().set(CSRF).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await post().set(CSRF).set('Origin', `https://${B}`)).status).toBe(403);
    expect((await post().set(CSRF).set('Origin', 'null')).status).toBe(403);
    // A mesma origem passa (o app de verdade).
    expect((await post().set(CSRF).set('Origin', `https://${A}`)).status).toBeLessThan(400);
  });

  it('JSON quebrado, corpo gigante e tipo errado viram 4xx, nunca 500', async () => {
    const admin = await sessions.get('admin');
    const base = () =>
      http().post('/api/v1/categories').set('Host', A).set(CSRF).set('Cookie', admin);
    expect((await base().set('Content-Type', 'application/json').send('{"name":')).status).toBe(
      400,
    );
    expect(
      (
        await base()
          .set('Content-Type', 'application/json')
          .send(`{"name":"${'x'.repeat(300_000)}"}`)
      ).status,
    ).toBe(413);
    const xml = await base().set('Content-Type', 'application/xml').send('<a>1</a>');
    expect(xml.status).toBeGreaterThanOrEqual(400);
    expect(xml.status).toBeLessThan(500);
  });

  it('senha nova óbvia é recusada com o motivo (cliente do cardápio e equipe)', async () => {
    const signup = (password: string) =>
      http()
        .post('/api/v1/store/account/signup')
        .set('Host', A)
        .set(CSRF)
        .send({ name: 'Cliente Varredura', phone: '11987650000', password });
    for (const [pw, why] of [
      ['abc123', /8 caracteres/],
      ['12345678', /fácil de adivinhar/],
      ['senha123', /fácil de adivinhar/],
      ['11987650000', /telefone/],
    ] as const) {
      const r = await signup(pw);
      expect(r.status, pw).toBe(400);
      expect(r.body.issues, pw).toHaveLength(1);
      expect(r.body.issues[0].message, pw).toMatch(why);
    }
    expect((await signup('tomate-com-queijo-7')).status).toBe(201);

    const admin = await sessions.get('admin');
    const weak = await http()
      .post('/api/v1/auth/password')
      .set('Host', A)
      .set(CSRF)
      .set('Cookie', admin)
      .send({ current: PASSWORD, next: 'qwerty123' });
    expect(weak.status).toBe(400);
    expect(weak.body.issues[0].message).toMatch(/fácil de adivinhar/);
  });

  it('Host estranho nunca cai em outro restaurante', async () => {
    for (const host of [
      'SWP-A.COMANDOU.TEST',
      'swp-a.comandou.test.',
      'swp-a.comandou.test:443',
      'swp-b.comandou.test@swp-a.comandou.test',
      'x.swp-a.comandou.test',
      'swp-a.comandou.test\\@evil.com',
    ]) {
      const res = await http().get('/api/v1/tenant').set('Host', host);
      if (res.status === 200) expect(res.body.slug ?? res.body.tenant?.slug, host).toBe('swp-a');
      else expect(res.status, host).toBeGreaterThanOrEqual(400);
    }
  });
});
