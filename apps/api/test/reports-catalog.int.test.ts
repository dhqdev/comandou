import { PDFDocument } from 'pdf-lib';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { REPORT_IDS, type ReportDoc } from '@comandou/shared';
import { writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeTenantRows } from '../src/backup/tenant-copy';
import { createApp } from '../src/bootstrap';
import { ensureDemoRestaurant } from '../src/demo/demo';
import { OWNER_URL, testEnv } from './env';
import { ownerQuery } from './fixtures';

/**
 * Relatórios do catálogo (aba Relatórios) sobre o restaurante de demonstração, que tem meses de
 * pedidos, caixas, entregas, cancelamentos e clientes: todos montam e viram planilha válida.
 */
const slug = 'relatorios-demo';
const HOST = `${slug}.comandou.test`;
const CSRF = { 'X-Comandou-Request': '1' };
let app: INestApplication;
let http: ReturnType<typeof request>;
let owner: string;
let waiter: string;

const localDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  });

async function login(email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email, password: 'comandou123' });
  expect(res.status).toBe(200);
  return (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
}
const get = (cookie: string, url: string) =>
  http.get(`/api/v1${url}`).set('Host', HOST).set('Cookie', cookie);

/** Lê os arquivos de um .xlsx (zip) sem dependências. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    i += 30 + nameLen + extra + size;
  }
  return out;
}

beforeAll(async () => {
  await ensureDemoRestaurant({
    ownerUrl: OWNER_URL,
    slug,
    emailDomain: 'relatorios.comandou.test',
    databaseMode: 'shared',
    mode: 'on',
    log: () => undefined,
  });
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  owner = await login('dono@relatorios.comandou.test');
  waiter = await login('garcom@relatorios.comandou.test');
}, 120_000);

afterAll(async () => {
  await app?.close();
  const [t] = await ownerQuery<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  if (!t) return;
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  await purgeTenantRows(c, t.id, true);
  await c.end();
});

describe('Relatórios do catálogo', () => {
  const qs = `from=${localDate(-29)}&to=${localDate(0)}`;

  it('valida acesso, período e relatório', async () => {
    await get(waiter, `/reports/catalog/resultado?${qs}`).expect(403);
    await get(owner, `/reports/catalog/nao-existe?${qs}`).expect(404);
    await get(owner, `/reports/catalog/resultado?from=${localDate(0)}&to=${localDate(-3)}`).expect(
      400,
    );
    await get(owner, `/reports/catalog/resultado?from=2020-01-01&to=2026-01-01`).expect(400);
  });

  it.each(REPORT_IDS)('%s: indicadores, gráficos e tabelas', async (id) => {
    const doc = (await get(owner, `/reports/catalog/${id}?${qs}`).expect(200)).body as ReportDoc;
    expect(doc).toMatchObject({ id, from: localDate(-29), to: localDate(0) });
    expect(doc.kpis.length).toBeGreaterThan(0);
    expect(doc.tables.length).toBeGreaterThan(0);
    for (const t of doc.tables)
      for (const r of t.rows)
        for (const c of t.columns)
          if (c.fmt !== 'text' && r[c.key] !== null && r[c.key] !== undefined)
            expect(
              Number.isFinite(Number(r[c.key])) || /^\d{4}-\d{2}-\d{2}/.test(String(r[c.key])),
            ).toBe(true);
    // A demonstração tem movimento em todos os relatórios.
    expect(doc.tables.some((t) => t.rows.length > 0)).toBe(true);

    const res = await get(owner, `/reports/catalog/${id}/xlsx?${qs}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    const files = unzip(res.body as Buffer);
    expect(files.has('xl/workbook.xml')).toBe(true);
    const sheets = [...files.keys()].filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
    expect(sheets.length).toBe(1 + doc.tables.length);
    expect(files.get('xl/worksheets/sheet1.xml')).toContain(doc.title.replace(/&/g, '&amp;'));
    if (process.env.REPORTS_XLSX_DIR)
      writeFileSync(`${process.env.REPORTS_XLSX_DIR}/${id}.xlsx`, res.body as Buffer);

    // O mesmo relatório em PDF: arquivo válido, com nome e pelo menos uma página.
    const pdf = await get(owner, `/reports/catalog/${id}/pdf?${qs}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('.pdf');
    const body = pdf.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(body)).getPageCount()).toBeGreaterThan(0);
  });

  it('resultado confere com os pedidos do banco', async () => {
    const doc = (await get(owner, `/reports/catalog/resultado?${qs}`).expect(200))
      .body as ReportDoc;
    const [t] = await ownerQuery<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    const [db] = await ownerQuery<{ v: string }>(
      `SELECT COALESCE(sum(total), 0)::text AS v FROM orders
        WHERE tenant_id = $1 AND status NOT IN ('cancelled','awaiting')
          AND created_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
      [t!.id, localDate(-29), localDate(0)],
    );
    expect(doc.kpis[0]).toMatchObject({ label: 'Vendido', value: Number(db!.v) });
  });
  it('garçons: pontuação e desafios batem com os pedidos de cada garçom', async () => {
    const doc = (await get(owner, `/reports/catalog/garcons?${qs}`).expect(200)).body as ReportDoc;
    const [t] = await ownerQuery<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    const db = await ownerQuery<{ name: string; total: number; period: number }>(
      `SELECT u.name, count(o.id)::int AS total,
              count(o.id) FILTER (WHERE o.created_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                AND o.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))::int AS period
         FROM memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN orders o ON o.created_by = u.id AND o.status <> 'cancelled' AND o.tenant_id = $1
        WHERE m.tenant_id = $1 AND m.role = 'waiter' GROUP BY u.name`,
      [t!.id, localDate(-29), localDate(0)],
    );
    const table = doc.tables.find((x) => x.id === 'pontuacao')!;
    expect(table.rows.length).toBe(db.length);
    for (const w of db) {
      const row = table.rows.find((r) => r.name === w.name)!;
      expect(row).toMatchObject({ total: w.total, orders: w.period });
    }
    expect(doc.tables.map((x) => x.id)).toEqual(['pontuacao', 'desafios', 'hoje']);
    expect(Number(doc.kpis[0]!.value)).toBeGreaterThan(0);
  });
});
