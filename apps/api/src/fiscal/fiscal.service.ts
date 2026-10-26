import {
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
import { allocateCents, fromCents, toCents } from '@comandou/shared';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { open, seal } from '../common/secret-box';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { QueueService, TenantJob } from '../queue/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  FocusClient,
  FocusCompanyBody,
  FocusEnvironment,
  FocusResponse,
  FocusUnavailableError,
} from './focus.client';
import { PlanService } from '../plans/plan.service';

export type FiscalStatus =
  'pending' | 'processing' | 'authorized' | 'rejected' | 'error' | 'cancelling' | 'cancelled';

/** Códigos de forma de pagamento da NFC-e (tPag). */
const PAYMENT_CODE: Record<string, string> = {
  cash: '01',
  credit: '03',
  debit: '04',
  voucher: '11',
  pix: '17',
  other: '99',
};

export type FiscalMode = 'own' | 'managed';

export interface FiscalSettingsInput {
  enabled?: boolean;
  /** own: o restaurante informa o token da Focus; managed: o Comandou cadastra a empresa (revenda). */
  mode?: FiscalMode;
  environment?: FocusEnvironment;
  cnpj?: string | null;
  /** string grava um token novo; null apaga; ausente mantém. */
  token?: string | null;
  defaultCfop?: string;
  defaultCode?: string;
  defaultNcm?: string | null;
  /** Obrigatório (true) para mudar para produção. */
  confirmProduction?: boolean;
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

interface SettingsRow {
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
}

interface DocRow {
  id: string;
  order_id: string;
  ref: string;
  environment: FocusEnvironment;
  status: FiscalStatus;
  attempts: number;
  request_payload: Record<string, unknown>;
  cancel_reason: string | null;
}

const SETTINGS_COLS = `enabled, environment, cnpj, token_enc, token_last4, default_cfop, default_code,
  default_ncm, updated_at, mode, focus_company_id, token_homolog_enc, token_prod_enc, company,
  certificate_valid_until, csc_homolog_set, csc_prod_set, focus_synced_at`;

/** Contexto do valor cifrado: um token não decifra se for trocado de ambiente ou de restaurante. */
const tokenContext = (tenantId: string, kind: 'own' | FocusEnvironment) =>
  kind === 'own' ? `focus:${tenantId}` : `focus-${kind}:${tenantId}`;

/** Tem token para emitir neste ambiente, no modo atual? */
function hasTokenFor(s: SettingsRow | undefined, e: FocusEnvironment) {
  if (!s) return false;
  if (s.mode === 'own') return !!s.token_enc;
  return !!(e === 'producao' ? s.token_prod_enc : s.token_homolog_enc);
}

const DOC_SELECT = `
  SELECT d.id, d.order_id AS "orderId", o.number AS "orderNumber", d.kind, d.ref, d.environment,
         d.status, d.attempts, d.total::text, d.sefaz_status AS "sefazStatus", d.sefaz_message AS "sefazMessage",
         d.access_key AS "accessKey", d.number, d.series, d.xml_path AS "xmlPath", d.danfe_path AS "danfePath",
         d.qrcode_url AS "qrcodeUrl", d.cancel_reason AS "cancelReason", d.last_error AS "lastError",
         d.created_at AS "createdAt", d.authorized_at AS "authorizedAt", d.cancelled_at AS "cancelledAt"
    FROM fiscal_documents d JOIN orders o ON o.id = d.order_id`;

export const LIVE_STATUSES: FiscalStatus[] = ['pending', 'processing', 'authorized', 'cancelling'];
const EMIT_JOB = 'fiscal.emit';
const CHECK_JOB = 'fiscal.check';
/** Consultas de uma nota "em processamento": 2s, 4s, 8s... (~8 min no total). */
const CHECK_ATTEMPTS = 8;

/** Preço unitário com até 10 casas: total / quantidade, sem ponto flutuante. */
export function unitPrice(totalCents: number, quantity: string): string {
  const [i, f = ''] = quantity.split('.');
  const milli = BigInt(i) * 1000n + BigInt(f.padEnd(3, '0').slice(0, 3));
  if (milli <= 0n) throw new Error('quantidade inválida');
  // reais * 1e10 = cents * 1e8 ; dividido pela quantidade (em milésimos) => * 1000
  const scaled = (BigInt(totalCents) * 100_000_000n * 1000n * 2n + milli) / (milli * 2n);
  const s = scaled.toString().padStart(11, '0');
  const int = s.slice(0, -10);
  const frac = s.slice(-10).replace(/0+$/, '').padEnd(2, '0');
  return `${int}.${frac}`;
}

/**
 * Nota fiscal ao consumidor (NFC-e) pela Focus NFe.
 *
 * O Postgres é a fonte da verdade: a requisição cria o documento (status "pending") com o
 * conteúdo congelado e só depois enfileira "fiscal.emit" com {tenantId, documentId}. O consumidor
 * relê tudo do banco dentro do tenant (RLS) antes de chamar a Focus. A referência enviada é fixa
 * por documento ("pm-<id>"), então repetir o envio nunca gera duas notas.
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
  ) {}

  onModuleInit() {
    this.queue.register(EMIT_JOB, (d, attempt, final) => this.runEmit(d, attempt, final));
    this.queue.register(CHECK_JOB, (d, attempt, final) => this.runCheck(d, attempt, final));
  }

  // ------------------------------------------------------------------ configuração
  private async settingsRow(tx: Tx) {
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
      hasHomologToken: !!s?.token_homolog_enc,
      hasProdToken: !!s?.token_prod_enc,
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
      const next = {
        enabled: b.enabled ?? cur.enabled,
        environment: b.environment ?? cur.environment,
        cnpj: b.cnpj !== undefined ? b.cnpj : cur.cnpj,
        defaultCfop: b.defaultCfop ?? cur.default_cfop,
        defaultCode: b.defaultCode ?? cur.default_code,
        defaultNcm: b.defaultNcm !== undefined ? b.defaultNcm : cur.default_ncm,
      };
      const probe = { ...cur, mode, token_enc: tokenEnc };
      if (next.enabled && !next.cnpj)
        throw new UnprocessableEntityException('Para ativar a emissão, informe o CNPJ');
      if (next.enabled && !hasTokenFor(probe, next.environment))
        throw new UnprocessableEntityException(
          mode === 'managed'
            ? `Cadastre a empresa na Focus NFe antes de ativar (${next.environment === 'producao' ? 'produção' : 'homologação'} sem token)`
            : 'Para ativar a emissão, informe o CNPJ e o token',
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
                default_code=$7, default_ncm=$8, updated_by=$9, mode=$10, updated_at=now()`,
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
        ],
      );
      // Nunca registrar o token na auditoria: só se ele mudou.
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.settings_updated',
        entity: 'tenant_fiscal_settings',
        entityId: ctx.tenantId,
        data: { ...next, mode, tokenChanged: b.token !== undefined },
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
      habilita_nfce: true,
      enviar_email_destinatario: false,
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

  // ------------------------------------------------------------------ consulta
  list(ctx: Ctx, f: { orderId?: string; status?: FiscalStatus; limit: number }) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q(
        tx,
        `${DOC_SELECT}
          WHERE ($1::uuid IS NULL OR d.order_id = $1) AND ($2::text IS NULL OR d.status = $2)
          ORDER BY d.created_at DESC LIMIT $3`,
        [f.orderId ?? null, f.status ?? null, f.limit],
      );
      return rows.map((r) => this.withUrls(r));
    });
  }

  async get(ctx: Ctx, id: string) {
    const r = await this.db.withTenant(ctx, (tx) => one(tx, `${DOC_SELECT} WHERE d.id = $1`, [id]));
    if (!r) throw new NotFoundException('Nota não encontrada');
    return this.withUrls(r);
  }

  private withUrls(r: Record<string, unknown>) {
    const env = r.environment as FocusEnvironment;
    const { xmlPath, danfePath, ...rest } = r as Record<string, unknown> & { status: FiscalStatus };
    return {
      ...rest,
      xmlUrl: this.focus.fileUrl(env, (xmlPath as string) ?? null),
      danfeUrl: this.focus.fileUrl(env, (danfePath as string) ?? null),
    };
  }

  // ------------------------------------------------------------------ emissão
  /** Monta o conteúdo da NFC-e a partir do pedido (sem data de emissão, que vai no envio). */
  private async buildPayload(tx: Tx, orderId: string, s: SettingsRow) {
    const o = (await one<{
      channel: string;
      subtotal: string;
      discount: string;
      surcharge: string;
      delivery_fee: string;
      total: string;
    }>(
      tx,
      `SELECT channel, subtotal::text, discount::text, surcharge::text, delivery_fee::text, total::text
         FROM orders WHERE id = $1`,
      [orderId],
    ))!;
    const items = await q<{
      product_id: string;
      name: string;
      quantity: string;
      total: string;
      ncm: string | null;
      cfop: string | null;
      fiscal_code: string | null;
      fiscal_origin: number | null;
      fiscal_unit: string | null;
    }>(
      tx,
      `SELECT i.product_id, i.name, i.quantity::text, i.total::text,
              p.ncm, p.cfop, p.fiscal_code, p.fiscal_origin, p.fiscal_unit
         FROM order_items i JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1 AND i.status <> 'cancelled' AND i.total > 0
        ORDER BY i.created_at, i.id`,
      [orderId],
    );
    if (!items.length) throw new UnprocessableEntityException('Pedido sem itens para a nota');
    const totals = items.map((i) => toCents(i.total));
    const itemsSum = totals.reduce((a, b) => a + b, 0);
    if (itemsSum !== toCents(o.subtotal))
      throw new ConflictException('Itens do pedido não conferem com o subtotal');
    const discount = toCents(o.discount);
    if (discount >= itemsSum)
      throw new UnprocessableEntityException('Desconto maior ou igual aos itens não cabe na NFC-e');
    const missing = items.filter((i) => !i.ncm && !s.default_ncm).map((i) => i.name);
    if (missing.length)
      throw new UnprocessableEntityException(
        `Informe o NCM dos produtos (ou um NCM padrão): ${[...new Set(missing)].join(', ')}`,
      );
    // Desconto e acréscimos (taxa de serviço/entrega) rateados pelos itens, sem perder centavo.
    const discounts = allocateCents(discount, totals);
    const others = allocateCents(toCents(o.surcharge) + toCents(o.delivery_fee), totals);

    const payments = await q<{ method: string; net: string }>(
      tx,
      `SELECT method, sum(amount - refunded_amount)::text AS net FROM payments
        WHERE order_id = $1 GROUP BY method HAVING sum(amount - refunded_amount) > 0 ORDER BY method`,
      [orderId],
    );
    const paid = payments.reduce((a, p) => a + toCents(p.net), 0);
    if (paid !== toCents(o.total))
      throw new UnprocessableEntityException('A nota só é emitida com o pedido totalmente pago');

    return {
      cnpj_emitente: s.cnpj,
      natureza_operacao: 'Venda ao consumidor',
      presenca_comprador: o.channel === 'delivery' ? '4' : '1',
      modalidade_frete: '9',
      local_destino: '1',
      items: items.map((i, n) => ({
        numero_item: String(n + 1),
        codigo_produto: i.product_id,
        descricao: i.name.slice(0, 120),
        codigo_ncm: i.ncm ?? s.default_ncm,
        cfop: i.cfop ?? s.default_cfop,
        unidade_comercial: i.fiscal_unit ?? 'UN',
        unidade_tributavel: i.fiscal_unit ?? 'UN',
        quantidade_comercial: i.quantity,
        quantidade_tributavel: i.quantity,
        valor_unitario_comercial: unitPrice(totals[n], i.quantity),
        valor_unitario_tributavel: unitPrice(totals[n], i.quantity),
        valor_bruto: fromCents(totals[n]),
        ...(discounts[n] ? { valor_desconto: fromCents(discounts[n]) } : {}),
        ...(others[n] ? { valor_outras_despesas: fromCents(others[n]) } : {}),
        icms_origem: String(i.fiscal_origin ?? 0),
        icms_situacao_tributaria: i.fiscal_code ?? s.default_code,
      })),
      formas_pagamento: payments.map((p) => ({
        forma_pagamento: PAYMENT_CODE[p.method] ?? '99',
        valor_pagamento: p.net,
      })),
    };
  }

  /** Pede a NFC-e de um pedido pago. Repetir o pedido devolve a nota viva já existente. */
  async request(ctx: Ctx, orderId: string) {
    let created = false;
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      const live = await one<{ id: string }>(
        tx,
        `SELECT id FROM fiscal_documents WHERE order_id = $1 AND status = ANY($2) LIMIT 1`,
        [o.id, LIVE_STATUSES],
      );
      if (live) return live;
      if (o.status === 'cancelled' || o.status === 'cancel_requested')
        throw new ConflictException('Pedido cancelado não recebe nota');
      await this.plans.assertFeature(tx, 'fiscal');
      const s = await this.settingsRow(tx);
      if (!s?.enabled || !s.cnpj || !hasTokenFor(s, s.environment))
        throw new UnprocessableEntityException(
          'Emissão fiscal desativada: configure em Ajustes > Fiscal',
        );
      const payload = await this.buildPayload(tx, o.id, s);
      const id = randomUUID();
      await tx.$client.query(
        `INSERT INTO fiscal_documents (id, tenant_id, order_id, ref, environment, total, request_payload, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          ctx.tenantId,
          o.id,
          `pm-${id}`,
          s.environment,
          o.total,
          JSON.stringify(payload),
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.nfce_requested',
        entity: 'fiscal_document',
        entityId: id,
        data: { orderId: o.id, environment: s.environment, total: o.total },
        ip: ctx.ip,
      });
      created = true;
      return { id };
    });
    if (created) {
      await this.enqueue(ctx.tenantId, doc.id, EMIT_JOB);
      this.changed(ctx.tenantId, doc.id, orderId);
    }
    return this.get(ctx, doc.id);
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

  private async enqueue(tenantId: string, documentId: string, job: string, manual = false) {
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

  private changed(tenantId: string, documentId: string, orderId: string) {
    this.realtime.publish(tenantId, { type: 'fiscal.changed', documentId, orderId });
  }

  /** Lê o documento e as credenciais dentro do tenant do trabalho (revalidação no consumidor). */
  private async load(job: TenantJob) {
    const documentId = String(job.documentId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error('trabalho fiscal sem documentId');
    return this.db.withTenant({ tenantId: job.tenantId }, async (tx) => {
      const doc = await one<DocRow>(
        tx,
        `SELECT id, order_id, ref, environment, status, attempts, request_payload, cancel_reason
           FROM fiscal_documents WHERE id = $1`,
        [documentId],
      );
      const s = await this.settingsRow(tx);
      return { doc, s };
    });
  }

  /** Token para falar com a Focus no ambiente do documento (próprio ou o da empresa cadastrada). */
  private token(tenantId: string, s: SettingsRow | undefined, e: FocusEnvironment) {
    if (!s || !this.env.INTEGRATIONS_KEY) return null;
    const sealed =
      s.mode === 'own' ? s.token_enc : e === 'producao' ? s.token_prod_enc : s.token_homolog_enc;
    if (!sealed) return null;
    try {
      return open(
        this.env.INTEGRATIONS_KEY,
        sealed,
        tokenContext(tenantId, s.mode === 'own' ? 'own' : e),
      );
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
    const common = {
      provider_status: b.status ?? null,
      sefaz_status: b.status_sefaz ?? null,
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
            access_key: b.chave_nfe ?? null,
            number: b.numero ?? null,
            series: b.serie ?? null,
            xml_path: b.caminho_xml_nota_fiscal ?? null,
            danfe_path: b.caminho_danfe ?? null,
            qrcode_url: b.qrcode_url ?? null,
            authorized_at: new Date(),
          },
          'fiscal.nfce_authorized',
        );
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
          'fiscal.nfce_cancelled',
        );
        return 'cancelled';
      case 'erro_autorizacao':
      case 'denegado':
        await this.setDoc(
          tenantId,
          doc.id,
          { ...common, status: 'rejected' },
          'fiscal.nfce_rejected',
        );
        return 'rejected';
      default: {
        const msg = [b.mensagem, ...(b.erros ?? []).map((e) => e.mensagem)]
          .filter(Boolean)
          .join('; ');
        await this.setDoc(
          tenantId,
          doc.id,
          { ...common, status: 'rejected', last_error: (msg || `HTTP ${res.http}`).slice(0, 500) },
          'fiscal.nfce_rejected',
        );
        return 'rejected';
      }
    }
  }

  /** Consumidor de "fiscal.emit": envia a NFC-e para a Focus. */
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
      res = await this.focus.emit(doc.environment, token, doc.ref, payload);
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
        last_error: 'Token da Focus NFe recusado: confira em Ajustes > Fiscal',
      });
      return;
    }
    if (res.http >= 400 && !res.body.status) {
      // Erro de validação ou referência já usada: a consulta pela referência diz o estado real.
      const cur = await this.focus.get(doc.environment, token, doc.ref).catch(() => null);
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
      res = await this.focus.get(doc.environment, token, doc.ref);
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
  /** Cancela uma NFC-e autorizada (a SEFAZ aceita até 30 minutos após a autorização). */
  async cancel(ctx: Ctx, id: string, reason: string) {
    const doc = await this.db.withTenant(ctx, async (tx) => {
      const d = await one<DocRow>(
        tx,
        `SELECT id, order_id, ref, environment, status, attempts, request_payload, cancel_reason
           FROM fiscal_documents WHERE id = $1 FOR UPDATE`,
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
        action: 'fiscal.nfce_cancel_requested',
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
      res = await this.focus.cancel(doc.environment, token, doc.ref, reason);
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
}
