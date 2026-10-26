import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formatBRL, fromCents, toCents } from '@comandou/shared';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { open, seal } from '../../common/secret-box';
import { ENV, Env } from '../../config/env';
import { TenantDatabaseUnavailable } from '../../database/tenant-database';
import type { Actor } from '../platform.service';
import { PlatformDb, platformAudit } from '../platform-db.service';
import type {
  ContractSettingsInput,
  NewContractInput,
  SignContractInput,
} from '../platform.schemas';
import { brTime, contractSummary, renderContractPdf, renderSignedPdf } from './contract-pdf';
import { buildContract, ContractContent, ContractParty, formatDocument } from './contract-template';

export const WEBHOOK_SECRET_CONTEXT = 'contracts:n8n';
/** Validade do link de assinatura. */
const LINK_DAYS = 30;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const tokenHash = (t: string) => createHash('sha256').update(t).digest();

interface SettingsRow {
  provider_name: string;
  provider_document: string;
  provider_address: string;
  provider_email: string;
  provider_representative: string;
  forum_city: string;
  due_day: number;
  term_months: number;
  sla_percent: string;
  readjust_index: string;
  late_fee_percent: string;
  late_interest_percent: string;
  suspend_after_days: number;
  support_hours: string;
  webhook_url: string;
  webhook_secret_enc: Buffer | null;
  notify_email: string;
  updated_at: Date;
}

interface ContractRow {
  id: string;
  tenant_id: string;
  number: string;
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'cancelled';
  content: string;
  content_hash: string;
  pdf_sha256: string;
  signer_email: string | null;
  token_expires_at: Date | null;
  sent_at: Date | null;
  viewed_at: Date | null;
  read_at: Date | null;
  signed_at: Date | null;
  signer_name: string | null;
  signer_document: string | null;
  signer_ip: string | null;
  signature_kind: string | null;
  signed_pdf_sha256: string | null;
  notified_at: Date | null;
  notify_error: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  created_by_name: string | null;
}

const CONTRACT_COLS = `c.id, c.tenant_id, c.number, c.status, c.content, c.content_hash, c.pdf_sha256,
  c.signer_email, c.token_expires_at, c.sent_at, c.viewed_at, c.read_at, c.signed_at, c.signer_name,
  c.signer_document, c.signer_ip, c.signature_kind, c.signed_pdf_sha256, c.notified_at,
  c.notify_error, c.cancelled_at, c.cancel_reason, c.created_at,
  (SELECT name FROM platform_admins a WHERE a.id = c.created_by) AS created_by_name`;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  /** https://admin.<base>, para montar o link de assinatura. */
  origin: string;
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Contrato gerado',
  link: 'Link de assinatura criado',
  sent: 'Enviado por e-mail',
  opened: 'Aberto pelo signatário',
  read: 'Lido até o fim pelo signatário',
  signed: 'Assinado',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** E-mail simples (o n8n só repassa): título, texto e um botão. */
function emailHtml(title: string, paragraphs: string[], button?: { label: string; url: string }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${esc(p)}</p>`).join('\n')}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#e23a00;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p><p style="font-size:12px;color:#71717a;word-break:break-all">Se o botão não abrir, copie este endereço: ${esc(button.url)}</p>` : ''}
</div>
<p style="font-size:12px;color:#71717a;text-align:center;margin-top:16px">Comandou · sistema para restaurantes</p>
</div></body></html>`;
}

export interface WebhookMessage {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
}

/**
 * Contrato digital de cada cliente: gera (texto congelado + PDF + hash), envia o link de
 * assinatura pelo n8n, recebe a assinatura pelo link público e guarda o PDF assinado.
 */
@Injectable()
export class ContractsService {
  private readonly log = new Logger('Contratos');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  // ------------------------------------------------------------------ configuração
  private async settingsRow(): Promise<SettingsRow> {
    return (await this.db.query<SettingsRow>(`SELECT * FROM platform_contract_settings`))[0]!;
  }

  private settingsView(r: SettingsRow) {
    return {
      providerName: r.provider_name,
      providerDocument: r.provider_document,
      providerAddress: r.provider_address,
      providerEmail: r.provider_email,
      providerRepresentative: r.provider_representative,
      forumCity: r.forum_city,
      dueDay: r.due_day,
      termMonths: r.term_months,
      slaPercent: r.sla_percent,
      readjustIndex: r.readjust_index,
      lateFeePercent: r.late_fee_percent,
      lateInterestPercent: r.late_interest_percent,
      suspendAfterDays: r.suspend_after_days,
      supportHours: r.support_hours,
      webhookUrl: r.webhook_url,
      hasWebhookSecret: !!r.webhook_secret_enc,
      notifyEmail: r.notify_email,
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      ready: !!(r.provider_name && r.provider_document),
      updatedAt: r.updated_at,
    };
  }

  async settings() {
    return this.settingsView(await this.settingsRow());
  }

  async saveSettings(b: ContractSettingsInput, a: Actor) {
    const cur = await this.settingsRow();
    let secret: Buffer | null = b.clearWebhookSecret ? null : cur.webhook_secret_enc;
    if (b.webhookSecret) {
      if (!this.env.INTEGRATIONS_KEY)
        throw new UnprocessableEntityException(
          'Servidor sem INTEGRATIONS_KEY: não é possível guardar o segredo com segurança',
        );
      secret = seal(this.env.INTEGRATIONS_KEY, b.webhookSecret, WEBHOOK_SECRET_CONTEXT);
    }
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_contract_settings SET provider_name = $1, provider_document = $2,
                provider_address = $3, provider_email = $4, provider_representative = $5,
                forum_city = $6, due_day = $7, term_months = $8, sla_percent = $9,
                readjust_index = $10, late_fee_percent = $11, late_interest_percent = $12,
                suspend_after_days = $13, support_hours = $14, webhook_url = $15,
                webhook_secret_enc = $16, notify_email = $17, updated_at = now(), updated_by = $18`,
        [
          b.providerName,
          b.providerDocument,
          b.providerAddress,
          b.providerEmail,
          b.providerRepresentative,
          b.forumCity,
          b.dueDay,
          b.termMonths,
          b.slaPercent,
          b.readjustIndex,
          b.lateFeePercent,
          b.lateInterestPercent,
          b.suspendAfterDays,
          b.supportHours,
          b.webhookUrl,
          secret,
          b.notifyEmail,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_settings_saved',
        entity: 'contract_settings',
        data: {
          providerName: b.providerName,
          webhookUrl: b.webhookUrl ? new URL(b.webhookUrl).host : '',
          secretChanged: !!b.webhookSecret || !!b.clearWebhookSecret,
        },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /** Manda um evento "test" para o n8n (com o e-mail de aviso como destinatário). */
  async testWebhook(a: Actor) {
    const s = await this.settingsRow();
    const to = s.notify_email || a.admin.email;
    await this.webhook(s, {
      event: 'test',
      messages: [
        {
          to,
          subject: 'Teste do envio de contratos do Comandou',
          html: emailHtml('Tudo certo com o n8n', [
            'Este é um e-mail de teste enviado pelo painel do Comandou.',
            'Se ele chegou, o envio de contratos e o aviso de contrato assinado estão funcionando.',
          ]),
          text: 'Teste do envio de contratos do Comandou: se este e-mail chegou, está funcionando.',
        },
      ],
      attachment: null,
    });
    return { ok: true, to };
  }

  /** POST no webhook do n8n. Erro vira mensagem legível (sem segredo). */
  private async webhook(s: SettingsRow, payload: Record<string, unknown>) {
    if (!s.webhook_url)
      throw new UnprocessableEntityException(
        'Configure o webhook do n8n em Contratos → Configurar antes de enviar',
      );
    const body = JSON.stringify({ ...payload, sentAt: new Date().toISOString() });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Comandou-Contratos/1',
      'X-Comandou-Event': String(payload.event),
    };
    if (s.webhook_secret_enc && this.env.INTEGRATIONS_KEY) {
      const secret = open(this.env.INTEGRATIONS_KEY, s.webhook_secret_enc, WEBHOOK_SECRET_CONTEXT);
      headers['X-Comandou-Token'] = secret;
      headers['X-Comandou-Signature'] =
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    }
    let res: Response;
    try {
      res = await fetch(s.webhook_url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new UnprocessableEntityException(
        `O n8n não respondeu (${(e as Error).name === 'TimeoutError' ? 'tempo esgotado' : (e as Error).message})`,
      );
    }
    if (!res.ok) {
      const txt = (await res.text().catch(() => '')).slice(0, 160);
      throw new UnprocessableEntityException(
        `O n8n recusou o envio (HTTP ${res.status}${txt ? `: ${txt}` : ''})`,
      );
    }
  }

  // ------------------------------------------------------------------ painel
  private view(r: ContractRow) {
    const content = JSON.parse(r.content) as ContractContent;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      number: r.number,
      status: r.status,
      planName: content.terms.planName,
      priceMonthly: content.terms.priceMonthly,
      signerEmail: r.signer_email,
      contentHash: r.content_hash,
      pdfSha256: r.pdf_sha256,
      signedPdfSha256: r.signed_pdf_sha256,
      expiresAt: r.token_expires_at,
      sentAt: r.sent_at,
      viewedAt: r.viewed_at,
      readAt: r.read_at,
      signedAt: r.signed_at,
      signerName: r.signer_name,
      signerDocument: r.signer_document ? formatDocument(r.signer_document) : null,
      signerIp: r.signer_ip,
      signatureKind: r.signature_kind,
      notifiedAt: r.notified_at,
      notifyError: r.notify_error,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      createdAt: r.created_at,
      createdBy: r.created_by_name,
    };
  }

  private async row(id: string, c?: PoolClient, lock = false): Promise<ContractRow> {
    const sql = `SELECT ${CONTRACT_COLS} FROM tenant_contracts c WHERE c.id = $1${lock ? ' FOR UPDATE OF c' : ''}`;
    const r = c
      ? (await c.query<ContractRow>(sql, [id])).rows[0]
      : (await this.db.query<ContractRow>(sql, [id]))[0];
    if (!r) throw new NotFoundException('Contrato não encontrado');
    return r;
  }

  async list(tenantId: string) {
    const rows = await this.db.query<ContractRow>(
      `SELECT ${CONTRACT_COLS} FROM tenant_contracts c WHERE c.tenant_id = $1
        ORDER BY c.created_at DESC LIMIT 50`,
      [tenantId],
    );
    return rows.map((r) => this.view(r));
  }

  async detail(id: string) {
    const r = await this.row(id);
    const events = await this.db.query(
      `SELECT kind, ip, user_agent AS "userAgent", data, created_at AS "createdAt"
         FROM tenant_contract_events WHERE contract_id = $1 ORDER BY id`,
      [id],
    );
    return { ...this.view(r), content: JSON.parse(r.content) as ContractContent, events };
  }

  async pdf(id: string, signed: boolean) {
    const [r] = await this.db.query<{ number: string; pdf: Buffer; signed_pdf: Buffer | null }>(
      `SELECT number, pdf, signed_pdf FROM tenant_contracts WHERE id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException('Contrato não encontrado');
    if (signed && !r.signed_pdf) throw new NotFoundException('Contrato ainda não assinado');
    return {
      fileName: `contrato-${r.number}${signed ? '-assinado' : ''}.pdf`,
      data: signed ? r.signed_pdf! : r.pdf,
    };
  }

  /** Dados que o contrato usa (cadastro, plano, dono), já validados. */
  private async gather(tenantId: string, b: NewContractInput, s: SettingsRow) {
    const [t] = await this.db.query<{
      name: string;
      slug: string;
      legal_name: string | null;
      document: string | null;
      contact_name: string | null;
      billing_email: string | null;
      city: string | null;
      state: string | null;
      sub_status: string | null;
      plan_name: string | null;
      price_monthly: string | null;
      max_users: number | null;
      max_products: number | null;
      max_orders_month: number | null;
      feature_fiscal: boolean | null;
      feature_whatsapp: boolean | null;
      feature_custom_domain: boolean | null;
      trial_days: number | null;
    }>(
      `SELECT t.name, t.slug, pf.legal_name, pf.document, pf.contact_name, pf.billing_email,
              pf.city, pf.state, s.status AS sub_status, pl.name AS plan_name,
              pl.price_monthly::text AS price_monthly, pl.max_users, pl.max_products,
              pl.max_orders_month, pl.feature_fiscal, pl.feature_whatsapp,
              pl.feature_custom_domain, pl.trial_days
         FROM tenants t
         LEFT JOIN tenant_profiles pf ON pf.tenant_id = t.id
         LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
         LEFT JOIN plans pl ON pl.id = s.plan_id
        WHERE t.id = $1`,
      [tenantId],
    );
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    if (!s.provider_name || !s.provider_document)
      throw new UnprocessableEntityException(
        'Preencha os dados da contratada (nome e CNPJ) em Contrato → Configurar',
      );
    if (!t.legal_name || !t.document)
      throw new UnprocessableEntityException(
        'Preencha a razão social e o CPF/CNPJ do cliente na aba Cadastro antes de gerar o contrato',
      );
    const planName = b.planName ?? t.plan_name;
    const price = b.priceMonthly ?? t.price_monthly;
    if (!planName || !price)
      throw new UnprocessableEntityException(
        'Cliente sem plano: escolha o plano na aba Assinatura ou informe plano e mensalidade',
      );
    let ownerEmail: string | null = null;
    try {
      const h = await this.db.tenantDb(tenantId);
      ownerEmail =
        (
          await h.query<{ email: string }>(
            `SELECT u.email::text AS email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.tenant_id = $1 AND m.role = 'owner' AND m.status = 'active'
              ORDER BY m.created_at LIMIT 1`,
            [tenantId],
          )
        )[0]?.email ?? null;
    } catch (e) {
      if (!(e instanceof TenantDatabaseUnavailable)) throw e;
    }
    const lim = (n: number | null, what: string, unit: string) =>
      n === null ? `${what}: sem limite` : `${what}: até ${n.toLocaleString('pt-BR')} ${unit}`;
    const yes = (v: boolean | null) => (v ? 'incluída' : 'não incluída');
    const limits =
      b.planName && !t.plan_name
        ? []
        : [
            lim(t.max_users, 'Equipe', 'pessoas ativas'),
            lim(t.max_products, 'Cardápio', 'produtos ativos'),
            lim(t.max_orders_month, 'Pedidos', 'por mês'),
          ];
    const features =
      b.planName && !t.plan_name
        ? ['Recursos conforme a proposta comercial aceita pela CONTRATANTE']
        : [
            `Emissão de NFC-e: ${yes(t.feature_fiscal)}`,
            `Avisos e atendimento por WhatsApp: ${yes(t.feature_whatsapp)}`,
            `Domínio próprio para a loja online: ${yes(t.feature_custom_domain)}`,
          ];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const customer: ContractParty = {
      role: 'CONTRATANTE',
      name: t.legal_name,
      document: formatDocument(t.document),
      address: [t.city, t.state].filter(Boolean).join('/') || null,
      email: t.billing_email ?? ownerEmail,
      representative: t.contact_name,
    };
    const provider: ContractParty = {
      role: 'CONTRATADA',
      name: s.provider_name,
      document: formatDocument(s.provider_document),
      address: s.provider_address || null,
      email: s.provider_email || null,
      representative: s.provider_representative || null,
    };
    return {
      customer,
      provider,
      signerEmail: b.signerEmail || t.billing_email || ownerEmail,
      terms: {
        storeName: t.name,
        systemAddress: `${t.slug}.${this.env.COMANDOU_BASE_DOMAIN}`,
        planName,
        priceMonthly: fromCents(toCents(price)),
        setupFee: fromCents(toCents(b.setupFee ?? '0')),
        dueDay: b.dueDay ?? s.due_day,
        termMonths: b.termMonths ?? s.term_months,
        startDate: b.startDate ?? today,
        trialDays: b.trialDays ?? (t.sub_status === 'trialing' ? (t.trial_days ?? 0) : 0),
        limits,
        features,
        slaPercent: s.sla_percent,
        readjustIndex: s.readjust_index,
        lateFeePercent: s.late_fee_percent,
        lateInterestPercent: s.late_interest_percent,
        suspendAfterDays: s.suspend_after_days,
        supportHours: s.support_hours,
        forumCity: s.forum_city,
        specialConditions: b.specialConditions || null,
      },
    };
  }

  async create(tenantId: string, b: NewContractInput, a: Actor) {
    const s = await this.settingsRow();
    const g = await this.gather(tenantId, b, s);
    const id = await this.db.tx(async (c) => {
      // Número sequencial por ano (CMD-2026-0001), sem corrida entre dois painéis abertos.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('tenant_contracts_number'))`);
      const year = new Date().getFullYear();
      const [{ n }] = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int + 1 AS n FROM tenant_contracts WHERE number LIKE $1`,
          [`CMD-${year}-%`],
        )
      ).rows as [{ n: number }];
      const number = `CMD-${year}-${String(n).padStart(4, '0')}`;
      const content = buildContract({
        number,
        issuedAt: new Date().toISOString(),
        provider: g.provider,
        customer: g.customer,
        terms: g.terms,
      });
      const text = JSON.stringify(content);
      const hash = sha256(text);
      const pdf = await renderContractPdf(content, hash);
      const r = await c.query<{ id: string }>(
        `INSERT INTO tenant_contracts (tenant_id, number, content, content_hash, pdf, pdf_sha256,
                                       signer_email, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenantId, number, text, hash, Buffer.from(pdf), sha256(pdf), g.signerEmail, a.admin.id],
      );
      const cid = r.rows[0]!.id;
      await this.event(c, cid, 'created', { ip: a.ip }, { by: a.admin.name });
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_created',
        entity: 'contract',
        entityId: cid,
        tenantId,
        data: { number, planName: g.terms.planName, priceMonthly: g.terms.priceMonthly },
        ip: a.ip,
      });
      return cid;
    });
    return this.detail(id);
  }

  private async event(
    c: PoolClient,
    contractId: string,
    kind: string,
    meta: { ip?: string; userAgent?: string },
    data: Record<string, unknown> = {},
  ) {
    await c.query(
      `INSERT INTO tenant_contract_events (contract_id, kind, ip, user_agent, data)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        contractId,
        kind,
        meta.ip?.slice(0, 64) ?? null,
        meta.userAgent?.slice(0, 300) ?? null,
        JSON.stringify(data),
      ],
    );
  }

  /** Novo link de assinatura (o anterior deixa de valer). */
  private async issueLink(c: PoolClient, r: ContractRow, email: string | null, origin: string) {
    if (r.status === 'signed') throw new ConflictException('Este contrato já foi assinado');
    if (r.status === 'cancelled') throw new ConflictException('Este contrato foi cancelado');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86400_000);
    await c.query(
      `UPDATE tenant_contracts SET token_hash = $2, token_expires_at = $3,
              signer_email = coalesce($4, signer_email),
              status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
        WHERE id = $1`,
      [r.id, tokenHash(token), expiresAt, email],
    );
    return { url: `${origin}/assinar/${token}`, expiresAt };
  }

  /** Só o link (para mandar por WhatsApp, por exemplo). */
  async link(id: string, a: Actor, origin: string) {
    return this.db.tx(async (c) => {
      const r = await this.row(id, c, true);
      const link = await this.issueLink(c, r, null, origin);
      await this.event(c, id, 'link', { ip: a.ip }, { by: a.admin.name });
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_link',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number },
        ip: a.ip,
      });
      return link;
    });
  }

  /** Gera o link e manda o e-mail pelo n8n (com o PDF anexado para leitura). */
  async send(id: string, b: { email?: string; message?: string }, a: Actor, origin: string) {
    const s = await this.settingsRow();
    if (!s.webhook_url)
      throw new UnprocessableEntityException(
        'Configure o webhook do n8n em Contrato → Configurar antes de enviar',
      );
    const result = await this.db.tx(async (c) => {
      const r = await this.row(id, c, true);
      const email = b.email ?? r.signer_email;
      if (!email) throw new UnprocessableEntityException('Informe o e-mail de quem vai assinar');
      const link = await this.issueLink(c, r, email, origin);
      const content = JSON.parse(r.content) as ContractContent;
      const [{ pdf }] = (
        await c.query<{ pdf: Buffer }>(`SELECT pdf FROM tenant_contracts WHERE id = $1`, [id])
      ).rows as [{ pdf: Buffer }];
      const who = content.parties.customer.representative;
      const provider = content.parties.provider.name;
      const summary = contractSummary(content)
        .filter(([k]) => ['Plano', 'Mensalidade', 'Vigência'].includes(k))
        .map(([k, v]) => `${k}: ${v}`);
      const paragraphs = [
        `Olá${who ? `, ${who}` : ''}!`,
        `${provider} enviou o contrato do Comandou de ${content.parties.customer.name} (nº ${r.number}) para você assinar.`,
        ...(b.message ? [b.message] : []),
        ...summary,
        `Abra o link, leia o contrato até o fim e assine com o dedo, o mouse ou digitando o seu nome. O link é pessoal e vale até ${brTime(link.expiresAt).replace(' (horário de Brasília)', '')}.`,
      ];
      // O webhook roda dentro da transação: se o n8n recusar, o link novo não fica valendo.
      await this.webhook(s, {
        event: 'contract.send',
        contract: {
          id,
          number: r.number,
          customer: content.parties.customer.name,
          store: content.terms.storeName,
          signUrl: link.url,
          expiresAt: link.expiresAt.toISOString(),
        },
        messages: [
          {
            to: email,
            toName: who,
            subject: `Contrato ${r.number} para assinatura · ${content.terms.storeName}`,
            html: emailHtml('Seu contrato está pronto para assinar', paragraphs, {
              label: 'Ler e assinar o contrato',
              url: link.url,
            }),
            text: `${paragraphs.join('\n\n')}\n\n${link.url}`,
          },
        ] satisfies WebhookMessage[],
        attachment: {
          fileName: `contrato-${r.number}.pdf`,
          mimeType: 'application/pdf',
          base64: pdf.toString('base64'),
        },
      });
      await c.query(`UPDATE tenant_contracts SET sent_at = now() WHERE id = $1`, [id]);
      await this.event(c, id, 'sent', { ip: a.ip }, { to: email, by: a.admin.name });
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_sent',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number, to: email },
        ip: a.ip,
      });
      return link;
    });
    return { ...result, contract: await this.detail(id) };
  }

  async cancel(id: string, reason: string, a: Actor) {
    await this.db.tx(async (c) => {
      const r = await this.row(id, c, true);
      if (r.status === 'signed')
        throw new ConflictException('Contrato assinado não pode ser cancelado (gere um aditivo)');
      if (r.status === 'cancelled') return;
      await c.query(
        `UPDATE tenant_contracts SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2,
                token_hash = NULL WHERE id = $1`,
        [id, reason],
      );
      await this.event(c, id, 'cancelled', { ip: a.ip }, { reason, by: a.admin.name });
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_cancelled',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number, reason },
        ip: a.ip,
      });
    });
    return this.detail(id);
  }

  /** Reenvia o aviso de contrato assinado (se o n8n estava fora na hora). */
  async renotify(id: string, a: Actor) {
    const r = await this.row(id);
    if (r.status !== 'signed') throw new ConflictException('Contrato ainda não assinado');
    await this.notifySigned(id);
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_renotified',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number },
        ip: a.ip,
      }),
    );
    return this.detail(id);
  }

  // ------------------------------------------------------------------ link público
  private async byToken(token: string, c?: PoolClient, lock = false): Promise<ContractRow> {
    if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw new NotFoundException('Link inválido');
    const sql = `SELECT ${CONTRACT_COLS} FROM tenant_contracts c WHERE c.token_hash = $1${lock ? ' FOR UPDATE OF c' : ''}`;
    const r = c
      ? (await c.query<ContractRow>(sql, [tokenHash(token)])).rows[0]
      : (await this.db.query<ContractRow>(sql, [tokenHash(token)]))[0];
    if (!r) throw new NotFoundException('Link inválido ou substituído por um mais novo');
    // Depois de assinado o link continua abrindo (para baixar a via assinada) até expirar.
    if (r.token_expires_at && r.token_expires_at.getTime() < Date.now())
      throw new GoneException('Este link expirou. Peça um novo para quem enviou o contrato.');
    return r;
  }

  private publicView(r: ContractRow) {
    const content = JSON.parse(r.content) as ContractContent;
    return {
      number: r.number,
      status: r.status,
      contentHash: r.content_hash,
      pdfSha256: r.pdf_sha256,
      signerEmail: r.signer_email,
      expiresAt: r.token_expires_at,
      readAt: r.read_at,
      signedAt: r.signed_at,
      signerName: r.signer_name,
      content,
    };
  }

  async open(token: string, meta: Omit<RequestMeta, 'origin'>) {
    return this.db.tx(async (c) => {
      const r = await this.byToken(token, c, true);
      if (r.status === 'sent' || r.status === 'viewed') {
        // Uma abertura por IP a cada 30 min basta para a trilha.
        const recent = await c.query(
          `SELECT 1 FROM tenant_contract_events WHERE contract_id = $1 AND kind = 'opened'
              AND ip IS NOT DISTINCT FROM $2 AND created_at > now() - interval '30 minutes'`,
          [r.id, meta.ip?.slice(0, 64) ?? null],
        );
        if (!recent.rowCount) await this.event(c, r.id, 'opened', meta);
        if (r.status === 'sent')
          await c.query(
            `UPDATE tenant_contracts SET status = 'viewed', viewed_at = now() WHERE id = $1`,
            [r.id],
          );
      }
      return this.publicView(await this.row(r.id, c));
    });
  }

  /** O navegador avisa que o texto foi percorrido até o fim (libera a assinatura). */
  async markRead(token: string, meta: Omit<RequestMeta, 'origin'>) {
    return this.db.tx(async (c) => {
      const r = await this.byToken(token, c, true);
      if (r.status !== 'sent' && r.status !== 'viewed')
        throw new ConflictException('Este contrato não está aguardando assinatura');
      if (!r.read_at) {
        await c.query(
          `UPDATE tenant_contracts SET read_at = now(), status = 'viewed',
                  viewed_at = coalesce(viewed_at, now()) WHERE id = $1`,
          [r.id],
        );
        await this.event(c, r.id, 'read', meta);
      }
      return { readAt: (await this.row(r.id, c)).read_at };
    });
  }

  async publicPdf(token: string, signed: boolean) {
    const r = await this.byToken(token);
    return this.pdf(r.id, signed);
  }

  async sign(token: string, b: SignContractInput, meta: Omit<RequestMeta, 'origin'>) {
    let png: Buffer | null = null;
    if (b.signature.kind === 'drawn') {
      png = Buffer.from(b.signature.image.slice(b.signature.image.indexOf(',') + 1), 'base64');
      const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (png.length < 60 || !png.subarray(0, 8).equals(PNG))
        throw new UnprocessableEntityException('Assinatura inválida: desenhe de novo');
    }
    const id = await this.db.tx(async (c) => {
      const r = await this.byToken(token, c, true);
      if (r.status === 'signed') throw new ConflictException('Este contrato já foi assinado');
      if (r.status !== 'sent' && r.status !== 'viewed')
        throw new ConflictException('Este contrato não está aguardando assinatura');
      if (!r.read_at) throw new ConflictException('Role o contrato até o fim antes de assinar');
      if (b.contentHash !== r.content_hash)
        throw new ConflictException('O contrato mudou desde que a página foi aberta. Recarregue.');
      const content = JSON.parse(r.content) as ContractContent;
      const [{ pdf }] = (
        await c.query<{ pdf: Buffer }>(`SELECT pdf FROM tenant_contracts WHERE id = $1`, [r.id])
      ).rows as [{ pdf: Buffer }];
      const events = (
        await c.query<{ kind: string; ip: string | null; created_at: Date; data: { to?: string } }>(
          `SELECT kind, ip, created_at, data FROM tenant_contract_events
            WHERE contract_id = $1 AND kind IN ('created', 'sent', 'opened', 'read') ORDER BY id`,
          [r.id],
        )
      ).rows;
      const signedAt = new Date();
      const sentBy = (
        await c.query<{ by: string | null }>(
          `SELECT data->>'by' AS by FROM tenant_contract_events
            WHERE contract_id = $1 AND kind IN ('sent', 'link') ORDER BY id DESC LIMIT 1`,
          [r.id],
        )
      ).rows[0]?.by;
      const signedPdf = await renderSignedPdf(new Uint8Array(pdf), {
        number: r.number,
        contentHash: r.content_hash,
        originalPdfSha256: r.pdf_sha256,
        customerName: content.parties.customer.name,
        customerDocument: content.parties.customer.document,
        signerName: b.name,
        signerDocument: b.document,
        signerEmail: b.email,
        signedAt,
        ip: meta.ip ?? '—',
        userAgent: meta.userAgent ?? '',
        signature:
          b.signature.kind === 'drawn'
            ? { kind: 'drawn', png: new Uint8Array(png!) }
            : { kind: 'typed', text: b.signature.text },
        sentBy: sentBy
          ? `${content.parties.provider.name} (${sentBy})`
          : content.parties.provider.name,
        events: [
          ...events.map((e) => ({
            at: e.created_at,
            label: `${EVENT_LABEL[e.kind] ?? e.kind}${e.data?.to ? ` para ${e.data.to}` : ''}`,
            ip: e.kind === 'opened' || e.kind === 'read' ? e.ip : null,
          })),
          { at: signedAt, label: `Assinado por ${b.name}`, ip: meta.ip ?? null },
        ],
      });
      await c.query(
        `UPDATE tenant_contracts SET status = 'signed', signed_at = $2, signer_name = $3,
                signer_document = $4, signer_email = $5, signer_ip = $6, signer_user_agent = $7,
                signature_kind = $8, signature_image = $9, signed_pdf = $10, signed_pdf_sha256 = $11
          WHERE id = $1`,
        [
          r.id,
          signedAt,
          b.name,
          b.document,
          b.email,
          meta.ip?.slice(0, 64) ?? null,
          meta.userAgent?.slice(0, 300) ?? null,
          b.signature.kind,
          png ?? Buffer.from(b.signature.kind === 'typed' ? b.signature.text : ''),
          Buffer.from(signedPdf),
          sha256(signedPdf),
        ],
      );
      await this.event(c, r.id, 'signed', meta, {
        name: b.name,
        email: b.email,
        signedPdfSha256: sha256(signedPdf),
      });
      await platformAudit(c, {
        action: 'platform.contract_signed',
        entity: 'contract',
        entityId: r.id,
        tenantId: r.tenant_id,
        data: { number: r.number, signer: b.name, email: b.email },
        ip: meta.ip,
      });
      return r.id;
    });
    // Aviso ao dono da plataforma e via para o signatário. Falha aqui não desfaz a assinatura.
    await this.notifySigned(id).catch(() => undefined);
    return this.publicView(await this.row(id));
  }

  /** contract.signed para o n8n: PDF assinado para o e-mail de aviso e cópia ao signatário. */
  private async notifySigned(id: string) {
    const s = await this.settingsRow();
    const [r] = await this.db.query<ContractRow & { signed_pdf: Buffer; tenant_id: string }>(
      `SELECT ${CONTRACT_COLS}, c.signed_pdf FROM tenant_contracts c WHERE c.id = $1`,
      [id],
    );
    if (!r) return;
    const content = JSON.parse(r.content) as ContractContent;
    const when = brTime(r.signed_at!);
    const to = s.notify_email || content.parties.provider.email;
    const messages: WebhookMessage[] = [];
    if (to)
      messages.push({
        to,
        subject: `Contrato ${r.number} assinado · ${content.terms.storeName}`,
        html: emailHtml('Contrato assinado', [
          `${r.signer_name} assinou o contrato nº ${r.number} de ${content.parties.customer.name} (${content.terms.storeName}).`,
          `Data e hora: ${when}. IP: ${r.signer_ip ?? '—'}.`,
          `Plano ${content.terms.planName}, mensalidade ${formatBRL(toCents(content.terms.priceMonthly))}.`,
          'O PDF assinado, com o manifesto da assinatura, está anexado e guardado no painel (Restaurantes → cliente → Contrato).',
        ]),
        text: `${r.signer_name} assinou o contrato ${r.number} de ${content.parties.customer.name} em ${when}.`,
      });
    if (r.signer_email)
      messages.push({
        to: r.signer_email,
        toName: r.signer_name,
        subject: `Sua via do contrato ${r.number} assinado`,
        html: emailHtml('Contrato assinado com sucesso', [
          `Olá, ${r.signer_name}!`,
          `Obrigado por assinar o contrato do Comandou de ${content.parties.customer.name}. Sua via assinada está anexada a este e-mail.`,
          `Código de integridade do texto (SHA-256): ${r.content_hash}`,
        ]),
        text: `Sua via do contrato ${r.number} assinado está anexada.`,
      });
    const errorOf = (e: unknown) => (e as Error).message.slice(0, 300);
    try {
      await this.webhook(s, {
        event: 'contract.signed',
        contract: {
          id,
          number: r.number,
          customer: content.parties.customer.name,
          customerDocument: content.parties.customer.document,
          store: content.terms.storeName,
          planName: content.terms.planName,
          priceMonthly: content.terms.priceMonthly,
          signedAt: r.signed_at!.toISOString(),
          signerName: r.signer_name,
          signerEmail: r.signer_email,
          signerIp: r.signer_ip,
          contentHash: r.content_hash,
          signedPdfSha256: r.signed_pdf_sha256,
        },
        notifyEmail: to,
        messages,
        attachment: {
          fileName: `contrato-${r.number}-assinado.pdf`,
          mimeType: 'application/pdf',
          base64: r.signed_pdf.toString('base64'),
        },
      });
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE tenant_contracts SET notified_at = now(), notify_error = NULL WHERE id = $1`,
          [id],
        );
        await this.event(c, id, 'notified', {}, { to: messages.map((m) => m.to) });
      });
    } catch (e) {
      this.log.warn(`aviso do contrato ${r.number} não enviado: ${errorOf(e)}`);
      await this.db.tx(async (c) => {
        await c.query(`UPDATE tenant_contracts SET notify_error = $2 WHERE id = $1`, [
          id,
          errorOf(e),
        ]);
        await this.event(c, id, 'notify_failed', {}, { error: errorOf(e) });
      });
      throw e;
    }
  }
}
