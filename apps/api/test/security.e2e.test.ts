import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { RedisThrottlerStorage } from '../src/common/redis-throttler.storage';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 7: bloqueio por conta, limite de requisições compartilhado entre réplicas (Redis) e
 * limpeza de dados vencidos.
 */
const HOST_A = 'sec-a.comandou.test';
const HOST_B = 'sec-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const REDIS = process.env.TEST_REDIS_URL;

let fx: Fixture;
let app: INestApplication;

const login = (a: INestApplication, host: string, email: string, password: string) =>
  request(a.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });

beforeAll(async () => {
  fx = await seedTwoTenants('sec');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      AUTH_ACCOUNT_LOCK_THRESHOLD: '3',
      AUTH_ACCOUNT_LOCK_MINUTES: '15',
    }),
    { logger: false },
  );
  await app.init();
});
afterAll(async () => {
  await app?.close();
});

describe('Bloqueio temporário por conta', () => {
  it('3 senhas erradas bloqueiam a conta, até com a senha certa; outras contas seguem normais', async () => {
    const email = 'admin@sec-a.test';
    for (let i = 0; i < 3; i++)
      expect((await login(app, HOST_A, email, `errada-${i}`)).status).toBe(401);
    const locked = await login(app, HOST_A, email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/Muitas tentativas/);
    expect(locked.headers['set-cookie']).toBeUndefined();

    // Outra conta do mesmo restaurante e a mesma pessoa em outro restaurante não são afetadas.
    expect((await login(app, HOST_A, 'garcom@sec-a.test', PASSWORD)).status).toBe(200);
    expect((await login(app, HOST_B, 'admin@sec-b.test', PASSWORD)).status).toBe(200);
  });

  it('e-mail que não existe também bloqueia (não revela quais contas existem)', async () => {
    const email = 'ninguem@sec-a.test';
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await login(app, HOST_A, email, 'x-' + i)).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('o bloqueio passa quando as falhas saem da janela', async () => {
    await ownerQuery(
      `UPDATE audit_log SET created_at = now() - interval '16 minutes'
        WHERE tenant_id = $1 AND action = 'auth.login_failed' AND data->>'email' = 'admin@sec-a.test'`,
      [fx.tenantA],
    );
    expect((await login(app, HOST_A, 'admin@sec-a.test', PASSWORD)).status).toBe(200);
  });
});

describe('Limite de requisições', () => {
  it('sem Redis acessível, o limite continua valendo (contador em memória)', async () => {
    const s = new RedisThrottlerStorage('redis://127.0.0.1:1', 'x:');
    try {
      const r = [];
      for (let i = 0; i < 4; i++) r.push(await s.increment('k', 60_000, 3, 60_000, 'default'));
      expect(r.map((x) => x.isBlocked)).toEqual([false, false, false, true]);
    } finally {
      await s.close();
    }
  });

  it.skipIf(!REDIS)('vale para as réplicas juntas (Redis compartilhado)', async () => {
    const prefix = `sec${Date.now().toString(36)}`;
    const env = testEnv({ AUTH_LOGIN_RATE_LIMIT: '3', REDIS_URL: REDIS!, QUEUE_PREFIX: prefix });
    const r1 = await createApp(env, { logger: false });
    const r2 = await createApp(env, { logger: false });
    await r1.init();
    await r2.init();
    try {
      // Espera as duas réplicas conectarem no Redis.
      await new Promise((ok) => setTimeout(ok, 300));
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const replica = i % 2 === 0 ? r1 : r2;
        statuses.push((await login(replica, HOST_B, 'garcom@sec-b.test', 'errada-' + i)).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await r1.close();
      await r2.close();
    }
  });
});

describe('Limpeza de dados vencidos', () => {
  it('apaga só sessões antigas e chaves de idempotência vencidas; não toca no financeiro', async () => {
    const [user] = await ownerQuery<{ id: string }>(
      `SELECT id FROM users WHERE email = 'admin@sec-b.test'`,
    );
    const hash = (s: string) => createHash('sha256').update(s).digest();
    const ins = (token: string, expires: string, revoked: string | null) =>
      ownerQuery(
        `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at, revoked_at)
         VALUES ($1, $2, $3, now() + $4::interval, now() + $5::interval)`,
        [fx.tenantB, user.id, hash(token), expires, revoked],
      );
    await ins('sec-old-expired', '-100 days', null);
    await ins('sec-old-revoked', '1 day', '-91 days');
    await ins('sec-recent-expired', '-10 days', null);
    await ownerQuery(
      `INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, created_at)
       VALUES ($1, 'sec', 'sec-key-old-1', 'h', now() - interval '31 days'),
              ($1, 'sec', 'sec-key-new-1', 'h', now() - interval '29 days')`,
      [fx.tenantB],
    );
    const payments = async () =>
      Number((await ownerQuery<{ n: string }>(`SELECT count(*) AS n FROM payments`))[0].n);
    const before = await payments();

    const r = await app.get(MaintenanceService).purge();
    expect(r.sessions).toBeGreaterThanOrEqual(2);
    expect(r.idempotencyKeys).toBeGreaterThanOrEqual(1);

    const left = await ownerQuery<{ token_hash: Buffer }>(
      `SELECT token_hash FROM sessions WHERE token_hash = ANY($1)`,
      [[hash('sec-old-expired'), hash('sec-old-revoked'), hash('sec-recent-expired')]],
    );
    expect(left.map((x) => x.token_hash.toString('hex'))).toEqual([
      hash('sec-recent-expired').toString('hex'),
    ]);
    const keys = await ownerQuery<{ key: string }>(
      `SELECT key FROM idempotency_keys WHERE tenant_id = $1 AND scope = 'sec' ORDER BY key`,
      [fx.tenantB],
    );
    expect(keys.map((k) => k.key)).toEqual(['sec-key-new-1']);
    expect(await payments()).toBe(before);
  });

  it('a API não apaga direto: só pela função de limpeza', async () => {
    const { Client } = await import('pg');
    const { APP_URL } = await import('./env');
    const c = new Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await expect(c.query('DELETE FROM idempotency_keys')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});
