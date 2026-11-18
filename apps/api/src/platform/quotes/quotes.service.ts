import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  type FiscalCosts,
  fiscalCostClause,
  fiscalEstimate,
  fromCents,
  toCents,
} from '@comandou/shared';
import { PlatformDb, platformAudit } from '../platform-db.service';
import type { Actor } from '../platform.service';
import type { NewQuoteInput, QuoteSettingsInput } from '../platform.schemas';
import {
  type ExtraCost,
  implementationSteps,
  planIncluded,
  quoteClauses,
  type QuoteContent,
} from './quote-content';
import { renderQuotePdf } from './quote-pdf';

interface SettingsRow {
  fiscal_mode: 'passthrough' | 'included';
  fiscal_monthly: string;
  fiscal_nfce_included: number;
  fiscal_nfe_included: number;
  fiscal_nfce_extra: string;
  fiscal_nfe_extra: string;
  setup_fee: string;
  validity_days: number;
  extra_costs: ExtraCost[];
  notes: string;
  updated_at: Date;
}

interface PlanRow {
  id: string;
  name: string;
  price: string;
  trial_days: number;
  max_users: number | null;
  max_products: number | null;
  max_orders_month: number | null;
  feature_fiscal: boolean;
  feature_whatsapp: boolean;
  feature_custom_domain: boolean;
}

/** numeric do Postgres sem zeros à direita além de 2 casas ("0.160" → "0.16", "0.055"). */
const trimNum = (v: string) => {
  const [i, f = ''] = v.split('.');
  const t = f.replace(/0+$/, '').padEnd(2, '0');
  return `${i}.${t}`;
};

export function toFiscalCosts(r: SettingsRow): FiscalCosts {
  return {
    mode: r.fiscal_mode,
    monthly: trimNum(r.fiscal_monthly),
    nfceIncluded: r.fiscal_nfce_included,
    nfeIncluded: r.fiscal_nfe_included,
    nfceExtra: trimNum(r.fiscal_nfce_extra),
    nfeExtra: trimNum(r.fiscal_nfe_extra),
  };
}

/** Lê os valores do orçamento (também usados pelo contrato). */
export async function loadQuoteSettings(db: Pick<PlatformDb, 'query'>): Promise<SettingsRow> {
  const [r] = await db.query<SettingsRow>(
    `SELECT fiscal_mode, fiscal_monthly::text AS fiscal_monthly, fiscal_nfce_included,
            fiscal_nfe_included, fiscal_nfce_extra::text AS fiscal_nfce_extra,
            fiscal_nfe_extra::text AS fiscal_nfe_extra, setup_fee::text AS setup_fee,
            validity_days, extra_costs, notes, updated_at
       FROM platform_quote_settings WHERE id`,
  );
  return r!;
}

/** Orçamentos do Super Admin: valores padrão, histórico e o PDF. */
@Injectable()
export class QuotesService {
  constructor(private readonly db: PlatformDb) {}

  private settingsView(r: SettingsRow) {
    return {
      fiscal: toFiscalCosts(r),
      setupFee: trimNum(r.setup_fee),
      validityDays: r.validity_days,
      extraCosts: r.extra_costs,
      notes: r.notes,
      updatedAt: r.updated_at,
    };
  }

  /** Plano oferecido: o padrão; sem padrão, o ativo mais barato. */
  private async plan(): Promise<PlanRow | undefined> {
    return (
      await this.db.query<PlanRow>(
        `SELECT id, name, price_monthly::text AS price, trial_days, max_users, max_products,
                max_orders_month, feature_fiscal, feature_whatsapp, feature_custom_domain
           FROM plans WHERE active ORDER BY is_default DESC, price_monthly, name LIMIT 1`,
      )
    )[0];
  }

  private async onlinePay() {
    const [r] = await this.db.query<{ enabled: boolean; percent: string; fixed: string }>(
      `SELECT enabled, fee_percent::text AS percent, fee_fixed::text AS fixed
         FROM platform_online_pay_settings WHERE id`,
    );
    return r?.enabled ? { percent: r.percent, fixed: r.fixed } : null;
  }

  /** Tudo que a tela precisa: valores padrão, plano, contratada e os últimos orçamentos. */
  async overview() {
    const [s, plan, pay, provider, quotes] = await Promise.all([
      loadQuoteSettings(this.db),
      this.plan(),
      this.onlinePay(),
      this.db.query<{ name: string; document: string }>(
        `SELECT provider_name AS name, provider_document AS document FROM platform_contract_settings WHERE id`,
      ),
      this.db.query<{
        id: string;
        number: string;
        clientName: string;
        totalMonthly: string;
        createdAt: Date;
        createdBy: string | null;
      }>(
        `SELECT q.id, q.number, q.client_name AS "clientName", q.total_monthly::text AS "totalMonthly",
                q.created_at AS "createdAt", a.name AS "createdBy"
           FROM platform_quotes q LEFT JOIN platform_admins a ON a.id = q.created_by
          ORDER BY q.created_at DESC LIMIT 50`,
      ),
    ]);
    return {
      settings: this.settingsView(s),
      plan: plan
        ? {
            name: plan.name,
            priceMonthly: plan.price,
            trialDays: plan.trial_days,
            featureFiscal: plan.feature_fiscal,
            included: planIncluded(plan),
          }
        : null,
      onlinePay: pay,
      providerReady: !!(provider[0]?.name && provider[0]?.document),
      quotes,
    };
  }

  async saveSettings(b: QuoteSettingsInput, a: Actor) {
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_quote_settings SET fiscal_mode = $1, fiscal_monthly = $2,
                fiscal_nfce_included = $3, fiscal_nfe_included = $4, fiscal_nfce_extra = $5,
                fiscal_nfe_extra = $6, setup_fee = $7, validity_days = $8, extra_costs = $9,
                notes = $10, updated_at = now(), updated_by = $11 WHERE id`,
        [
          b.fiscal.mode,
          b.fiscal.monthly,
          b.fiscal.nfceIncluded,
          b.fiscal.nfeIncluded,
          b.fiscal.nfceExtra,
          b.fiscal.nfeExtra,
          b.setupFee,
          b.validityDays,
          JSON.stringify(b.extraCosts),
          b.notes,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.quote_settings_saved',
        entity: 'quote_settings',
        data: { fiscal: b.fiscal, setupFee: b.setupFee },
        ip: a.ip,
      });
    });
    return this.overview();
  }

  async create(b: NewQuoteInput, a: Actor) {
    const [s, plan, pay, [prov]] = await Promise.all([
      loadQuoteSettings(this.db),
      this.plan(),
      this.onlinePay(),
      this.db.query<{
        provider_name: string;
        provider_document: string;
        provider_email: string;
        provider_representative: string;
        provider_address: string;
        due_day: number;
        term_months: number;
        sla_percent: string;
        readjust_index: string;
        support_hours: string;
        late_fee_percent: string;
        late_interest_percent: string;
        forum_city: string;
      }>(
        `SELECT provider_name, provider_document, provider_email, provider_representative,
                provider_address, due_day, term_months, sla_percent::text AS sla_percent,
                readjust_index, support_hours, late_fee_percent::text AS late_fee_percent,
                late_interest_percent::text AS late_interest_percent, forum_city
           FROM platform_contract_settings WHERE id`,
      ),
    ]);
    if (!plan)
      throw new UnprocessableEntityException('Nenhum plano ativo: crie o plano em Planos primeiro');
    const price = b.priceMonthly ?? plan.price;
    const setupFee = b.setupFee ?? trimNum(s.setup_fee);
    const costs = toFiscalCosts(s);
    const fiscalOn = b.fiscal && plan.feature_fiscal;
    const est = fiscalOn ? fiscalEstimate(costs, b.nfcePerMonth, b.nfePerMonth) : null;
    const monthlyCents = toCents(price) + (est?.totalCents ?? 0);
    const issued = new Date();
    const validity = b.validityDays ?? s.validity_days;
    const validUntil = new Date(issued.getTime() + validity * 86_400_000);
    const p = prov!;
    const trialDays = b.trialDays ?? plan.trial_days;
    const termMonths = b.termMonths ?? Math.min(12, p.term_months || 12);
    const implementationDays = b.implementationDays ?? 5;
    const readjust = p.readjust_index || 'IPCA/IBGE';
    const { conditions, service } = quoteClauses({
      trialDays,
      termMonths,
      setupCents: toCents(setupFee),
      readjustIndex: readjust,
      lateFeePercent: p.late_fee_percent || '2',
      lateInterestPercent: p.late_interest_percent || '1',
      slaPercent: p.sla_percent || '99.5',
      supportHours: p.support_hours,
    });
    const contentBase = {
      version: 2 as const,
      issuedAt: issued.toISOString(),
      validUntil: validUntil.toISOString(),
      provider: {
        name: p.provider_name,
        document: p.provider_document || null,
        email: p.provider_email || null,
        representative: p.provider_representative || null,
        address: p.provider_address || null,
      },
      client: {
        name: b.clientName,
        document: b.clientDocument || null,
        contact: b.contactName || null,
        email: b.email || null,
        phone: b.phone || null,
        city: b.city || null,
      },
      plan: {
        name: plan.name,
        priceMonthly: fromCents(toCents(price)),
        trialDays,
        included: planIncluded({ ...plan, feature_fiscal: fiscalOn }),
      },
      setupFee: fromCents(toCents(setupFee)),
      fiscal: {
        enabled: fiscalOn,
        costs,
        nfcePerMonth: b.nfcePerMonth,
        nfePerMonth: b.nfePerMonth,
        estimateCents: est?.totalCents ?? 0,
        clause: fiscalCostClause(costs),
      },
      onlinePay: pay,
      extraCosts: s.extra_costs,
      conditions,
      service,
      implementation: implementationSteps(fiscalOn),
      terms: {
        validityDays: validity,
        trialDays,
        termMonths,
        implementationDays,
        dueDay: p.due_day,
        lateFeePercent: p.late_fee_percent,
        lateInterestPercent: p.late_interest_percent,
        slaPercent: p.sla_percent,
        readjustIndex: readjust,
        supportHours: p.support_hours,
        forumCity: p.forum_city,
      },
      notes: b.notes ?? s.notes,
      totals: { monthlyCents, firstPaymentCents: monthlyCents + toCents(setupFee) },
    };
    return this.db.tx(async (c) => {
      // Número sequencial por ano (ORC-2026-0001), sem corrida entre dois painéis abertos.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('platform_quotes_number'))`);
      const year = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
      }).format(issued);
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int + 1 AS n FROM platform_quotes WHERE number LIKE $1`,
        [`ORC-${year}-%`],
      );
      const number = `ORC-${year}-${String(rows[0]!.n).padStart(4, '0')}`;
      const content: QuoteContent = { ...contentBase, number };
      const r = await c.query<{ id: string }>(
        `INSERT INTO platform_quotes (number, client_name, total_monthly, content, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [number, b.clientName, fromCents(monthlyCents), JSON.stringify(content), a.admin.id],
      );
      const id = r.rows[0]!.id;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.quote_created',
        entity: 'quote',
        entityId: id,
        data: { number, client: b.clientName, totalMonthly: fromCents(monthlyCents) },
        ip: a.ip,
      });
      return { id, number };
    });
  }

  async pdf(id: string) {
    const [r] = await this.db.query<{ number: string; content: QuoteContent }>(
      `SELECT number, content FROM platform_quotes WHERE id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException('Orçamento não encontrado');
    const slug = r.content.client.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return {
      fileName: `orcamento-${r.number}${slug ? `-${slug}` : ''}.pdf`,
      data: Buffer.from(await renderQuotePdf(r.content)),
    };
  }
}
