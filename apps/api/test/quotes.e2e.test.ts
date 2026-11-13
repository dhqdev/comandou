import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';

/** Super Admin → Orçamento: valores padrão, orçamento numerado e o PDF. */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();

let app: INestApplication;
let http: ReturnType<typeof request>;
let cookie = '';

const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put', url: string, body: object = {}) =>
  http[method](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);

beforeAll(async () => {
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('orcamento@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  // Plano padrão do teste: R$ 400 sem limites e com nota (como o plano único).
  await ownerQuery(`UPDATE plans SET is_default = false WHERE is_default`);
  await ownerQuery(
    `INSERT INTO plans (code, name, price_monthly, feature_fiscal, feature_whatsapp, trial_days, is_default)
     VALUES ('orc-unico', 'Comandou ORC', 400.00, true, true, 7, true)`,
  );
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
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'orcamento@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  cookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await ownerQuery(`UPDATE plans SET is_default = false WHERE code = 'orc-unico'`);
  await app?.close();
});

describe('Orçamento', () => {
  it('não abre sem a sessão do painel', async () => {
    await http.get('/api/v1/platform/quotes').set('Host', ADMIN_HOST).expect(401);
  });

  it('mostra o plano padrão e os custos da Focus NFe', async () => {
    const r = await pget('/quotes').expect(200);
    expect(r.body.plan).toMatchObject({ name: 'Comandou ORC', priceMonthly: '400.00' });
    expect(r.body.settings.fiscal).toEqual({
      mode: 'passthrough',
      monthly: '62.90',
      nfceIncluded: 500,
      nfeIncluded: 100,
      nfceExtra: '0.055',
      nfeExtra: '0.16',
    });
    expect(r.body.settings.extraCosts.length).toBeGreaterThan(0);
  });

  it('gera orçamento numerado, soma a nota estimada e devolve o PDF', async () => {
    const r = await psend('post', '/quotes', {
      clientName: 'Hamburgueria do Teste',
      clientDocument: '12.345.678/0001-90',
      email: 'dono@burger.test',
      nfcePerMonth: 2000,
      nfePerMonth: 0,
    }).expect(201);
    expect(r.body.number).toMatch(/^ORC-\d{4}-0001$/);
    const [row] = await ownerQuery<{ total: string; content: any }>(
      `SELECT total_monthly::text AS total, content FROM platform_quotes WHERE id = $1`,
      [r.body.id],
    );
    // 400 + 62,90 + 1.500 × 0,055 (82,50) = 545,40
    expect(row!.total).toBe('545.40');
    expect(row!.content.client.document).toBe('12345678000190');
    expect(row!.content.fiscal.clause).toContain('Focus NFe');

    const pdf = await pget(`/quotes/${r.body.id}/pdf?download=1`)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('orcamento-ORC-');
    const doc = await PDFDocument.load(pdf.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain('Hamburgueria do Teste');

    const list = await pget('/quotes').expect(200);
    expect(list.body.quotes[0]).toMatchObject({ number: r.body.number, totalMonthly: '545.40' });
  });

  it('sem nota fiscal, o total é só a mensalidade', async () => {
    const r = await psend('post', '/quotes', {
      clientName: 'Lanchonete Sem Nota',
      fiscal: false,
      nfcePerMonth: 3000,
    }).expect(201);
    expect(r.body.number).toMatch(/-0002$/);
    const [row] = await ownerQuery<{ total: string }>(
      `SELECT total_monthly::text AS total FROM platform_quotes WHERE id = $1`,
      [r.body.id],
    );
    expect(row!.total).toBe('400.00');
  });

  it('salva os valores padrão (e o contrato passa a usar)', async () => {
    const body = {
      fiscal: {
        mode: 'included',
        monthly: '0.00',
        nfceIncluded: 1000,
        nfeIncluded: 50,
        nfceExtra: '0.06',
        nfeExtra: '0.2',
      },
      setupFee: '150.00',
      validityDays: 10,
      extraCosts: [{ label: 'Certificado A1', value: 'R$ 200 por ano' }],
      notes: 'Condição de lançamento',
    };
    const r = await psend('put', '/quotes/settings', body).expect(200);
    expect(r.body.settings).toMatchObject({
      fiscal: { mode: 'included', nfceIncluded: 1000, nfceExtra: '0.06', nfeExtra: '0.20' },
      setupFee: '150.00',
      validityDays: 10,
      notes: 'Condição de lançamento',
    });
    await psend('put', '/quotes/settings', { ...body, validityDays: 0 }).expect(400);
    await psend('put', '/quotes/settings', {
      ...body,
      fiscal: { ...body.fiscal, nfceExtra: '0,055' },
    }).expect(400);
    const [audit] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log WHERE action = 'platform.quote_settings_saved'`,
    );
    expect(audit!.n).toBe(1);
    // Volta ao padrão para não afetar outras suítes.
    await ownerQuery(`DELETE FROM platform_quote_settings`);
    await ownerQuery(`INSERT INTO platform_quote_settings (id) VALUES (true)`);
  });

  it('o papel da plataforma não apaga orçamentos', async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: PLATFORM_URL });
    await c.connect();
    try {
      await expect(c.query('DELETE FROM platform_quotes')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});
