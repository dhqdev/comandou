import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { DomainVerifier } from '../src/domains/domains.controller';
import type { CleanupTarget, HostAgent } from '../src/host-agent/agent';
import { agentServer } from '../src/host-agent/server';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { APP_URL, PLATFORM_URL, testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 6: painel Super Admin (admin.<base>) com papel de banco próprio, login com código do
 * autenticador, planos/assinaturas/limites, suspensão, domínios por DNS TXT, provider do Traefik
 * e métricas. Inclui as barreiras: rota do painel some fora de admin.<base>, cookie do
 * restaurante não abre o painel, papéis de banco sem acesso cruzado.
 */
const ADMIN_HOST = 'admin.comandou.test';
const HOST_A = 'pf-a.comandou.test';
const HOST_B = 'pf-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const METRICS_TOKEN = 'metrics-token-0123456789abcdef';
const TRAEFIK_TOKEN = 'traefik-token-0123456789abcdef';
const AGENT_TOKEN = 'agent-token-0123456789abcdef';
const ADMIN_EMAIL = 'root@plataforma.test';
const ADMIN_PASSWORD = 'senha-super-admin-123';
const SECRET = newTotpSecret();

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let adminCookie = '';
const txt = new Map<string, string[]>();

// Agente do servidor falso (o HTTP e a autenticação são os reais; só as leituras são fixas).
const agentCalls: string[] = [];
const fakeAgent = {
  status: async () => ({ host: { hostname: 'vm-teste' }, history: [], docker: { services: [] } }),
  diskUsage: async () => ({ images: { count: 3 } }),
  cleanup: async (targets: CleanupTarget[]) => {
    agentCalls.push(`cleanup:${targets.join(',')}`);
    return targets.map((target) => ({ target, reclaimed: 100, removed: 1 }));
  },
  restartService: async (name: string) => {
    agentCalls.push(`restart:${name}`);
    return { service: name };
  },
  serviceLogs: async (name: string, tail: number) => ({ service: name, text: `linhas ${tail}` }),
} as unknown as HostAgent;
let agentSrv: Server;

async function createAdmin() {
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ($1, 'Raiz', $2, '\\x00') RETURNING id`,
    [ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  return id;
}

const adminLogin = (code: string, password = ADMIN_PASSWORD, host = ADMIN_HOST) =>
  http
    .post('/api/v1/platform/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email: ADMIN_EMAIL, password, code });

const pget = (url: string, cookie = adminCookie) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put', url: string, body: object, cookie = adminCookie) =>
  http[method](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);

async function tenantLogin(host: string, email: string, password = PASSWORD) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return { res, cookie: raw.find((c) => c.startsWith('cm_sid='))?.split(';')[0] ?? '' };
}
const tget = (host: string, cookie: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', host).set('Cookie', cookie);
const tsend = (
  host: string,
  cookie: string,
  method: 'post' | 'put' | 'patch',
  url: string,
  b: object,
) => http[method](`/api/v1${url}`).set('Host', host).set(CSRF).set('Cookie', cookie).send(b);

const plan = (code: string, extra: object = {}) => ({
  code,
  name: `Plano ${code}`,
  priceMonthly: '99.90',
  maxUsers: null,
  maxProducts: null,
  maxOrdersMonth: null,
  featureFiscal: false,
  featureWhatsapp: false,
  featureCustomDomain: false,
  trialDays: 0,
  isDefault: false,
  active: true,
  ...extra,
});

beforeAll(async () => {
  fx = await seedTwoTenants('pf');
  await createAdmin();
  agentSrv = agentServer(fakeAgent, AGENT_TOKEN);
  await new Promise<void>((r) => agentSrv.listen(0, '127.0.0.1', r));
  const agentPort = (agentSrv.address() as AddressInfo).port;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      METRICS_TOKEN,
      TRAEFIK_PROVIDER_TOKEN: TRAEFIK_TOKEN,
      HOST_AGENT_URL: `http://127.0.0.1:${agentPort}`,
      HOST_AGENT_TOKEN: AGENT_TOKEN,
    }),
    { logger: false },
  );
  await app.init();
  app.get(DomainVerifier).resolveTxt = async (name: string) => {
    const v = txt.get(name);
    if (!v) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return v.map((s) => [s.slice(0, 10), s.slice(10)]); // TXT em pedaços, como no DNS real
  };
  http = request(app.getHttpServer());
});

afterAll(async () => {
  // Não deixa plano padrão para os outros arquivos de teste (o provisionamento usaria).
  await ownerQuery(`UPDATE plans SET is_default = false WHERE is_default`);
  await app?.close();
  agentSrv?.close();
});

describe('Barreiras do painel', () => {
  it('rotas do painel não existem fora de admin.<base>', async () => {
    for (const host of [HOST_A, 'comandou.test', 'www.comandou.test', 'admin.outro.com']) {
      await http.get('/api/v1/platform/auth/me').set('Host', host).expect(404);
      await adminLogin(totpCode(SECRET, totpStep()), ADMIN_PASSWORD, host).expect(404);
    }
  });

  it('admin.<base> não resolve restaurante nenhum', async () => {
    await http.get('/api/v1/tenant').set('Host', ADMIN_HOST).expect(404);
  });

  it('sem sessão do painel: 401; cookie de restaurante não abre o painel', async () => {
    await pget('/overview', '').expect(401);
    const { cookie } = await tenantLogin(HOST_A, 'admin@pf-a.test');
    expect(cookie).toBeTruthy();
    await pget('/overview', cookie.replace('cm_sid=', 'cm_admin=')).expect(401);
    await pget('/overview', cookie).expect(401);
  });

  it('papéis do banco: a app não lê a plataforma; a plataforma não lê hash de senha', async () => {
    const appDb = new Client({ connectionString: APP_URL });
    const pfDb = new Client({ connectionString: PLATFORM_URL });
    await appDb.connect();
    await pfDb.connect();
    try {
      for (const t of ['platform_admins', 'platform_sessions', 'platform_audit_log', 'backup_runs'])
        await expect(appDb.query(`SELECT 1 FROM ${t}`)).rejects.toThrow(/permission denied/);
      await expect(pfDb.query(`SELECT password_hash FROM users`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(pfDb.query(`SELECT * FROM orders`)).rejects.toThrow(/permission denied/);
      await expect(pfDb.query(`DELETE FROM platform_audit_log`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pfDb.query(
          `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc) VALUES ('x@y.z','x','x','\\x00')`,
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
      await pfDb.end();
    }
  });
});

describe('Login do Super Admin', () => {
  it('senha certa com código errado é recusada e auditada', async () => {
    await adminLogin('000000').expect(401);
    await adminLogin(totpCode(SECRET, totpStep()), 'senha-errada-000').expect(401);
    const rows = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'platform.login_failed'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('muitas tentativas recusadas bloqueiam a conta por um tempo (429)', async () => {
    const email = 'alvo@plataforma.test';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await http
        .post('/api/v1/platform/auth/login')
        .set('Host', ADMIN_HOST)
        .set(CSRF)
        .send({ email, password: 'senha-errada-' + i, code: '123456' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('senha + código: cookie restrito ao painel; o mesmo código não serve de novo', async () => {
    const code = totpCode(SECRET, totpStep());
    const r = await adminLogin(code).expect(200);
    const raw = r.headers['set-cookie'] as unknown as string[];
    const c = raw.find((x) => x.startsWith('cm_admin='))!;
    expect(c).toMatch(/Path=\/api\/v1\/platform/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    adminCookie = c.split(';')[0];
    await adminLogin(code).expect(401); // replay
    const me = await pget('/auth/me').expect(200);
    expect(me.body.admin.email).toBe(ADMIN_EMAIL);
    // O cookie do painel não abre rotas do restaurante.
    await tget(HOST_A, adminCookie, '/auth/me').expect(401);
  });

  it('logout revoga a sessão no servidor', async () => {
    const r = await adminLogin(totpCode(SECRET, totpStep() + 1)).expect(200);
    const cookie = (r.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('cm_admin='))!
      .split(';')[0];
    await http
      .post('/api/v1/platform/auth/logout')
      .set('Host', ADMIN_HOST)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    await pget('/auth/me', cookie).expect(401);
  });
});

describe('Planos, assinaturas e limites', () => {
  let small: string;
  let full: string;

  it('cria planos (código único) e só um padrão', async () => {
    const a = await psend(
      'post',
      '/plans',
      plan('pf-pequeno', { maxProducts: 2, maxUsers: 3, maxOrdersMonth: 1 }),
    ).expect(201);
    small = a.body.id;
    expect(a.body.priceMonthly).toBe('99.90');
    const b = await psend(
      'post',
      '/plans',
      plan('pf-completo', {
        featureFiscal: true,
        featureWhatsapp: true,
        featureCustomDomain: true,
        trialDays: 14,
        isDefault: true,
      }),
    ).expect(201);
    full = b.body.id;
    await psend('post', '/plans', plan('pf-pequeno')).expect(409);
    await psend('post', '/plans', plan('pf-x', { priceMonthly: '9.999' })).expect(400);
    await psend('post', '/plans', plan('pf-y', { isDefault: true, active: false })).expect(422);
    const list = await pget('/plans').expect(200);
    expect(list.body.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1);
  });

  it('cria restaurante pelo painel com o plano padrão em teste (sem auditar a senha)', async () => {
    const r = await psend('post', '/tenants', {
      slug: 'pf-novo',
      name: 'Restaurante Novo',
      adminEmail: 'dona@pf-novo.test',
      adminName: 'Dona',
      adminPassword: 'senha-inicial-123',
    }).expect(201);
    expect(r.body.status).toBe('provisioned');
    expect(r.body.subscription).toMatchObject({ status: 'trialing', planId: full });
    expect(r.body.owners).toEqual([{ name: 'Dona', email: 'dona@pf-novo.test' }]);
    const { res } = await tenantLogin(
      'pf-novo.comandou.test',
      'dona@pf-novo.test',
      'senha-inicial-123',
    );
    expect(res.status).toBe(200);
    const audit = await ownerQuery<{ data: string }>(
      `SELECT data::text FROM platform_audit_log WHERE action = 'platform.tenant_created'`,
    );
    expect(audit.map((a) => a.data).join()).not.toContain('senha-inicial-123');
    await psend('post', '/tenants', {
      slug: 'pf-novo',
      name: 'X',
      adminEmail: 'x@x.test',
      adminName: 'X',
      adminPassword: 'senha-inicial-123',
    }).expect(409);
    await psend('post', '/tenants', {
      slug: 'admin',
      name: 'X',
      adminEmail: 'x@x.test',
      adminName: 'X',
      adminPassword: 'senha-inicial-123',
    }).expect(400);
    await psend('post', '/tenants', {
      slug: 'pf-sem-plano',
      name: 'X',
      adminEmail: 'x@x.test',
      adminName: 'X',
      adminPassword: 'senha-inicial-123',
      planCode: 'nao-existe',
    }).expect(422);
    expect(await ownerQuery(`SELECT 1 FROM tenants WHERE slug = 'pf-sem-plano'`)).toHaveLength(0);
  });

  it('aplica limites de produtos, equipe e pedidos do plano, sem apagar nada', async () => {
    await psend('put', `/tenants/${fx.tenantA}/subscription`, {
      planId: small,
      status: 'active',
    }).expect(200);
    const { cookie } = await tenantLogin(HOST_A, 'admin@pf-a.test');
    const sub = await tget(HOST_A, cookie, '/subscription').expect(200);
    expect(sub.body.current.plan.limits).toEqual({ users: 3, products: 2, orders_month: 1 });
    expect(sub.body.usage).toEqual({ users: 2, products: 1, orders_month: 0 });

    // Produtos: tinha 1; cabe mais 1.
    await tsend(HOST_A, cookie, 'post', '/products', {
      categoryId: fx.catA,
      name: 'P2',
      price: '1.00',
    }).expect(201);
    const over = await tsend(HOST_A, cookie, 'post', '/products', {
      categoryId: fx.catA,
      name: 'P3',
      price: '1.00',
    }).expect(403);
    expect(over.body.message).toMatch(/Limite do plano/);
    // Desativar libera vaga; reativar conta de novo.
    await tsend(HOST_A, cookie, 'patch', `/products/${fx.prodA}`, { active: false }).expect(200);
    await tsend(HOST_A, cookie, 'post', '/products', {
      categoryId: fx.catA,
      name: 'P3',
      price: '1.00',
    }).expect(201);
    await tsend(HOST_A, cookie, 'patch', `/products/${fx.prodA}`, { active: true }).expect(403);

    // Equipe: 2 ativos, limite 3.
    await tsend(HOST_A, cookie, 'post', '/users', {
      email: 'caixa@pf-a.test',
      name: 'Caixa',
      role: 'cashier',
      password: 'senha-caixa-123',
    }).expect(201);
    await tsend(HOST_A, cookie, 'post', '/users', {
      email: 'caixa2@pf-a.test',
      name: 'Caixa 2',
      role: 'cashier',
      password: 'senha-caixa-123',
    }).expect(403);

    // Pedidos no mês: limite 1.
    const [p] = await ownerQuery<{ id: string }>(
      `SELECT id FROM products WHERE tenant_id = $1 AND active LIMIT 1`,
      [fx.tenantA],
    );
    await tsend(HOST_A, cookie, 'post', '/orders', {
      channel: 'counter',
      items: [{ productId: p.id, quantity: 1 }],
    }).expect(201);
    await tsend(HOST_A, cookie, 'post', '/orders', {
      channel: 'counter',
      items: [{ productId: p.id, quantity: 1 }],
    }).expect(403);

    // Recursos fora do plano.
    const [o] = await ownerQuery<{ id: string }>(
      `SELECT id FROM orders WHERE tenant_id = $1 LIMIT 1`,
      [fx.tenantA],
    );
    const nf = await tsend(HOST_A, cookie, 'post', `/orders/${o.id}/nfce`, {}).expect(403);
    expect(nf.body.message).toMatch(/Nota fiscal/);
    await tsend(HOST_A, cookie, 'put', '/messaging/settings', { enabled: true }).expect(403);
    await tsend(HOST_A, cookie, 'post', '/domains', { hostname: 'pedidos.pf-a.com.br' }).expect(
      403,
    );

    // Outro restaurante (sem assinatura) não é afetado.
    const b = await tenantLogin(HOST_B, 'admin@pf-b.test');
    await tsend(HOST_B, b.cookie, 'post', '/products', {
      categoryId: fx.catB,
      name: 'B2',
      price: '1.00',
    }).expect(201);
    await tsend(HOST_B, b.cookie, 'post', '/products', {
      categoryId: fx.catB,
      name: 'B3',
      price: '1.00',
    }).expect(201);
  });

  it('garçom não vê o plano; cancelar a assinatura tira os limites', async () => {
    const w = await tenantLogin(HOST_A, 'garcom@pf-a.test');
    await tget(HOST_A, w.cookie, '/subscription').expect(403);
    await psend('put', `/tenants/${fx.tenantA}/subscription`, {
      status: 'cancelled',
      notes: 'teste',
    }).expect(200);
    const { cookie } = await tenantLogin(HOST_A, 'admin@pf-a.test');
    expect((await tget(HOST_A, cookie, '/subscription').expect(200)).body.current).toBeNull();
    await tsend(HOST_A, cookie, 'post', '/products', {
      categoryId: fx.catA,
      name: 'P4',
      price: '1.00',
    }).expect(201);
    await psend('put', `/tenants/${fx.tenantA}/subscription`, { status: 'cancelled' }).expect(404);
    const audit = await pget(`/audit?tenantId=${fx.tenantA}`).expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['platform.subscription_changed']),
    );
  });

  it('período de teste exige data ou dias de teste no plano', async () => {
    await psend('put', `/tenants/${fx.tenantB}/subscription`, {
      planId: small,
      status: 'trialing',
    }).expect(422);
    const r = await psend('put', `/tenants/${fx.tenantB}/subscription`, {
      planId: full,
      status: 'trialing',
    }).expect(200);
    expect(r.body.subscription.trialEndsAt).toBeTruthy();
  });
});

describe('Suspensão', () => {
  it('suspende (restaurante fica indisponível) e reativa, com motivo auditado', async () => {
    await psend('post', `/tenants/${fx.tenantB}/status`, {
      status: 'suspended',
      reason: 'x',
    }).expect(400);
    await psend('post', `/tenants/${fx.tenantB}/status`, {
      status: 'suspended',
      reason: 'Pagamento atrasado',
    }).expect(200);
    const { res } = await tenantLogin(HOST_B, 'admin@pf-b.test');
    expect(res.status).toBe(403);
    await psend('post', `/tenants/${fx.tenantB}/status`, {
      status: 'suspended',
      reason: 'de novo',
    }).expect(409);
    await psend('post', `/tenants/${fx.tenantB}/status`, {
      status: 'provisioned',
      reason: 'Pago',
    }).expect(200);
    expect((await tenantLogin(HOST_B, 'admin@pf-b.test')).res.status).toBe(200);
    const t = await ownerQuery<{ action: string }>(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'tenant.%' ORDER BY id`,
      [fx.tenantB],
    );
    expect(t.map((r) => r.action)).toEqual(
      expect.arrayContaining(['tenant.suspended', 'tenant.reactivated']),
    );
  });
});

describe('Domínio próprio', () => {
  let domainId = '';

  it('valida o endereço, cadastra e mostra o registro TXT', async () => {
    const { cookie } = await tenantLogin(HOST_B, 'admin@pf-b.test');
    for (const bad of [
      'pf-b.comandou.test',
      'x.comandou.test',
      '10.0.0.1',
      'localhost',
      'a..b.com',
      '-a.com',
    ])
      await tsend(HOST_B, cookie, 'post', '/domains', { hostname: bad }).expect(422);
    const r = await tsend(HOST_B, cookie, 'post', '/domains', {
      hostname: 'Pedidos.PF-B.com.br.',
    }).expect(201);
    expect(r.body).toMatchObject({
      hostname: 'pedidos.pf-b.com.br',
      verified: false,
      dns: { txtName: '_comandou.pedidos.pf-b.com.br', cnameTarget: 'pf-b.comandou.test' },
    });
    expect(r.body.dns.txtValue).toMatch(/^comandou-verify=[A-Za-z0-9_-]{32}$/);
    domainId = r.body.id;
    await tsend(HOST_B, cookie, 'post', '/domains', { hostname: 'pedidos.pf-b.com.br' }).expect(
      409,
    );

    // Sem TXT: não verifica e explica.
    const v1 = await tsend(HOST_B, cookie, 'post', `/domains/${domainId}/verify`, {}).expect(201);
    expect(v1.body.verified).toBe(false);
    expect(v1.body.lastError).toMatch(/Nenhum registro TXT/);
    await http.get('/api/v1/tenant').set('Host', 'pedidos.pf-b.com.br').expect(404);

    txt.set('_comandou.pedidos.pf-b.com.br', ['outra-coisa', r.body.dns.txtValue]);
    const v2 = await tsend(HOST_B, cookie, 'post', `/domains/${domainId}/verify`, {}).expect(201);
    expect(v2.body.verified).toBe(true);
    const t = await http.get('/api/v1/tenant').set('Host', 'pedidos.pf-b.com.br').expect(200);
    expect(t.body.slug).toBe('pf-b');
  });

  it('outro restaurante pode pedir o mesmo domínio, mas não verificá-lo', async () => {
    await psend('put', `/tenants/${fx.tenantA}/subscription`, {
      planId: (await pget('/plans')).body.find((p: { code: string }) => p.code === 'pf-completo')
        .id,
      status: 'active',
    }).expect(200);
    const { cookie } = await tenantLogin(HOST_A, 'admin@pf-a.test');
    const r = await tsend(HOST_A, cookie, 'post', '/domains', {
      hostname: 'pedidos.pf-b.com.br',
    }).expect(201);
    txt.set('_comandou.pedidos.pf-b.com.br', [r.body.dns.txtValue]);
    await tsend(HOST_A, cookie, 'post', `/domains/${r.body.id}/verify`, {}).expect(409);
    // A lista de A não vê os domínios de B.
    const list = await tget(HOST_A, cookie, '/domains').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].verified).toBe(false);
  });

  it('Traefik recebe só domínios verificados, com token', async () => {
    await http.get('/api/v1/internal/traefik').expect(404);
    await http
      .get('/api/v1/internal/traefik')
      .set('Authorization', 'Bearer errado-errado-errado-errado')
      .expect(404);
    // Traefik 2.x não envia cabeçalhos ao provider HTTP: o token também vale na URL.
    await http.get('/api/v1/internal/traefik?token=errado-errado-errado-errado').expect(404);
    await http.get(`/api/v1/internal/traefik?token=${TRAEFIK_TOKEN}`).expect(200);
    const r = await http
      .get('/api/v1/internal/traefik')
      .set('Authorization', `Bearer ${TRAEFIK_TOKEN}`)
      .expect(200);
    const routers = Object.values(r.body.http.routers) as {
      rule: string;
      service: string;
      tls: object;
    }[];
    expect(routers).toHaveLength(2);
    expect(routers.map((x) => x.rule)).toEqual([
      'Host(`pedidos.pf-b.com.br`) && PathPrefix(`/api`)',
      'Host(`pedidos.pf-b.com.br`)',
    ]);
    expect(routers[0]).toMatchObject({
      service: 'comandou-api@swarm',
      tls: { certResolver: 'letsencrypt-http' },
    });
  });

  it('remover tira o domínio do ar; o painel também remove', async () => {
    const { cookie } = await tenantLogin(HOST_B, 'admin@pf-b.test');
    await tsend(HOST_B, cookie, 'post', `/domains/${domainId}/remove`, {}).expect(201);
    await http.get('/api/v1/tenant').set('Host', 'pedidos.pf-b.com.br').expect(404);
    const r = await http
      .get('/api/v1/internal/traefik')
      .set('Authorization', `Bearer ${TRAEFIK_TOKEN}`)
      .expect(200);
    expect(Object.keys(r.body.http.routers)).toHaveLength(0);

    const a = await tenantLogin(HOST_A, 'admin@pf-a.test');
    const [d] = (await tget(HOST_A, a.cookie, '/domains').expect(200)).body;
    await psend('post', `/tenants/${fx.tenantA}/domains/${d.id}/remove`, {}).expect(200);
    expect((await tget(HOST_A, a.cookie, '/domains').expect(200)).body).toHaveLength(0);
  });
});

describe('Monitoramento e visão geral', () => {
  it('métricas Prometheus só com token, sem restaurante nos rótulos', async () => {
    await http.get('/api/v1/metrics').expect(404);
    const r = await http
      .get('/api/v1/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`)
      .expect(200);
    expect(r.text).toContain('comandou_http_request_duration_seconds');
    expect(r.text).toContain('comandou_db_pool_connections');
    expect(r.text).toContain('route="/api/v1/products"');
    expect(r.text).not.toContain('pf-a');
  });

  it('métrica do último backup bom (alertas de backup atrasado)', async () => {
    await ownerQuery(
      `INSERT INTO backup_runs (kind, status, finished_at) VALUES ('backup', 'ok', '2026-01-02T03:04:05Z')`,
    );
    const r = await http
      .get('/api/v1/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`)
      .expect(200);
    const line = (kind: string) =>
      r.text
        .split('\n')
        .find((l) =>
          l.startsWith(`comandou_backup_last_success_timestamp_seconds{kind="${kind}"}`),
        );
    expect(Number(line('backup')?.split(' ')[1])).toBeGreaterThanOrEqual(
      Date.parse('2026-01-02T03:04:05Z') / 1000,
    );
    expect(line('restore_test')).toBeDefined();
  });

  it('readiness mostra banco e Redis', async () => {
    const r = await http.get('/api/v1/health/ready').expect(200);
    expect(r.body.checks.database).toBe('ok');
    expect(['ok', 'disabled']).toContain(r.body.checks.redis);
  });

  it('visão geral, lista de restaurantes, backups e auditoria', async () => {
    await ownerQuery(
      `INSERT INTO backup_runs (kind, status, finished_at, object_key, size_bytes)
       VALUES ('backup', 'ok', now(), 'comandou/2026/10/x.dump.age', 1234)`,
    );
    const o = await pget('/overview').expect(200);
    expect(o.body.health.database).toBe('ok');
    expect(o.body.tenants.provisioned).toBeGreaterThanOrEqual(3);
    expect(o.body.backups.backup.lastOkAt).toBeTruthy();
    expect(o.body.backups.restoreTest.last).toBeNull();
    const l = await pget('/tenants?search=pf-').expect(200);
    const a = l.body.find((t: { slug: string }) => t.slug === 'pf-a');
    expect(a).toMatchObject({ planName: 'Plano pf-completo', subscriptionStatus: 'active' });
    expect(a.ordersMonth).toBe(1);
    expect((await pget('/backups').expect(200)).body[0].objectKey).toContain('.dump.age');
    const audit = (await pget('/audit').expect(200)).body as { action: string }[];
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'platform.login',
        'platform.plan_created',
        'platform.tenant_created',
      ]),
    );
  });
});

describe('Controle do restaurante e acesso de suporte', () => {
  const exchange = (host: string, token: string) =>
    http.post('/api/v1/auth/support').set('Host', host).set(CSRF).send({ token });

  it('equipe com último uso e restaurantes extras de cada pessoa', async () => {
    const team = (await pget(`/tenants/${fx.tenantA}/team`).expect(200)).body as {
      email: string;
      role: string;
      otherTenants: number;
    }[];
    expect(team.map((m) => m.email)).toEqual(
      expect.arrayContaining(['admin@pf-a.test', 'garcom@pf-a.test']),
    );
    expect(team[0]!.role).toBe('owner');
    expect(team[0]).toHaveProperty('lastSeenAt');
  });

  it('consumo e operação: números agregados de cada restaurante, sem misturar com o outro', async () => {
    const a = (await pget(`/tenants/${fx.tenantA}/insights`).expect(200)).body;
    const b = (await pget(`/tenants/${fx.tenantB}/insights`).expect(200)).body;
    expect(a.footprint.rows).toBeGreaterThan(0);
    expect(a.footprint.bytes).toBeGreaterThan(0);
    expect(a.footprint.tables.some((t: { table: string }) => t.table === 'orders')).toBe(true);
    expect(a.operation.orders.allTime).toBeGreaterThanOrEqual(1);
    expect(a.operation.byChannel[0].key).toBe('counter');
    expect(b.operation.orders.allTime).toBe(0);
    expect(b.footprint.tables.some((t: { table: string }) => t.table === 'orders')).toBe(false);
    // Nenhum dado de cliente final volta.
    expect(JSON.stringify(a)).not.toMatch(/customer|phone|address/i);

    const c = (await pget('/consumption').expect(200)).body as {
      databaseBytes: number;
      tenants: { id: string; bytes: number }[];
    };
    expect(c.databaseBytes).toBeGreaterThan(0);
    const bytes = c.tenants.map((t) => t.bytes);
    expect(bytes).toEqual([...bytes].sort((x, y) => y - x));
    // O ranking e o detalhe medem a mesma coisa (pode variar um pouco: a auditoria cresce entre as chamadas).
    expect(c.tenants.find((t) => t.id === fx.tenantA)!.bytes).toBeGreaterThanOrEqual(
      a.footprint.bytes,
    );
    await pget(`/tenants/${crypto.randomUUID()}/insights`).expect(404);
  });

  it('link de suporte: uso único, só no restaurante dele, sessão marcada e auditada', async () => {
    const r = await psend('post', `/tenants/${fx.tenantA}/access`, {}).expect(200);
    expect(r.body).toMatchObject({ slug: 'pf-a', user: { email: 'admin@pf-a.test' } });
    const token = r.body.token as string;

    // Em outro restaurante o token não vale (e não é gasto).
    await exchange(HOST_B, token).expect(401);
    const ok = await exchange(HOST_A, token).expect(200);
    const raw = (ok.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('cm_sid='),
    )!;
    const me = await tget(HOST_A, raw.split(';')[0]!, '/auth/me').expect(200);
    expect(me.body.user.email).toBe('admin@pf-a.test');
    expect(me.body.support).toEqual({ adminName: 'Raiz' });
    // Sessão de suporte dura no máximo 2 horas.
    expect(new Date(ok.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(2 * 3600_000);

    await exchange(HOST_A, token).expect(401); // uso único
    const [log] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'auth.support_login'`,
      [fx.tenantA],
    );
    expect(log!.n).toBe(1);
    const audit = (await pget(`/audit?tenantId=${fx.tenantA}`).expect(200)).body as {
      action: string;
    }[];
    expect(audit.map((x) => x.action)).toContain('platform.tenant.support_access');
  });

  it('link vencido não abre; membro escolhido precisa ser do restaurante', async () => {
    const r = await psend('post', `/tenants/${fx.tenantA}/access`, {}).expect(200);
    await ownerQuery(
      `UPDATE support_access_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`,
    );
    await exchange(HOST_A, r.body.token).expect(401);
    const [b] = await ownerQuery<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      'admin@pf-b.test',
    ]);
    await psend('post', `/tenants/${fx.tenantA}/access`, { userId: b!.id }).expect(422);
    // Sem sessão do painel, nada.
    await psend('post', `/tenants/${fx.tenantA}/access`, {}, '').expect(401);
  });

  it('encerrar sessões derruba quem está logado', async () => {
    const { cookie } = await tenantLogin(HOST_A, 'garcom@pf-a.test');
    await tget(HOST_A, cookie, '/auth/me').expect(200);
    const r = await psend('post', `/tenants/${fx.tenantA}/sessions/revoke`, {}).expect(200);
    expect(r.body.revoked).toBeGreaterThanOrEqual(1);
    await tget(HOST_A, cookie, '/auth/me').expect(401);
  });

  it('redefinir senha: a nova vale, a antiga não, sessões encerradas', async () => {
    const { cookie } = await tenantLogin(HOST_A, 'garcom@pf-a.test');
    const [w] = await ownerQuery<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      'garcom@pf-a.test',
    ]);
    await psend('post', `/tenants/${fx.tenantA}/password`, {
      userId: w!.id,
      password: 'curta',
    }).expect(400);
    await psend('post', `/tenants/${fx.tenantB}/password`, {
      userId: w!.id,
      password: 'nova-senha-123',
    }).expect(404); // não é membro do B
    await psend('post', `/tenants/${fx.tenantA}/password`, {
      userId: w!.id,
      password: 'nova-senha-123',
    }).expect(200);
    await tget(HOST_A, cookie, '/auth/me').expect(401);
    expect((await tenantLogin(HOST_A, 'garcom@pf-a.test')).res.status).toBe(401);
    expect((await tenantLogin(HOST_A, 'garcom@pf-a.test', 'nova-senha-123')).res.status).toBe(200);
    const audit = await ownerQuery<{ data: object }>(
      `SELECT data FROM platform_audit_log WHERE action = 'platform.user.password_reset'`,
    );
    expect(JSON.stringify(audit)).not.toContain('nova-senha-123');
  });

  it('renomeia o restaurante com auditoria', async () => {
    const r = await psend('put', `/tenants/${fx.tenantB}/name`, { name: 'Cantina B' }).expect(200);
    expect(r.body.name).toBe('Cantina B');
    const [log] = await ownerQuery<{ data: { to: string } }>(
      `SELECT data FROM platform_audit_log WHERE action = 'platform.tenant.renamed' ORDER BY id DESC LIMIT 1`,
    );
    expect(log!.data.to).toBe('Cantina B');
  });
});

describe('Servidor (agente)', () => {
  it('situação e espaço do Docker pelo agente; sem sessão do painel, 401', async () => {
    await pget('/server', '').expect(401);
    const r = await pget('/server').expect(200);
    expect(r.body).toMatchObject({ enabled: true, host: { hostname: 'vm-teste' } });
    expect((await pget('/server/disk').expect(200)).body.images.count).toBe(3);
  });

  it('limpeza só com alvos conhecidos, auditada', async () => {
    await psend('post', '/server/cleanup', { targets: ['volumes'] }).expect(400);
    await psend('post', '/server/cleanup', { targets: [] }).expect(400);
    const r = await psend('post', '/server/cleanup', {
      targets: ['containers', 'build-cache'],
    }).expect(200);
    expect(r.body.results).toHaveLength(2);
    expect(agentCalls).toContain('cleanup:containers,build-cache');
    const audit = (await pget('/audit').expect(200)).body as { action: string }[];
    expect(audit.map((a) => a.action)).toContain('platform.server.cleanup');
  });

  it('reinicia serviço e lê logs; nome inválido é recusado', async () => {
    await psend('post', '/server/services/comandou_api/restart', {}).expect(200);
    expect(agentCalls).toContain('restart:comandou_api');
    await psend('post', `/server/services/${encodeURIComponent('../x')}/restart`, {}).expect(400);
    const l = await pget('/server/services/comandou_api/logs?tail=50').expect(200);
    expect(l.body.text).toBe('linhas 50');
  });

  it('agente recusa token errado', async () => {
    const port = (agentSrv.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/status`, {
      headers: { Authorization: 'Bearer token-errado-0123456789abcdef' },
    });
    expect(res.status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });
});
