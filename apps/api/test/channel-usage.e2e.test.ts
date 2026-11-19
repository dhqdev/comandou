import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { ChannelMetrics } from '../src/integrations/channels/channel-metrics';
import { ChannelUsageService } from '../src/integrations/channels/channel-usage.service';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { APP_URL, PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';

/**
 * Super Admin › Aplicativos (ADR 0015, Fase 9): a contagem por hora vai para channel_usage, o
 * painel lê contra as regras de uso indevido do iFood e a equipe marca o roteiro de homologação.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const EMAIL = 'aplicativos@plataforma.test';

let app: INestApplication;
let http: ReturnType<typeof request>;
let cookie = '';
let metrics: ChannelMetrics;
let usage: ChannelUsageService;

const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const pput = (url: string, body: object) =>
  http
    .put(`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);

async function asRole(url: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await ownerQuery(`DELETE FROM channel_usage`);
  await ownerQuery(`DELETE FROM platform_channel_homologation`);
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ($1, 'Equipe Apps', $2, '\\x00') RETURNING id`,
    [EMAIL, await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
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
  metrics = app.get(ChannelMetrics);
  usage = app.get(ChannelUsageService);
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({ email: EMAIL, password: 'senha-super-admin-123', code: totpCode(SECRET, totpStep()) })
    .expect(200);
  cookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

describe('Uso dos aplicativos (Super Admin)', () => {
  it('não abre sem a sessão do painel nem fora de admin.<base>', async () => {
    await http.get('/api/v1/platform/channels/usage').set('Host', ADMIN_HOST).expect(401);
    await http
      .get('/api/v1/platform/channels/usage')
      .set('Host', 'qualquer.comandou.test')
      .set('Cookie', cookie)
      .expect(404);
  });

  it('a contagem vai para o banco somada por hora e o painel lê contra as regras', async () => {
    metrics.record('ifood', 'request', 'events:polling|2xx', 99);
    metrics.record('ifood', 'request', 'events:polling|5xx', 1);
    metrics.record('ifood', 'request', 'orders:details|2xx', 3);
    metrics.record('ifood', 'request', 'merchant:status|401', 2);
    metrics.record('ifood', 'poll', 'with_events', 20);
    metrics.record('ifood', 'poll', 'empty', 79);
    metrics.record('ifood', 'poll', 'error', 1);
    metrics.record('ifood', 'poll_acked', 'all', 20);
    metrics.record('ifood', 'event', 'saved', 30);
    metrics.record('ifood', 'ack', 'ok', 30);
    metrics.record('ifood', 'order_lookup', '1', 3);
    await usage.flush();
    // Uma segunda rodada (outra réplica, ou o minuto seguinte) soma na mesma hora.
    metrics.record('ifood', 'poll_acked', 'partial', 1);
    metrics.record('ifood', 'order_lookup', 'Blocked', 1);
    await usage.flush();
    const rows = await ownerQuery<{ metric: string; label: string; count: string }>(
      `SELECT metric, label, count::text FROM channel_usage WHERE channel = 'ifood' ORDER BY 1, 2`,
    );
    expect(rows).toContainEqual({ metric: 'order_lookup', label: 'blocked', count: '1' });
    expect(new Set(rows.map((r) => `${r.metric}/${r.label}`)).size).toBe(rows.length);

    const r = await pget('/channels/usage?hours=24').expect(200);
    const ifood = r.body.channels.find((c: { channel: string }) => c.channel === 'ifood');
    expect(ifood.report).toMatchObject({
      polls: 99,
      pollsWithEvents: 20,
      pollErrorPct: 1,
      pollTone: 'warn',
      ordersLooked: 3,
      ordersBlocked: 1,
      lookupTone: 'bad',
      clientErrors: 2,
      tone: 'bad',
    });
    expect(ifood.report.ackPct).toBeCloseTo(95.24, 2);
    expect(ifood.report.ackTone).toBe('warn');
    expect(Array.isArray(ifood.live)).toBe(true);
    // Período inválido.
    await pget('/channels/usage?hours=0').expect(400);
    await pget('/channels/usage?hours=9999').expect(400);
  });

  it('o que passou do período fica de fora; só a API grava e só pela função', async () => {
    const old = new Date(Date.now() - 3 * 3600_000);
    old.setUTCMinutes(0, 0, 0);
    await ownerQuery(
      `INSERT INTO channel_usage (channel, hour, metric, label, count)
       VALUES ('ifood', $1, 'request', 'events:polling|5xx', 500)`,
      [old],
    );
    const r1 = await pget('/channels/usage?hours=1').expect(200);
    const r4 = await pget('/channels/usage?hours=4').expect(200);
    const err = (b: { channels: { channel: string; report: { pollErrorPct: number } }[] }) =>
      b.channels.find((c) => c.channel === 'ifood')!.report.pollErrorPct;
    expect(err(r1.body)).toBe(1);
    expect(err(r4.body)).toBeGreaterThan(80);

    // A API não lê nem escreve a tabela direto; a função recusa rótulo fora do padrão.
    await expect(asRole(APP_URL, 'SELECT * FROM channel_usage')).rejects.toThrow(/permission/);
    await expect(
      asRole(
        APP_URL,
        `INSERT INTO channel_usage VALUES ('ifood', date_trunc('hour', now()), 'poll', 'x', 1)`,
      ),
    ).rejects.toThrow(/permission/);
    await expect(
      asRole(APP_URL, 'SELECT app_channel_usage_add($1::jsonb)', [
        JSON.stringify([
          {
            channel: 'ifood',
            hour: new Date().toISOString(),
            metric: 'poll',
            label: 'Loja X',
            count: 1,
          },
        ]),
      ]),
    ).rejects.toThrow(/channel_usage_label_check|violates check/);
    await expect(
      asRole(APP_URL, 'SELECT app_channel_usage_add($1::jsonb)', [
        JSON.stringify([
          {
            channel: 'ifood',
            hour: new Date().toISOString(),
            metric: 'cliente',
            label: 'x',
            count: 1,
          },
        ]),
      ]),
    ).rejects.toThrow(/check/);
    // O painel lê, mas não escreve.
    await expect(
      asRole(PLATFORM_URL, `DELETE FROM channel_usage WHERE channel = 'ifood'`),
    ).rejects.toThrow(/permission/);
  });

  it('banco fora do ar: a contagem volta para a memória e vai na próxima vez', async () => {
    metrics.record('ifood', 'poll', 'empty', 5);
    const before = await ownerQuery<{ n: string }>(
      `SELECT coalesce(sum(count), 0)::text AS n FROM channel_usage WHERE metric = 'poll' AND label = 'empty'`,
    );
    await ownerQuery(`REVOKE EXECUTE ON FUNCTION app_channel_usage_add(jsonb) FROM comandou_app`);
    try {
      await usage.flush();
    } finally {
      await ownerQuery(`GRANT EXECUTE ON FUNCTION app_channel_usage_add(jsonb) TO comandou_app`);
    }
    await usage.flush();
    const after = await ownerQuery<{ n: string }>(
      `SELECT coalesce(sum(count), 0)::text AS n FROM channel_usage WHERE metric = 'poll' AND label = 'empty'`,
    );
    expect(Number(after[0]!.n) - Number(before[0]!.n)).toBe(5);
  });
});

describe('Homologação dos aplicativos (Super Admin)', () => {
  it('mostra o roteiro do iFood com os passos a fazer', async () => {
    const r = await pget('/channels/homologation').expect(200);
    const ifood = r.body.find((c: { channel: string }) => c.channel === 'ifood');
    expect(ifood.steps.length).toBeGreaterThanOrEqual(8);
    expect(ifood.steps[0]).toMatchObject({ id: 'account', doneAt: null, how: expect.any(Array) });
  });

  it('marca, guarda a observação, desmarca e fica no registro do painel', async () => {
    let r = await pput('/channels/homologation/ifood/test_orders', {
      done: true,
      note: '  pedido 4810 conferido  ',
    }).expect(200);
    let step = r.body[0].steps.find((s: { id: string }) => s.id === 'test_orders');
    expect(step).toMatchObject({ note: 'pedido 4810 conferido', doneBy: 'Equipe Apps' });
    const doneAt = step.doneAt;
    expect(doneAt).toEqual(expect.any(String));

    // Mudar só a observação não troca a data de quando foi feito.
    r = await pput('/channels/homologation/ifood/test_orders', { done: true, note: 'outra' });
    step = r.body[0].steps.find((s: { id: string }) => s.id === 'test_orders');
    expect(step).toMatchObject({ note: 'outra', doneAt });

    r = await pput('/channels/homologation/ifood/test_orders', { done: false }).expect(200);
    step = r.body[0].steps.find((s: { id: string }) => s.id === 'test_orders');
    expect(step).toMatchObject({ doneAt: null, doneBy: null, note: null });

    const audit = await ownerQuery<{ data: { step: string; done: boolean } }>(
      `SELECT data FROM platform_audit_log WHERE action = 'platform.channel_homologation'
        ORDER BY created_at`,
    );
    expect(audit.map((a) => a.data.done)).toEqual([true, true, false]);
    expect(audit[0]!.data.step).toBe('test_orders');
  });

  it('passo ou aplicativo que não existe, corpo inválido e sem CSRF são recusados', async () => {
    await pput('/channels/homologation/ifood/nao_existe', { done: true }).expect(404);
    await pput('/channels/homologation/rappi/account', { done: true }).expect(400);
    await pput('/channels/homologation/ifood/account', { done: 'sim' }).expect(400);
    await pput('/channels/homologation/ifood/account', {
      done: true,
      note: 'x'.repeat(501),
    }).expect(400);
    await http
      .put('/api/v1/platform/channels/homologation/ifood/account')
      .set('Host', ADMIN_HOST)
      .set('Cookie', cookie)
      .send({ done: true })
      .expect(403);
  });
});
