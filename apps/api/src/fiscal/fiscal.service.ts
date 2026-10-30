import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { explainFiscalError, FiscalIssue, toCents } from '@comandou/shared';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import type { Ctx } from '../common/context';
import { open, seal } from '../common/secret-box';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { QueueService, TenantJob } from '../queue/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { composeNote, ComposeItem, Operation, Recipient } from './fiscal-compose';
import { FiscalRulesService } from './fiscal-rules.service';
import {
  FiscalKind,
  FocusClient,
  FocusCompanyBody,
  FocusEnvironment,
  FocusResponse,
  FocusUnavailableError,
} from './focus.client';
import { PlanService } from '../plans/plan.service';

export { unitPrice } from './fiscal-compose';

export type FiscalStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'error'
  | 'cancelling'
  | 'cancelled'
  | 'discarded';

export type FiscalMode = 'own' | 'managed';

export interface FiscalSettingsInput {
  enabled?: boolean;
  /** own: o restaurante informa o token da Focus; managed: o Comandou cadastra a empresa (revenda). */
  mode?: FiscalMode;
  environment?: FocusEnvironment;
  cnpj?: string | null;
  /** string grava um token novo; null apaga; ausente mantém. Token antigo, vale nos dois ambientes. */
  token?: string | null;
  /** Token próprio da Focus por ambiente (a Focus dá um para homologação e outro para produção). */
  tokenHomolog?: string | null;
  tokenProd?: string | null;
  defaultCfop?: string;
  defaultCode?: string;
  defaultNcm?: string | null;
  /** Obrigatório (true) para mudar para produção. */
  confirmProduction?: boolean;
  nfeEnabled?: boolean;
  nfceNature?: string;
  nfeNature?: string;
  additionalInfo?: string | null;
  autoEmitNfce?: boolean;
  emailCustomer?: boolean;
}

/** Dados cadastrais do emitente (vão para a Focus e ficam no banco, sem segredos). */
export interface FiscalCompany {
  nome: string;
  nomeFantasia?: string | null;
  inscricaoEstadual: string;
  inscricaoMunicipal?: string | null;
  /** 1 Simples Nacional; 2 Simples com excesso de sublimite; 3 Regime normal; 4 MEI. */
  regimeTributario: 1 | 2 | 3 | 4;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  email?: string | null;
  telefone?: string | null;
  /** CPF ou CNPJ do escritório de contabilidade (alguns estados exigem para liberar o XML). */
  contabilidade?: string | null;
  /** Série e próximo número em produção (para continuar a numeração de outro sistema). */
  numeracao?: {
    nfceSerie?: number | null;
    nfceProximo?: number | null;
    nfeSerie?: number | null;
    nfeProximo?: number | null;
  } | null;
}

export interface FiscalCompanyInput {
  cnpj: string;
  company: FiscalCompany;
  /** Certificado A1 (.pfx/.p12) em base64 e a senha. Vão direto para a Focus, nunca para o banco. */
  certificate?: { base64: string; password: string };
  /** CSC da NFC-e (gerado no site da SEFAZ do estado), por ambiente. */
  csc?: {
    homologacao?: { id: string; csc: string };
    producao?: { id: string; csc: string };
  };
}

export interface SettingsRow {
  enabled: boolean;
  mode: FiscalMode;
  focus_company_id: string | null;
  token_homolog_enc: Buffer | null;
  token_prod_enc: Buffer | null;
  company: FiscalCompany | null;
  certificate_valid_until: Date | null;
  csc_homolog_set: boolean;
  csc_prod_set: boolean;
  focus_synced_at: Date | null;
  environment: FocusEnvironment;
  cnpj: string | null;
  token_enc: Buffer | null;
  token_last4: string | null;
  default_cfop: string;
  default_code: string;
  default_ncm: string | null;
  updated_at: Date | null;
  nfe_enabled: boolean;
  nfce_nature: string;
  nfe_nature: string;
  additional_info: string | null;
  auto_emit_nfce: boolean;
  email_customer: boolean;
  received_version: string;
  received_synced_at: Date | null;
}

interface DocRow {
  id: string;
  order_id: string;
  kind: FiscalKind;
  ref: string;
  environment: FocusEnvironment;
  status: FiscalStatus;
  attempts: number;
  request_payload: Record<string, unknown>;
  cancel_reason: string | null;
  recipient: Recipient | null;
  operation: Operation | null;
  customer_id: string | null;
  number: string | null;
}

const SETTINGS_COLS = `enabled, environment, cnpj, token_enc, token_last4, default_cfop, default_code,
  default_ncm, updated_at, mode, focus_company_id, token_homolog_enc, token_prod_enc, company,
  certificate_valid_until, csc_homolog_set, csc_prod_set, focus_synced_at, nfe_enabled, nfce_nature,
  nfe_nature, additional_info, auto_emit_nfce, email_customer, received_version::text, received_synced_at`;

const DOC_COLS = `id, order_id, kind, ref, environment, status, attempts, request_payload, cancel_reason,
  recipient, operation, customer_id, number`;

/** Contexto do valor cifrado: um token não decifra se for trocado de ambiente ou de restaurante. */
const tokenContext = (tenantId: string, kind: 'own' | FocusEnvironment) =>
  kind === 'own' ? `focus:${tenantId}` : `focus-${kind}:${tenantId}`;

/**
 * Token cifrado para o ambiente e o contexto que o abre. Os dois modos guardam um token por
 * ambiente; no modo próprio, o token antigo (um só) continua valendo quando falta o do ambiente.
 */
function sealedToken(s: SettingsRow, e: FocusEnvironment) {
  const byEnv = e === 'producao' ? s.token_prod_enc : s.token_homolog_enc;
  if (byEnv) return { sealed: byEnv, kind: e } as const;
  if (s.mode === 'own' && s.token_enc) return { sealed: s.token_enc, kind: 'own' } as const;
  return null;
}

/** Tem token para emitir neste ambiente, no modo atual? */
function hasTokenFor(s: SettingsRow | undefined, e: FocusEnvironment) {
  return !!s && !!sealedToken(s, e);
}

const DOC_SELECT = `
  SELECT d.id, d.order_id AS "orderId", o.number AS "orderNumber", o.channel AS "orderChannel",
         d.kind, d.ref, d.environment,
         d.status, d.attempts, d.total::text, d.sefaz_status AS "sefazStatus", d.sefaz_message AS "sefazMessage",
         d.access_key AS "accessKey", d.number, d.series, d.xml_path AS "xmlPath", d.danfe_path AS "danfePath",
         d.qrcode_url AS "qrcodeUrl", d.cancel_reason AS "cancelReason", d.last_error AS "lastError",
         d.issues, d.recipient, d.customer_id AS "customerId", d.protocol,
         coalesce(d.recipient->>'name', o.customer_name) AS "recipientName",
         d.created_at AS "createdAt", d.updated_at AS "updatedAt", d.authorized_at AS "authorizedAt",
         d.cancelled_at AS "cancelledAt", d.discarded_at AS "discardedAt", d.discard_reason AS "discardReason"
    FROM fiscal_documents d JOIN orders o ON o.id = d.order_id`;

/** Estados "vivos": a venda já tem nota (ou rascunho) e não recebe outra. */
export const LIVE_STATUSES: FiscalStatus[] = [
  'draft',
  'pending',
  'processing',
  'authorized',
  'cancelling',
];
/** Estados em que a nota ainda pode ser corrigida e reemitida. */
const EDITABLE: FiscalStatus[] = ['draft', 'rejected', 'error'];
const EMIT_JOB = 'fiscal.emit';
const CHECK_JOB = 'fiscal.check';
/** Consultas de uma nota "em processamento": 2s, 4s, 8s... (~8 min no total). */
const CHECK_ATTEMPTS = 8;
const KIND_LABEL: Record<FiscalKind, string> = { nfce: 'NFC-e', nfe: 'NF-e' };

/** O que pode vir no pedido de NFC-e pelo caixa (CPF na nota). */
export interface NfceRequest {
  cpf?: string | null;
  cnpj?: string | null;
  name?: string | null;
}

/** Edição de uma nota em rascunho, rejeitada ou com erro. */
export interface DocumentPatch {
  recipient?: Recipient | null;
  customerId?: string | null;
  operation?: Partial<Omit<Operation, 'lines'>>;
}

/**
 * Notas fiscais pela Focus NFe: NFC-e (modelo 65, cupom do consumidor) e NF-e (modelo 55, nota de
 * produto com destinatário identificado).
 *
 * O Postgres é a fonte da verdade: a requisição grava o documento com o conteúdo congelado e só
 * depois enfileira "fiscal.emit" com {tenantId, documentId}. O consumidor relê tudo do banco dentro
 * do tenant (RLS) antes de chamar a Focus. A referência enviada é fixa por documento ("pm-<id>"):
 * repetir o envio nunca gera duas notas, e reemitir uma nota rejeitada usa a mesma referência (a
 * Focus reaproveita o número). Problemas que dá para ver antes (item sem padrão fiscal, delivery
 * sem CPF) deixam a nota em "erro" com a explicação, sem gastar uma chamada na SEFAZ.
 */
@Injectable()
export class FiscalService implements OnModuleInit {
  private readonly logger = new Logger('Fiscal');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly focus: FocusClient,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly plans: PlanService,
    private readonly rules: FiscalRulesService,
    private readonly cash: CashService,
  ) {}

  onModuleInit() {
    this.cash.onOrderPaid((ctx, orderId) => this.autoEmit(ctx, orderId));
    this.queue.register(EMIT_JOB, (d, attempt, final) => this.runEmit(d, attempt, final));
    this.queue.register(CHECK_JOB, (d, attempt, final) => this.runCheck(d, attempt, final));
  }

  // ------------------------------------------------------------------ configuração
  async settingsRow(tx: Tx) {
    return one<SettingsRow>(tx, `SELECT ${SETTINGS_COLS} FROM tenant_fiscal_settings`);
  }

  private present(s: SettingsRow | undefined) {
    return {
      enabled: s?.enabled ?? false,
      mode: s?.mode ?? 'own',
      /** O servidor tem o token master da Focus (cadastro guiado da empresa disponível)? */
      managedAvailable: this.focus.masterAvailable,
      company: s?.company ?? null,
      focusRegistered: !!s?.focus_company_id,
      hasHomologToken: !!s && hasTokenFor(s, 'homologacao'),
      hasProdToken: !!s && hasTokenFor(s, 'producao'),
      cscHomolog: s?.csc_homolog_set ?? false,
      cscProd: s?.csc_prod_set ?? false,
      certificateValidUntil: s?.certificate_valid_until ?? null,
      focusSyncedAt: s?.focus_synced_at ?? null,
      environment: s?.environment ?? 'homologacao',
      cnpj: s?.cnpj ?? null,
      hasToken: !!s?.token_enc,
      tokenLast4: s?.token_last4 ?? null,
      defaultCfop: s?.default_cfop ?? '5102',
      defaultCode: s?.default_code ?? '102',
      defaultNcm: s?.default_ncm ?? null,
      updatedAt: s?.updated_at ?? null,
      nfeEnabled: s?.nfe_enabled ?? false,
      nfceNature: s?.nfce_nature ?? 'VENDA AO CONSUMIDOR',
      nfeNature: s?.nfe_nature ?? 'VENDA DE MERCADORIA',
      additionalInfo: s?.additional_info ?? null,
      autoEmitNfce: s?.auto_emit_nfce ?? false,
      emailCustomer: s?.email_customer ?? false,
      regime: s?.company?.regimeTributario ?? null,
      receivedSyncedAt: s?.received_synced_at ?? null,
      /** O servidor tem a chave que cifra o token? Sem ela não dá para salvar token. */
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
    };
  }

  getSettings(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => this.present(await this.settingsRow(tx)));
  }

  async saveSettings(ctx: Ctx, b: FiscalSettingsInput) {
    const r = await this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `INSERT INTO tenant_fiscal_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [ctx.tenantId],
      );
      const cur = (await one<SettingsRow>(
        tx,
        `SELECT ${SETTINGS_COLS} FROM tenant_fiscal_settings FOR UPDATE`,
      ))!;
      if (b.environment === 'producao' && cur.environment !== 'producao') {
        if (ctx.user.role !== 'owner')
          throw new ForbiddenException('Só o dono do restaurante muda a emissão para produção');
        if (b.confirmProduction !== true)
          throw new UnprocessableEntityException(
            'Confirme a mudança para produção: as notas passam a ter valor fiscal',
          );
      }
      const mode = b.mode ?? cur.mode;
      if (mode === 'managed' && cur.mode !== 'managed' && !this.focus.masterAvailable)
        throw new UnprocessableEntityException(
          'O cadastro guiado da Focus NFe não está disponível neste servidor',
        );
      let tokenEnc = cur.token_enc;
      let last4 = cur.token_last4;
      if (b.token !== undefined) {
        if (b.token === null) {
          tokenEnc = null;
          last4 = null;
        } else {
          if (!this.env.INTEGRATIONS_KEY)
            throw new UnprocessableEntityException(
              'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
            );
          tokenEnc = seal(this.env.INTEGRATIONS_KEY, b.token, tokenContext(ctx.tenantId, 'own'));
          last4 = b.token.slice(-4);
        }
      }
      // Tokens por ambiente (modo próprio): string grava, null apaga, ausente mantém.
      const envToken = (v: string | null | undefined, e: FocusEnvironment, cur: Buffer | null) => {
        if (v === undefined) return cur;
        if (v === null) return null;
        if (!this.env.INTEGRATIONS_KEY)
          throw new UnprocessableEntityException(
            'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
          );
        return seal(this.env.INTEGRATIONS_KEY, v, tokenContext(ctx.tenantId, e));
      };
      const homologEnc = envToken(b.tokenHomolog, 'homologacao', cur.token_homolog_enc);
      const prodEnc = envToken(b.tokenProd, 'producao', cur.token_prod_enc);
      const next = {
        enabled: b.enabled ?? cur.enabled,
        environment: b.environment ?? cur.environment,
        cnpj: b.cnpj !== undefined ? b.cnpj : cur.cnpj,
        defaultCfop: b.defaultCfop ?? cur.default_cfop,
        defaultCode: b.defaultCode ?? cur.default_code,
        defaultNcm: b.defaultNcm !== undefined ? b.defaultNcm : cur.default_ncm,
        nfeEnabled: b.nfeEnabled ?? cur.nfe_enabled,
        nfceNature: b.nfceNature ?? cur.nfce_nature,
        nfeNature: b.nfeNature ?? cur.nfe_nature,
        additionalInfo: b.additionalInfo !== undefined ? b.additionalInfo : cur.additional_info,
        autoEmitNfce: b.autoEmitNfce ?? cur.auto_emit_nfce,
        emailCustomer: b.emailCustomer ?? cur.email_customer,
      };
      const probe = {
        ...cur,
        mode,
        token_enc: tokenEnc,
        token_homolog_enc: homologEnc,
        token_prod_enc: prodEnc,
      };
      if (next.enabled && !next.cnpj)
        throw new UnprocessableEntityException('Para ativar a emissão, informe o CNPJ');
      if (next.enabled && !hasTokenFor(probe, next.environment))
        throw new UnprocessableEntityException(
          mode === 'managed'
            ? `Cadastre a empresa na Focus NFe antes de ativar (${next.environment === 'producao' ? 'produção' : 'homologação'} sem token)`
            : `Para ativar a emissão, informe o token de ${next.environment === 'producao' ? 'produção' : 'homologação'} da Focus NFe`,
        );
      if (
        next.enabled &&
        mode === 'managed' &&
        !(next.environment === 'producao' ? cur.csc_prod_set : cur.csc_homolog_set)
      )
        throw new UnprocessableEntityException(
          `Informe o CSC de ${next.environment === 'producao' ? 'produção' : 'homologação'} da NFC-e antes de ativar`,
        );
      await tx.$client.query(
        `UPDATE tenant_fiscal_settings
            SET enabled=$1, environment=$2, cnpj=$3, token_enc=$4, token_last4=$5, default_cfop=$6,
                default_code=$7, default_ncm=$8, updated_by=$9, mode=$10, nfe_enabled=$11,
                nfce_nature=$12, nfe_nature=$13, additional_info=$14, auto_emit_nfce=$15,
                email_customer=$16, token_homolog_enc=$17, token_prod_enc=$18, updated_at=now()`,
        [
          next.enabled,
          next.environment,
          next.cnpj,
          tokenEnc,
          last4,
          next.defaultCfop,
          next.defaultCode,
          next.defaultNcm,
          ctx.userId,
          mode,
          next.nfeEnabled,
          next.nfceNature,
          next.nfeNature,
          next.additionalInfo,
          next.autoEmitNfce,
          next.emailCustomer,
          homologEnc,
          prodEnc,
        ],
      );
      // Nunca registrar o token na auditoria: só se ele mudou.
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.settings_updated',
        entity: 'tenant_fiscal_settings',
        entityId: ctx.tenantId,
        data: {
          ...next,
          mode,
          tokenChanged:
            b.token !== undefined || b.tokenHomolog !== undefined || b.tokenProd !== undefined,
        },
        ip: ctx.ip,
      });
      return this.present(await this.settingsRow(tx));
    });
    return r;
  }

  // ------------------------------------------------------------------ empresa na Focus (revenda)
  private assertManaged() {
    if (!this.focus.masterAvailable)
      throw new UnprocessableEntityException(
        'O cadastro guiado da Focus NFe não está disponível neste servidor',
      );
  }

  private focusError(b: FocusCompanyBody, http: number) {
    const msg = [b.mensagem, ...(b.erros ?? []).map((e) => e.mensagem)].filter(Boolean).join('; ');
    return msg || `A Focus NFe respondeu ${http}`;
  }

  /** Busca razão social e endereço pelo CNPJ (consulta pública da Focus) para preencher o cadastro. */
  async lookupCnpj(cnpj: string): Promise<Partial<FiscalCompany> & { simples: boolean | null }> {
    this.assertManaged();
    let r: { http: number; body: FocusCompanyBody };
    try {
      r = await this.focus.lookupCnpj(cnpj);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    if (r.http === 404) throw new NotFoundException('CNPJ não encontrado na Receita');
    if (r.http >= 400) throw new UnprocessableEntityException(this.focusError(r.body, r.http));
    const e = r.body.endereco ?? {};
    const street = [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ');
    return {
      nome: r.body.razao_social ?? '',
      logradouro: street,
      numero: e.numero ?? '',
      complemento: e.complemento ?? null,
      bairro: e.bairro ?? '',
      municipio: e.nome_municipio ?? '',
      uf: e.uf ?? '',
      cep: (e.cep ?? '').replace(/\D/g, ''),
      regimeTributario: r.body.optante_mei ? 4 : r.body.optante_simples_nacional ? 1 : 3,
      simples: r.body.optante_simples_nacional ?? null,
    };
  }

  /**
   * Cadastra (ou atualiza) a empresa do restaurante na Focus NFe com o token master do Comandou
   * e guarda, cifrados, os tokens de homologação e de produção que a Focus devolve. O certificado
   * A1, a senha e o CSC passam direto para a Focus: nada disso fica no banco.
   */
  async saveCompany(ctx: Ctx, b: FiscalCompanyInput) {
    this.assertManaged();
    if (!this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar os tokens com segurança',
      );
    const key = this.env.INTEGRATIONS_KEY;
    const cur = await this.db.withTenant(ctx, async (tx) => {
      await this.plans.assertFeature(tx, 'fiscal');
      return this.settingsRow(tx);
    });
    if (!cur?.focus_company_id && !b.certificate)
      throw new UnprocessableEntityException('Envie o certificado digital A1 (.pfx) da empresa');

    const c = b.company;
    const n = c.numeracao ?? {};
    const payload: Record<string, unknown> = {
      nome: c.nome,
      nome_fantasia: c.nomeFantasia || c.nome,
      cnpj: b.cnpj,
      inscricao_estadual: c.inscricaoEstadual,
      ...(c.inscricaoMunicipal ? { inscricao_municipal: c.inscricaoMunicipal } : {}),
      regime_tributario: c.regimeTributario,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento || undefined,
      bairro: c.bairro,
      municipio: c.municipio,
      uf: c.uf,
      cep: c.cep,
      email: c.email || undefined,
      telefone: c.telefone || undefined,
      ...(c.contabilidade ? { cpf_cnpj_contabilidade: c.contabilidade.replace(/\D/g, '') } : {}),
      habilita_nfce: true,
      habilita_nfe: true,
      habilita_manifestacao: true,
      enviar_email_destinatario: false,
      ...(n.nfceSerie ? { serie_nfce_producao: String(n.nfceSerie) } : {}),
      ...(n.nfceProximo ? { proximo_numero_nfce_producao: String(n.nfceProximo) } : {}),
      ...(n.nfeSerie ? { serie_nfe_producao: String(n.nfeSerie) } : {}),
      ...(n.nfeProximo ? { proximo_numero_nfe_producao: String(n.nfeProximo) } : {}),
      ...(b.certificate
        ? {
            arquivo_certificado_base64: b.certificate.base64,
            senha_certificado: b.certificate.password,
          }
        : {}),
      ...(b.csc?.homologacao
        ? {
            id_token_nfce_homologacao: b.csc.homologacao.id,
            csc_nfce_homologacao: b.csc.homologacao.csc,
          }
        : {}),
      ...(b.csc?.producao
        ? {
            id_token_nfce_producao: b.csc.producao.id,
            csc_nfce_producao: b.csc.producao.csc,
          }
        : {}),
    };

    let r: { http: number; body: FocusCompanyBody };
    try {
      r = cur?.focus_company_id
        ? await this.focus.updateCompany(cur.focus_company_id, payload)
        : await this.focus.createCompany(payload);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    if (r.http === 401 || r.http === 403)
      throw new UnprocessableEntityException(
        'A Focus NFe recusou o token master do Comandou: avise o suporte',
      );
    if (r.http >= 400 || r.body.id === undefined || r.body.id === null)
      throw new UnprocessableEntityException(
        `A Focus NFe recusou o cadastro: ${this.focusError(r.body, r.http)}`,
      );

    const companyId = String(r.body.id);
    const tokHom = r.body.token_homologacao || null;
    const tokProd = r.body.token_producao || null;
    const validUntil = r.body.certificado_valido_ate
      ? new Date(r.body.certificado_valido_ate)
      : null;

    return this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `INSERT INTO tenant_fiscal_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [ctx.tenantId],
      );
      await tx.$client.query(
        `UPDATE tenant_fiscal_settings
            SET mode = 'managed', cnpj = $1, focus_company_id = $2, company = $3,
                token_homolog_enc = coalesce($4, token_homolog_enc),
                token_prod_enc = coalesce($5, token_prod_enc),
                certificate_valid_until = coalesce($6, certificate_valid_until),
                csc_homolog_set = csc_homolog_set OR $7, csc_prod_set = csc_prod_set OR $8,
                focus_synced_at = now(), updated_by = $9, updated_at = now()`,
        [
          b.cnpj,
          companyId,
          JSON.stringify(c),
          tokHom ? seal(key, tokHom, tokenContext(ctx.tenantId, 'homologacao')) : null,
          tokProd ? seal(key, tokProd, tokenContext(ctx.tenantId, 'producao')) : null,
          validUntil && !Number.isNaN(validUntil.getTime()) ? validUntil : null,
          !!b.csc?.homologacao,
          !!b.csc?.producao,
          ctx.userId,
        ],
      );
      // Nunca registrar certificado, senha, CSC ou tokens na auditoria.
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: cur?.focus_company_id ? 'fiscal.company_updated' : 'fiscal.company_created',
        entity: 'tenant_fiscal_settings',
        entityId: ctx.tenantId,
        data: {
          cnpj: b.cnpj,
          focusCompanyId: companyId,
          company: c,
          certificateChanged: !!b.certificate,
          cscHomologChanged: !!b.csc?.homologacao,
          cscProdChanged: !!b.csc?.producao,
        },
        ip: ctx.ip,
      });
      return this.present(await this.settingsRow(tx));
    });
  }

  /**
   * Busca na Focus a empresa já cadastrada (modo revenda) e atualiza os tokens e a validade do
   * certificado. Serve para quando o cadastro foi mexido no painel da Focus ou o certificado foi
   * renovado por lá.
   */
  async syncCompany(ctx: Ctx) {
    this.assertManaged();
    if (!this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar os tokens com segurança',
      );
    const key = this.env.INTEGRATIONS_KEY;
    const cur = await this.db.withTenant(ctx, (tx) => this.settingsRow(tx));
    if (!cur?.focus_company_id)
      throw new UnprocessableEntityException('Cadastre a empresa na Focus NFe primeiro');
    let r: { http: number; body: FocusCompanyBody };
    try {
      r = await this.focus.getCompany(cur.focus_company_id);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    if (r.http === 404)
      throw new UnprocessableEntityException(
        'A empresa não foi encontrada na Focus NFe: cadastre de novo em Empresa',
      );
    if (r.http >= 400)
      throw new UnprocessableEntityException(
        `A Focus NFe não respondeu à sincronização: ${this.focusError(r.body, r.http)}`,
      );
    const tokHom = r.body.token_homologacao || null;
    const tokProd = r.body.token_producao || null;
    const validUntil = r.body.certificado_valido_ate
      ? new Date(r.body.certificado_valido_ate)
      : null;
    return this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `UPDATE tenant_fiscal_settings
            SET token_homolog_enc = coalesce($1, token_homolog_enc),
                token_prod_enc = coalesce($2, token_prod_enc),
                certificate_valid_until = coalesce($3, certificate_valid_until),
                focus_synced_at = now(), updated_at = now()`,
        [
          tokHom ? seal(key, tokHom, tokenContext(ctx.tenantId, 'homologacao')) : null,
          tokProd ? seal(key, tokProd, tokenContext(ctx.tenantId, 'producao')) : null,
          validUntil && !Number.isNaN(validUntil.getTime()) ? validUntil : null,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.company_synced',
        entity: 'tenant_fiscal_settings',
        entityId: ctx.tenantId,
        data: { focusCompanyId: cur.focus_company_id },
        ip: ctx.ip,
      });
      return this.present(await this.settingsRow(tx));
    });
  }

  // ------------------------------------------------------------------ consulta
  list(
    ctx: Ctx,
    f: {
      orderId?: string;
      status?: FiscalStatus;
      kind?: FiscalKind;
      from?: string;
      to?: string;
      limit: number;
    },
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q(
        tx,
        `${DOC_SELECT}
          WHERE ($1::uuid IS NULL OR d.order_id = $1)
            AND (CASE WHEN $2::text IS NULL THEN d.status <> 'discarded' ELSE d.status = $2 END)
            AND ($3::text IS NULL OR d.kind = $3)
            AND ($4::date IS NULL OR d.created_at >= $4::date)
            AND ($5::date IS NULL OR d.created_at < $5::date + 1)
          ORDER BY d.created_at DESC LIMIT $6`,
        [
          f.orderId ?? null,
          f.status ?? null,
          f.kind ?? null,
          f.from ?? null,
          f.to ?? null,
          f.limit,
        ],
      );
      return rows.map((r) => this.withUrls(r));
    });
  }

  async get(ctx: Ctx, id: string) {
    const r = await this.db.withTenant(ctx, (tx) => one(tx, `${DOC_SELECT} WHERE d.id = $1`, [id]));
    if (!r) throw new NotFoundException('Nota não encontrada');
    return this.withUrls(r);
  }

  /** Detalhe completo: venda, destinatário, itens com o padrão fiscal, pagamentos e eventos. */
  async detail(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `${DOC_SELECT} WHERE d.id = $1`, [id]);
      if (!r) throw new NotFoundException('Nota não encontrada');
      const raw = (await one<{
        request_payload: Record<string, unknown>;
        operation: Operation | null;
      }>(tx, `SELECT request_payload, operation FROM fiscal_documents WHERE id = $1`, [id]))!;
      const order = await one(
        tx,
        `SELECT o.id, o.number, o.channel, o.source, o.status, o.created_at AS "createdAt",
                o.subtotal::text, o.discount::text, o.surcharge::text, o.delivery_fee::text AS "deliveryFee",
                o.total::text, o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
                o.delivery_address AS "deliveryAddress", o.customer_id AS "customerId",
                coalesce((SELECT sum(p.amount - p.refunded_amount) FROM payments p WHERE p.order_id = o.id), 0)::text AS paid,
                coalesce((SELECT sum(p.tendered - p.amount) FROM payments p WHERE p.order_id = o.id AND p.tendered IS NOT NULL), 0)::text AS change
           FROM orders o WHERE o.id = $1`,
        [r.orderId],
      );
      const events = await q(
        tx,
        `SELECT id, kind, sequence, text, status, sefaz_status AS "sefazStatus", sefaz_message AS "sefazMessage",
                xml_path AS "xmlPath", pdf_path AS "pdfPath", created_at AS "createdAt"
           FROM fiscal_events WHERE document_id = $1 ORDER BY created_at`,
        [id],
      );
      const env = r.environment as FocusEnvironment;
      const payload = raw.request_payload ?? {};
      const items = (Array.isArray(payload.items) ? payload.items : []) as Record<string, string>[];
      const lines = raw.operation?.lines ?? [];
      return {
        ...this.withUrls(r),
        operation: raw.operation ? { ...raw.operation, lines: undefined } : null,
        order,
        nature: payload.natureza_operacao ?? null,
        presence: payload.presenca_comprador ?? null,
        localDestino: payload.local_destino ?? null,
        info: payload.informacoes_adicionais_contribuinte ?? null,
        items: items.map((it, n) => ({
          number: Number(it.numero_item ?? n + 1),
          name: it.descricao,
          quantity: it.quantidade_comercial,
          unitPrice: it.valor_unitario_comercial,
          total: it.valor_bruto,
          discount: it.valor_desconto ?? null,
          other: it.valor_outras_despesas ?? null,
          freight: it.valor_frete ?? null,
          ncm: it.codigo_ncm ?? null,
          cest: it.cest ?? null,
          cfop: it.cfop,
          cst: it.icms_situacao_tributaria,
          origin: it.icms_origem,
          pisCst: it.pis_situacao_tributaria ?? null,
          cofinsCst: it.cofins_situacao_tributaria ?? null,
          icmsValue: it.icms_valor ?? '0.00',
          ipiValue: it.ipi_valor ?? '0.00',
          cbsValue: it.cbs_valor ?? null,
          ibsValue: it.ibs_valor_total ?? null,
          approxTaxes: it.valor_total_tributos ?? null,
          itemId: lines[n]?.itemId ?? null,
          productId: lines[n]?.productId ?? it.codigo_produto,
          ruleId: lines[n]?.ruleId ?? null,
          ruleCode: lines[n]?.ruleCode ?? null,
          ruleName: lines[n]?.ruleName ?? null,
          ruleSource: lines[n]?.source ?? null,
        })),
        payments: ((payload.formas_pagamento ?? []) as Record<string, string>[]).map((p) => ({
          code: p.forma_pagamento,
          amount: p.valor_pagamento,
        })),
        events: events.map((e) => ({
          ...e,
          xmlUrl: this.focus.fileUrl(env, (e.xmlPath as string) ?? null),
          pdfUrl: this.focus.fileUrl(env, (e.pdfPath as string) ?? null),
        })),
      };
    });
  }

  private withUrls(r: Record<string, unknown>) {
    const env = r.environment as FocusEnvironment;
    const { xmlPath, danfePath, ...rest } = r as Record<string, unknown> & { status: FiscalStatus };
    return {
      ...rest,
      issues: this.explain(r),
      xmlUrl: this.focus.fileUrl(env, (xmlPath as string) ?? null),
      danfeUrl: this.focus.fileUrl(env, (danfePath as string) ?? null),
    };
  }

  /** Problemas da nota em palavras simples (os gravados ou os deduzidos da resposta da SEFAZ). */
  private explain(r: Record<string, unknown>): FiscalIssue[] {
    const saved = r.issues as FiscalIssue[] | null;
    if (saved?.length) return saved;
    if (r.status === 'rejected')
      return [
        explainFiscalError(r.sefazStatus as string, (r.sefazMessage ?? r.lastError) as string),
      ];
    if (r.status === 'error' && r.lastError)
      return [{ title: 'Não foi possível emitir', detail: String(r.lastError), fix: 'retry' }];
    return [];
  }

  // ------------------------------------------------------------------ montagem
  /** Lê o pedido e monta a nota (conteúdo + problemas) com o destinatário e a operação dados. */
  private async compose(
    tx: Tx,
    kind: FiscalKind,
    orderId: string,
    s: SettingsRow,
    recipient: Recipient | null,
    operation: Operation,
  ) {
    const o = (await one<{
      channel: string;
      source: string;
      subtotal: string;
      discount: string;
      surcharge: string;
      delivery_fee: string;
      total: string;
    }>(
      tx,
      `SELECT channel, source, subtotal::text, discount::text, surcharge::text, delivery_fee::text, total::text
         FROM orders WHERE id = $1`,
      [orderId],
    ))!;
    const rows = await q<{
      id: string;
      product_id: string;
      name: string;
      quantity: string;
      total: string;
      ncm: string | null;
      cest: string | null;
      cfop: string | null;
      fiscal_code: string | null;
      fiscal_origin: number | null;
      fiscal_unit: string | null;
      fiscal_rule_id: string | null;
    }>(
      tx,
      `SELECT i.id, i.product_id, i.name, i.quantity::text, i.total::text,
              p.ncm, p.cest, p.cfop, p.fiscal_code, p.fiscal_origin, p.fiscal_unit, p.fiscal_rule_id
         FROM order_items i JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1 AND i.status <> 'cancelled' AND i.total > 0
        ORDER BY i.created_at, i.id`,
      [orderId],
    );
    const resolved = await this.rules.resolve(
      tx,
      kind,
      rows.map((r) => ({
        productId: r.product_id,
        ncm: r.ncm ?? s.default_ncm,
        ruleId: operation.lineRules?.[r.id] ?? r.fiscal_rule_id,
      })),
    );
    // Com padrões fiscais cadastrados, todo item precisa resolver um; sem nenhum, valem os códigos antigos.
    const strict = !!(await one(tx, `SELECT 1 FROM fiscal_rules WHERE active LIMIT 1`));
    const items: ComposeItem[] = rows.map((r, n) => ({
      id: r.id,
      productId: r.product_id,
      name: r.name,
      quantity: r.quantity,
      totalCents: toCents(r.total),
      ncm: r.ncm,
      cest: r.cest,
      unit: r.fiscal_unit,
      legacyCfop: r.cfop,
      legacyCode: r.fiscal_code,
      origin: r.fiscal_origin,
      rule: resolved.items[n].rule,
      source: resolved.items[n].source,
    }));
    const payments = await q<{ method: string; net: string }>(
      tx,
      `SELECT method, sum(amount - refunded_amount)::text AS net FROM payments
        WHERE order_id = $1 GROUP BY method HAVING sum(amount - refunded_amount) > 0 ORDER BY method`,
      [orderId],
    );
    const res = composeNote({
      kind,
      cnpj: s.cnpj ?? '',
      issuerUf: s.company?.uf ?? null,
      regime: s.company?.regimeTributario ?? null,
      order: {
        channel: o.channel,
        source: o.source,
        subtotalCents: toCents(o.subtotal),
        discountCents: toCents(o.discount),
        surchargeCents: toCents(o.surcharge),
        deliveryFeeCents: toCents(o.delivery_fee),
        totalCents: toCents(o.total),
      },
      items,
      payments,
      settings: {
        defaultCfop: s.default_cfop,
        defaultCode: s.default_code,
        defaultNcm: s.default_ncm,
        nature: kind === 'nfe' ? s.nfe_nature : s.nfce_nature,
        additionalInfo: s.additional_info,
        strictRules: strict,
      },
      recipient,
      operation,
    });
    return { ...res, total: o.total, operation: { ...operation, lines: res.lines } };
  }

  /** Destinatário a partir do cadastro do cliente (e do endereço da entrega). */
  private async recipientFromCustomer(
    tx: Tx,
    customerId: string | null,
    order?: { customer_name: string | null; customer_phone: string | null },
  ): Promise<Recipient | null> {
    if (!customerId)
      return order?.customer_name ? { name: order.customer_name, ieIndicator: 9 } : null;
    const c = await one<{
      name: string;
      phone: string;
      email: string | null;
      document: string | null;
      state_registration: string | null;
      ie_indicator: number | null;
    }>(
      tx,
      `SELECT name, phone, email, document, state_registration, ie_indicator FROM customers WHERE id = $1`,
      [customerId],
    );
    if (!c) return null;
    const a = await one<{
      street: string;
      number: string | null;
      complement: string | null;
      district: string | null;
      city: string | null;
      state: string | null;
      cep: string | null;
    }>(
      tx,
      `SELECT street, number, complement, district, city, state, cep FROM customer_addresses
        WHERE customer_id = $1 ORDER BY is_default DESC, created_at LIMIT 1`,
      [customerId],
    );
    const doc = c.document ?? '';
    return {
      name: c.name,
      cpf: doc.length === 11 ? doc : null,
      cnpj: doc.length === 14 ? doc : null,
      ie: c.state_registration,
      ieIndicator: (c.ie_indicator as 1 | 2 | 9 | null) ?? 9,
      email: c.email,
      phone: c.phone,
      street: a?.street ?? null,
      number: a?.number ?? null,
      complement: a?.complement ?? null,
      district: a?.district ?? null,
      city: a?.city ?? null,
      state: a?.state ?? null,
      cep: a?.cep ?? null,
    };
  }

  private async assertReady(tx: Tx, kind: FiscalKind) {
    await this.plans.assertFeature(tx, 'fiscal');
    const s = await this.settingsRow(tx);
    if (!s?.enabled || !s.cnpj || !hasTokenFor(s, s.environment))
      throw new UnprocessableEntityException(
        'Emissão fiscal desativada: configure em Fiscal > Configuração',
      );
    if (kind === 'nfe' && !s.nfe_enabled)
      throw new UnprocessableEntityException(
        'A NF-e está desligada: ative em Fiscal > Configuração',
      );
    return s;
  }

  private async assertPaid(tx: Tx, orderId: string) {
    const r = (await one<{ ok: boolean }>(
      tx,
      `SELECT (SELECT coalesce(sum(amount - refunded_amount), 0) FROM payments WHERE order_id = $1)
              = (SELECT total FROM orders WHERE id = $1) AS ok`,
      [orderId],
    ))!;
    if (!r.ok)
      throw new UnprocessableEntityException('A nota só é emitida com o pedido totalmente pago');
  }

  /** Grava uma nota (nova ou reaproveitada) com o conteúdo montado. */
  private async store(
    tx: Tx,
    ctx: Ctx,
    kind: FiscalKind,
    orderId: string,
    s: SettingsRow,
    reuseId: string | null,
    recipient: Recipient | null,
    customerId: string | null,
    operation: Operation,
    target: 'draft' | 'send' | 'hold',
  ) {
    const c = await this.compose(tx, kind, orderId, s, recipient, operation);
    const status: FiscalStatus =
      target === 'draft' ? 'draft' : target === 'hold' || c.issues.length ? 'error' : 'pending';
    const id = reuseId ?? randomUUID();
    if (reuseId) {
      await tx.$client.query(
        `UPDATE fiscal_documents
            SET request_payload = $2, recipient = $3, customer_id = $4, operation = $5, issues = $6,
                status = $7, total = $8, last_error = NULL, sefaz_status = NULL, sefaz_message = NULL,
                provider_status = NULL
          WHERE id = $1`,
        [
          id,
          JSON.stringify(c.payload),
          recipient ? JSON.stringify(recipient) : null,
          customerId,
          JSON.stringify(c.operation),
          c.issues.length ? JSON.stringify(c.issues) : null,
          status,
          c.total,
        ],
      );
    } else {
      await tx.$client.query(
        `INSERT INTO fiscal_documents (id, tenant_id, order_id, kind, ref, environment, total, request_payload,
            created_by, status, recipient, customer_id, operation, issues)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          ctx.tenantId,
          orderId,
          kind,
          `pm-${id}`,
          s.environment,
          c.total,
          JSON.stringify(c.payload),
          ctx.userId,
          status,
          recipient ? JSON.stringify(recipient) : null,
          customerId,
          JSON.stringify(c.operation),
          c.issues.length ? JSON.stringify(c.issues) : null,
        ],
      );
    }
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: reuseId ? `fiscal.${kind}_reissued` : `fiscal.${kind}_requested`,
      entity: 'fiscal_document',
      entityId: id,
      data: {
        orderId,
        environment: s.environment,
        total: c.total,
        status,
        issues: c.issues.map((i) => i.title),
      },
      ip: ctx.ip,
    });
    return { id, status };
  }

  // ------------------------------------------------------------------ emissão
  /**
   * Pede a NFC-e de um pedido pago. Repetir o pedido devolve a nota viva já existente; uma NFC-e
   * rejeitada ou com erro do mesmo pedido é corrigida e reenviada com a mesma referência.
   */
  async request(ctx: Ctx, orderId: string, body: NfceRequest = {}) {
    let send = false;
    let again = false;
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      const live = await one<{ id: string; kind: FiscalKind; status: FiscalStatus }>(
        tx,
        `SELECT id, kind, status FROM fiscal_documents WHERE order_id = $1 AND status = ANY($2) LIMIT 1`,
        [o.id, LIVE_STATUSES],
      );
      if (live && live.kind === 'nfce') return live;
      if (live)
        throw new ConflictException(
          live.status === 'draft'
            ? 'Esta venda tem uma NF-e em rascunho: emita ou apague o rascunho antes'
            : 'Esta venda já tem NF-e: não dá para emitir NFC-e da mesma venda',
        );
      if (o.status === 'cancelled' || o.status === 'cancel_requested')
        throw new ConflictException('Pedido cancelado não recebe nota');
      const s = await this.assertReady(tx, 'nfce');
      await this.assertPaid(tx, o.id);
      const prev = await one<DocRow>(
        tx,
        `SELECT ${DOC_COLS} FROM fiscal_documents
          WHERE order_id = $1 AND kind = 'nfce' AND status IN ('rejected','error')
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [o.id],
      );
      const extra = await one<{
        customer_id: string | null;
        customer_name: string | null;
        customer_phone: string | null;
        channel: string;
        delivery_address: string | null;
        tax_document: string | null;
      }>(
        tx,
        `SELECT customer_id, customer_name, customer_phone, channel, delivery_address, tax_document
           FROM orders WHERE id = $1`,
        [o.id],
      );
      let recipient =
        prev?.recipient ??
        (await this.recipientFromCustomer(tx, extra?.customer_id ?? null, extra ?? undefined));
      // Delivery sem endereço cadastrado: começa pelo endereço digitado no pedido e pela cidade da loja.
      if (!prev && extra?.channel === 'delivery' && !recipient?.street && extra.delivery_address)
        recipient = {
          ...(recipient ?? {}),
          name: recipient?.name ?? extra.customer_name,
          phone: recipient?.phone ?? extra.customer_phone,
          street: extra.delivery_address.slice(0, 60),
          city: recipient?.city ?? s.company?.municipio ?? null,
          state: recipient?.state ?? s.company?.uf ?? null,
        };
      // CPF/CNPJ pedido agora; senão o informado no pagamento (se a nota ainda não tem um).
      const asked =
        !body.cpf && !body.cnpj && extra?.tax_document && !recipient?.cpf && !recipient?.cnpj
          ? extra.tax_document
          : '';
      const cpf = (body.cpf ?? (asked.length === 11 ? asked : '')).replace(/\D/g, '');
      const cnpj = (body.cnpj ?? (asked.length === 14 ? asked : '')).replace(/\D/g, '');
      if (cpf || cnpj || body.name)
        recipient = {
          ...(recipient ?? {}),
          ...(cpf ? { cpf, cnpj: null } : {}),
          ...(cnpj ? { cnpj, cpf: null } : {}),
          ...(body.name ? { name: body.name } : {}),
        };
      const r = await this.store(
        tx,
        ctx,
        'nfce',
        o.id,
        s,
        prev?.id ?? null,
        recipient,
        prev?.customer_id ?? extra?.customer_id ?? null,
        { lineRules: prev?.operation?.lineRules },
        'send',
      );
      send = r.status === 'pending';
      again = !!prev;
      return r;
    });
    // Reemissão da mesma nota: o id do trabalho precisa ser novo, senão a fila descarta como duplicado.
    if (send) await this.enqueue(ctx.tenantId, doc.id, EMIT_JOB, again);
    this.changed(ctx.tenantId, doc.id, orderId);
    return this.get(ctx, doc.id);
  }

  /** Abre a NF-e de um pedido pago como rascunho (destinatário e operação editáveis). */
  async createNfe(ctx: Ctx, orderId: string, body: { customerId?: string | null } = {}) {
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      const live = await one<{ id: string; kind: FiscalKind }>(
        tx,
        `SELECT id, kind FROM fiscal_documents WHERE order_id = $1 AND status = ANY($2) LIMIT 1`,
        [o.id, LIVE_STATUSES],
      );
      if (live && live.kind === 'nfe') return live;
      if (live)
        throw new ConflictException(
          'Esta venda já tem NFC-e: cancele a NFC-e antes de emitir uma NF-e da mesma venda',
        );
      if (o.status === 'cancelled' || o.status === 'cancel_requested')
        throw new ConflictException('Pedido cancelado não recebe nota');
      const s = await this.assertReady(tx, 'nfe');
      await this.assertPaid(tx, o.id);
      const extra = (await one<{
        customer_id: string | null;
        customer_name: string | null;
        customer_phone: string | null;
        channel: string;
        source: string;
      }>(
        tx,
        `SELECT customer_id, customer_name, customer_phone, channel, source FROM orders WHERE id = $1`,
        [o.id],
      ))!;
      const customerId = body.customerId ?? extra.customer_id;
      const recipient = await this.recipientFromCustomer(tx, customerId, extra);
      const operation: Operation = {
        nature: s.nfe_nature,
        purpose: '1',
        presence: extra.channel === 'delivery' ? '4' : extra.source === 'online' ? '2' : '1',
        finalConsumer: recipient?.ieIndicator !== 1,
        info: null,
      };
      return this.store(tx, ctx, 'nfe', o.id, s, null, recipient, customerId, operation, 'draft');
    });
    this.changed(ctx.tenantId, doc.id, orderId);
    return this.detail(ctx, doc.id);
  }

  private async lockEditable(tx: Tx, id: string) {
    const d = await one<DocRow>(
      tx,
      `SELECT ${DOC_COLS} FROM fiscal_documents WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!d) throw new NotFoundException('Nota não encontrada');
    if (!EDITABLE.includes(d.status))
      throw new ConflictException('Só nota em rascunho, rejeitada ou com erro pode ser alterada');
    return d;
  }

  /** Corrige destinatário/operação de uma nota em rascunho, rejeitada ou com erro (sem enviar). */
  async update(ctx: Ctx, id: string, p: DocumentPatch) {
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const d = await this.lockEditable(tx, id);
      const s = (await this.settingsRow(tx))!;
      let recipient = p.recipient !== undefined ? p.recipient : d.recipient;
      let customerId = d.customer_id;
      if (p.customerId !== undefined) {
        customerId = p.customerId;
        if (p.recipient === undefined) recipient = await this.recipientFromCustomer(tx, customerId);
      }
      const { lines: _l, ...prevOp } = d.operation ?? {};
      const operation: Operation = { ...prevOp, ...(p.operation ?? {}) };
      await this.store(
        tx,
        ctx,
        d.kind,
        d.order_id,
        s,
        d.id,
        recipient,
        customerId,
        operation,
        // O rascunho segue rascunho; rejeitada/erro fica "erro" (corrigida, ainda não enviada).
        d.status === 'draft' ? 'draft' : 'hold',
      );
      return d.order_id;
    });
    this.changed(ctx.tenantId, id, orderId);
    return this.detail(ctx, id);
  }

  /** Emite um rascunho ou reemite uma nota rejeitada/com erro, com a mesma referência. */
  async reissue(ctx: Ctx, id: string) {
    let send = false;
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const d = await this.lockEditable(tx, id);
      const s = await this.assertReady(tx, d.kind);
      await this.assertPaid(tx, d.order_id);
      const { lines: _l, ...op } = d.operation ?? {};
      const r = await this.store(
        tx,
        ctx,
        d.kind,
        d.order_id,
        s,
        d.id,
        d.recipient,
        d.customer_id,
        op,
        'send',
      );
      send = r.status === 'pending';
      return d.order_id;
    });
    if (send) await this.enqueue(ctx.tenantId, id, EMIT_JOB, true);
    this.changed(ctx.tenantId, id, orderId);
    return this.detail(ctx, id);
  }

  /** Apaga (descarta) uma nota que não foi autorizada: rascunho, rejeitada ou com erro. */
  async discard(ctx: Ctx, id: string, reason: string | null) {
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const d = await this.lockEditable(tx, id);
      await tx.$client.query(
        `UPDATE fiscal_documents SET status = 'discarded', discarded_at = now(), discard_reason = $2 WHERE id = $1`,
        [id, reason],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: `fiscal.${d.kind}_discarded`,
        entity: 'fiscal_document',
        entityId: id,
        data: { reason, number: d.number },
        ip: ctx.ip,
      });
      return d.order_id;
    });
    this.changed(ctx.tenantId, id, orderId);
    return this.get(ctx, id);
  }

  /** Reenfileira uma nota parada (pendente ou em processamento), por exemplo após queda do Redis. */
  async sync(ctx: Ctx, id: string) {
    const d = await this.get(ctx, id);
    const status = d.status as FiscalStatus;
    if (status === 'pending') await this.enqueue(ctx.tenantId, id, EMIT_JOB, true);
    else if (status === 'processing' || status === 'cancelling')
      await this.enqueue(ctx.tenantId, id, CHECK_JOB, true);
    else throw new ConflictException('Nota sem nada a sincronizar');
    return d;
  }

  /** Emissão automática da NFC-e quando o pedido fica pago (se ligada). Nunca derruba o pagamento. */
  async autoEmit(ctx: Ctx, orderId: string) {
    try {
      const on = await this.db.withTenant(ctx, async (tx) => {
        const s = await this.settingsRow(tx);
        if (!s?.enabled || !s.auto_emit_nfce) return false;
        const r = await one<{ ok: boolean }>(
          tx,
          `SELECT o.status NOT IN ('cancelled','cancel_requested')
                  AND (SELECT coalesce(sum(amount - refunded_amount), 0) FROM payments WHERE order_id = o.id) = o.total
                  AND o.total > 0
                  AND NOT EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.order_id = o.id AND f.status <> 'discarded') AS ok
             FROM orders o WHERE o.id = $1`,
          [orderId],
        );
        return !!r?.ok;
      });
      if (on) await this.request(ctx, orderId);
    } catch (err) {
      this.logger.warn(`emissão automática da NFC-e falhou: ${(err as Error).message}`);
    }
  }

  async enqueue(tenantId: string, documentId: string, job: string, manual = false) {
    try {
      await this.queue.add(
        job,
        { tenantId, documentId },
        {
          // Id fixo evita o mesmo trabalho duplicado na fila; o manual ganha um sufixo próprio.
          jobId: `${job}-${documentId}${manual ? `-${Date.now()}` : ''}`,
          attempts: job === CHECK_JOB ? CHECK_ATTEMPTS : 5,
          delayMs: job === CHECK_JOB ? 3000 : 0,
        },
      );
    } catch (err) {
      // A nota fica "pendente" no banco e pode ser reenviada pela tela (sincronizar).
      this.logger.error(`falha ao enfileirar ${job} ${documentId}: ${(err as Error).message}`);
    }
  }

  changed(tenantId: string, documentId: string, orderId: string) {
    this.realtime.publish(tenantId, { type: 'fiscal.changed', documentId, orderId });
  }

  /** Lê o documento e as credenciais dentro do tenant do trabalho (revalidação no consumidor). */
  private async load(job: TenantJob) {
    const documentId = String(job.documentId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error('trabalho fiscal sem documentId');
    return this.db.withTenant({ tenantId: job.tenantId }, async (tx) => {
      const doc = await one<DocRow>(tx, `SELECT ${DOC_COLS} FROM fiscal_documents WHERE id = $1`, [
        documentId,
      ]);
      const s = await this.settingsRow(tx);
      return { doc, s };
    });
  }

  /** Token para falar com a Focus no ambiente pedido (próprio ou o da empresa cadastrada). */
  token(tenantId: string, s: SettingsRow | undefined, e: FocusEnvironment) {
    if (!s || !this.env.INTEGRATIONS_KEY) return null;
    const t = sealedToken(s, e);
    if (!t) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, t.sealed, tokenContext(tenantId, t.kind));
    } catch {
      return null;
    }
  }

  private async setDoc(
    tenantId: string,
    id: string,
    fields: Record<string, unknown>,
    audit?: string,
  ) {
    const cols = Object.keys(fields);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const row = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ order_id: string; status: string }>(
        tx,
        `UPDATE fiscal_documents SET ${sets} WHERE id = $1 RETURNING order_id, status`,
        [id, ...cols.map((c) => fields[c])],
      );
      if (r && audit)
        await this.audit.record(tx, {
          tenantId,
          action: audit,
          entity: 'fiscal_document',
          entityId: id,
          data: { status: r.status, sefazMessage: fields.sefaz_message ?? null },
        });
      return r;
    });
    if (row) this.changed(tenantId, id, row.order_id);
  }

  /** Aplica o retorno da Focus ao documento. Devolve o novo status. */
  private async apply(tenantId: string, doc: DocRow, res: FocusResponse): Promise<FiscalStatus> {
    const b = res.body;
    const label = doc.kind ?? 'nfce';
    const common = {
      provider_status: b.status ?? null,
      sefaz_status: b.status_sefaz != null ? String(b.status_sefaz) : null,
      sefaz_message: b.mensagem_sefaz ?? null,
      last_error: null,
    };
    switch (b.status) {
      case 'autorizado':
        await this.setDoc(
          tenantId,
          doc.id,
          {
            ...common,
            status: 'authorized',
            issues: null,
            access_key: b.chave_nfe ?? null,
            number: b.numero ?? null,
            series: b.serie ?? null,
            protocol: b.protocolo != null ? String(b.protocolo) : null,
            xml_path: b.caminho_xml_nota_fiscal ?? null,
            danfe_path: b.caminho_danfe ?? null,
            qrcode_url: b.qrcode_url ?? null,
            authorized_at: new Date(),
          },
          `fiscal.${label}_authorized`,
        );
        void this.emailOnAuthorize(tenantId, doc);
        return 'authorized';
      case 'processando_autorizacao':
        await this.setDoc(tenantId, doc.id, { ...common, status: 'processing' });
        return 'processing';
      case 'cancelado':
        await this.setDoc(
          tenantId,
          doc.id,
          {
            ...common,
            status: 'cancelled',
            cancel_reason: doc.cancel_reason ?? 'Cancelada na Focus NFe',
            cancelled_at: new Date(),
          },
          `fiscal.${label}_cancelled`,
        );
        return 'cancelled';
      case 'erro_autorizacao':
      case 'denegado':
        await this.setDoc(
          tenantId,
          doc.id,
          {
            ...common,
            status: 'rejected',
            ...(b.numero ? { number: b.numero, series: b.serie ?? null } : {}),
            issues: JSON.stringify([explainFiscalError(common.sefaz_status, b.mensagem_sefaz)]),
          },
          `fiscal.${label}_rejected`,
        );
        return 'rejected';
      default: {
        const msg = [b.mensagem, ...(b.erros ?? []).map((e) => e.mensagem)]
          .filter(Boolean)
          .join('; ');
        const text = (msg || `HTTP ${res.http}`).slice(0, 500);
        await this.setDoc(
          tenantId,
          doc.id,
          {
            ...common,
            status: 'rejected',
            last_error: text,
            issues: JSON.stringify([explainFiscalError(null, text)]),
          },
          `fiscal.${label}_rejected`,
        );
        return 'rejected';
      }
    }
  }

  /** Manda o DANFE/XML para o e-mail do cliente, se ligado na configuração. */
  private async emailOnAuthorize(tenantId: string, doc: DocRow) {
    try {
      const email = doc.recipient?.email;
      if (!email) return;
      const s = await this.db.withTenant({ tenantId }, (tx) => this.settingsRow(tx));
      if (!s?.email_customer) return;
      const token = this.token(tenantId, s, doc.environment);
      if (!token) return;
      const r = await this.focus.email(doc.environment, token, doc.ref, [email], doc.kind);
      await this.db.withTenant({ tenantId }, (tx) =>
        tx.$client.query(
          `INSERT INTO fiscal_events (tenant_id, document_id, kind, text, status, sefaz_message)
           VALUES ($1, $2, 'email', $3, $4, $5)`,
          [tenantId, doc.id, email, r.http < 300 ? 'sent' : 'error', r.body.mensagem ?? null],
        ),
      );
    } catch (err) {
      this.logger.warn(`e-mail da nota não enviado: ${(err as Error).message}`);
    }
  }

  /** Consumidor de "fiscal.emit": envia a nota para a Focus. */
  async runEmit(job: TenantJob, _attempt: number, final: boolean) {
    const { doc, s } = await this.load(job);
    if (!doc) return this.logger.warn(`documento fiscal não encontrado no tenant do trabalho`);
    if (doc.status === 'processing') return this.enqueue(job.tenantId, doc.id, CHECK_JOB);
    if (doc.status !== 'pending') return; // já resolvido por outro trabalho
    const token = this.token(job.tenantId, s, doc.environment);
    if (!s?.enabled || !token) {
      await this.setDoc(job.tenantId, doc.id, {
        status: 'error',
        last_error: 'Emissão desativada ou token indisponível',
      });
      return;
    }
    await this.setDoc(job.tenantId, doc.id, { attempts: doc.attempts + 1 });
    const payload = { ...doc.request_payload, data_emissao: new Date().toISOString() };
    let res: FocusResponse;
    try {
      res = await this.focus.emit(doc.environment, token, doc.ref, payload, doc.kind);
    } catch (err) {
      if (!(err instanceof FocusUnavailableError)) throw err;
      if (!final) throw err;
      // Não sabemos se a Focus recebeu: consultar pela referência decide (nunca reemitir às cegas).
      await this.setDoc(job.tenantId, doc.id, { status: 'processing', last_error: err.message });
      return this.enqueue(job.tenantId, doc.id, CHECK_JOB);
    }
    if (res.http === 401 || res.http === 403) {
      await this.setDoc(job.tenantId, doc.id, {
        status: 'error',
        last_error: 'Token da Focus NFe recusado: confira em Fiscal > Configuração',
      });
      return;
    }
    if (res.http >= 400 && !res.body.status) {
      // Erro de validação ou referência já usada: a consulta pela referência diz o estado real.
      const cur = await this.focus.get(doc.environment, token, doc.ref, doc.kind).catch(() => null);
      if (cur && cur.http === 200 && cur.body.status) res = cur;
    }
    const st = await this.apply(job.tenantId, doc, res);
    if (st === 'processing') await this.enqueue(job.tenantId, doc.id, CHECK_JOB);
  }

  /** Consumidor de "fiscal.check": consulta a nota pela referência até sair de "processando". */
  async runCheck(job: TenantJob, _attempt: number, final: boolean) {
    const { doc, s } = await this.load(job);
    if (!doc) return;
    if (doc.status !== 'processing' && doc.status !== 'cancelling') return;
    const token = this.token(job.tenantId, s, doc.environment);
    if (!token) {
      await this.setDoc(job.tenantId, doc.id, {
        last_error: 'Token indisponível para consultar a nota',
      });
      return;
    }
    let res: FocusResponse;
    try {
      res = await this.focus.get(doc.environment, token, doc.ref, doc.kind);
    } catch (err) {
      if (final) {
        await this.setDoc(job.tenantId, doc.id, { last_error: (err as Error).message });
        return;
      }
      throw err;
    }
    if (res.http === 404) {
      // A Focus não conhece a referência: nada foi emitido. Libera emitir de novo.
      if (doc.status === 'cancelling')
        await this.setDoc(job.tenantId, doc.id, {
          status: 'authorized',
          last_error: 'Cancelamento não confirmado',
        });
      else
        await this.setDoc(job.tenantId, doc.id, {
          status: 'error',
          last_error: 'A Focus NFe não recebeu a nota; emita de novo',
        });
      return;
    }
    if (doc.status === 'cancelling') {
      if (res.body.status === 'cancelado') await this.apply(job.tenantId, doc, res);
      else if (res.body.status === 'autorizado')
        await this.setDoc(job.tenantId, doc.id, {
          status: 'authorized',
          last_error: 'Cancelamento não confirmado pela SEFAZ',
        });
      return;
    }
    const st = await this.apply(job.tenantId, doc, res);
    if (st === 'processing') {
      if (final) {
        await this.setDoc(job.tenantId, doc.id, {
          last_error: 'SEFAZ ainda processando; use "Atualizar" mais tarde',
        });
        return;
      }
      throw new Error('nota ainda em processamento');
    }
  }

  // ------------------------------------------------------------------ cancelamento
  /** Cancela uma nota autorizada (NFC-e: até 30 minutos; NF-e: até 24 horas, na maioria dos estados). */
  async cancel(ctx: Ctx, id: string, reason: string) {
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const d = await one<DocRow>(
        tx,
        `SELECT ${DOC_COLS} FROM fiscal_documents WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!d) throw new NotFoundException('Nota não encontrada');
      if (d.status !== 'authorized')
        throw new ConflictException('Só nota autorizada pode ser cancelada');
      await tx.$client.query(
        `UPDATE fiscal_documents SET status = 'cancelling', cancel_reason = $2, last_error = NULL WHERE id = $1`,
        [id, reason],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: `fiscal.${d.kind}_cancel_requested`,
        entity: 'fiscal_document',
        entityId: id,
        data: { reason },
        ip: ctx.ip,
      });
      return { ...d, cancel_reason: reason };
    });
    this.changed(ctx.tenantId, id, doc.order_id);
    const s = await this.db.withTenant(ctx, (tx) => this.settingsRow(tx));
    const token = this.token(ctx.tenantId, s, doc.environment);
    if (!token) {
      await this.setDoc(ctx.tenantId, id, {
        status: 'authorized',
        last_error: 'Token indisponível',
      });
      throw new UnprocessableEntityException('Token da Focus NFe indisponível');
    }
    let res: FocusResponse;
    try {
      res = await this.focus.cancel(doc.environment, token, doc.ref, reason, doc.kind);
    } catch (err) {
      if (!(err instanceof FocusUnavailableError)) throw err;
      // Resultado incerto: fica "cancelando" e a consulta decide.
      await this.setDoc(ctx.tenantId, id, { last_error: err.message });
      await this.enqueue(ctx.tenantId, id, CHECK_JOB);
      return this.get(ctx, id);
    }
    if (res.body.status === 'cancelado') {
      await this.apply(ctx.tenantId, doc, res);
      return this.get(ctx, id);
    }
    const msg =
      res.body.mensagem_sefaz ??
      [res.body.mensagem, ...(res.body.erros ?? []).map((e) => e.mensagem)]
        .filter(Boolean)
        .join('; ') ??
      `HTTP ${res.http}`;
    await this.setDoc(ctx.tenantId, id, {
      status: 'authorized',
      cancel_reason: null,
      last_error: `Cancelamento recusado: ${msg}`.slice(0, 500),
    });
    throw new UnprocessableEntityException(`Cancelamento recusado: ${msg || `HTTP ${res.http}`}`);
  }

  // ------------------------------------------------------------------ CC-e e e-mail
  /** Carta de correção de uma NF-e autorizada (texto de 15 a 1000 caracteres, até 20 por nota). */
  async correction(ctx: Ctx, id: string, text: string) {
    const { doc, s, seq } = await this.db.withTenant(ctx, async (tx) => {
      const d = await one<DocRow>(tx, `SELECT ${DOC_COLS} FROM fiscal_documents WHERE id = $1`, [
        id,
      ]);
      if (!d) throw new NotFoundException('Nota não encontrada');
      if (d.kind !== 'nfe') throw new BadRequestException('Carta de correção só existe para NF-e');
      if (d.status !== 'authorized')
        throw new ConflictException('Só NF-e autorizada recebe carta de correção');
      const n = (await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM fiscal_events WHERE document_id = $1 AND kind = 'correction' AND status = 'authorized'`,
        [id],
      ))!.n;
      if (n >= 20) throw new ConflictException('A NF-e já tem 20 cartas de correção (o limite)');
      return { doc: d, s: await this.settingsRow(tx), seq: n + 1 };
    });
    const token = this.token(ctx.tenantId, s, doc.environment);
    if (!token) throw new UnprocessableEntityException('Token da Focus NFe indisponível');
    let res: FocusResponse;
    try {
      res = await this.focus.correction(doc.environment, token, doc.ref, text);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    const ok = res.body.status === 'autorizado';
    const msg =
      res.body.mensagem_sefaz ??
      [res.body.mensagem, ...(res.body.erros ?? []).map((e) => e.mensagem)]
        .filter(Boolean)
        .join('; ');
    await this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `INSERT INTO fiscal_events (tenant_id, document_id, kind, sequence, text, status, sefaz_status,
            sefaz_message, xml_path, pdf_path, created_by)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          ctx.tenantId,
          id,
          res.body.numero_carta_correcao ?? seq,
          text,
          ok ? 'authorized' : 'rejected',
          res.body.status_sefaz != null ? String(res.body.status_sefaz) : null,
          msg || null,
          res.body.caminho_xml_carta_correcao ?? null,
          res.body.caminho_pdf_carta_correcao ?? null,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: ok ? 'fiscal.nfe_corrected' : 'fiscal.nfe_correction_rejected',
        entity: 'fiscal_document',
        entityId: id,
        data: { text, message: msg },
        ip: ctx.ip,
      });
    });
    this.changed(ctx.tenantId, id, doc.order_id);
    if (!ok)
      throw new UnprocessableEntityException(
        `Carta de correção recusada: ${msg || `HTTP ${res.http}`}`,
      );
    return this.detail(ctx, id);
  }

  /** Manda o DANFE e o XML de uma nota autorizada para os e-mails informados (a Focus envia). */
  async email(ctx: Ctx, id: string, emails: string[]) {
    const { doc, s } = await this.db.withTenant(ctx, async (tx) => {
      const d = await one<DocRow>(tx, `SELECT ${DOC_COLS} FROM fiscal_documents WHERE id = $1`, [
        id,
      ]);
      if (!d) throw new NotFoundException('Nota não encontrada');
      if (!['authorized', 'cancelled'].includes(d.status))
        throw new ConflictException('Só nota autorizada ou cancelada pode ser enviada');
      return { doc: d, s: await this.settingsRow(tx) };
    });
    const token = this.token(ctx.tenantId, s, doc.environment);
    if (!token) throw new UnprocessableEntityException('Token da Focus NFe indisponível');
    let res: FocusResponse;
    try {
      res = await this.focus.email(doc.environment, token, doc.ref, emails, doc.kind);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    const ok = res.http < 300;
    await this.db.withTenant(ctx, (tx) =>
      tx.$client.query(
        `INSERT INTO fiscal_events (tenant_id, document_id, kind, text, status, sefaz_message, created_by)
         VALUES ($1,$2,'email',$3,$4,$5,$6)`,
        [
          ctx.tenantId,
          id,
          emails.join(', '),
          ok ? 'sent' : 'error',
          res.body.mensagem ?? null,
          ctx.userId,
        ],
      ),
    );
    if (!ok)
      throw new UnprocessableEntityException(
        `A Focus NFe não enviou o e-mail: ${res.body.mensagem ?? `HTTP ${res.http}`}`,
      );
    return { ok: true };
  }

  /** Rótulo da nota para mensagens (NFC-e / NF-e). */
  static label(kind: FiscalKind) {
    return KIND_LABEL[kind];
  }
}
