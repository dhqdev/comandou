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
const HOST_A = 'fi-a.comandou.test';
const HOST_B = 'fi-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const TOKEN = 'tok-homolog-abc-1234';
// Modo revenda: token master do Comandou e os tokens que a Focus devolve para a empresa de B.
const MASTER = 'master-comandou-0001';
const B_HOM = 'tok-b-homolog-9876';
const B_PROD = 'tok-b-prod-5432';
const CERT = Buffer.from('pfx-falso-de-teste').toString('base64');
const companies = new Map<string, Record<string, unknown>>();

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
    const basic = (t: string) => `Basic ${Buffer.from(`${t}:`).toString('base64')}`;
    const url = new URL(req.url!, 'http://x');
    if (url.pathname.startsWith('/v2/empresas') || url.pathname.startsWith('/v2/cnpjs/')) {
      if (req.headers.authorization !== basic(MASTER)) return send(401, {});
      if (req.method === 'GET') {
        if (url.pathname.endsWith('/00000000000000'))
          return send(404, { codigo: 'nao_encontrado' });
        return send(200, {
          razao_social: 'RESTAURANTE B LTDA',
          optante_simples_nacional: true,
          optante_mei: false,
          endereco: {
            tipo_logradouro: 'Rua',
            logradouro: 'das Flores',
            numero: '10',
            bairro: 'Centro',
            nome_municipio: 'Curitiba',
            uf: 'PR',
            cep: '80000000',
          },
        });
      }
      if (body?.senha_certificado === 'errada')
        return send(422, { codigo: 'erro_validacao', mensagem: 'Certificado ou senha inválidos' });
      const m = /^\/v2\/empresas(?:\/(\d+))?$/.exec(url.pathname)!;
      const id = m[1] ?? String(companies.size + 101);
      if (m[1] && !companies.has(id)) return send(404, {});
      companies.set(id, { ...(companies.get(id) ?? {}), ...body });
      return send(200, {
        id: Number(id),
        token_homologacao: B_HOM,
        token_producao: B_PROD,
        certificado_valido_ate: '2027-05-01T10:00:00-03:00',
      });
    }
    if (![TOKEN, B_HOM, B_PROD].some((t) => req.headers.authorization === basic(t)))
      return send(401, { codigo: 'nao_autorizado' });
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
    // Inutilização, CC-e, e-mail e notas recebidas (antes das rotas por referência).
    const inut = /^\/v2\/(nfce|nfe)\/inutilizacao$/.exec(url.pathname);
    if (inut && req.method === 'POST') {
      if (body?.numero_inicial === '999')
        return send(200, {
          status: 'erro_autorizacao',
          status_sefaz: 241,
          mensagem_sefaz: 'Rejeição: Um número da faixa já foi utilizado',
        });
      return send(200, {
        status: 'autorizado',
        status_sefaz: 102,
        mensagem_sefaz: 'Inutilizacao de numero homologado',
        protocolo_sefaz: 135210002233889,
        caminho_xml: `/arquivos/inut-${body?.numero_inicial}.xml`,
      });
    }
    const cce = /^\/v2\/nfe\/([^/]+)\/carta_correcao$/.exec(url.pathname);
    if (cce && req.method === 'POST')
      return send(200, {
        status: 'autorizado',
        status_sefaz: '135',
        mensagem_sefaz: 'Evento registrado e vinculado a NF-e',
        numero_carta_correcao: 1,
        caminho_xml_carta_correcao: `/arquivos/${cce[1]}-cce.xml`,
        caminho_pdf_carta_correcao: `/arquivos/${cce[1]}-cce.pdf`,
      });
    if (/^\/v2\/(nfce|nfe)\/[^/]+\/email$/.test(url.pathname)) return send(200, {});
    if (url.pathname === '/v2/nfes_recebidas' && req.method === 'GET') {
      const v = Number(url.searchParams.get('versao') ?? 0);
      const rows =
        v === 0
          ? [
              {
                nome_emitente: 'Distribuidora de Bebidas Ltda',
                documento_emitente: '11222333000181',
                chave_nfe: '41171179060190000182550010000002661875685069',
                valor_total: '845.30',
                data_emissao: '2026-10-20T10:00:00-03:00',
                situacao: 'autorizada',
                manifestacao_destinatario: null,
                nfe_completa: false,
                tipo_nfe: '1',
                versao: 4,
              },
              {
                nome_emitente: 'Hortifruti Bom Preço',
                documento_emitente: '22333444000190',
                chave_nfe: '41171179060190000182550010000002671875685060',
                valor_total: '120.00',
                data_emissao: '2026-10-21T08:00:00-03:00',
                situacao: 'cancelada',
                manifestacao_destinatario: 'ciencia',
                nfe_completa: true,
                tipo_nfe: '1',
                versao: 5,
                data_cancelamento: '2026-10-21T09:00:00-03:00',
                justificativa_cancelamento: 'Erro no pedido',
              },
            ]
          : [];
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Max-Version': String(rows.length ? 5 : v),
        'X-Total-Count': String(rows.length),
      });
      return res.end(JSON.stringify(rows));
    }
    const man = /^\/v2\/nfes_recebidas\/([0-9]{44})\/manifesto$/.exec(url.pathname);
    if (man && req.method === 'POST')
      return send(200, {
        status: 'evento_registrado',
        status_sefaz: '135',
        mensagem_sefaz: 'Evento registrado',
      });
    const rfile = /^\/v2\/nfes_recebidas\/([0-9]{44})\.(xml|pdf)$/.exec(url.pathname);
    if (rfile) {
      res.writeHead(200, {
        'Content-Type': rfile[2] === 'pdf' ? 'application/pdf' : 'application/xml',
      });
      return res.end(rfile[2] === 'pdf' ? '%PDF-1.4 falso' : '<nfe/>');
    }
    const emitM = /^\/v2\/(nfce|nfe)$/.exec(url.pathname);
    if (req.method === 'POST' && emitM) {
      const ref = url.searchParams.get('ref')!;
      if (mode === 'down') return send(503, {});
      if (mode === 'fail-once' && !failed.has(ref)) {
        failed.add(ref);
        return send(500, {});
      }
      // A Focus aceita reenviar a mesma referência de uma nota recusada (corrigida).
      if (notes.get(ref)?.status === 'erro_autorizacao') notes.delete(ref);
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
    const m = /^\/v2\/(?:nfce|nfe)\/([^/]+)$/.exec(url.pathname);
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
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
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
      FOCUS_NFE_MASTER_TOKEN: MASTER,
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
      { forma_pagamento: '17', valor_pagamento: '45.00', tipo_integracao: '2' },
    ]);
  });

  it('CPF informado no pagamento entra na NFC-e; cartão leva o grupo do cartão e "outros" a descrição', async () => {
    mode = 'authorize';
    const o = (
      await post('adminA', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 2 }],
      }).expect(201)
    ).body as { id: string; total: string };
    // CPF com dígito errado é recusado antes de cobrar.
    await post(
      'adminA',
      `/orders/${o.id}/payments`,
      {
        cashSessionId: sessionId,
        method: 'credit',
        amount: '10.00',
        taxDocument: '529.982.247-24',
      },
      key(),
    ).expect(400);
    await post(
      'adminA',
      `/orders/${o.id}/payments`,
      {
        cashSessionId: sessionId,
        method: 'credit',
        amount: '10.00',
        taxDocument: '529.982.247-25',
      },
      key(),
    ).expect(201);
    await post(
      'adminA',
      `/orders/${o.id}/payments`,
      { cashSessionId: sessionId, method: 'other', amount: (Number(o.total) - 10).toFixed(2) },
      key(),
    ).expect(201);
    expect((await get('adminA', `/orders/${o.id}`).expect(200)).body.taxDocument).toBe(
      '52998224725',
    );
    const d = (await post('cashierA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(d.recipient).toMatchObject({ cpf: '52998224725' });
    await waitDoc(d.id, (s) => s === 'authorized');
    const sent = calls.find((c) => c.method === 'POST' && c.url.includes(`ref=pm-${d.id}`))!;
    const body = sent.body as Record<string, unknown> & {
      formas_pagamento: Record<string, string>[];
    };
    expect(body.cpf_destinatario).toBe('52998224725');
    expect(body.formas_pagamento).toEqual([
      { forma_pagamento: '03', valor_pagamento: '10.00', tipo_integracao: '2' },
      {
        forma_pagamento: '99',
        valor_pagamento: (Number(o.total) - 10).toFixed(2),
        descricao_pagamento: 'Outros',
      },
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
      ).rejects.toThrow(/permission denied|já enviada não pode ser alterada/);
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
    // A recusa vem explicada em palavras simples.
    expect(done.issues[0]).toMatchObject({ title: 'NCM inexistente', code: '778' });
    // Reemitir corrige e reenvia a MESMA nota, com a mesma referência (a Focus reaproveita o número).
    mode = 'authorize';
    const again = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(again.id).toBe(d.id);
    const ok = await waitDoc(again.id, (s) => s === 'authorized');
    expect(ok.attempts).toBe(2);
    expect(ok.issues).toEqual([]);
  });

  it('NCM ausente é recusado antes de enviar, listando o produto', async () => {
    await patch('adminA', `/products/${fx.prodA}`, { ncm: null }).expect(200);
    const o = await paidOrder();
    const sentBefore = calls.length;
    // A nota fica com erro explicado, sem gastar chamada na SEFAZ.
    const r = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(r.status).toBe('error');
    expect(r.issues[0].title).toBe('Item sem NCM');
    expect(r.issues[0].detail).toContain('X-Burguer A');
    expect(calls.length).toBe(sentBefore);
    await put('adminA', '/fiscal/settings', { defaultNcm: '21069090' }).expect(200);
    mode = 'authorize';
    const d = (await post('adminA', `/fiscal/documents/${r.id}/reissue`).expect(202)).body;
    expect(d.id).toBe(r.id);
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

describe('Modo revenda (token master do Comandou)', () => {
  const company = {
    nome: 'Restaurante B Ltda',
    inscricaoEstadual: '123.456.789',
    regimeTributario: 1,
    logradouro: 'Rua das Flores',
    numero: '10',
    bairro: 'Centro',
    municipio: 'Curitiba',
    uf: 'pr',
    cep: '80000-000',
    email: '',
  };

  it('busca os dados do CNPJ para preencher o cadastro', async () => {
    await get('waiterA', '/fiscal/cnpj/12345678000195').expect(403);
    const r = (await get('adminB', '/fiscal/cnpj/98765432000110').expect(200)).body;
    expect(r).toMatchObject({
      nome: 'RESTAURANTE B LTDA',
      logradouro: 'Rua das Flores',
      municipio: 'Curitiba',
      uf: 'PR',
      regimeTributario: 1,
    });
    await get('adminB', '/fiscal/cnpj/00000000000000').expect(404);
  });

  it('cadastra a empresa na Focus e guarda só os tokens, cifrados', async () => {
    const s0 = (await get('adminB', '/fiscal/settings').expect(200)).body;
    expect(s0).toMatchObject({ managedAvailable: true, mode: 'own', focusRegistered: false });
    // Primeiro cadastro exige o certificado; senha errada volta a mensagem da Focus.
    await put('adminB', '/fiscal/company', { cnpj: '98765432000110', company }).expect(422);
    const bad = await put('adminB', '/fiscal/company', {
      cnpj: '98765432000110',
      company,
      certificate: { base64: CERT, password: 'errada' },
    }).expect(422);
    expect(bad.body.message).toContain('Certificado ou senha inválidos');

    const s = (
      await put('adminB', '/fiscal/company', {
        cnpj: '98.765.432/0001-10',
        company,
        certificate: { base64: CERT, password: 'senha-do-pfx' },
        csc: { homologacao: { id: '1', csc: 'ABCDEF0123456789ABCDEF' } },
      }).expect(200)
    ).body;
    expect(s).toMatchObject({
      mode: 'managed',
      cnpj: '98765432000110',
      focusRegistered: true,
      hasHomologToken: true,
      hasProdToken: true,
      cscHomolog: true,
      cscProd: false,
      company: { uf: 'PR', cep: '80000000', inscricaoEstadual: '123456789' },
    });
    expect(new Date(s.certificateValidUntil).getUTCFullYear()).toBe(2027);
    const sent = companies.get('101')!;
    expect(sent).toMatchObject({
      cnpj: '98765432000110',
      habilita_nfce: true,
      arquivo_certificado_base64: CERT,
      id_token_nfce_homologacao: '1',
    });
    // Nem o banco nem a auditoria guardam certificado, senha, CSC ou tokens em claro.
    const [row] = await ownerQuery<Record<string, unknown>>(
      `SELECT * FROM tenant_fiscal_settings WHERE tenant_id = $1`,
      [fx.tenantB],
    );
    const audit = await ownerQuery(`SELECT data FROM audit_log WHERE tenant_id = $1`, [fx.tenantB]);
    const dump =
      JSON.stringify(row, (_k, v) =>
        v?.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v,
      ) + JSON.stringify(audit);
    for (const secret of [CERT, 'senha-do-pfx', 'ABCDEF0123456789ABCDEF', B_HOM, B_PROD])
      expect(dump).not.toContain(secret);
    // A não enxerga o cadastro de B.
    expect((await get('adminA', '/fiscal/settings').expect(200)).body.focusRegistered).toBe(false);
  });

  it('atualiza a mesma empresa sem reenviar o certificado', async () => {
    await put('adminB', '/fiscal/company', {
      cnpj: '98765432000110',
      company: { ...company, numero: '20' },
    }).expect(200);
    expect(companies.size).toBe(1);
    expect(companies.get('101')).toMatchObject({ numero: '20' });
  });

  it('ativa em homologação e emite com o token da empresa; produção exige CSC de produção', async () => {
    await put('adminB', '/fiscal/settings', { enabled: true, defaultNcm: '21069090' }).expect(200);
    await put('adminB', '/fiscal/settings', {
      environment: 'producao',
      confirmProduction: true,
    }).expect(422);

    const reg = (await post('adminB', '/cash-registers', { name: 'Caixa B' }).expect(201)).body;
    const sess = (
      await post('adminB', '/cash/sessions', { registerId: reg.id, openingAmount: '0.00' }).expect(
        201,
      )
    ).body.id;
    const o = (
      await post('adminB', '/orders', {
        channel: 'counter',
        items: [{ productId: fx.prodB, quantity: 1 }],
      }).expect(201)
    ).body;
    await post(
      'adminB',
      `/orders/${o.id}/payments`,
      { cashSessionId: sess, method: 'pix', amount: o.total },
      key(),
    ).expect(201);
    mode = 'authorize';
    calls.length = 0;
    const d = (await post('adminB', `/orders/${o.id}/nfce`).expect(202)).body;
    const end = Date.now() + 15_000;
    let cur = d;
    while (cur.status !== 'authorized' && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
      cur = (await get('adminB', `/fiscal/documents/${d.id}`).expect(200)).body;
    }
    expect(cur.status).toBe('authorized');
    const emit = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v2/nfce'))!;
    expect(emit.auth).toBe(`Basic ${Buffer.from(`${B_HOM}:`).toString('base64')}`);
    expect(emit.body).toMatchObject({ cnpj_emitente: '98765432000110' });
  });
});

describe('Módulo fiscal completo (padrões, NF-e, inutilização, recebidas)', () => {
  const VALID_CPF = '52998224725';
  let ruleId = '';

  it('padrões fiscais: valida, cria e lista os itens sem padrão', async () => {
    mode = 'authorize';
    await post('cashierA', '/fiscal/rules', { name: 'X', cfop: '5101', icmsCst: '102' }).expect(
      403,
    );
    await post('adminA', '/fiscal/rules', { name: 'X', cfop: '51', icmsCst: '102' }).expect(400);
    const r = (
      await post('adminA', '/fiscal/rules', {
        name: 'Comida feita na casa',
        cfop: '5101',
        icmsCst: '102',
        approxTaxRate: '13,45',
        ibsCbsCst: '000',
        ibsCbsClass: '000001',
        cbsRate: '0.9',
        ibsUfRate: '0.1',
      }).expect(201)
    ).body;
    expect(r).toMatchObject({
      code: 'PF-000001',
      cfop: '5101',
      approxTaxRate: '13.45',
      isDefault: false,
    });
    ruleId = r.id;
    const list = (await get('adminA', '/fiscal/rules').expect(200)).body;
    expect(list.rules).toHaveLength(1);
    // Sem padrão da empresa, o produto sem padrão e sem NCM ligado aparece como pendente.
    expect(list.uncovered.map((p: { id: string }) => p.id)).toContain(fx.prodA);
    // B não vê os padrões de A.
    expect((await get('adminB', '/fiscal/rules').expect(200)).body.rules).toEqual([]);
  });

  it('item sem padrão fiscal vira erro explicado; ligar o NCM resolve e a reemissão usa o padrão', async () => {
    await patch('adminA', `/products/${fx.prodA}`, { ncm: '21069090' }).expect(200);
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(d.status).toBe('error');
    expect(d.issues.map((i: { title: string }) => i.title)).toContain(
      'Item sem regra de tributação',
    );
    await put('adminA', '/fiscal/ncm-rules/2106.90.90', { ruleId }).expect(200);
    await post('adminA', `/fiscal/documents/${d.id}/reissue`).expect(202);
    await waitDoc(d.id, (s) => s === 'authorized');
    const sent = calls
      .filter((c) => c.method === 'POST' && c.url.includes(`ref=pm-${d.id}`))
      .at(-1)!;
    const item = (sent.body as { items: Record<string, string>[] }).items[0];
    expect(item).toMatchObject({
      cfop: '5101',
      icms_situacao_tributaria: '102',
      valor_total_tributos: '6.97',
      ibs_cbs_situacao_tributaria: '000',
      cbs_aliquota: '0.9',
      cbs_valor: '0.47',
    });
    const full = (await get('adminA', `/fiscal/documents/${d.id}?full=1`).expect(200)).body;
    expect(full.items[0]).toMatchObject({ ruleCode: 'PF-000001', ruleSource: 'ncm', cfop: '5101' });
    expect(full.order).toMatchObject({ number: expect.any(Number), total: o.total });
  });

  it('CPF na nota: válido vai no XML; inválido vira erro antes de enviar', async () => {
    const o = await paidOrder();
    const bad = (
      await post('adminA', `/orders/${o.id}/nfce`, { cpf: '111.111.111-12' }).expect(202)
    ).body;
    expect(bad.status).toBe('error');
    expect(bad.issues[0].title).toBe('CPF do cliente inválido');
    await patch('adminA', `/fiscal/documents/${bad.id}`, {
      recipient: { cpf: VALID_CPF, name: 'Maria' },
    }).expect(200);
    await post('adminA', `/fiscal/documents/${bad.id}/reissue`).expect(202);
    await waitDoc(bad.id, (s) => s === 'authorized');
    const sent = calls.filter((c) => c.url.includes(`ref=pm-${bad.id}`)).at(-1)!;
    expect(sent.body).toMatchObject({ cpf_destinatario: VALID_CPF, nome_destinatario: 'Maria' });
  });

  it('delivery sem CPF: rejeição 787 explicada antes; com CPF e endereço sai como entrega a domicílio', async () => {
    const o = (
      await post('adminA', '/orders', {
        channel: 'delivery',
        deliveryAddress: 'Rua das Flores, 100',
        customerName: 'Carla',
        customerPhone: '11999990000',
        deliveryFee: '7.00',
        items: [{ productId: fx.prodA, quantity: 1 }],
      }).expect(201)
    ).body;
    await post(
      'adminA',
      `/orders/${o.id}/payments`,
      { cashSessionId: sessionId, method: 'pix', amount: o.total },
      key(),
    ).expect(201);
    const d = (await post('adminA', `/orders/${o.id}/nfce`).expect(202)).body;
    expect(d.status).toBe('error');
    expect(d.issues[0]).toMatchObject({ title: 'Falta o CPF ou CNPJ do cliente', code: '787' });
    expect(d.recipient).toMatchObject({ name: 'Carla', street: 'Rua das Flores, 100' });
    await patch('adminA', `/fiscal/documents/${d.id}`, {
      recipient: {
        ...d.recipient,
        cpf: VALID_CPF,
        street: 'Rua das Flores',
        number: '100',
        district: 'Centro',
        city: 'Curitiba',
        state: 'pr',
      },
    }).expect(200);
    await post('adminA', `/fiscal/documents/${d.id}/reissue`).expect(202);
    await waitDoc(d.id, (s) => s === 'authorized');
    const sent = calls.filter((c) => c.url.includes(`ref=pm-${d.id}`)).at(-1)!;
    expect(sent.body).toMatchObject({
      presenca_comprador: '4',
      cpf_destinatario: VALID_CPF,
      logradouro_destinatario: 'Rua das Flores',
      uf_destinatario: 'PR',
    });
  });

  it('descartar nota com erro: some da lista; autorizada não se descarta', async () => {
    const o = await paidOrder();
    const d = (await post('adminA', `/orders/${o.id}/nfce`, { cpf: '11111111112' }).expect(202))
      .body;
    await post('adminA', `/fiscal/documents/${d.id}/discard`, { reason: 'teste' }).expect(200);
    const list = (await get('adminA', '/fiscal/documents?kind=nfce&limit=500').expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === d.id)).toBeUndefined();
    const [auth] = (await get('adminA', '/fiscal/documents?status=authorized').expect(200)).body;
    await post('adminA', `/fiscal/documents/${auth.id}/discard`).expect(409);
  });

  it('NF-e: precisa estar ligada, nasce rascunho, corrige destinatário e emite pela /v2/nfe', async () => {
    const o = await paidOrder();
    await post('adminA', `/orders/${o.id}/nfe`).expect(422);
    await put('adminA', '/fiscal/settings', {
      nfeEnabled: true,
      nfeNature: 'venda de mercadoria',
    }).expect(200);
    const d = (await post('adminA', `/orders/${o.id}/nfe`).expect(201)).body;
    expect(d).toMatchObject({ kind: 'nfe', status: 'draft' });
    expect(d.issues.map((i: { title: string }) => i.title)).toEqual(
      expect.arrayContaining(['Falta o CPF ou CNPJ do cliente', 'Endereço do cliente incompleto']),
    );
    // Rascunho de NF-e bloqueia NFC-e da mesma venda.
    await post('adminA', `/orders/${o.id}/nfce`).expect(409);
    // Rascunho com problema não sai.
    const still = (await post('adminA', `/fiscal/documents/${d.id}/reissue`).expect(202)).body;
    expect(still.status).toBe('error');
    await patch('adminA', `/fiscal/documents/${d.id}`, {
      recipient: {
        name: 'Empresa Cliente Ltda',
        cnpj: '11.222.333/0001-81',
        ieIndicator: 9,
        street: 'Av. Brasil',
        number: '50',
        district: 'Centro',
        city: 'Curitiba',
        state: 'PR',
        cep: '80000-000',
        email: 'compras@cliente.test',
      },
      operation: { finalConsumer: true, info: 'Pedido de compra 123' },
    }).expect(200);
    await post('adminA', `/fiscal/documents/${d.id}/reissue`).expect(202);
    const done = await waitDoc(d.id, (s) => s === 'authorized');
    expect(done.kind).toBe('nfe');
    const sent = calls
      .filter((c) => c.method === 'POST' && c.url.startsWith(`/v2/nfe?ref=pm-${d.id}`))
      .at(-1)!;
    expect(sent.body).toMatchObject({
      natureza_operacao: 'VENDA DE MERCADORIA',
      finalidade_emissao: '1',
      tipo_documento: '1',
      consumidor_final: '1',
      cnpj_destinatario: '11222333000181',
      indicador_inscricao_estadual_destinatario: '9',
      cep_destinatario: '80000000',
      email_destinatario: 'compras@cliente.test',
      informacoes_adicionais_contribuinte: 'Pedido de compra 123',
    });
    // NF-e lista separada da NFC-e.
    const nfes = (await get('adminA', '/fiscal/documents?kind=nfe').expect(200)).body;
    expect(nfes.map((x: { id: string }) => x.id)).toEqual([d.id]);
  });

  it('carta de correção e e-mail da NF-e autorizada', async () => {
    const [nfe] = (await get('adminA', '/fiscal/documents?kind=nfe&status=authorized').expect(200))
      .body;
    await post('adminA', `/fiscal/documents/${nfe.id}/correction`, { text: 'curta' }).expect(400);
    const r = (
      await post('adminA', `/fiscal/documents/${nfe.id}/correction`, {
        text: 'Corrige o complemento do endereço de entrega para sala 2',
      }).expect(200)
    ).body;
    expect(r.events[0]).toMatchObject({ kind: 'correction', status: 'authorized', sequence: 1 });
    expect(r.events[0].pdfUrl).toMatch(/cce\.pdf$/);
    await post('adminA', `/fiscal/documents/${nfe.id}/email`, { emails: ['x@y.test'] }).expect(200);
    const [nfce] = (
      await get('adminA', '/fiscal/documents?kind=nfce&status=authorized').expect(200)
    ).body;
    await post('adminA', `/fiscal/documents/${nfce.id}/correction`, {
      text: 'Não existe carta de correção para NFC-e',
    }).expect(400);
  });

  it('inutilização: autorizada, recusada explicada e número já usado bloqueado', async () => {
    const v = (
      await post('adminA', '/fiscal/voids', {
        kind: 'nfce',
        series: 1,
        from: 500,
        to: 502,
        reason: 'Números pulados por falha do sistema',
      }).expect(201)
    ).body;
    expect(v.status).toBe('authorized');
    const bad = await post('adminA', '/fiscal/voids', {
      kind: 'nfe',
      series: 1,
      from: 999,
      to: 999,
      reason: 'Número pulado na troca de sistema',
    }).expect(422);
    expect(bad.body.message).toContain('Inutilização recusada');
    await post('adminA', '/fiscal/voids', {
      kind: 'nfce',
      series: 1,
      from: 1,
      to: 1,
      reason: 'Tentando inutilizar número já usado',
    }).expect(409);
    const list = (await get('adminA', '/fiscal/voids').expect(200)).body;
    expect(list.map((x: { status: string }) => x.status).sort()).toEqual([
      'authorized',
      'rejected',
    ]);
    expect(Array.isArray((await get('adminA', '/fiscal/voids/gaps').expect(200)).body)).toBe(true);
  });

  it('notas recebidas: busca, manifesta e baixa o DANFE', async () => {
    const s = (await post('adminA', '/fiscal/received/sync').expect(200)).body;
    expect(s).toMatchObject({ fetched: 2, version: 5 });
    // De novo: a partir da versão 5, nada novo.
    expect((await post('adminA', '/fiscal/received/sync').expect(200)).body.fetched).toBe(0);
    const { rows } = (await get('adminA', '/fiscal/received').expect(200)).body;
    expect(rows).toHaveLength(2);
    const drinks = rows.find((r: { issuerName: string }) =>
      r.issuerName.startsWith('Distribuidora'),
    );
    expect(drinks).toMatchObject({ total: '845.30', manifestation: null, situation: 'autorizada' });
    await post('adminA', `/fiscal/received/${drinks.id}/manifest`, {
      tipo: 'nao_realizada',
    }).expect(422);
    await post('adminA', `/fiscal/received/${drinks.id}/manifest`, { tipo: 'ciencia' }).expect(200);
    const after = (await get('adminA', '/fiscal/received').expect(200)).body.rows;
    expect(after.find((r: { id: string }) => r.id === drinks.id).manifestation).toBe('ciencia');
    const pdf = await get('adminA', `/fiscal/received/${drinks.id}/file?ext=pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await get('adminB', '/fiscal/received').expect(200)).body.rows).toEqual([]);
  });

  it('emissão automática: com a opção ligada, pagar o pedido já pede a NFC-e', async () => {
    await put('adminA', '/fiscal/settings', { autoEmitNfce: true }).expect(200);
    const o = await paidOrder();
    const end = Date.now() + 10_000;
    let docs: { id: string; status: string }[] = [];
    while (!docs.length && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
      docs = (await get('adminA', `/fiscal/documents?orderId=${o.id}`).expect(200)).body;
    }
    expect(docs).toHaveLength(1);
    await waitDoc(docs[0].id, (s) => s === 'authorized');
    await put('adminA', '/fiscal/settings', { autoEmitNfce: false }).expect(200);
  });
});
