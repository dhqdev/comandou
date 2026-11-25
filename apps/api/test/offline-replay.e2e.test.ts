import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Fila offline do app: a gravação reenviada com a mesma `X-Comandou-Op` não se repete
 * (common/op-replay.interceptor.ts).
 */
const HOST_A = 'replay-a.comandou.test';
const HOST_B = 'replay-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
}

const post = (path: string, body: object, op?: string, host = HOST_A) => {
  const r = http.post(`/api/v1${path}`).set('Host', host).set('Cookie', cookies[host]!).set(CSRF);
  if (op) r.set('X-Comandou-Op', op);
  return r.send(body);
};

const categories = async (host = HOST_A) =>
  (await http.get('/api/v1/categories').set('Host', host).set('Cookie', cookies[host]!).expect(200))
    .body as { id: string; name: string }[];

beforeAll(async () => {
  await seedTwoTenants('replay');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  cookies[HOST_A] = await login(HOST_A, 'admin@replay-a.test');
  cookies[HOST_B] = await login(HOST_B, 'admin@replay-b.test');
});

afterAll(async () => {
  await app?.close();
});

describe('reenvio da fila offline', () => {
  it('a mesma chave devolve a mesma resposta sem gravar de novo', async () => {
    const op = `op-${Date.now()}-a`;
    const first = await post('/categories', { name: 'Offline 1' }, op).expect(201);
    const again = await post('/categories', { name: 'Offline 1' }, op);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await categories()).filter((c) => c.name === 'Offline 1')).toHaveLength(1);
  });

  it('a mesma chave com outro conteúdo é recusada', async () => {
    const op = `op-${Date.now()}-b`;
    await post('/categories', { name: 'Offline 2' }, op).expect(201);
    await post('/categories', { name: 'Outro nome' }, op).expect(422);
    expect((await categories()).some((c) => c.name === 'Outro nome')).toBe(false);
  });

  it('sem a chave, cada envio grava', async () => {
    await post('/categories', { name: 'Offline 3' }).expect(201);
    await post('/categories', { name: 'Offline 3' }).expect(201);
    expect((await categories()).filter((c) => c.name === 'Offline 3')).toHaveLength(2);
  });

  it('envio recusado não guarda a chave: o reenvio corrigido grava', async () => {
    const op = `op-${Date.now()}-c`;
    const bad = await post('/categories', { name: '' }, op);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    await post('/categories', { name: 'Offline 6' }, op).expect(201);
  });

  it('a chave de um restaurante não vale no outro', async () => {
    const op = `op-${Date.now()}-d`;
    const a = await post('/categories', { name: 'Offline 4' }, op).expect(201);
    const b = await post('/categories', { name: 'Offline 4' }, op, HOST_B).expect(201);
    expect(b.body.id).not.toBe(a.body.id);
    expect((await categories(HOST_B)).some((c) => c.id === a.body.id)).toBe(false);
  });

  it('dois reenvios ao mesmo tempo gravam uma vez só', async () => {
    const op = `op-${Date.now()}-e`;
    const res = await Promise.all(
      Array.from({ length: 4 }, () => post('/categories', { name: 'Offline 7' }, op)),
    );
    // Quem chegou com o primeiro ainda gravando recebe 429 (a fila tenta de novo depois).
    for (const r of res) expect([201, 429]).toContain(r.status);
    expect((await categories()).filter((c) => c.name === 'Offline 7')).toHaveLength(1);
    const again = await post('/categories', { name: 'Offline 7' }, op).expect(201);
    expect(again.body.id).toBe(res.find((r) => r.status === 201)!.body.id);
  });

  it('chave inválida é recusada', async () => {
    await post('/categories', { name: 'Offline 5' }, 'x').expect(422);
  });
});
