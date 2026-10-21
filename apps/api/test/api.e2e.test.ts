import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

const HOST_A = 'api-a.pedemais.test';
const HOST_B = 'api-b.pedemais.test';
const CSRF = { 'X-PedeMais-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;

async function login(host: string, email: string, password = PASSWORD) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('pm_sid='))?.split(';')[0];
  return { res, cookie: cookie ?? '', raw: raw ?? [] };
}

beforeAll(async () => {
  fx = await seedTwoTenants('api');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app?.close();
});

describe('Health', () => {
  it('responde sem tenant', async () => {
    await http
      .get('/api/v1/health/live')
      .set('Host', 'qualquer.coisa')
      .expect(200, { status: 'ok' });
    const r = await http.get('/api/v1/health/ready').expect(200);
    expect(r.body.checks.database).toBe('ok');
  });
});

describe('Resolução de tenant pelo Host', () => {
  it('host de restaurante inexistente → 404', async () => {
    await http.get('/api/v1/tenant').set('Host', 'naoexiste.pedemais.test').expect(404);
  });
  it('host da plataforma → 404 nas rotas de restaurante', async () => {
    await http.get('/api/v1/tenant').set('Host', 'pedemais.test').expect(404);
  });
  it('host malformado ou subdomínio aninhado → 400', async () => {
    await http.get('/api/v1/tenant').set('Host', 'x.api-a.pedemais.test').expect(400);
    await http.get('/api/v1/tenant').set('Host', 'api.pedemais.test').expect(400);
  });
  it('domínio personalizado desconhecido → 404', async () => {
    await http.get('/api/v1/tenant').set('Host', 'evil.example.com').expect(404);
  });
  it('X-Forwarded-Host é ignorado quando TRUST_PROXY=false', async () => {
    const r = await http
      .get('/api/v1/tenant')
      .set('Host', HOST_A)
      .set('X-Forwarded-Host', HOST_B)
      .expect(200);
    expect(r.body.slug).toBe('api-a');
  });
  it('retorna nome público do restaurante', async () => {
    const r = await http.get('/api/v1/tenant').set('Host', HOST_A).expect(200);
    expect(r.body).toEqual({ slug: 'api-a', name: 'Restaurante A api' });
  });
});

describe('Autenticação', () => {
  it('senha errada → 401 e auditoria', async () => {
    const { res } = await login(HOST_A, 'admin@api-a.test', 'errada-errada');
    expect(res.status).toBe(401);
    const rows = await ownerQuery(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'auth.login_failed'`,
      [fx.tenantA],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('usuário de B não faz login pelo host de A', async () => {
    const { res } = await login(HOST_A, 'admin@api-b.test');
    expect(res.status).toBe(401);
  });

  it('login válido define cookie HttpOnly, SameSite=Lax, host-only', async () => {
    const { res, raw } = await login(HOST_A, 'admin@api-a.test');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('owner');
    const c = raw.find((x) => x.startsWith('pm_sid='))!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).not.toMatch(/Domain=/i);
    // Token nunca é guardado em claro.
    const token = c.split(';')[0].slice('pm_sid='.length);
    const rows = await ownerQuery(
      `SELECT 1 FROM sessions WHERE token_hash = convert_to($1, 'UTF8')`,
      [token],
    );
    expect(rows).toEqual([]);
  });

  it('sem sessão → 401', async () => {
    await http.get('/api/v1/auth/me').set('Host', HOST_A).expect(401);
  });

  it('sessão de A é rejeitada no host de B', async () => {
    const { cookie } = await login(HOST_A, 'admin@api-a.test');
    await http.get('/api/v1/auth/me').set('Host', HOST_A).set('Cookie', cookie).expect(200);
    await http.get('/api/v1/auth/me').set('Host', HOST_B).set('Cookie', cookie).expect(401);
  });

  it('logout revoga a sessão no servidor', async () => {
    const { cookie } = await login(HOST_A, 'admin@api-a.test');
    await http
      .post('/api/v1/auth/logout')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookie)
      .expect(204);
    await http.get('/api/v1/auth/me').set('Host', HOST_A).set('Cookie', cookie).expect(401);
  });
});

describe('Cardápio — isolamento e autorização via API', () => {
  let cookieA: string;
  let cookieWaiter: string;

  beforeAll(async () => {
    cookieA = (await login(HOST_A, 'admin@api-a.test')).cookie;
    cookieWaiter = (await login(HOST_A, 'garcom@api-a.test')).cookie;
  });

  it('lista apenas produtos do próprio restaurante', async () => {
    const r = await http
      .get('/api/v1/products')
      .set('Host', HOST_A)
      .set('Cookie', cookieA)
      .expect(200);
    const ids = (r.body as { id: string; tenantId: string }[]).map((p) => p.id);
    expect(ids).toContain(fx.prodA);
    expect(ids).not.toContain(fx.prodB);
    expect((r.body as { tenantId: string }[]).every((p) => p.tenantId === fx.tenantA)).toBe(true);
  });

  it('trocar o ID na URL para um produto de B → 404', async () => {
    await http
      .get(`/api/v1/products/${fx.prodB}`)
      .set('Host', HOST_A)
      .set('Cookie', cookieA)
      .expect(404);
    await http
      .patch(`/api/v1/products/${fx.prodB}`)
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookieA)
      .send({ price: '0.01' })
      .expect(404);
    const [b] = await ownerQuery<{ price: string }>('SELECT price FROM products WHERE id = $1', [
      fx.prodB,
    ]);
    expect(b.price).toBe('45.00');
  });

  it('criar produto em categoria de B → 404', async () => {
    await http
      .post('/api/v1/products')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookieA)
      .send({ categoryId: fx.catB, name: 'Invasor', price: '1.00' })
      .expect(404);
  });

  it('tenant_id enviado pelo cliente é ignorado', async () => {
    const r = await http
      .post('/api/v1/products')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookieA)
      .send({
        categoryId: fx.catA,
        name: 'Suco',
        price: '8.50',
        tenantId: fx.tenantB,
        tenant_id: fx.tenantB,
      })
      .expect(201);
    expect(r.body.tenantId).toBe(fx.tenantA);
    expect(r.body.price).toBe('8.50');
  });

  it('valida preço monetário (sem float, sem negativo)', async () => {
    for (const price of ['1.999', '-1.00', 'abc', 12.5]) {
      await http
        .post('/api/v1/products')
        .set('Host', HOST_A)
        .set(CSRF)
        .set('Cookie', cookieA)
        .send({ categoryId: fx.catA, name: 'X', price })
        .expect(400);
    }
  });

  it('garçom lê o cardápio mas não altera (403)', async () => {
    await http.get('/api/v1/products').set('Host', HOST_A).set('Cookie', cookieWaiter).expect(200);
    await http
      .post('/api/v1/categories')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookieWaiter)
      .send({ name: 'Nova' })
      .expect(403);
  });

  it('escrita sem cabeçalho anti-CSRF ou de outra origem → 403', async () => {
    await http
      .post('/api/v1/categories')
      .set('Host', HOST_A)
      .set('Cookie', cookieA)
      .send({ name: 'Sem header' })
      .expect(403);
    await http
      .post('/api/v1/categories')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Origin', `http://${HOST_B}`)
      .set('Cookie', cookieA)
      .send({ name: 'Cross origin' })
      .expect(403);
  });

  it('escritas geram auditoria no tenant correto', async () => {
    await http
      .post('/api/v1/categories')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', cookieA)
      .send({ name: 'Bebidas' })
      .expect(201);
    const rows = await ownerQuery<{ tenant_id: string }>(
      `SELECT tenant_id FROM audit_log WHERE action = 'catalog.category_created'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === fx.tenantA)).toBe(true);
  });
});

describe('Status do tenant', () => {
  it('restaurante suspenso não aceita requisições', async () => {
    const { cookie } = await login(HOST_B, 'admin@api-b.test');
    await ownerQuery(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [fx.tenantB]);
    await http.get('/api/v1/auth/me').set('Host', HOST_B).set('Cookie', cookie).expect(403);
    await ownerQuery(`UPDATE tenants SET status = 'provisioned' WHERE id = $1`, [fx.tenantB]);
    await http.get('/api/v1/auth/me').set('Host', HOST_B).set('Cookie', cookie).expect(200);
  });
});

describe('Rate limiting', () => {
  it('bloqueia tentativas excessivas de login (429)', async () => {
    const limited = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '3' }), { logger: false });
    await limited.init();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await request(limited.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Host', HOST_B)
          .set(CSRF)
          .send({ email: 'admin@api-b.test', password: 'errada-' + i });
        statuses.push(r.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});
