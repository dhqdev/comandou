import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  accessUntil,
  addDays,
  BLOCK_LABELS,
  BlockReason,
  contractPhase,
  daysLeft,
  fromCents,
  invoiceDue,
  paymentBlocked,
  periodAfterPayment,
  spDate,
  toCents,
  upgradeCharge,
} from '@comandou/shared';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import { AsaasClient, AsaasError, AsaasPayment, ASAAS_URLS, invoiceStatusOf } from './asaas.client';

export const KEY_CONTEXT = 'billing:asaas-key';
export const WEBHOOK_CONTEXT = 'billing:asaas-webhook';

export const BillingSettingsBody = z.object({
  enabled: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
  /** Vazio mantém a chave salva. */
  apiKey: z.string().trim().max(300).optional(),
  invoiceDaysBefore: z.number().int().min(1).max(20),
  blockAfterDays: z.number().int().min(0).max(15),
  upgradeDueDays: z.number().int().min(1).max(10),
  contractRenewalDays: z.number().int().min(7).max(90),
  contractGraceDays: z.number().int().min(0).max(60),
});
export type BillingSettingsInput = z.infer<typeof BillingSettingsBody>;

export const ManualInvoiceBody = z.object({
  description: z.string().trim().min(3).max(200),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'valor inválido'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD'),
});

interface Actor {
  admin: { id: string; name: string };
  ip?: string;
}

interface SettingsRow {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  api_key_enc: Buffer | null;
  webhook_token_enc: Buffer | null;
  invoice_days_before: number;
  block_after_days: number;
  upgrade_due_days: number;
  contract_renewal_days: number;
  contract_grace_days: number;
  account_name: string | null;
  webhook_id: string | null;
  last_cycle_at: Date | null;
  last_cycle_error: string | null;
  updated_at: Date;
}

interface SubRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  billing_mode: 'manual' | 'asaas';
  blocked_at: Date | null;
  block_reason: BlockReason | null;
  plan_name: string;
  price_monthly: string;
  tenant_status: string;
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  subscription_id: string;
  kind: 'monthly' | 'upgrade' | 'manual';
  plan_id: string | null;
  description: string;
  amount: string;
  period_start: Date | null;
  due_date: string;
  status: string;
  environment: string | null;
  provider_id: string | null;
  applied_at: Date | null;
}

const SUB_SQL = `SELECT s.id, s.tenant_id, s.plan_id, s.status, s.trial_ends_at, s.current_period_end,
         s.billing_mode, s.blocked_at, s.block_reason, p.name AS plan_name,
         p.price_monthly::text AS price_monthly, t.status AS tenant_status
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id
   WHERE s.status <> 'cancelled'`;

const INVOICE_COLS = `i.id, i.kind, i.description, i.amount::text AS amount, i.due_date::text AS "dueDate",
  i.status, i.period_start AS "periodStart", i.invoice_url AS "invoiceUrl",
  i.bank_slip_url AS "bankSlipUrl", i.billing_type AS "billingType", i.paid_at AS "paidAt",
  i.provider_id IS NOT NULL AS "sent", i.last_error AS "lastError", i.environment,
  i.created_at AS "createdAt", i.data`;

const dateBR = (d: Date | string) => spDate(d).split('-').reverse().join('/');

/**
 * Cobrança da assinatura pelo Asaas (docs/cobranca.md): 7 dias de teste, cada pagamento libera
 * mais 30 dias e quem não paga é bloqueado automaticamente. Tudo pelo pool da plataforma; as rotas
 * do restaurante só chegam aqui com o restaurante resolvido pelo Host e a sessão conferida.
 */
@Injectable()
export class BillingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Billing');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  /** Bloqueio por restaurante (lido a cada escrita): cache curto por réplica. */
  private readonly blockCache = new Map<string, { at: number; reason: BlockReason | null }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  get available() {
    return this.db.enabled;
  }

  onApplicationBootstrap() {
    const minutes = this.env.BILLING_INTERVAL_MINUTES;
    if (!minutes || !this.db.enabled) return;
    this.first = setTimeout(() => void this.cycleSafely(), 60_000);
    this.timer = setInterval(() => void this.cycleSafely(), minutes * 60_000);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ configuração
  private async settingsRow(c?: PoolClient): Promise<SettingsRow> {
    const sql = `SELECT * FROM platform_billing_settings WHERE id`;
    return c
      ? (await c.query<SettingsRow>(sql)).rows[0]!
      : (await this.db.query<SettingsRow>(sql))[0]!;
  }

  private reveal(enc: Buffer | null, context: string): string | null {
    if (!enc || !this.env.INTEGRATIONS_KEY) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, enc, context);
    } catch {
      return null;
    }
  }

  private client(s: SettingsRow): AsaasClient {
    const key = this.reveal(s.api_key_enc, KEY_CONTEXT);
    if (!key)
      throw new ServiceUnavailableException(
        'Cobrança sem chave do Asaas: configure em Super Admin → Cobrança',
      );
    return new AsaasClient(this.env.ASAAS_BASE_URL ?? ASAAS_URLS[s.environment], key);
  }

  private publicSettings(s: SettingsRow) {
    return {
      enabled: s.enabled,
      environment: s.environment,
      hasApiKey: !!s.api_key_enc,
      keyReadable: !!this.reveal(s.api_key_enc, KEY_CONTEXT),
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      hasWebhookToken: !!s.webhook_token_enc,
      webhookRegistered: !!s.webhook_id,
      invoiceDaysBefore: s.invoice_days_before,
      blockAfterDays: s.block_after_days,
      upgradeDueDays: s.upgrade_due_days,
      contractRenewalDays: s.contract_renewal_days,
      contractGraceDays: s.contract_grace_days,
      accountName: s.account_name,
      lastCycleAt: s.last_cycle_at,
      lastCycleError: s.last_cycle_error,
      updatedAt: s.updated_at,
    };
  }

  /** Tela Cobrança do painel: configuração, números do mês, restaurantes e faturas recentes. */
  async overview() {
    const s = await this.settingsRow();
    const subs = await this.db.query<SubRow & { name: string; slug: string }>(
      `SELECT x.*, t.name, t.slug FROM (${SUB_SQL}) x JOIN tenants t ON t.id = x.tenant_id
        WHERE t.status <> 'deleting' ORDER BY t.name`,
    );
    const contracts = await this.contractEnds();
    const [totals] = await this.db.query<{
      open: string;
      overdue: string;
      paidMonth: string;
      openCount: number;
      overdueCount: number;
    }>(
      `SELECT coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0)::text AS open,
              coalesce(sum(amount) FILTER (WHERE status = 'overdue'), 0)::text AS overdue,
              coalesce(sum(amount) FILTER (WHERE status = 'paid'
                AND paid_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'), 0)::text AS "paidMonth",
              count(*) FILTER (WHERE status = 'pending')::int AS "openCount",
              count(*) FILTER (WHERE status = 'overdue')::int AS "overdueCount"
         FROM billing_invoices`,
    );
    const invoices = await this.db.query(
      `SELECT ${INVOICE_COLS}, t.id AS "tenantId", t.name AS "tenantName"
         FROM billing_invoices i JOIN tenants t ON t.id = i.tenant_id
        ORDER BY i.created_at DESC LIMIT 40`,
    );
    const events = await this.db.query(
      `SELECT id, event, payment_id AS "paymentId", received_at AS "receivedAt",
              processed_at AS "processedAt", error
         FROM billing_events ORDER BY id DESC LIMIT 15`,
    );
    const now = new Date();
    return {
      settings: this.publicSettings(s),
      webhookPath: '/api/v1/platform/billing/asaas/webhook',
      totals,
      tenants: subs.map((x) => {
        const until = accessUntil({
          status: x.status,
          trialEndsAt: x.trial_ends_at,
          currentPeriodEnd: x.current_period_end,
        });
        const validUntil = contracts.get(x.tenant_id) ?? null;
        return {
          id: x.tenant_id,
          name: x.name,
          slug: x.slug,
          planName: x.plan_name,
          priceMonthly: x.price_monthly,
          status: x.status,
          billingMode: x.billing_mode,
          accessUntil: until,
          daysLeft: daysLeft(until, now),
          blockedAt: x.blocked_at,
          blockReason: x.block_reason,
          contractValidUntil: validUntil,
          contractPhase: contractPhase(
            validUntil,
            s.contract_renewal_days,
            s.contract_grace_days,
            now,
          ),
        };
      }),
      invoices,
      events,
    };
  }

  async saveSettings(b: BillingSettingsInput, a: Actor) {
    const cur = await this.settingsRow();
    let keyEnc = cur.api_key_enc;
    let tokenEnc = cur.webhook_token_enc;
    if ((b.apiKey || !tokenEnc) && !this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar a chave com segurança',
      );
    if (b.apiKey) keyEnc = seal(this.env.INTEGRATIONS_KEY!, b.apiKey, KEY_CONTEXT);
    if (!tokenEnc)
      tokenEnc = seal(
        this.env.INTEGRATIONS_KEY!,
        randomBytes(32).toString('base64url'),
        WEBHOOK_CONTEXT,
      );
    if (b.enabled && !keyEnc) throw new UnprocessableEntityException('Informe a chave do Asaas');
    const envChanged = b.environment !== cur.environment;
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_billing_settings
            SET enabled = $1, environment = $2, api_key_enc = $3, webhook_token_enc = $4,
                invoice_days_before = $5, block_after_days = $6, upgrade_due_days = $7,
                contract_renewal_days = $8, contract_grace_days = $9,
                account_name = CASE WHEN $10 THEN NULL ELSE account_name END,
                webhook_id = CASE WHEN $10 THEN NULL ELSE webhook_id END,
                updated_at = now(), updated_by = $11
          WHERE id`,
        [
          b.enabled,
          b.environment,
          keyEnc,
          tokenEnc,
          b.invoiceDaysBefore,
          b.blockAfterDays,
          b.upgradeDueDays,
          b.contractRenewalDays,
          b.contractGraceDays,
          envChanged || !!b.apiKey,
          a.admin.id,
        ],
      );
      const { apiKey: _k, ...safe } = b;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_settings_updated',
        entity: 'billing',
        data: { ...safe, apiKeyChanged: !!b.apiKey },
        ip: a.ip,
      });
    });
    return this.overview();
  }

  /** Confere a chave: nome da conta e saldo no Asaas. */
  async test(a: Actor) {
    const s = await this.settingsRow();
    const client = this.client(s);
    try {
      const acc = await client.account();
      const bal = await client.balance().catch(() => null);
      await this.db.tx(async (c) => {
        await c.query(`UPDATE platform_billing_settings SET account_name = $1 WHERE id`, [
          acc.name?.slice(0, 160) ?? null,
        ]);
        await platformAudit(c, {
          adminId: a.admin.id,
          action: 'platform.billing_tested',
          entity: 'billing',
          data: { ok: true, environment: s.environment },
          ip: a.ip,
        });
      });
      return { ok: true, accountName: acc.name ?? null, balance: bal?.balance ?? null };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Cadastra o webhook no Asaas apontando para este painel, com o token guardado aqui. */
  async registerWebhook(origin: string, a: Actor) {
    const s = await this.settingsRow();
    const token = this.reveal(s.webhook_token_enc, WEBHOOK_CONTEXT);
    if (!token) throw new UnprocessableEntityException('Salve a configuração antes');
    const [cfg] = await this.db.query<{ notify_email: string; provider_email: string }>(
      `SELECT notify_email, provider_email FROM platform_contract_settings WHERE id`,
    );
    const email = cfg?.notify_email || cfg?.provider_email;
    if (!email)
      throw new UnprocessableEntityException(
        'Informe o e-mail de aviso em Contrato → Configurar: o Asaas avisa por ele se o webhook falhar',
      );
    const url = `${origin}/api/v1/platform/billing/asaas/webhook`;
    let id: string;
    try {
      id = (await this.client(s).createWebhook({ url, email, authToken: token })).id;
    } catch (e) {
      throw new UnprocessableEntityException((e as Error).message);
    }
    await this.db.tx(async (c) => {
      await c.query(`UPDATE platform_billing_settings SET webhook_id = $1 WHERE id`, [id]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_webhook_registered',
        entity: 'billing',
        data: { url },
        ip: a.ip,
      });
    });
    return { ok: true, url };
  }

  /** Mostra o token do webhook (para cadastrar à mão no Asaas). Auditado. */
  async webhookToken(origin: string, a: Actor) {
    const s = await this.settingsRow();
    const token = this.reveal(s.webhook_token_enc, WEBHOOK_CONTEXT);
    if (!token) throw new UnprocessableEntityException('Salve a configuração antes');
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_webhook_token_viewed',
        entity: 'billing',
        ip: a.ip,
      }),
    );
    return { url: `${origin}/api/v1/platform/billing/asaas/webhook`, token };
  }

  // ------------------------------------------------------------------ contrato
  /** Fim da vigência do contrato assinado mais longo de cada restaurante. */
  private async contractEnds(tenantId?: string): Promise<Map<string, string>> {
    const rows = await this.db.query<{ tenant_id: string; valid_until: string }>(
      `SELECT tenant_id, max(valid_until)::text AS valid_until FROM tenant_contracts
        WHERE status = 'signed' AND valid_until IS NOT NULL ${tenantId ? 'AND tenant_id = $1' : ''}
        GROUP BY tenant_id`,
      tenantId ? [tenantId] : [],
    );
    return new Map(rows.map((r) => [r.tenant_id, r.valid_until]));
  }

  // ------------------------------------------------------------------ bloqueio
  /** Motivo do bloqueio do restaurante (cache de 30 s). null = liberado. */
  async blockOf(tenantId: string): Promise<BlockReason | null> {
    if (!this.db.enabled) return null;
    const hit = this.blockCache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.reason;
    const [r] = await this.db.query<{ block_reason: BlockReason | null }>(
      `SELECT block_reason FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'`,
      [tenantId],
    );
    const reason = r?.block_reason ?? null;
    this.blockCache.set(tenantId, { at: Date.now(), reason });
    return reason;
  }

  /**
   * Confere uma assinatura e grava a situação: faturas vencidas, "pagamento pendente" e o
   * bloqueio automático (pagamento ou contrato). Devolve se mudou o bloqueio.
   */
  private async evaluate(c: PoolClient, sub: SubRow, s: SettingsRow, now: Date) {
    const today = spDate(now);
    await c.query(
      `UPDATE billing_invoices SET status = 'overdue'
        WHERE subscription_id = $1 AND status = 'pending' AND due_date < $2::date`,
      [sub.id, today],
    );
    let reason: BlockReason | null = null;
    let status = sub.status;
    const free = toCents(sub.price_monthly) === 0;
    if (sub.billing_mode === 'asaas' && s.enabled && !free) {
      const until = accessUntil({
        status: sub.status,
        trialEndsAt: sub.trial_ends_at,
        currentPeriodEnd: sub.current_period_end,
      });
      const expired = paymentBlocked(until, 0, now);
      if (expired && (status === 'trialing' || status === 'active')) status = 'past_due';
      if (!expired && status === 'past_due') status = 'active';
      const lateExtra = (
        await c.query(
          `SELECT 1 FROM billing_invoices
            WHERE subscription_id = $1 AND kind <> 'monthly' AND status = 'overdue'
              AND due_date + $2::int < $3::date LIMIT 1`,
          [sub.id, s.block_after_days, today],
        )
      ).rowCount;
      if (paymentBlocked(until, s.block_after_days, now) || lateExtra) reason = 'payment';
    }
    if (!reason) {
      const validUntil = (await this.contractEnds(sub.tenant_id)).get(sub.tenant_id) ?? null;
      if (
        contractPhase(validUntil, s.contract_renewal_days, s.contract_grace_days, now) === 'blocked'
      )
        reason = 'contract';
    }
    const changed = reason !== sub.block_reason;
    if (changed || status !== sub.status) {
      await c.query(
        `UPDATE subscriptions SET status = $2,
                block_reason = $3, blocked_at = CASE WHEN $3::text IS NULL THEN NULL
                                                     WHEN block_reason IS NULL THEN now() ELSE blocked_at END
          WHERE id = $1`,
        [sub.id, status, reason],
      );
    }
    if (changed) {
      this.blockCache.delete(sub.tenant_id);
      await platformAudit(c, {
        action: reason ? 'platform.billing_blocked' : 'platform.billing_unblocked',
        entity: 'subscription',
        entityId: sub.id,
        tenantId: sub.tenant_id,
        data: { reason: reason ?? sub.block_reason },
      });
    }
    return changed;
  }

  /** Reavalia um restaurante agora (depois de pagamento ou mudança no painel). */
  async refresh(tenantId: string, now = new Date()) {
    if (!this.db.enabled) return;
    await this.db.tx(async (c) => {
      const s = await this.settingsRow(c);
      const sub = (
        await c.query<SubRow>(`${SUB_SQL} AND s.tenant_id = $1 FOR UPDATE OF s`, [tenantId])
      ).rows[0];
      if (sub) await this.evaluate(c, sub, s, now);
    });
    this.blockCache.delete(tenantId);
  }

  // ------------------------------------------------------------------ ciclo
  private async cycleSafely() {
    try {
      const r = await this.runCycle();
      if (r) this.logger.log(`cobrança: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`ciclo de cobrança falhou: ${(e as Error).message}`);
    }
  }

  /**
   * Uma passada por todas as assinaturas: gera a fatura do próximo período, reenvia ao Asaas o que
   * falhou, marca vencidas e aplica o bloqueio. Uma réplica por vez (trava no banco).
   */
  async runCycle(now = new Date()) {
    if (!this.db.enabled) return null;
    const lock = await this.db.pool!.connect();
    try {
      const got = (
        await lock.query<{ ok: boolean }>(
          `SELECT pg_try_advisory_lock(hashtext('comandou.billing_cycle')) AS ok`,
        )
      ).rows[0]!.ok;
      if (!got) return null;
      try {
        return await this.cycle(now);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(hashtext('comandou.billing_cycle'))`);
      }
    } finally {
      lock.release();
    }
  }

  private async cycle(now: Date) {
    const s = await this.settingsRow();
    const out = { created: 0, sent: 0, blocked: 0, unblocked: 0, errors: 0 };
    const errors: string[] = [];
    const subs = await this.db.query<SubRow>(`${SUB_SQL} AND t.status = 'provisioned'`);
    for (const sub of subs) {
      try {
        if (sub.billing_mode === 'asaas' && s.enabled && toCents(sub.price_monthly) > 0) {
          if (await this.ensureMonthly(sub, s, now, false)) out.created++;
        }
        const before = sub.block_reason;
        await this.db.tx(async (c) => {
          const fresh = (
            await c.query<SubRow>(`${SUB_SQL} AND s.id = $1 FOR UPDATE OF s`, [sub.id])
          ).rows[0];
          if (fresh) await this.evaluate(c, fresh, s, now);
        });
        const after = await this.blockOf(sub.tenant_id);
        if (!before && after) out.blocked++;
        if (before && !after) out.unblocked++;
      } catch (e) {
        out.errors++;
        errors.push(`${sub.tenant_id}: ${(e as Error).message}`);
      }
    }
    if (s.enabled && s.api_key_enc) {
      const pending = await this.db.query<{ id: string }>(
        `SELECT id FROM billing_invoices
          WHERE provider_id IS NULL AND status IN ('pending', 'overdue')
          ORDER BY created_at LIMIT 50`,
      );
      for (const p of pending) if (await this.push(p.id)) out.sent++;
    }
    await this.db.query(
      `UPDATE platform_billing_settings SET last_cycle_at = now(), last_cycle_error = $1 WHERE id`,
      [errors.length ? errors.join(' | ').slice(0, 500) : null],
    );
    return out;
  }

  /**
   * Cria (se ainda não existe) a mensalidade do próximo período: vence no último dia liberado e
   * libera mais 30 dias quando paga. `force` gera mesmo antes da hora (botão do painel).
   */
  private async ensureMonthly(sub: SubRow, s: SettingsRow, now: Date, force: boolean) {
    let until = accessUntil({
      status: sub.status,
      trialEndsAt: sub.trial_ends_at,
      currentPeriodEnd: sub.current_period_end,
    });
    if (!until) {
      // Assinatura ativa sem período: o primeiro pagamento vence em alguns dias.
      until = addDays(now, s.upgrade_due_days);
      await this.db.query(
        `UPDATE subscriptions SET current_period_end = $2 WHERE id = $1 AND current_period_end IS NULL`,
        [sub.id, until],
      );
    }
    if (!force && !invoiceDue(until, s.invoice_days_before, now)) return false;
    const due = spDate(until) < spDate(now) ? spDate(now) : spDate(until);
    const end = addDays(until, 30);
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, plan_id, description, amount,
                                     period_start, due_date, environment, data)
       VALUES ($1, $2, 'monthly', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (subscription_id, period_start)
         WHERE kind = 'monthly' AND status NOT IN ('cancelled', 'refunded') DO NOTHING
       RETURNING id`,
      [
        sub.tenant_id,
        sub.id,
        sub.plan_id,
        `Comandou · Plano ${sub.plan_name} · 30 dias (${dateBR(until)} a ${dateBR(end)})`.slice(
          0,
          200,
        ),
        sub.price_monthly,
        until,
        due,
        s.environment,
        JSON.stringify({ planName: sub.plan_name }),
      ],
    );
    if (!r[0]) return false;
    await this.push(r[0].id);
    return true;
  }

  /** Cliente do restaurante no Asaas (cria na primeira cobrança do ambiente). */
  private async customer(tenantId: string, s: SettingsRow, client: AsaasClient) {
    const [hit] = await this.db.query<{ customer_id: string }>(
      `SELECT customer_id FROM billing_customers WHERE tenant_id = $1 AND environment = $2`,
      [tenantId, s.environment],
    );
    if (hit) return hit.customer_id;
    const [p] = await this.db.query<{
      name: string;
      legal_name: string | null;
      document: string | null;
      billing_email: string | null;
      phone: string | null;
    }>(
      `SELECT t.name, pf.legal_name, pf.document, pf.billing_email, pf.phone
         FROM tenants t LEFT JOIN tenant_profiles pf ON pf.tenant_id = t.id WHERE t.id = $1`,
      [tenantId],
    );
    if (!p?.document)
      throw new UnprocessableEntityException(
        'Cadastro do cliente sem CPF/CNPJ: preencha na aba Cadastro para gerar a cobrança',
      );
    const { id } = await client.createCustomer({
      name: p.legal_name || p.name,
      cpfCnpj: p.document.replace(/\D/g, ''),
      email: p.billing_email,
      mobilePhone: p.phone?.replace(/\D/g, '') || null,
      externalReference: tenantId,
    });
    await this.db.query(
      `INSERT INTO billing_customers (tenant_id, environment, customer_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tenantId, s.environment, id],
    );
    return id;
  }

  /** Envia ao Asaas uma fatura ainda sem cobrança lá. Falha fica na fatura e o ciclo tenta de novo. */
  private async push(invoiceId: string): Promise<boolean> {
    const s = await this.settingsRow();
    const [inv] = await this.db.query<InvoiceRow>(
      `SELECT id, tenant_id, amount::text AS amount, due_date::text AS due_date, description,
              provider_id, status
         FROM billing_invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv || inv.provider_id || !['pending', 'overdue'].includes(inv.status)) return false;
    try {
      if (!s.enabled) throw new Error('Cobrança automática desligada no painel');
      const client = this.client(s);
      const customer = await this.customer(inv.tenant_id, s, client);
      const [late] = await this.db.query<{ fee: string; interest: string }>(
        `SELECT late_fee_percent::text AS fee, late_interest_percent::text AS interest
           FROM platform_contract_settings WHERE id`,
      );
      const today = spDate();
      const p = await client.createPayment({
        customer,
        value: Number(inv.amount),
        dueDate: inv.due_date < today ? today : inv.due_date,
        description: inv.description,
        externalReference: inv.id,
        fine: late ? Number(late.fee) : undefined,
        interest: late ? Number(late.interest) : undefined,
      });
      await this.db.query(
        `UPDATE billing_invoices SET provider_id = $2, invoice_url = $3, bank_slip_url = $4,
                environment = $5, last_error = NULL
          WHERE id = $1`,
        [inv.id, p.id, p.invoiceUrl ?? null, p.bankSlipUrl ?? null, s.environment],
      );
      return true;
    } catch (e) {
      await this.db.query(`UPDATE billing_invoices SET last_error = $2 WHERE id = $1`, [
        inv.id,
        (e as Error).message.slice(0, 300),
      ]);
      return false;
    }
  }

  // ------------------------------------------------------------------ pagamento
  /** Aplica o que o Asaas diz da cobrança (situação, pagamento) na fatura e na assinatura. */
  private async applyPayment(invoiceId: string, p: AsaasPayment | null, manual?: Actor) {
    const status = p ? invoiceStatusOf(p) : 'paid';
    const tenantId = await this.db.tx(async (c) => {
      const inv = (
        await c.query<InvoiceRow>(
          `SELECT id, tenant_id, subscription_id, kind, status, applied_at, period_start
             FROM billing_invoices WHERE id = $1 FOR UPDATE`,
          [invoiceId],
        )
      ).rows[0];
      if (!inv) throw new NotFoundException('Fatura não encontrada');
      if (inv.status === 'cancelled' && status !== 'paid') return inv.tenant_id;
      const paidAt =
        status === 'paid'
          ? p?.clientPaymentDate || p?.paymentDate || p?.confirmedDate
            ? new Date(`${p.clientPaymentDate || p.paymentDate || p.confirmedDate}T12:00:00-03:00`)
            : new Date()
          : null;
      // Data do pagamento no futuro (fuso) não adianta nada: limita a agora.
      const paid = paidAt && paidAt.getTime() > Date.now() ? new Date() : paidAt;
      await c.query(
        `UPDATE billing_invoices SET status = $2, paid_at = coalesce($3, paid_at),
                billing_type = coalesce($4, billing_type), net_amount = coalesce($5, net_amount),
                invoice_url = coalesce($6, invoice_url), bank_slip_url = coalesce($7, bank_slip_url)
          WHERE id = $1`,
        [
          inv.id,
          status,
          paid,
          p?.billingType && p.billingType !== 'UNDEFINED'
            ? p.billingType
            : manual
              ? 'MANUAL'
              : null,
          p?.netValue ?? null,
          p?.invoiceUrl ?? null,
          p?.bankSlipUrl ?? null,
        ],
      );
      if (status === 'paid' && !inv.applied_at) {
        const sub = (
          await c.query<SubRow>(`${SUB_SQL} AND s.id = $1 FOR UPDATE OF s`, [inv.subscription_id])
        ).rows[0];
        if (sub && inv.kind === 'monthly') {
          const until = accessUntil({
            status: sub.status,
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
          });
          const end = periodAfterPayment(until ?? inv.period_start, paid!);
          await c.query(
            `UPDATE subscriptions SET status = 'active', current_period_end = $2 WHERE id = $1`,
            [sub.id, end],
          );
        }
        await c.query(`UPDATE billing_invoices SET applied_at = now() WHERE id = $1`, [inv.id]);
        await platformAudit(c, {
          adminId: manual?.admin.id ?? null,
          action: 'platform.billing_paid',
          entity: 'invoice',
          entityId: inv.id,
          tenantId: inv.tenant_id,
          data: { kind: inv.kind, manual: !!manual, billingType: p?.billingType ?? null },
          ip: manual?.ip,
        });
      }
      return inv.tenant_id;
    });
    await this.refresh(tenantId);
    return tenantId;
  }

  /**
   * Webhook do Asaas. O token do cabeçalho asaas-access-token precisa bater; cada evento entra
   * uma vez só; a situação vem sempre de uma consulta ao Asaas (o corpo só diz qual cobrança).
   */
  async webhook(token: string | undefined, body: unknown) {
    const s = await this.settingsRow();
    const expected = this.reveal(s.webhook_token_enc, WEBHOOK_CONTEXT);
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected ?? '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b))
      throw new ForbiddenException('Token do webhook inválido');
    const e = z
      .object({
        id: z.string().min(1).max(120).optional(),
        event: z.string().min(1).max(80),
        payment: z
          .object({ id: z.string().min(1).max(80) })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .safeParse(body);
    if (!e.success) return { ok: true, ignored: 'formato' };
    const paymentId = e.data.payment?.id ?? null;
    const eventId = e.data.id ?? `${e.data.event}:${paymentId}:${Date.now()}`;
    const ins = await this.db.query<{ id: string }>(
      `INSERT INTO billing_events (event_id, event, payment_id, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [eventId, e.data.event, paymentId, JSON.stringify(body)],
    );
    let evId = ins[0]?.id;
    if (!evId) {
      // Repetido: só processa de novo se a primeira vez falhou.
      const [prev] = await this.db.query<{ id: string; processed_at: Date | null }>(
        `SELECT id, processed_at FROM billing_events WHERE event_id = $1`,
        [eventId],
      );
      if (!prev || prev.processed_at) return { ok: true, duplicate: true };
      evId = prev.id;
    }
    if (!paymentId || !e.data.event.startsWith('PAYMENT_')) {
      await this.db.query(`UPDATE billing_events SET processed_at = now() WHERE id = $1`, [evId]);
      return { ok: true };
    }
    try {
      const [inv] = await this.db.query<{ id: string }>(
        `SELECT id FROM billing_invoices WHERE provider_id = $1`,
        [paymentId],
      );
      if (!inv) {
        await this.db.query(
          `UPDATE billing_events SET processed_at = now(), error = 'cobrança fora do Comandou' WHERE id = $1`,
          [evId],
        );
        return { ok: true, ignored: 'desconhecida' };
      }
      const p = await this.client(s).payment(paymentId);
      if (e.data.event === 'PAYMENT_DELETED') p.deleted = true;
      await this.applyPayment(inv.id, p);
      await this.db.query(
        `UPDATE billing_events SET processed_at = now(), invoice_id = $2 WHERE id = $1`,
        [evId, inv.id],
      );
      return { ok: true };
    } catch (err) {
      await this.db.query(`UPDATE billing_events SET error = $2 WHERE id = $1`, [
        evId,
        (err as Error).message.slice(0, 300),
      ]);
      // 503 faz o Asaas tentar de novo mais tarde; o evento fica registrado sem processar.
      throw new ServiceUnavailableException('Não deu para processar agora');
    }
  }

  // ------------------------------------------------------------------ painel: restaurante
  private async invoiceOf(id: string, tenantId?: string) {
    const [inv] = await this.db.query<InvoiceRow>(
      `SELECT id, tenant_id, subscription_id, kind, status, provider_id, amount::text AS amount
         FROM billing_invoices WHERE id = $1 ${tenantId ? 'AND tenant_id = $2' : ''}`,
      tenantId ? [id, tenantId] : [id],
    );
    if (!inv) throw new NotFoundException('Fatura não encontrada');
    return inv;
  }

  /** Aba Assinatura do painel. */
  async tenantAdmin(tenantId: string) {
    return this.view(tenantId, true);
  }

  async setMode(tenantId: string, mode: 'manual' | 'asaas', a: Actor) {
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE subscriptions SET billing_mode = $2 WHERE tenant_id = $1 AND status <> 'cancelled'`,
        [tenantId, mode],
      );
      if (!r.rowCount) throw new NotFoundException('Restaurante sem assinatura');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_mode_changed',
        entity: 'subscription',
        tenantId,
        data: { mode },
        ip: a.ip,
      });
    });
    await this.refresh(tenantId);
    return this.view(tenantId, true);
  }

  /** Gera agora a mensalidade do próximo período (sem esperar o ciclo). */
  async chargeNow(tenantId: string, a: Actor) {
    const s = await this.settingsRow();
    if (!s.enabled) throw new ConflictException('Ligue a cobrança automática em Cobrança');
    const [sub] = await this.db.query<SubRow>(`${SUB_SQL} AND s.tenant_id = $1`, [tenantId]);
    if (!sub) throw new NotFoundException('Restaurante sem assinatura');
    if (toCents(sub.price_monthly) === 0) throw new ConflictException('Plano sem mensalidade');
    const created = await this.ensureMonthly(sub, s, new Date(), true);
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_charge_now',
        entity: 'subscription',
        tenantId,
        data: { created },
        ip: a.ip,
      }),
    );
    if (!created) throw new ConflictException('A mensalidade deste período já foi gerada');
    return this.view(tenantId, true);
  }

  async createManual(tenantId: string, b: z.infer<typeof ManualInvoiceBody>, a: Actor) {
    const s = await this.settingsRow();
    const [sub] = await this.db.query<SubRow>(`${SUB_SQL} AND s.tenant_id = $1`, [tenantId]);
    if (!sub) throw new NotFoundException('Restaurante sem assinatura');
    if (toCents(b.amount) < 500) throw new UnprocessableEntityException('Valor mínimo de R$ 5,00');
    const id = await this.db.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, plan_id, description, amount,
                                       due_date, environment, created_by, data)
         VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, '{"asaas":true}') RETURNING id`,
        [
          tenantId,
          sub.id,
          sub.plan_id,
          b.description,
          b.amount,
          b.dueDate,
          s.environment,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_invoice_created',
        entity: 'invoice',
        entityId: r.rows[0]!.id,
        tenantId,
        data: b,
        ip: a.ip,
      });
      return r.rows[0]!.id;
    });
    await this.push(id);
    return this.view(tenantId, true);
  }

  async cancelInvoice(id: string, a: Actor) {
    const inv = await this.invoiceOf(id);
    if (!['pending', 'overdue'].includes(inv.status))
      throw new ConflictException('Só fatura em aberto pode ser cancelada');
    if (inv.provider_id) {
      const s = await this.settingsRow();
      try {
        await this.client(s).cancelPayment(inv.provider_id);
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404))
          throw new UnprocessableEntityException((e as Error).message);
      }
    }
    await this.db.tx(async (c) => {
      await c.query(`UPDATE billing_invoices SET status = 'cancelled' WHERE id = $1`, [id]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.billing_invoice_cancelled',
        entity: 'invoice',
        entityId: id,
        tenantId: inv.tenant_id,
        ip: a.ip,
      });
    });
    await this.refresh(inv.tenant_id);
    return this.view(inv.tenant_id, true);
  }

  /** Pagamento recebido fora do Asaas (dinheiro, transferência): libera como se fosse pago. */
  async markPaid(id: string, a: Actor) {
    const inv = await this.invoiceOf(id);
    if (!['pending', 'overdue'].includes(inv.status))
      throw new ConflictException('Só fatura em aberto pode ser baixada');
    const tenantId = await this.applyPayment(id, null, a);
    return this.view(tenantId, true);
  }

  /** Consulta o Asaas e aplica a situação (quando um aviso do webhook se perdeu). */
  async sync(id: string, a?: Actor) {
    const inv = await this.invoiceOf(id);
    if (!inv.provider_id) {
      await this.push(id);
    } else {
      const s = await this.settingsRow();
      let p: AsaasPayment;
      try {
        p = await this.client(s).payment(inv.provider_id);
      } catch (e) {
        throw new UnprocessableEntityException((e as Error).message);
      }
      await this.applyPayment(id, p);
    }
    if (a)
      await this.db.tx((c) =>
        platformAudit(c, {
          adminId: a.admin.id,
          action: 'platform.billing_invoice_synced',
          entity: 'invoice',
          entityId: id,
          tenantId: inv.tenant_id,
          ip: a.ip,
        }),
      );
    return this.view(inv.tenant_id, !!a);
  }

  // ------------------------------------------------------------------ restaurante
  /** Tudo da tela Assinatura (restaurante) e da aba Assinatura do painel. */
  async view(tenantId: string, admin = false) {
    if (!this.db.enabled) return null;
    const s = await this.settingsRow();
    const [sub] = await this.db.query<SubRow & { started_at: Date }>(
      `SELECT x.*, s2.started_at FROM (${SUB_SQL} AND s.tenant_id = $1) x
         JOIN subscriptions s2 ON s2.id = x.id`,
      [tenantId],
    );
    const now = new Date();
    const invoices = await this.db.query<{ id: string; status: string; dueDate: string }>(
      `SELECT ${INVOICE_COLS} FROM billing_invoices i WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC LIMIT ${admin ? 60 : 24}`,
      [tenantId],
    );
    const contracts = await this.db.query<{
      id: string;
      number: string;
      status: string;
      validUntil: string | null;
      signerEmail: string | null;
      sentAt: Date | null;
      createdAt: Date;
    }>(
      `SELECT id, number, status, valid_until::text AS "validUntil", signer_email AS "signerEmail",
              sent_at AS "sentAt", created_at AS "createdAt"
         FROM tenant_contracts WHERE tenant_id = $1 AND status <> 'cancelled'
        ORDER BY created_at DESC LIMIT 5`,
      [tenantId],
    );
    const signed = contracts
      .filter((c) => c.status === 'signed' && c.validUntil)
      .sort((x, y) => (x.validUntil! < y.validUntil! ? 1 : -1))[0];
    const pending = contracts.find((c) => c.status !== 'signed' && c.status !== 'draft');
    const validUntil = signed?.validUntil ?? null;
    const plans = await this.db.query<{
      id: string;
      code: string;
      name: string;
      priceMonthly: string;
      maxUsers: number | null;
      maxProducts: number | null;
      maxOrdersMonth: number | null;
      featureFiscal: boolean;
      featureWhatsapp: boolean;
      featureCustomDomain: boolean;
    }>(
      `SELECT id, code, name, price_monthly::text AS "priceMonthly", max_users AS "maxUsers",
              max_products AS "maxProducts", max_orders_month AS "maxOrdersMonth",
              feature_fiscal AS "featureFiscal", feature_whatsapp AS "featureWhatsapp",
              feature_custom_domain AS "featureCustomDomain"
         FROM plans WHERE active ORDER BY price_monthly, name`,
    );
    const until = sub
      ? accessUntil({
          status: sub.status,
          trialEndsAt: sub.trial_ends_at,
          currentPeriodEnd: sub.current_period_end,
        })
      : null;
    const auto = !!sub && sub.billing_mode === 'asaas' && s.enabled;
    const free = !!sub && toCents(sub.price_monthly) === 0;
    return {
      billing: {
        enabled: s.enabled,
        auto,
        environment: admin ? s.environment : undefined,
        blockAfterDays: s.block_after_days,
        upgradeDueDays: s.upgrade_due_days,
      },
      subscription: sub
        ? {
            id: sub.id,
            planId: sub.plan_id,
            planName: sub.plan_name,
            priceMonthly: sub.price_monthly,
            status: sub.status,
            billingMode: sub.billing_mode,
            startedAt: sub.started_at,
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
            accessUntil: until,
            daysLeft: daysLeft(until, now),
            blockOn:
              auto && until && !free ? addDays(until, s.block_after_days).toISOString() : null,
            blockedAt: sub.blocked_at,
            blockReason: sub.block_reason,
            blockLabel: sub.block_reason ? BLOCK_LABELS[sub.block_reason] : null,
          }
        : null,
      invoices,
      contract: {
        number: signed?.number ?? null,
        validUntil,
        daysLeft: validUntil ? daysLeft(new Date(`${validUntil}T23:59:59-03:00`), now) : null,
        phase: contractPhase(validUntil, s.contract_renewal_days, s.contract_grace_days, now),
        blockOn: validUntil
          ? spDate(addDays(new Date(`${validUntil}T12:00:00-03:00`), s.contract_grace_days))
          : null,
        renewal: pending
          ? {
              number: pending.number,
              status: pending.status,
              sentTo: pending.signerEmail,
              sentAt: pending.sentAt,
            }
          : null,
      },
      plans,
    };
  }

  /** Aviso curto para a barra do sistema (qualquer pessoa da equipe). */
  async notice(tenantId: string) {
    const v = await this.view(tenantId);
    if (!v?.subscription) return { level: 'none' as const };
    const sub = v.subscription;
    const open = (v.invoices as { status: string; dueDate: string; amount?: string }[]).filter(
      (i) => i.status === 'pending' || i.status === 'overdue',
    );
    return {
      level: sub.blockReason
        ? ('blocked' as const)
        : open.some((i) => i.status === 'overdue') ||
            (v.billing.auto && sub.daysLeft !== null && sub.daysLeft <= 3 && open.length > 0)
          ? ('warning' as const)
          : v.contract.phase === 'expired' || v.contract.phase === 'renewal'
            ? ('info' as const)
            : ('none' as const),
      blockReason: sub.blockReason,
      daysLeft: v.billing.auto ? sub.daysLeft : null,
      status: sub.status,
      openInvoices: open.length,
      blockOn: sub.blockOn,
      contractPhase: v.contract.phase,
      contractDaysLeft: v.contract.daysLeft,
      contractBlockOn: v.contract.blockOn,
    };
  }

  /** Pix (QR Code e copia e cola) e linha digitável do boleto de uma fatura do restaurante. */
  async payInfo(tenantId: string, invoiceId: string) {
    const inv = await this.invoiceOf(invoiceId, tenantId);
    if (!['pending', 'overdue'].includes(inv.status))
      throw new ConflictException('Fatura sem pagamento em aberto');
    if (!inv.provider_id) {
      await this.push(inv.id);
      const again = await this.invoiceOf(invoiceId, tenantId);
      if (!again.provider_id)
        throw new ServiceUnavailableException(
          'A cobrança ainda não foi criada no banco. Tente de novo em alguns minutos.',
        );
      inv.provider_id = again.provider_id;
    }
    const s = await this.settingsRow();
    const client = this.client(s);
    const [pix, line, pay] = await Promise.all([
      client.pixQrCode(inv.provider_id).catch(() => null),
      client.boletoLine(inv.provider_id).catch(() => null),
      client.payment(inv.provider_id).catch(() => null),
    ]);
    if (pay && invoiceStatusOf(pay) === 'paid') {
      await this.applyPayment(inv.id, pay);
      return { paid: true };
    }
    return {
      paid: false,
      amount: inv.amount,
      pix: pix
        ? { image: pix.encodedImage, payload: pix.payload, expiresAt: pix.expirationDate }
        : null,
      boleto: line ? { line: line.identificationField, url: pay?.bankSlipUrl ?? null } : null,
      invoiceUrl: pay?.invoiceUrl ?? null,
    };
  }

  /**
   * Subir de plano pelo próprio restaurante: o plano novo vale na hora (limites maiores já) e a
   * diferença proporcional dos dias que faltam vira uma fatura com vencimento curto. Durante o
   * teste não há cobrança. Plano menor só pelo suporte.
   */
  async upgrade(tenantId: string, planId: string, by: { id: string; name: string }) {
    const s = await this.settingsRow();
    const result = await this.db.tx(async (c) => {
      const sub = (
        await c.query<SubRow>(`${SUB_SQL} AND s.tenant_id = $1 FOR UPDATE OF s`, [tenantId])
      ).rows[0];
      if (!sub) throw new ConflictException('Restaurante sem assinatura: fale com o suporte');
      if (sub.billing_mode !== 'asaas' || !s.enabled)
        throw new ConflictException('Troca de plano pelo suporte: fale com a gente');
      if (sub.block_reason === 'payment')
        throw new ConflictException('Pague a fatura em aberto antes de trocar de plano');
      const plan = (
        await c.query<{ id: string; name: string; price: string; active: boolean }>(
          `SELECT id, name, price_monthly::text AS price, active FROM plans WHERE id = $1`,
          [planId],
        )
      ).rows[0];
      if (!plan || !plan.active) throw new NotFoundException('Plano não encontrado');
      if (plan.id === sub.plan_id) throw new ConflictException('Este já é o seu plano');
      if (toCents(plan.price) <= toCents(sub.price_monthly))
        throw new ConflictException('Para um plano menor, fale com o suporte');
      const until = accessUntil({
        status: sub.status,
        trialEndsAt: sub.trial_ends_at,
        currentPeriodEnd: sub.current_period_end,
      });
      const charge =
        sub.status === 'trialing'
          ? { cents: 0, amount: '0.00', days: 0 }
          : upgradeCharge(sub.price_monthly, plan.price, until);
      await c.query(`UPDATE subscriptions SET plan_id = $2 WHERE id = $1`, [sub.id, plan.id]);
      let invoiceId: string | null = null;
      if (charge.cents > 0) {
        invoiceId = (
          await c.query<{ id: string }>(
            `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, plan_id, description,
                                           amount, due_date, environment, data)
             VALUES ($1, $2, 'upgrade', $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              tenantId,
              sub.id,
              plan.id,
              `Comandou · troca para o Plano ${plan.name} · ${charge.days} dia(s) proporcionais`.slice(
                0,
                200,
              ),
              charge.amount,
              spDate(addDays(new Date(), s.upgrade_due_days)),
              s.environment,
              JSON.stringify({ from: sub.plan_name, to: plan.name, days: charge.days }),
            ],
          )
        ).rows[0]!.id;
      }
      // Mensalidade ainda não paga do próximo período passa a ter o preço novo.
      const pend = await c.query<{ id: string; provider_id: string | null }>(
        `SELECT id, provider_id FROM billing_invoices
          WHERE subscription_id = $1 AND kind = 'monthly' AND status IN ('pending', 'overdue')`,
        [sub.id],
      );
      await platformAudit(c, {
        action: 'tenant.plan_upgraded',
        entity: 'subscription',
        entityId: sub.id,
        tenantId,
        data: {
          from: sub.plan_name,
          to: plan.name,
          charge: charge.amount,
          by: by.name,
          userId: by.id,
        },
      });
      return { invoiceId, charge, plan, sub, reprice: pend.rows };
    });
    if (result.invoiceId) await this.push(result.invoiceId);
    for (const r of result.reprice) await this.reprice(r.id, r.provider_id, result.plan);
    return { charge: result.charge.amount, invoiceId: result.invoiceId };
  }

  /** Mensalidade aberta depois da troca: cancela a antiga e gera outra com o preço do plano novo. */
  private async reprice(
    id: string,
    providerId: string | null,
    plan: { id: string; name: string; price: string },
  ) {
    const s = await this.settingsRow();
    if (providerId) {
      try {
        await this.client(s).cancelPayment(providerId);
      } catch (e) {
        if (!(e instanceof AsaasError && e.status === 404)) return; // fica a antiga
      }
    }
    const [old] = await this.db.query<{
      tenant_id: string;
      subscription_id: string;
      period_start: Date;
      due_date: string;
    }>(
      `UPDATE billing_invoices SET status = 'cancelled' WHERE id = $1
       RETURNING tenant_id, subscription_id, period_start, due_date::text AS due_date`,
      [id],
    );
    if (!old) return;
    const end = addDays(old.period_start, 30);
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, plan_id, description, amount,
                                     period_start, due_date, environment, data)
       VALUES ($1, $2, 'monthly', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        old.tenant_id,
        old.subscription_id,
        plan.id,
        `Comandou · Plano ${plan.name} · 30 dias (${dateBR(old.period_start)} a ${dateBR(end)})`.slice(
          0,
          200,
        ),
        plan.price,
        old.period_start,
        old.due_date,
        s.environment,
        JSON.stringify({ planName: plan.name }),
      ],
    );
    if (r[0]) await this.push(r[0].id);
  }

  /** Valor da troca antes de confirmar (mesma conta do upgrade). */
  async quote(tenantId: string, planId: string) {
    const [sub] = await this.db.query<SubRow>(`${SUB_SQL} AND s.tenant_id = $1`, [tenantId]);
    const [plan] = await this.db.query<{ price: string; name: string }>(
      `SELECT price_monthly::text AS price, name FROM plans WHERE id = $1 AND active`,
      [planId],
    );
    if (!sub || !plan) throw new NotFoundException('Plano não encontrado');
    const until = accessUntil({
      status: sub.status,
      trialEndsAt: sub.trial_ends_at,
      currentPeriodEnd: sub.current_period_end,
    });
    const charge =
      sub.status === 'trialing'
        ? { cents: 0, amount: '0.00', days: 0 }
        : upgradeCharge(sub.price_monthly, plan.price, until);
    return {
      planName: plan.name,
      priceMonthly: plan.price,
      ...charge,
      total: fromCents(charge.cents),
    };
  }
}
