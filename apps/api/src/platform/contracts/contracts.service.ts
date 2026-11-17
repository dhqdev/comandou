import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  contractValidUntil,
  fiscalCostClause,
  formatBRL,
  fromCents,
  toCents,
} from '@comandou/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ENV, Env } from '../../config/env';
import { TenantDatabaseUnavailable } from '../../database/tenant-database';
import { MailService } from '../../mail/mail.service';
import { PlatformAuthService } from '../platform-auth';
import type { Actor } from '../platform.service';
import { PlatformDb, platformAudit } from '../platform-db.service';
import type {
  ContractSettingsInput,
  CountersignContractInput,
  NewContractInput,
  SignContractInput,
} from '../platform.schemas';
import {
  brTime,
  contractSummary,
  ManifestSigner,
  renderContractPdf,
  renderSignedPdf,
  SignatureMark,
} from './contract-pdf';
import { buildContract, ContractContent, ContractParty, formatDocument } from './contract-template';
import { loadQuoteSettings, toFiscalCosts } from '../quotes/quotes.service';

const MAIL_OFF = 'Configure o envio de e-mail em Super Admin › E-mail antes de enviar';
/** Validade do link de assinatura. */
const LINK_DAYS = 30;
/** Prazo da contratada para assinar depois do cliente (cláusula "Assinatura eletrônica"). */
export const COUNTERSIGN_DAYS = 10;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const tokenHash = (t: string) => createHash('sha256').update(t).digest();

/** JSON com as chaves em ordem (o jsonb do Postgres não guarda a ordem original). */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date))
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  return v;
}
export const canonical = (v: unknown) => JSON.stringify(sortKeys(v));

export interface TrailEvent {
  contractId: string;
  kind: string;
  ip: string | null;
  userAgent: string | null;
  data: Record<string, unknown>;
  at: Date;
}
/** Elo da trilha: sha256(hash anterior + evento). */
export const eventHash = (prev: string | null, e: TrailEvent) =>
  sha256(
    `${prev ?? ''}\n${canonical([e.contractId, e.kind, e.ip, e.userAgent, e.data, e.at.toISOString()])}`,
  );

type Geo = { lat: number; lng: number; accuracy: number } | null;

/** PNG da assinatura desenhada (data URL) ou erro legível. */
function signaturePng(s: { kind: 'drawn'; image: string } | { kind: 'typed'; text: string }) {
  if (s.kind !== 'drawn') return null;
  const png = Buffer.from(s.image.slice(s.image.indexOf(',') + 1), 'base64');
  const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 60 || !png.subarray(0, 8).equals(MAGIC))
    throw new UnprocessableEntityException('Assinatura inválida: desenhe de novo');
  return png;
}

const HOW: Record<string, string> = {
  drawn: 'Assinatura desenhada na tela',
  typed: 'Assinatura digitada (nome completo)',
};

interface SettingsRow {
  provider_name: string;
  provider_document: string;
  provider_address: string;
  provider_email: string;
  provider_representative: string;
  provider_representative_document: string;
  forum_city: string;
  due_day: number;
  term_months: number;
  sla_percent: string;
  readjust_index: string;
  late_fee_percent: string;
  late_interest_percent: string;
  suspend_after_days: number;
  support_hours: string;
  notify_email: string;
  updated_at: Date;
}

interface ContractRow {
  id: string;
  valid_until: string | null;
  tenant_id: string;
  number: string;
  status: 'draft' | 'sent' | 'viewed' | 'client_signed' | 'signed' | 'cancelled';
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
  signer_user_agent: string | null;
  signer_geo: Geo;
  signature_kind: string | null;
  client_evidence_sha256: string | null;
  countersigned_at: Date | null;
  countersigner_name: string | null;
  countersigner_document: string | null;
  countersigner_email: string | null;
  countersigner_ip: string | null;
  countersign_kind: string | null;
  trail_sha256: string | null;
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
  c.signer_document, c.signer_ip, c.signer_user_agent, c.signer_geo, c.signature_kind,
  c.client_evidence_sha256, c.countersigned_at, c.countersigner_name, c.countersigner_document,
  c.countersigner_email, c.countersigner_ip, c.countersign_kind, c.trail_sha256,
  c.signed_pdf_sha256, c.notified_at,
  c.notify_error, c.cancelled_at, c.cancel_reason, c.created_at, c.valid_until::text AS valid_until,
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
  signed: 'Assinado pela CONTRATANTE',
  countersigned: 'Assinado pela CONTRATADA',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** E-mail simples: título, texto e um botão. */
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
 * assinatura por e-mail (envio do próprio Comandou), recebe a assinatura pelo link público e guarda o PDF assinado.
 */
@Injectable()
export class ContractsService {
  private readonly log = new Logger('Contratos');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly auth: PlatformAuthService,
    private readonly mail: MailService,
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
      providerRepresentativeDocument: r.provider_representative_document,
      forumCity: r.forum_city,
      dueDay: r.due_day,
      termMonths: r.term_months,
      slaPercent: r.sla_percent,
      readjustIndex: r.readjust_index,
      lateFeePercent: r.late_fee_percent,
      lateInterestPercent: r.late_interest_percent,
      suspendAfterDays: r.suspend_after_days,
      supportHours: r.support_hours,
      notifyEmail: r.notify_email,
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      ready: !!(r.provider_name && r.provider_document),
      updatedAt: r.updated_at,
    };
  }

  async settings() {
    return { ...this.settingsView(await this.settingsRow()), mailReady: await this.mail.ready() };
  }

  async saveSettings(b: ContractSettingsInput, a: Actor) {
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_contract_settings SET provider_name = $1, provider_document = $2,
                provider_address = $3, provider_email = $4, provider_representative = $5,
                forum_city = $6, due_day = $7, term_months = $8, sla_percent = $9,
                readjust_index = $10, late_fee_percent = $11, late_interest_percent = $12,
                suspend_after_days = $13, support_hours = $14, notify_email = $15,
                updated_at = now(), updated_by = $16, provider_representative_document = $17`,
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
          b.notifyEmail,
          a.admin.id,
          b.providerRepresentativeDocument,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_settings_saved',
        entity: 'contract_settings',
        data: {
          providerName: b.providerName,
        },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /** E-mail de teste para o endereço de aviso (ou o do admin), pelo envio do Comandou. */
  async testWebhook(a: Actor) {
    const s = await this.settingsRow();
    const to = s.notify_email || a.admin.email;
    await this.webhook(s, {
      event: 'test',
      messages: [
        {
          to,
          subject: 'Teste do envio de contratos do Comandou',
          html: emailHtml('Tudo certo com o envio de contratos', [
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

  /**
   * Manda as mensagens pelo envio do próprio Comandou (Super Admin › E-mail), com o PDF anexado
   * quando houver. Sai na hora; se o provedor recusar ou estiver fora, as mensagens deste aviso
   * são canceladas (não saem mais tarde com um link que pode ter deixado de valer) e o erro
   * volta legível. Quem chamou decide (desfaz o link novo, grava o erro, mostra na tela).
   */
  private async webhook(_s: SettingsRow, payload: Record<string, unknown>) {
    if (!(await this.mail.ready())) throw new UnprocessableEntityException(MAIL_OFF);
    const messages = (payload.messages ?? []) as WebhookMessage[];
    const att = payload.attachment as { fileName: string; mimeType: string; base64: string } | null;
    const ids: string[] = [];
    for (const m of messages)
      ids.push(
        await this.mail.enqueue(null, {
          kind: String(payload.event).slice(0, 60),
          to: [{ email: m.to, name: m.toName ?? undefined }],
          subject: m.subject,
          html: m.html,
          text: m.text,
          attachments: att
            ? [
                {
                  filename: att.fileName,
                  contentType: att.mimeType,
                  data: Buffer.from(att.base64, 'base64'),
                },
              ]
            : [],
        }),
      );
    for (const id of ids) {
      const r = await this.mail.deliver(id);
      if (!r.ok) {
        await this.db.query(
          `UPDATE mail_outbox SET status = 'cancelled', last_error = COALESCE(last_error, $2)
            WHERE id = ANY($1::uuid[]) AND status IN ('queued', 'failed')`,
          [ids, r.error ?? 'Cancelado'],
        );
        throw new UnprocessableEntityException(`O e-mail não saiu: ${r.error ?? 'erro no envio'}`);
      }
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
      startDate: content.terms.startDate,
      validUntil: r.valid_until,
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
      signerUserAgent: r.signer_user_agent,
      signerGeo: r.signer_geo,
      signatureKind: r.signature_kind,
      clientEvidenceSha256: r.client_evidence_sha256,
      countersignDeadline:
        r.status === 'client_signed' && r.signed_at
          ? new Date(r.signed_at.getTime() + COUNTERSIGN_DAYS * 86400_000)
          : null,
      countersignedAt: r.countersigned_at,
      countersignerName: r.countersigner_name,
      countersignerDocument: r.countersigner_document
        ? formatDocument(r.countersigner_document)
        : null,
      countersignerEmail: r.countersigner_email,
      countersignerIp: r.countersigner_ip,
      countersignKind: r.countersign_kind,
      trailSha256: r.trail_sha256,
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
    const rows = await this.db.query<{
      kind: string;
      ip: string | null;
      user_agent: string | null;
      data: Record<string, unknown>;
      created_at: Date;
      prev_hash: string | null;
      hash: string | null;
    }>(
      `SELECT kind, ip, user_agent, data, created_at, prev_hash, hash
         FROM tenant_contract_events WHERE contract_id = $1 ORDER BY id`,
      [id],
    );
    const [img] = await this.db.query<{ signature_image: Buffer | null }>(
      `SELECT signature_image FROM tenant_contracts WHERE id = $1`,
      [id],
    );
    // A assinatura do cliente aparece no painel para a contratada conferir antes de assinar.
    const clientSignature =
      r.signed_at && img?.signature_image
        ? r.signature_kind === 'drawn'
          ? {
              kind: 'drawn' as const,
              image: `data:image/png;base64,${img.signature_image.toString('base64')}`,
            }
          : { kind: 'typed' as const, text: img.signature_image.toString('utf8') }
        : null;
    return {
      ...this.view(r),
      content: JSON.parse(r.content) as ContractContent,
      clientSignature,
      integrity: this.verifyTrail(id, rows, r, img?.signature_image ?? null),
      events: rows.map((e) => ({
        kind: e.kind,
        ip: e.ip,
        userAgent: e.user_agent,
        data: e.data,
        createdAt: e.created_at,
        hash: e.hash,
      })),
    };
  }

  /**
   * Confere a trilha encadeada (cada evento aponta para o hash do anterior e o hash bate com o
   * conteúdo) e o registro da assinatura do cliente. Eventos de antes da v0.43 não têm hash.
   */
  private verifyTrail(
    contractId: string,
    rows: {
      kind: string;
      ip: string | null;
      user_agent: string | null;
      data: Record<string, unknown>;
      created_at: Date;
      prev_hash: string | null;
      hash: string | null;
    }[],
    r: ContractRow,
    signatureImage: Buffer | null,
  ) {
    let prev: string | null = null;
    let chained = 0;
    let ok = true;
    for (const e of rows) {
      if (e.hash) {
        const expect = eventHash(prev, {
          contractId,
          kind: e.kind,
          ip: e.ip,
          userAgent: e.user_agent,
          data: e.data,
          at: e.created_at,
        });
        if (e.prev_hash !== prev || e.hash !== expect) ok = false;
        chained++;
      }
      prev = e.hash;
    }
    let clientOk: boolean | null = null;
    const signed = rows.find((e) => e.kind === 'signed' && e.data?.evidence);
    if (signed && r.client_evidence_sha256) {
      const ev = signed.data.evidence as Record<string, unknown>;
      clientOk =
        sha256(canonical(ev)) === r.client_evidence_sha256 &&
        ev.contentHash === r.content_hash &&
        (!signatureImage || ev.signatureSha256 === sha256(signatureImage));
    }
    if (r.trail_sha256 && !rows.some((e) => e.hash === r.trail_sha256)) ok = false;
    return { trailOk: ok, chainedEvents: chained, lastHash: prev, clientEvidenceOk: clientOk };
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
    // Regras da cobrança automática (docs/cobranca.md) entram no texto do contrato.
    const [bill] = await this.db.query<{ block_after_days: number; contract_grace_days: number }>(
      `SELECT block_after_days, contract_grace_days FROM platform_billing_settings WHERE id`,
    );
    // Quanto custa a nota fiscal (Focus NFe) e se a mensalidade é fixa (Super Admin → Orçamento).
    const quote = await loadQuoteSettings(this.db);
    const fromPlan = !(b.planName && !t.plan_name);
    const fixedPrice =
      fromPlan && t.max_users === null && t.max_products === null && t.max_orders_month === null;
    const fiscalCosts =
      fromPlan && t.feature_fiscal ? fiscalCostClause(toFiscalCosts(quote)) : null;
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
        // O contrato é reassinado todo ano: vigência de no máximo 12 meses.
        termMonths: Math.min(12, b.termMonths ?? s.term_months),
        startDate: b.startDate ?? today,
        trialDays: b.trialDays ?? (t.sub_status === 'trialing' ? (t.trial_days ?? 0) : 0),
        limits,
        features,
        slaPercent: s.sla_percent,
        readjustIndex: s.readjust_index,
        lateFeePercent: s.late_fee_percent,
        lateInterestPercent: s.late_interest_percent,
        suspendAfterDays: bill?.block_after_days ?? s.suspend_after_days,
        renewalGraceDays: bill?.contract_grace_days ?? 15,
        supportHours: s.support_hours,
        forumCity: s.forum_city,
        specialConditions: b.specialConditions || null,
        fixedPrice,
        fiscalCosts,
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
                                       signer_email, created_by, valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          tenantId,
          number,
          text,
          hash,
          Buffer.from(pdf),
          sha256(pdf),
          g.signerEmail,
          a.admin.id,
          contractValidUntil(g.terms.startDate, g.terms.termMonths),
        ],
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

  /** Acrescenta um evento à trilha, encadeado ao anterior. Devolve o hash do evento. */
  private async event(
    c: PoolClient,
    contractId: string,
    kind: string,
    meta: { ip?: string; userAgent?: string },
    data: Record<string, unknown> = {},
  ): Promise<string> {
    // Um evento por vez em cada contrato, para a cadeia não bifurcar.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('tenant_contract_events:' || $1))`, [
      contractId,
    ]);
    const prev =
      (
        await c.query<{ hash: string | null }>(
          `SELECT hash FROM tenant_contract_events WHERE contract_id = $1 ORDER BY id DESC LIMIT 1`,
          [contractId],
        )
      ).rows[0]?.hash ?? null;
    const e: TrailEvent = {
      contractId,
      kind,
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      // Passa pelo JSON para o hash ver exatamente o que o jsonb vai devolver.
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
      at: new Date(),
    };
    const hash = eventHash(prev, e);
    await c.query(
      `INSERT INTO tenant_contract_events (contract_id, kind, ip, user_agent, data, created_at,
                                           prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [contractId, kind, e.ip, e.userAgent, JSON.stringify(e.data), e.at, prev, hash],
    );
    return hash;
  }

  /** Novo link de assinatura (o anterior deixa de valer). */
  private async issueLink(c: PoolClient, r: ContractRow, email: string | null, origin: string) {
    if (r.status === 'signed') throw new ConflictException('Este contrato já foi assinado');
    if (r.status === 'client_signed')
      throw new ConflictException('O cliente já assinou: falta a assinatura da contratada');
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

  /** Gera o link e manda o e-mail (com o PDF anexado para leitura). */
  async send(id: string, b: { email?: string; message?: string }, a: Actor, origin: string) {
    const s = await this.settingsRow();
    if (!(await this.mail.ready())) throw new UnprocessableEntityException(MAIL_OFF);
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
      // O envio roda dentro da transação: se o provedor recusar, o link novo não fica valendo.
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
    const before = await this.db.tx(async (c) => {
      const r = await this.row(id, c, true);
      if (r.status === 'signed')
        throw new ConflictException('Contrato assinado não pode ser cancelado (gere um aditivo)');
      if (r.status === 'cancelled') return null;
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
        data: { number: r.number, reason, afterClientSigned: r.status === 'client_signed' },
        ip: a.ip,
      });
      return r;
    });
    // O cliente já tinha assinado: ele precisa saber que a assinatura dele perdeu o efeito.
    if (before?.status === 'client_signed' && before.signer_email) {
      const s = await this.settingsRow();
      const content = JSON.parse(before.content) as ContractContent;
      const paragraphs = [
        `Olá, ${before.signer_name}!`,
        `${content.parties.provider.name} cancelou o contrato nº ${before.number} de ${content.parties.customer.name}, que você tinha assinado. A sua assinatura perdeu o efeito e nada foi cobrado por ele.`,
        `Motivo informado: ${reason}`,
      ];
      await this.webhook(s, {
        event: 'contract.cancelled',
        contract: { id, number: before.number, customer: content.parties.customer.name, reason },
        messages: [
          {
            to: before.signer_email,
            toName: before.signer_name,
            subject: `Contrato ${before.number} cancelado`,
            html: emailHtml('Contrato cancelado', paragraphs),
            text: paragraphs.join('\n\n'),
          },
        ] satisfies WebhookMessage[],
        attachment: null,
      }).catch((e: Error) => this.log.warn(`aviso de cancelamento ${before.number}: ${e.message}`));
    }
    return this.detail(id);
  }

  /** Reenvia o aviso da etapa atual (se o envio falhou na hora). */
  async renotify(id: string, a: Actor, origin: string) {
    const r = await this.row(id);
    if (r.status === 'client_signed') await this.notifyClientSigned(id, origin);
    else if (r.status === 'signed') await this.notifySigned(id);
    else throw new ConflictException('Contrato ainda não assinado');
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_renotified',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number, status: r.status },
        ip: a.ip,
      }),
    );
    return this.detail(id);
  }

  /** Contratos que o cliente já assinou e esperam a assinatura da contratada. */
  async pending() {
    const rows = await this.db.query<{
      id: string;
      tenant_id: string;
      tenant_name: string;
      number: string;
      signer_name: string;
      signed_at: Date;
    }>(
      `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.number, c.signer_name, c.signed_at
         FROM tenant_contracts c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.status = 'client_signed' ORDER BY c.signed_at`,
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      number: r.number,
      signerName: r.signer_name,
      signedAt: r.signed_at,
      deadline: new Date(r.signed_at.getTime() + COUNTERSIGN_DAYS * 86400_000),
    }));
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
      countersignedAt: r.countersigned_at,
      countersignDeadline:
        r.status === 'client_signed' && r.signed_at
          ? new Date(r.signed_at.getTime() + COUNTERSIGN_DAYS * 86400_000)
          : null,
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

  /**
   * 1ª assinatura (CONTRATANTE). O contrato fica aguardando a contratada; a assinatura do cliente
   * vira um registro com hash (client_evidence_sha256) que não muda mais.
   */
  async sign(token: string, b: SignContractInput, meta: RequestMeta & { forwardedFor?: string }) {
    const png = signaturePng(b.signature);
    const id = await this.db.tx(async (c) => {
      const r = await this.byToken(token, c, true);
      if (r.status === 'signed' || r.status === 'client_signed')
        throw new ConflictException('Este contrato já foi assinado');
      if (r.status !== 'sent' && r.status !== 'viewed')
        throw new ConflictException('Este contrato não está aguardando assinatura');
      if (!r.read_at) throw new ConflictException('Role o contrato até o fim antes de assinar');
      if (b.contentHash !== r.content_hash)
        throw new ConflictException('O contrato mudou desde que a página foi aberta. Recarregue.');
      const signedAt = new Date();
      const image = png ?? Buffer.from(b.signature.kind === 'typed' ? b.signature.text : '');
      const ip = meta.ip?.slice(0, 64) ?? null;
      const userAgent = meta.userAgent?.slice(0, 300) ?? null;
      const evidence = {
        contract: r.number,
        role: 'CONTRATANTE',
        contentHash: r.content_hash,
        pdfSha256: r.pdf_sha256,
        name: b.name,
        document: b.document,
        email: b.email,
        signedAt: signedAt.toISOString(),
        ip,
        userAgent,
        geo: b.geo ?? null,
        kind: b.signature.kind,
        signatureSha256: sha256(image),
      };
      const evidenceSha256 = sha256(canonical(evidence));
      await c.query(
        `UPDATE tenant_contracts SET status = 'client_signed', signed_at = $2, signer_name = $3,
                signer_document = $4, signer_email = $5, signer_ip = $6, signer_user_agent = $7,
                signature_kind = $8, signature_image = $9, signer_geo = $10,
                signer_forwarded_for = $11, client_evidence_sha256 = $12
          WHERE id = $1`,
        [
          r.id,
          signedAt,
          b.name,
          b.document,
          b.email,
          ip,
          userAgent,
          b.signature.kind,
          image,
          b.geo ? JSON.stringify(b.geo) : null,
          meta.forwardedFor?.slice(0, 300) ?? null,
          evidenceSha256,
        ],
      );
      await this.event(c, r.id, 'signed', meta, {
        name: b.name,
        email: b.email,
        evidence,
        evidenceSha256,
        forwardedFor: meta.forwardedFor?.slice(0, 300) ?? null,
      });
      await platformAudit(c, {
        action: 'platform.contract_signed',
        entity: 'contract',
        entityId: r.id,
        tenantId: r.tenant_id,
        data: { number: r.number, signer: b.name, email: b.email, role: 'CONTRATANTE' },
        ip: meta.ip,
      });
      return r.id;
    });
    // Aviso para a contratada assinar e recibo para o cliente. Falha aqui não desfaz a assinatura.
    await this.notifyClientSigned(id, meta.origin).catch(() => undefined);
    return this.publicView(await this.row(id));
  }

  /**
   * 2ª assinatura (CONTRATADA), no painel: só depois do cliente, dentro do prazo, conferindo que o
   * texto e a assinatura do cliente são os que estavam na tela e com o código do autenticador.
   * Gera o PDF final (rubricas + manifesto das duas assinaturas) e manda a via aos dois.
   */
  async countersign(
    id: string,
    b: CountersignContractInput,
    a: Actor,
    meta: { userAgent?: string },
  ) {
    const png = signaturePng(b.signature);
    const check = (r: ContractRow) => {
      if (r.status === 'signed') throw new ConflictException('Este contrato já foi assinado');
      if (r.status !== 'client_signed')
        throw new ConflictException('A contratada só assina depois do cliente');
      if (Date.now() > r.signed_at!.getTime() + COUNTERSIGN_DAYS * 86400_000)
        throw new ConflictException(
          `Passou o prazo de ${COUNTERSIGN_DAYS} dias para assinar: cancele e gere um contrato novo`,
        );
      if (b.contentHash !== r.content_hash || b.clientEvidenceSha256 !== r.client_evidence_sha256)
        throw new ConflictException('O contrato mudou desde que a tela foi aberta. Recarregue.');
    };
    check(await this.row(id));
    if (!(await this.auth.confirmCode(a.admin.id, b.code))) {
      await this.db.tx(async (c) => {
        await this.event(
          c,
          id,
          'countersign_denied',
          { ip: a.ip, userAgent: meta.userAgent },
          {
            by: a.admin.name,
          },
        );
        await platformAudit(c, {
          adminId: a.admin.id,
          action: 'platform.contract_countersign_denied',
          entity: 'contract',
          entityId: id,
          ip: a.ip,
        });
      });
      throw new UnprocessableEntityException('Código do autenticador inválido ou já usado');
    }

    await this.db.tx(async (c) => {
      const r = await this.row(id, c, true);
      check(r);
      const content = JSON.parse(r.content) as ContractContent;
      const [blob] = (
        await c.query<{ pdf: Buffer; signature_image: Buffer }>(
          `SELECT pdf, signature_image FROM tenant_contracts WHERE id = $1`,
          [id],
        )
      ).rows as [{ pdf: Buffer; signature_image: Buffer }];
      const at = new Date();
      const image = png ?? Buffer.from(b.signature.kind === 'typed' ? b.signature.text : '');
      const ip = a.ip?.slice(0, 64) ?? null;
      const userAgent = meta.userAgent?.slice(0, 300) ?? null;
      const evidence = {
        contract: r.number,
        role: 'CONTRATADA',
        contentHash: r.content_hash,
        clientEvidenceSha256: r.client_evidence_sha256,
        adminId: a.admin.id,
        name: b.name,
        document: b.document,
        email: a.admin.email,
        signedAt: at.toISOString(),
        ip,
        userAgent,
        geo: b.geo ?? null,
        kind: b.signature.kind,
        signatureSha256: sha256(image),
        confirmedWith: 'totp',
      };
      const evidenceSha256 = sha256(canonical(evidence));
      // O evento entra antes do PDF: o hash dele fecha a trilha impressa no manifesto.
      const trail = await this.event(
        c,
        id,
        'countersigned',
        { ip: a.ip, userAgent: meta.userAgent },
        { name: b.name, by: a.admin.name, evidence, evidenceSha256 },
      );
      const events = (
        await c.query<{
          kind: string;
          ip: string | null;
          created_at: Date;
          data: { to?: string; name?: string };
        }>(
          `SELECT kind, ip, created_at, data FROM tenant_contract_events
            WHERE contract_id = $1
              AND kind IN ('created', 'sent', 'opened', 'read', 'signed', 'countersigned')
            ORDER BY id`,
          [id],
        )
      ).rows;
      const sentBy = (
        await c.query<{ by: string | null }>(
          `SELECT data->>'by' AS by FROM tenant_contract_events
            WHERE contract_id = $1 AND kind IN ('sent', 'link') ORDER BY id DESC LIMIT 1`,
          [id],
        )
      ).rows[0]?.by;
      const mark = (kind: string | null, img: Buffer): SignatureMark =>
        kind === 'drawn'
          ? { kind: 'drawn', png: new Uint8Array(img) }
          : { kind: 'typed', text: img.toString('utf8') };
      const signers: ManifestSigner[] = [
        {
          role: 'CONTRATANTE',
          name: r.signer_name!,
          document: r.signer_document!,
          email: r.signer_email,
          onBehalfOf: `${content.parties.customer.name}${content.parties.customer.document ? ` (${content.parties.customer.document})` : ''}`,
          signedAt: r.signed_at!,
          ip: r.signer_ip ?? '—',
          userAgent: r.signer_user_agent ?? '',
          geo: r.signer_geo,
          how: HOW[r.signature_kind ?? 'typed']!,
          signature: mark(r.signature_kind, blob.signature_image),
          evidenceSha256: r.client_evidence_sha256!,
        },
        {
          role: 'CONTRATADA',
          name: b.name,
          document: b.document,
          email: a.admin.email,
          onBehalfOf: `${content.parties.provider.name}${content.parties.provider.document ? ` (${content.parties.provider.document})` : ''}`,
          signedAt: at,
          ip: ip ?? '—',
          userAgent: userAgent ?? '',
          geo: b.geo ?? null,
          how: `${HOW[b.signature.kind]} · confirmada com o código do aplicativo autenticador`,
          signature: mark(b.signature.kind, image),
          evidenceSha256,
        },
      ];
      const signedPdf = await renderSignedPdf(new Uint8Array(blob.pdf), {
        number: r.number,
        contentHash: r.content_hash,
        originalPdfSha256: r.pdf_sha256,
        customerName: content.parties.customer.name,
        signers,
        sentBy: sentBy
          ? `${content.parties.provider.name} (${sentBy})`
          : content.parties.provider.name,
        events: events.map((e) => ({
          at: e.created_at,
          label:
            e.kind === 'signed' || e.kind === 'countersigned'
              ? `${EVENT_LABEL[e.kind]} (${e.data?.name ?? ''})`
              : `${EVENT_LABEL[e.kind] ?? e.kind}${e.data?.to ? ` para ${e.data.to}` : ''}`,
          ip: e.kind === 'created' || e.kind === 'sent' ? null : e.ip,
        })),
        trailSha256: trail,
      });
      await c.query(
        `UPDATE tenant_contracts SET status = 'signed', countersigned_at = $2,
                countersigner_admin_id = $3, countersigner_name = $4, countersigner_document = $5,
                countersigner_email = $6, countersigner_ip = $7, countersigner_user_agent = $8,
                countersigner_geo = $9, countersign_kind = $10, countersign_image = $11,
                countersign_evidence_sha256 = $12, trail_sha256 = $13, signed_pdf = $14,
                signed_pdf_sha256 = $15, notified_at = NULL, notify_error = NULL,
                token_expires_at = greatest(token_expires_at, now() + make_interval(days => $16))
          WHERE id = $1`,
        [
          id,
          at,
          a.admin.id,
          b.name,
          b.document,
          a.admin.email,
          ip,
          userAgent,
          b.geo ? JSON.stringify(b.geo) : null,
          b.signature.kind,
          image,
          evidenceSha256,
          trail,
          Buffer.from(signedPdf),
          sha256(signedPdf),
          LINK_DAYS,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.contract_countersigned',
        entity: 'contract',
        entityId: id,
        tenantId: r.tenant_id,
        data: { number: r.number, signer: b.name, signedPdfSha256: sha256(signedPdf) },
        ip: a.ip,
      });
    });
    // Via final para os dois lados. Falha aqui não desfaz a assinatura (dá para reenviar).
    await this.notifySigned(id).catch(() => undefined);
    return this.detail(id);
  }

  /** Destinatários sem repetir (mesmo e-mail com letras diferentes conta uma vez). */
  private uniqueTo(messages: WebhookMessage[]) {
    const seen = new Set<string>();
    return messages.filter((m) => {
      const k = m.to.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Manda o aviso e registra o resultado (notified_at / notify_error e a trilha). */
  private async deliver(
    id: string,
    number: string,
    payload: Record<string, unknown>,
    to: string[],
  ) {
    const s = await this.settingsRow();
    const errorOf = (e: unknown) => (e as Error).message.slice(0, 300);
    try {
      await this.webhook(s, payload);
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE tenant_contracts SET notified_at = now(), notify_error = NULL WHERE id = $1`,
          [id],
        );
        await this.event(c, id, 'notified', {}, { to, event: payload.event });
      });
    } catch (e) {
      this.log.warn(`aviso do contrato ${number} não enviado: ${errorOf(e)}`);
      await this.db.tx(async (c) => {
        await c.query(`UPDATE tenant_contracts SET notify_error = $2 WHERE id = $1`, [
          id,
          errorOf(e),
        ]);
        await this.event(c, id, 'notify_failed', {}, { error: errorOf(e), event: payload.event });
      });
      throw e;
    }
  }

  /** contract.client_signed: "falta a sua assinatura" para a contratada e recibo para o cliente. */
  private async notifyClientSigned(id: string, origin: string) {
    const s = await this.settingsRow();
    const r = await this.row(id);
    if (r.status !== 'client_signed') return;
    const content = JSON.parse(r.content) as ContractContent;
    const when = brTime(r.signed_at!);
    const deadline = brTime(new Date(r.signed_at!.getTime() + COUNTERSIGN_DAYS * 86400_000));
    const panelUrl = `${origin}/restaurantes/${r.tenant_id}?aba=contrato&contrato=${id}`;
    const to = s.notify_email || content.parties.provider.email;
    const messages: WebhookMessage[] = [];
    if (to) {
      const p = [
        `${r.signer_name} assinou o contrato nº ${r.number} de ${content.parties.customer.name} (${content.terms.storeName}).`,
        `Data e hora: ${when}. IP: ${r.signer_ip ?? '—'}.`,
        `Agora falta a sua assinatura. Confira a assinatura do cliente e assine pelo painel até ${deadline.replace(' (horário de Brasília)', '')}. Depois disso a via final vai por e-mail para vocês dois.`,
      ];
      messages.push({
        to,
        subject: `Falta a sua assinatura · contrato ${r.number} · ${content.terms.storeName}`,
        html: emailHtml('O cliente assinou. Falta você.', p, {
          label: 'Conferir e assinar',
          url: panelUrl,
        }),
        text: `${p.join('\n\n')}\n\n${panelUrl}`,
      });
    }
    if (r.signer_email) {
      const p = [
        `Olá, ${r.signer_name}!`,
        `Recebemos a sua assinatura do contrato nº ${r.number} de ${content.parties.customer.name} em ${when}.`,
        `Agora ${content.parties.provider.name} confere e assina. Assim que isso acontecer, a via final, com as duas assinaturas, chega neste e-mail.`,
        `Código de integridade do texto (SHA-256): ${r.content_hash}`,
      ];
      messages.push({
        to: r.signer_email,
        toName: r.signer_name,
        subject: `Recebemos a sua assinatura · contrato ${r.number}`,
        html: emailHtml('Assinatura recebida', p),
        text: p.join('\n\n'),
      });
    }
    const list = this.uniqueTo(messages);
    await this.deliver(
      id,
      r.number,
      {
        event: 'contract.client_signed',
        contract: {
          id,
          number: r.number,
          customer: content.parties.customer.name,
          store: content.terms.storeName,
          signedAt: r.signed_at!.toISOString(),
          signerName: r.signer_name,
          signerEmail: r.signer_email,
          signerIp: r.signer_ip,
          contentHash: r.content_hash,
          countersignUrl: panelUrl,
        },
        notifyEmail: to,
        messages: list,
        attachment: null,
      },
      list.map((m) => m.to),
    );
  }

  /** contract.signed: via final (duas assinaturas) para a contratada e para o cliente. */
  private async notifySigned(id: string) {
    const s = await this.settingsRow();
    const [r] = await this.db.query<ContractRow & { signed_pdf: Buffer }>(
      `SELECT ${CONTRACT_COLS}, c.signed_pdf FROM tenant_contracts c WHERE c.id = $1`,
      [id],
    );
    if (!r || r.status !== 'signed') return;
    const content = JSON.parse(r.content) as ContractContent;
    const done = r.countersigned_at ?? r.signed_at!;
    const when = brTime(done);
    const to = s.notify_email || content.parties.provider.email;
    const both = !!r.countersigned_at;
    const finalText = both
      ? `${r.signer_name} (CONTRATANTE) e ${r.countersigner_name} (CONTRATADA) assinaram o contrato nº ${r.number} de ${content.parties.customer.name} (${content.terms.storeName}). Concluído em ${when}.`
      : `${r.signer_name} assinou o contrato nº ${r.number} de ${content.parties.customer.name} (${content.terms.storeName}) em ${when}.`;
    const messages: WebhookMessage[] = [];
    if (to)
      messages.push({
        to,
        subject: `Contrato ${r.number} assinado · ${content.terms.storeName}`,
        html: emailHtml('Contrato assinado', [
          finalText,
          `Plano ${content.terms.planName}, mensalidade ${formatBRL(toCents(content.terms.priceMonthly))}.`,
          'O PDF final, com as rubricas e o manifesto das assinaturas, está anexado e guardado no painel (Restaurantes → cliente → Contrato).',
        ]),
        text: finalText,
      });
    if (r.countersigner_email && r.countersigner_email !== to)
      messages.push({
        to: r.countersigner_email,
        toName: r.countersigner_name,
        subject: `Sua via do contrato ${r.number} assinado`,
        html: emailHtml('Contrato assinado', [finalText, 'A via final está anexada.']),
        text: finalText,
      });
    const customerTo = [r.signer_email, content.parties.customer.email].filter(
      (x): x is string => !!x,
    );
    for (const addr of customerTo)
      messages.push({
        to: addr,
        toName: addr === r.signer_email ? r.signer_name : content.parties.customer.representative,
        subject: `Sua via do contrato ${r.number} assinado`,
        html: emailHtml('Contrato assinado com sucesso', [
          `Olá${addr === r.signer_email ? `, ${r.signer_name}` : ''}!`,
          both
            ? `O contrato do Comandou de ${content.parties.customer.name} está assinado pelas duas partes. A via final, com as rubricas e o manifesto das assinaturas, está anexada a este e-mail.`
            : `Obrigado por assinar o contrato do Comandou de ${content.parties.customer.name}. Sua via assinada está anexada a este e-mail.`,
          `Código de integridade do texto (SHA-256): ${r.content_hash}`,
        ]),
        text: `Sua via do contrato ${r.number} assinado está anexada.`,
      });
    const list = this.uniqueTo(messages);
    await this.deliver(
      id,
      r.number,
      {
        event: 'contract.signed',
        contract: {
          id,
          number: r.number,
          customer: content.parties.customer.name,
          customerDocument: content.parties.customer.document,
          store: content.terms.storeName,
          planName: content.terms.planName,
          priceMonthly: content.terms.priceMonthly,
          signedAt: done.toISOString(),
          clientSignedAt: r.signed_at!.toISOString(),
          signerName: r.signer_name,
          signerEmail: r.signer_email,
          signerIp: r.signer_ip,
          countersignedAt: r.countersigned_at?.toISOString() ?? null,
          countersignerName: r.countersigner_name,
          countersignerIp: r.countersigner_ip,
          contentHash: r.content_hash,
          signedPdfSha256: r.signed_pdf_sha256,
          trailSha256: r.trail_sha256,
        },
        notifyEmail: to,
        messages: list,
        attachment: {
          fileName: `contrato-${r.number}-assinado.pdf`,
          mimeType: 'application/pdf',
          base64: r.signed_pdf.toString('base64'),
        },
      },
      list.map((m) => m.to),
    );
  }
}
