import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Etapa 5: NFC-e pela Focus NFe, com um servidor falso no lugar da Focus (homologação).
 * Cobre configuração (token cifrado, nunca devolvido), emissão pela fila, consulta de nota
 * "em processamento", referência já usada, falha temporária, rejeição, cancelamento e
 * isolamento entre restaurantes. Com TEST_REDIS_URL, a fila roda de verdade no BullMQ.
 */
const HOST_A = 'fi-a.pedemais.test';
const HOST_B = 'fi-b.pedemais.test';
const CSRF = { 'X-PedeMais-Request': '1' };
const TOKEN = 'tok-homolog-abc-1234';

type Mode = 'authorize' | 'processing' | 'reject' | 'fail-once' | 'ref-used' | 'down';
let mode: Mode = 'authorize';
let cancelMode: 'ok' | 'refuse' = 'ok';
const notes = new Map<string, Record<string, unknown>>();
const calls: { method: string; url: string; auth?: string; body?: Record<string, unknown> }[] = [];
let failed = new Set<string>();

function focusHandler(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    const send = (code: number, b: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    const expected = `Basic ${Buffer.from(`${TOKEN}:`).toString('base64')}`;
    if (req.headers.authorization !== expected) return send(401, { codigo: 'nao_autorizado' });
    const url = new URL(req.url!, 'http://x');
    const authorized = (ref: string) => ({
      status: 'autorizado',
      status_sefaz: '100',
      mensagem_sefaz: 'Autorizado o uso da NF-e',
      chave_nfe: `NFe${'3'.repeat(44)}`,
      numero: String(notes.size + 1),
      serie: '1',
      caminho_xml_nota_fiscal: `/arquivos/${ref}.xml`,
      caminho_danfe: `/notas_fiscais_consumidor/${ref}.html`,
      qrcode_url: 'https://sefaz.example/qr',
    });
    if (req.method === 'POST' && url.pathname === '/v2/nfce') {
      const ref = url.searchParams.get('ref')!;
      if (mode === 'down') return send(503, {});
      if (mode === 'fail-once' && !failed.has(ref)) {
        failed.add(ref);
        return send(500, {});
      }
      if (mode === 'ref-used' || notes.has(ref)) {
        notes.set(ref, notes.get(ref) ?? authorized(ref));
        return send(422, { codigo: 'already_processed', mensagem: 'Nota já processada' });
      }
      if (mode === 'reject') {
        const r = {
          status: 'erro_autorizacao',
          status_sefaz: '778',
          mensagem_sefaz: 'NCM inexistente',
        };
        notes.set(ref, r);
        return send(201, r);
      }
      if (mode === 'processing') {
        notes.set(ref, { status: 'processando_autorizacao', pending: true });
        return send(202, { status: 'processando_autorizacao' });
      }
      const r = authorized(ref);
      notes.set(ref, r);
      return send(201, r);
    }
    const m = /^\/v2\/nfce\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const ref = decodeURIComponent(m[1]);
      const n = notes.get(ref);
      if (!n)
        return send(404, { codigo: 'nao_encontrado', mensagem: 'Nota fiscal não encontrada' });
      if (req.method === 'GET') {
        if (n.pending) {
          const r = authorized(ref);
          notes.set(ref, r);
          return send(200, { status: 'processando_autorizacao' });
        }
        return send(200, n);
      }
      if (req.method === 'DELETE') {
        if (cancelMode === 'refuse')
          return send(200, {
            status: 'erro_cancelamento',
            status_sefaz: '501',
            mensagem_sefaz: 'Prazo de cancelamento superior ao previsto',
          });
        const r = {
          ...n,
          status: 'cancelado',
          status_sefaz: '135',
          mensagem_sefaz: 'Evento registrado',
        };
        notes.set(ref, r);
        return send(200, r);
      }
    }
    send(404, {});
  });
}

let app: INestApplication;
let focus: Server;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};
let keySeq = 0;
const key = () => `fi-key-${Date.now()}-${++keySeq}`;
let sessionId = '';

const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const post = (w: string, url: string, body: object = {}, idem?: string) => {
  const r = http
    .post(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const put = (w: string, url: string, body: object) =>
  http
    .put(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const patch = (w: string, url: string, body: object) =>
  http
    .patch(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('pm_sid='))!.split(';')[0];
}

async function addUser(tenantId: string, email: string, role: string) {
  const [u] = await ownerQuery<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, `${role} ${email.split('@')[0]}`, await hashPassword(PASSWORD)],
  );
  await ownerQuery(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)`, [
    tenantId,
    u.id,
    role,
  ]);
}

/** Pedido de balcão pago (por padrão em dinheiro + pix). */
async function paidOrder(body: Record<string, unknown> = {}, pays?: [string, string][]) {
  const o = (
    await post('adminA', '/orders', {
      channel: 'counter',
      items: [{ productId: fx.prodA, quantity: 2 }],
      ...body,
    }).expect(201)
  ).body as { id: string; total: string };
  const plan = pays ?? [
    ['cash', '10.00'],
    ['pix', (Number(o.total) * 100 - 1000).toString()],
  ];
  for (const [method, amt] of plan) {
    const amount = amt.includes('.') ? amt : (Number(amt) / 100).toFixed(2);
    await post(
      'adminA',
      `/orders/${o.id}/payments`,
      { cashSessionId: sessionId, method, amount },
      key(),
    ).expect(201);
  }
  return o;
}

/** Espera a nota sair do estado indicado (a fila trabalha em segundo plano). */
async function waitDoc(id: string, until: (s: string) => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const d = (await get('adminA', `/fiscal/documents/${id}`).expect(200)).body;
    if (until(d.status)) return d;
    if (Date.now() > end) throw new Error(`nota parada em ${d.status}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

beforeAll(async () => {
  focus = createServer(focusHandler);
  await new Promise<void>((r) => focus.listen(0, '127.0.0.1', r));
  const focusUrl = `http://127.0.0.1:${(focus.address() as AddressInfo).port}`;
  fx = await seedTwoTenants('fi');
  await addUser(fx.tenantA, 'caixa@fi-a.test', 'cashier');
  await addUser(fx.tenantA, 'gerente@fi-a.test', 'manager');
  const redis = process.env.TEST_REDIS_URL;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      INTEGRATIONS_KEY: randomBytes(32).toString('base64'),
      FOCUS_NFE_URL_HOMOLOGACAO: focusUrl,
      FOCUS_NFE_URL_PRODUCAO: focusUrl,
      ...(redis ? { REDIS_URL: redis, QUEUE_PREFIX: `t${Date.now()}` } : {}),
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@fi-a.test');
  cookies.adminB = await login(HOST_B, 'admin@fi-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@fi-a.test');
  cookies.cashierA = await login(HOST_A, 'caixa@fi-a.test');
  cookies.managerA = await login(HOST_A, 'gerente@fi-a.test');
  const reg = (await post('adminA', '/cash-registers', { name: 'Caixa NF' }).expect(201)).body;
  sessionId = (
    await post('adminA', '/cash/sessions', { registerId: reg.id, openingAmount: '0.00' }).expect(
      201,
    )
  ).body.id;
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => focus?.close(r));
});

describe('Configuração fiscal', () => {
  it('permissões: garçom e caixa não configuram; gerente sim', async () => {
    await get('waiterA', '/fiscal/settings').expect(403);
    await get('cashierA', '/fiscal/settings').expect(403);
    const s = (await get('managerA', '/fiscal/settings').expect(200)).body;
    expect(s).toMatchObject({
      enabled: false,
      environment: 'homologacao',
      hasToken: false,
      keyConfigured: true,
    });
  });

  it('não ativa sem CNPJ e token; guarda o token cifrado e nunca o devolve', async () => {
    await put('adminA', '/fiscal/settings', { enabled: true }).expect(422);
    await put('adminA', '/fiscal/settings', { cnpj: '123' }).expect(400);
    const s = (
      await put('adminA', '/fiscal/settings', {
        enabled: true,
        cnpj: '12.345.678/0001-95',
        token: TOKEN,
      }).expect(200)
    ).body;
    expect(s).toMatchObject({
      enabled: true,
      cnpj: '12345678000195',
      hasToken: true,
      tokenLast4: '1234',
    });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    const [row] = await ownerQuery<{ token_enc: Buffer }>(
      `SELECT token_enc FROM tenant_fiscal_settings WHERE tenant_id = $1`,
      [fx.tenantA],
    );
    expect(row.token_enc.toString('latin1')).not.toContain(TOKEN);
    // Nem a auditoria guarda o token.
    const audit = await ownerQuery<{ data: unknown }>(
      `SELECT data FROM audit_log WHERE tenant_id = $1 AND action = 'fiscal.settings_updated'`,
      [fx.tenantA],
    );
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    // B não vê a configuração de A.
    expect((await get('adminB', '/fiscal/settings').expect(200)).body.hasToken).toBe(false);
  });

  it('produção exige o dono e confirmação explícita', async () => {
    await put('managerA', '/fiscal/settings', {
      environment: 'producao',
      confirmProduction: true,
    }).expect(403);
    await put('adminA', '/fiscal/settings', { environment: 'producao' }).expect(422);
    expect((await get('adminA', '/fiscal/settings').expect(200)).body.environment).toBe(
      'homologacao',
    );
  });

  it('produto recebe dados fiscais validados', async () => {
    await patch('adminA', `/products/${fx.prodA}`, { ncm: '123' }).expect(400);
    const p = (
      await patch('adminA', `/products/${fx.prodA}`, {
        ncm: '21069090',
        fiscalCode: '102',
        fiscalOrigin: 0,
      }).expect(200)
    ).body;
    expect(p).toMatchObject({ ncm: '21069090', fiscalCode: '102', fiscalOrigin: 0, cfop: null });
  });
});

describe('Emissão de NFC-e', () => {
  it('não emite pedido sem pagamento completo; garçom não emite', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post('waiterA', `/orders/${o.id}/nfce`).expect(403);
    await post('adminA', `/orders/${o.id}/nfce`).expect(422);
  });

  it('autoriza pela fila, com desconto e taxa rateados e pagamentos agrupados', async () => {
    mode = 'authorize';
    // 2 x 25.90 = 51.80 ; desconto 1.80 ; taxa 5.00 => 55.00
    const o = await paidOrder({ discount: '1.80', surcharge: '5.00' }, [
      ['cash', '10.00'],
      ['pix', '20.00'],
      ['pix', '25.00'],
    ]);
    expect(o.total).toBe('55.00');
    const d = (await post('cashierA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(['pending', 'processing', 'authorized']).toContain(d.status);
    // Repetir devolve a mesma nota.
    expect((await post('cashierA', `/orders/${o.id}/nfce`).expect(202)).body.id).toBe(d.id);
    const done = await waitDoc(d.id, (s) => s === 'authorized');
    expect(done).toMatchObject({ number: expect.any(String), series: '1', total: '55.00' });
    expect(done.danfeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/notas_fiscais_consumidor\/pm-/);
    const sent = calls.find((c) => c.method === 'POST' && c.url.includes(`ref=pm-${d.id}`))!;
    const body = sent.body as {
      cnpj_emitente: string;
      data_emissao: string;
      items: Record<string, string>[];
      formas_pagamento: Record<string, string>[];
    };
    expect(body.cnpj_emitente).toBe('12345678000195');
    expect(Math.abs(Date.parse(body.data_emissao) - Date.now())).toBeLessThan(60_000);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      codigo_ncm: '21069090',
      cfop: '5102',
      quantidade_comercial: '2.000',
      valor_unitario_comercial: '25.90',
      valor_bruto: '51.80',
      valor_desconto: '1.80',
      valor_outras_despesas: '5.00',
      icms_situacao_tributaria: '102',
    });
    expect(body.formas_pagamento).toEqual([
      { forma_pagamento: '01', valor_pagamento: '10.00' },
      { forma_pagamento: '17', valor_pagamento: '45.00' },
    ]);
  });

  it('pedido com nota viva não é cancelado nem estornado', async () => {
    const [doc] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    await post('adminA', `/orders/${doc.orderId}/status`, {
      to: 'cancelled',
      reason: 'teste',
    }).expect(409);
    const order = (await get('adminA', `/orders/${doc.orderId}`).expect(200)).body;
    const pay = order.payments[0];
    await post(
      'adminA',
      `/payments/${pay.id}/refunds`,
      { cashSessionId: sessionId, amount: '1.00', reason: 'teste' },
      key(),
    ).expect(409);
  });

  it('isolamento: outro restaurante não vê nem cancela a nota', async () => {
    const [doc] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    await get('adminB', `/fiscal/documents/${doc.id}`).expect(404);
    expect((await get('adminB', '/fiscal/documents').expect(200)).body).toEqual([]);
    await post('adminB', `/fiscal/documents/${doc.id}/cancel`, {
      reason: 'cancelamento de teste B',
    }).expect(404);
    await post('adminB', `/orders/${doc.orderId}/nfce`).expect(404);
  });

  it('a aplicação não altera o conteúdo enviado nem apaga notas', async () => {
    const [doc] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    const { Client } = await import('pg');
    const c = new Client({ connectionString: testEnv().DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(`UPDATE fiscal_documents SET total = 1 WHERE id = $1`, [doc.id]),
      ).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(c.query(`DELETE FROM fiscal_documents WHERE id = $1`, [doc.id])).rejects.toThrow(
        /permission denied/,
      );
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('nota "em processamento" é consultada até ser autorizada', async () => {
    mode = 'processing';
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    const done = await waitDoc(d.id, (s) => s === 'authorized');
    expect(done.accessKey).toMatch(/^NFe/);
    expect(
      calls.filter((c) => c.method === 'GET' && c.url.endsWith(`pm-${d.id}`)).length,
    ).toBeGreaterThan(0);
  });

  it('falha temporária da Focus é tentada de novo com a mesma referência', async () => {
    mode = 'fail-once';
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    const done = await waitDoc(d.id, (s) => s === 'authorized');
    expect(done.attempts).toBe(2);
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes(`ref=pm-${d.id}`));
    expect(posts).toHaveLength(2);
  });

  it('referência já usada na Focus é reconciliada pela consulta (sem nota duplicada)', async () => {
    mode = 'ref-used';
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    const done = await waitDoc(d.id, (s) => s !== 'pending' && s !== 'processing');
    expect(done.status).toBe('authorized');
  });

  it('rejeição da SEFAZ fica registrada e permite emitir de novo', async () => {
    mode = 'reject';
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    const done = await waitDoc(d.id, (s) => s === 'rejected');
    expect(done).toMatchObject({ sefazStatus: '778', sefazMessage: 'NCM inexistente' });
    // Rejeitada não bloqueia o pedido: dá para emitir outra (nova referência).
    mode = 'authorize';
    const again = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(again.id).not.toBe(d.id);
    await waitDoc(again.id, (s) => s === 'authorized');
  });

  it('NCM ausente é recusado antes de enviar, listando o produto', async () => {
    await patch('adminA', `/products/${fx.prodA}`, { ncm: null }).expect(200);
    const o = await paidOrder();
    const r = await post('adminA', `/orders/${o.id}/nfce`).expect(422);
    expect(r.body.message).toContain('X-Burguer A');
    await put('adminA', '/fiscal/settings', { defaultNcm: '21069090' }).expect(200);
    mode = 'authorize';
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    await waitDoc(d.id, (s) => s === 'authorized');
  });
});

describe('Cancelamento de NFC-e', () => {
  it('exige justificativa de 15+ caracteres; recusa da SEFAZ mantém autorizada', async () => {
    const [doc] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    await post('adminA', `/fiscal/documents/${doc.id}/cancel`, { reason: 'curto' }).expect(400);
    cancelMode = 'refuse';
    const r = await post('adminA', `/fiscal/documents/${doc.id}/cancel`, {
      reason: 'Cliente desistiu da compra',
    }).expect(422);
    expect(r.body.message).toContain('Prazo de cancelamento');
    const after = (await get('adminA', `/fiscal/documents/${doc.id}`).expect(200)).body;
    expect(after.status).toBe('authorized');
    expect(after.lastError).toContain('Prazo de cancelamento');
  });

  it('cancela e libera o cancelamento do pedido', async () => {
    cancelMode = 'ok';
    const [doc] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    const c = (
      await post('cashierA', `/fiscal/documents/${doc.id}/cancel`, {
        reason: 'Cliente desistiu da compra',
      }).expect(200)
    ).body;
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Cliente desistiu da compra' });
    await post('adminA', `/fiscal/documents/${doc.id}/cancel`, {
      reason: 'Cliente desistiu da compra',
    }).expect(409);
    // Sem nota viva, o estorno volta a ser possível.
    const order = (await get('adminA', `/orders/${doc.orderId}`).expect(200)).body;
    await post(
      'adminA',
      `/payments/${order.payments[0].id}/refunds`,
      { cashSessionId: sessionId, amount: '1.00', reason: 'teste' },
      key(),
    ).expect(201);
  });
});

describe('Fila', () => {
  it('Focus fora do ar: a nota fica pendente/processando e não vira erro às cegas', async () => {
    mode = 'down';
    await put('adminA', '/fiscal/settings', { defaultNcm: '21069090' }).expect(200);
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    await new Promise((r) => setTimeout(r, 2500));
    const cur = (await get('adminA', `/fiscal/documents/${d.id}`).expect(200)).body;
    expect(['pending', 'processing']).toContain(cur.status);
    // Volta ao ar: sincronizar manualmente conclui.
    mode = 'authorize';
    await post('adminA', `/fiscal/documents/${d.id}/sync`).expect(202);
    await waitDoc(d.id, (s) => s === 'authorized', 18_000);
  });
});
