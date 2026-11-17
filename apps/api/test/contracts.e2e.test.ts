import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { totpContext } from '../src/platform/platform-auth';
import { isCpf } from '../src/platform/platform.schemas';
import { extenso } from '../src/platform/contracts/contract-template';
import { pdfSafe } from '../src/platform/contracts/contract-pdf';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, seedTwoTenants } from './fixtures';
import { fakeMail } from './mail-fake';

/**
 * Contrato digital do cliente: gerar (texto + PDF + hash), enviar por e-mail (envio do próprio
 * Comandou), assinar pelo link público só depois de ler até o fim, PDF assinado guardado e aviso
 * de volta por e-mail.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
// 1x1 PNG transparente (assinatura "desenhada").
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
let cookie = '';
let mail: Awaited<ReturnType<typeof fakeMail>> | null = null;

const pget = (url: string) =>
  http.get(`/api/v1/platform${url}`).set('Host', ADMIN_HOST).set('Cookie', cookie);
const psend = (method: 'post' | 'put', url: string, body: object = {}) =>
  http[method](`/api/v1/platform${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', cookie)
    .send(body);
const sget = (url: string) => http.get(`/api/v1/platform/sign/${url}`).set('Host', ADMIN_HOST);
const spost = (url: string, body: object = {}) =>
  http
    .post(`/api/v1/platform/sign/${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('User-Agent', 'Navegador-Teste/1.0')
    .send(body);

const settings = {
  providerName: 'Comandou Tecnologia Ltda',
  providerDocument: '12.345.678/0001-90',
  providerAddress: 'Rua das Flores, 100, São Paulo/SP',
  providerEmail: 'contato@comandou.test',
  providerRepresentative: 'David Queiroz',
  forumCity: 'São Paulo/SP',
  dueDay: 10,
  termMonths: 12,
  slaPercent: 99.5,
  readjustIndex: 'IPCA/IBGE',
  lateFeePercent: 2,
  lateInterestPercent: 1,
  suspendAfterDays: 15,
  supportHours: 'segunda a sábado, das 9h às 18h',
  notifyEmail: 'david@comandou.test',
};

beforeAll(async () => {
  fx = await seedTwoTenants('ct');
  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('contratos@plataforma.test', 'David', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  const [{ id: planId }] = await ownerQuery<{ id: string }>(
    `INSERT INTO plans (code, name, price_monthly, max_users, max_products, max_orders_month,
                        feature_fiscal, feature_whatsapp, trial_days)
     VALUES ('ct-pro', 'Profissional CT', 179.90, 15, 800, NULL, true, true, 14) RETURNING id`,
  );
  await ownerQuery(
    `INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES ($1, $2, 'active')`,
    [fx.tenantA, planId],
  );

  await ownerQuery(`UPDATE mail_settings SET provider = 'none', from_address = ''`);

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
      email: 'contratos@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  cookie = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  await mail?.off();
});

describe('Peças do contrato', () => {
  it('extenso, CPF e texto seguro para o PDF', () => {
    expect(extenso(30)).toBe('trinta');
    expect(extenso(15)).toBe('quinze');
    expect(extenso(48)).toBe('quarenta e oito');
    expect(extenso(100)).toBe('cem');
    expect(extenso(120)).toBe('cento e vinte');
    expect(isCpf('52998224725')).toBe(true);
    expect(isCpf('52998224724')).toBe(false);
    expect(isCpf('11111111111')).toBe(false);
    expect(pdfSafe('Cláusula — “ação” ✓ 🍕')).toBe('Cláusula — “ação” ? ?');
  });
});

describe('Contrato do cliente', () => {
  let contractId = '';
  let token = '';
  let hash = '';

  it('sem dados da contratada ou do cliente, não gera', async () => {
    const r = await psend('post', `/tenants/${fx.tenantA}/contracts`).expect(422);
    expect(r.body.message).toMatch(/contratada/);
    await psend('put', '/contracts/settings', settings).expect(200);
    const r2 = await psend('post', `/tenants/${fx.tenantA}/contracts`).expect(422);
    expect(r2.body.message).toMatch(/Cadastro/);
  });

  it('configuração guarda os dados da contratada', async () => {
    const r = await pget('/contracts/settings').expect(200);
    expect(r.body.notifyEmail).toBe('david@comandou.test');
    expect(r.body).not.toHaveProperty('webhookUrl');
    expect(r.body.providerDocument).toBe('12345678000190');
    expect(r.body.slaPercent).toBe('99.50');
  });

  it('gera o contrato com plano, cadastro e PDF com hash', async () => {
    await psend('put', `/tenants/${fx.tenantA}/profile`, {
      legalName: 'Restaurante A Comércio de Alimentos Ltda',
      document: '11.222.333/0001-81',
      contactName: 'Maria Souza',
      billingEmail: 'financeiro@ct-a.test',
      city: 'Campinas',
      state: 'SP',
    }).expect(200);
    const r = await psend('post', `/tenants/${fx.tenantA}/contracts`, {
      setupFee: '300.00',
      specialConditions: 'Primeiros 3 meses com 20% de desconto.',
    }).expect(201);
    contractId = r.body.id;
    hash = r.body.contentHash;
    expect(r.body.number).toMatch(/^CMD-\d{4}-0001$/);
    expect(r.body.status).toBe('draft');
    expect(r.body.planName).toBe('Profissional CT');
    expect(r.body.priceMonthly).toBe('179.90');
    expect(r.body.signerEmail).toBe('financeiro@ct-a.test');
    const titles = r.body.content.clauses.map((c: { title: string }) => c.title);
    for (const t of [
      'Proteção de dados pessoais (LGPD)',
      'Nível de serviço (disponibilidade)',
      'Foro',
      'Condições especiais',
      'Assinatura eletrônica',
    ])
      expect(titles).toContain(t);
    // Plano com nota: o contrato diz quanto custa a Focus NFe (Super Admin → Orçamento).
    const nfce = r.body.content.clauses.find((c: { title: string }) =>
      c.title.startsWith('Nota fiscal'),
    );
    expect(nfce.items.join(' ')).toMatch(
      /Focus NFe.*R\$\s62,90 por mês por CNPJ.*R\$\s0,055 por NFC-e/,
    );
    // Plano com limites: não diz que a mensalidade é fixa sem limite.
    expect(JSON.stringify(r.body.content)).not.toContain('nem limite de uso');
    expect(createHash('sha256').update(JSON.stringify(r.body.content)).digest('hex')).toBe(hash);
    const pdf = await pget(`/contracts/${contractId}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200)
      .expect('Content-Type', 'application/pdf');
    const doc = await PDFDocument.load(pdf.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(5);
    expect(
      createHash('sha256')
        .update(pdf.body as Buffer)
        .digest('hex'),
    ).toBe(r.body.pdfSha256);
  });

  it('enviar sem e-mail configurado avisa; configurado, manda o link e o PDF', async () => {
    const r = await psend('post', `/contracts/${contractId}/send`).expect(422);
    expect(r.body.message).toMatch(/Super Admin › E-mail/);
    mail = await fakeMail(app, KEY);
    const s = await psend('post', `/contracts/${contractId}/send`, {
      message: 'Qualquer dúvida, me chame.',
    }).expect(200);
    expect(s.body.url).toMatch(/^http:\/\/admin\.comandou\.test\/assinar\/[A-Za-z0-9_-]{43}$/);
    expect(s.body.contract.status).toBe('sent');
    token = s.body.url.split('/').pop();
    const call = mail!.sent.at(-1)!.body;
    expect(call.to).toEqual(['financeiro@ct-a.test']);
    expect(call.html).toContain(s.body.url);
    expect(call.attachments?.[0]?.content_type).toBe('application/pdf');
    expect(Buffer.from(call.attachments![0]!.content, 'base64').subarray(0, 4).toString()).toBe(
      '%PDF',
    );
    // O token não fica no banco (só o hash).
    const [row] = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenant_contracts WHERE content LIKE $1`,
      [`%${token}%`],
    );
    expect(row.n).toBe(0);
  });

  it('provedor de e-mail fora do ar: o envio falha e o link anterior continua valendo', async () => {
    mail!.state.fail = 500;
    const r = await psend('post', `/contracts/${contractId}/send`).expect(422);
    expect(r.body.message).toMatch(/HTTP 500/);
    mail!.state.fail = null;
    await sget(token).expect(200);
    // O e-mail com o link que não valeu não sai depois sozinho.
    const [o] = await ownerQuery<{ status: string }>(
      `SELECT status FROM mail_outbox WHERE kind = 'contract.send'
        ORDER BY created_at DESC LIMIT 1`,
    );
    expect(o!.status).toBe('cancelled');
  });

  it('link público: abre, mas só assina depois de ler até o fim', async () => {
    await sget('token-que-nao-existe-0000000000000000').expect(404);
    const o = await sget(token).expect(200);
    expect(o.body.status).toBe('viewed');
    expect(o.body.content.number).toBe(o.body.number);
    const body = {
      name: 'Maria Souza',
      document: '529.982.247-25',
      email: 'maria@ct-a.test',
      accept: true,
      contentHash: hash,
      signature: { kind: 'drawn', image: PNG },
    };
    const early = await spost(token, body).expect(409);
    expect(early.body.message).toMatch(/até o fim/);
    await spost(`${token}/read`).expect(200);
    await spost(token, { ...body, document: '111.111.111-11' }).expect(400);
    await spost(token, { ...body, contentHash: '0'.repeat(64) }).expect(409);
    const done = await spost(token, {
      ...body,
      geo: { lat: -22.90556, lng: -47.06083, accuracy: 35 },
    }).expect(200);
    expect(done.body.status).toBe('client_signed');
    expect(done.body.signerName).toBe('Maria Souza');
    expect(done.body.countersignDeadline).toBeTruthy();
    await spost(token, body).expect(409);
  });

  it('cliente assinou: a contratada recebe o aviso para assinar e o cliente o recibo', async () => {
    const d = await pget(`/contracts/${contractId}`).expect(200);
    expect(d.body.status).toBe('client_signed');
    expect(d.body.signedPdfSha256).toBeNull();
    expect(d.body.signerGeo).toEqual({ lat: -22.90556, lng: -47.06083, accuracy: 35 });
    expect(d.body.clientSignature.kind).toBe('drawn');
    expect(d.body.integrity).toMatchObject({ trailOk: true, clientEvidenceOk: true });
    const calls = mail!.sent.slice(-2).map((x) => x.body);
    expect(calls.map((m) => m.to[0])).toEqual(['david@comandou.test', 'maria@ct-a.test']);
    expect(calls[0]!.html).toContain(
      `/restaurantes/${fx.tenantA}?aba=contrato&amp;contrato=${contractId}`,
    );
    expect(calls[0]!.attachments).toBeUndefined();
    const p = await pget('/contracts/pending').expect(200);
    expect(p.body.map((x: { id: string }) => x.id)).toContain(contractId);
    // O cliente não consegue trocar a assinatura dele (nem direto no banco).
    await expect(
      ownerQuery(`UPDATE tenant_contracts SET signer_name = 'Outro' WHERE id = $1`, [contractId]),
    ).rejects.toThrow(/não pode ser alterado/);
    await psend('post', `/contracts/${contractId}/link`).expect(409);
  });

  it('a contratada assina por último, com o código do autenticador', async () => {
    const d = await pget(`/contracts/${contractId}`).expect(200);
    const body = {
      name: 'David Queiroz',
      document: '111.444.777-35',
      accept: true,
      contentHash: hash,
      clientEvidenceSha256: d.body.clientEvidenceSha256,
      code: '000000',
      signature: { kind: 'typed', text: 'David Queiroz' },
    };
    const bad = await psend('post', `/contracts/${contractId}/countersign`, body).expect(422);
    expect(bad.body.message).toMatch(/autenticador/);
    await psend('post', `/contracts/${contractId}/countersign`, {
      ...body,
      code: totpCode(SECRET, totpStep() + 1),
      clientEvidenceSha256: '0'.repeat(64),
    }).expect(409);
    const code = totpCode(SECRET, totpStep() + 1);
    const ok = await psend('post', `/contracts/${contractId}/countersign`, {
      ...body,
      code,
    }).expect(200);
    expect(ok.body.status).toBe('signed');
    expect(ok.body.countersignerName).toBe('David Queiroz');
    expect(ok.body.countersignerEmail).toBe('contratos@plataforma.test');
    expect(ok.body.trailSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.body.integrity).toMatchObject({ trailOk: true, clientEvidenceOk: true });
    // Depois de completo, não se assina de novo.
    await psend('post', `/contracts/${contractId}/countersign`, { ...body, code }).expect(409);
  });

  it('PDF assinado tem o manifesto, fica guardado e o aviso vai por e-mail', async () => {
    const d = await pget(`/contracts/${contractId}`).expect(200);
    expect(d.body.status).toBe('signed');
    expect(d.body.signerDocument).toBe('529.982.247-25');
    expect(d.body.notifiedAt).toBeTruthy();
    expect(d.body.events.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining([
        'created',
        'sent',
        'opened',
        'read',
        'signed',
        'countersign_denied',
        'countersigned',
        'notified',
      ]),
    );
    const calls = mail!.sent.slice(-4).map((x) => x.body);
    expect(calls.map((m) => m.to[0])).toEqual([
      'david@comandou.test',
      'contratos@plataforma.test',
      'maria@ct-a.test',
      'financeiro@ct-a.test',
    ]);
    const signed = Buffer.from(calls[0]!.attachments![0]!.content, 'base64');
    expect(createHash('sha256').update(signed).digest('hex')).toBe(d.body.signedPdfSha256);
    const original = await PDFDocument.load(
      (
        await ownerQuery<{ pdf: Buffer }>(`SELECT pdf FROM tenant_contracts WHERE id = $1`, [
          contractId,
        ])
      )[0].pdf,
    );
    const doc = await PDFDocument.load(signed);
    expect(doc.getPageCount()).toBeGreaterThan(original.getPageCount());
    expect(doc.getKeywords()).toContain(`trilha:${d.body.trailSha256}`);
    // O cliente baixa a via dele pelo mesmo link.
    await sget(`${token}/pdf?signed=1`).expect(200).expect('Content-Type', 'application/pdf');
  });

  it('contrato assinado não muda nem é cancelado', async () => {
    await psend('post', `/contracts/${contractId}/cancel`, { reason: 'teste' }).expect(409);
    await psend('post', `/contracts/${contractId}/link`).expect(409);
    await expect(
      ownerQuery(`UPDATE tenant_contracts SET countersigner_name = 'Outro' WHERE id = $1`, [
        contractId,
      ]),
    ).rejects.toThrow(/não pode ser alterado/);
  });

  it('mexer num evento da trilha aparece na conferência', async () => {
    await ownerQuery(
      `UPDATE tenant_contract_events SET ip = '10.9.9.9' WHERE contract_id = $1 AND kind = 'read'`,
      [contractId],
    );
    const d = await pget(`/contracts/${contractId}`).expect(200);
    expect(d.body.integrity.trailOk).toBe(false);
  });

  it('cancelar um contrato pendente derruba o link', async () => {
    const c = await psend('post', `/tenants/${fx.tenantA}/contracts`, {}).expect(201);
    expect(c.body.number).toMatch(/-0002$/);
    const l = await psend('post', `/contracts/${c.body.id}/link`).expect(200);
    const t = l.body.url.split('/').pop();
    await sget(t).expect(200);
    await psend('post', `/contracts/${c.body.id}/countersign`, {
      name: 'David Queiroz',
      document: '111.444.777-35',
      accept: true,
      contentHash: c.body.contentHash,
      clientEvidenceSha256: '0'.repeat(64),
      code: '123456',
      signature: { kind: 'typed', text: 'David' },
    }).expect(409);
    await psend('post', `/contracts/${c.body.id}/cancel`, { reason: 'valores errados' }).expect(
      200,
    );
    await sget(t).expect(404);
    const list = await pget(`/tenants/${fx.tenantA}/contracts`).expect(200);
    expect(list.body.map((x: { status: string }) => x.status)).toEqual(['cancelled', 'signed']);
  });

  it('link público só existe em admin.<base>', async () => {
    await http.get(`/api/v1/platform/sign/${token}`).set('Host', 'ct-a.comandou.test').expect(404);
  });
});
