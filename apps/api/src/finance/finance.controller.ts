import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FINANCE_MONTH_START_MAX,
  FINANCE_MONTH_START_MIN,
  normalizePaymentTerms,
  PAYMENT_METHODS,
  PAYMENT_TERM_MAX_DAYS,
  PAYMENT_TERM_MAX_FEE,
  financeMonth,
  fromCents,
  isMoneyString,
  toCents,
} from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { requireKey, withIdempotency } from '../common/idempotency';
import { isoDate, money, reason } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const SETTLE_METHODS = [...PAYMENT_METHODS, 'transfer', 'boleto'] as const;
const Entry = z.object({
  kind: z.enum(['payable', 'receivable']),
  description: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional(),
  counterparty: z.string().trim().max(120).optional(),
  amount: money.refine((v) => isMoneyString(v) && toCents(v) > 0, 'valor deve ser maior que zero'),
  dueDate: isoDate,
  /** Conta que se repete todo mês (aluguel, salário): cria uma por mês, de 2 a 36. */
  repeatMonths: z.number().int().min(2).max(36).optional(),
});

/** Mesmo dia N meses depois; em mês mais curto, o último dia (31/01 + 1 → 28/02). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const EntriesQuery = z.object({
  kind: z.enum(['payable', 'receivable']).optional(),
  status: z.enum(['open', 'paid', 'cancelled', 'overdue']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
const Settle = z.object({ paidAt: isoDate.optional(), method: z.enum(SETTLE_METHODS) });
const Period = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, 'período inválido')
  .refine(
    (p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86_400_000,
    'período máximo de 1 ano',
  );
const SummaryQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((p) => !p.from === !p.to, 'informe o início e o fim do período')
  .refine((p) => !p.from || !p.to || p.from <= p.to, 'período inválido');
const Term = z.object({
  feePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, 'taxa com até 2 casas')
    .refine((v) => Number(v) <= PAYMENT_TERM_MAX_FEE, `taxa de até ${PAYMENT_TERM_MAX_FEE}%`),
  days: z.number().int().min(0).max(PAYMENT_TERM_MAX_DAYS),
});
const Settings = z
  .object({
    monthStartDay: z
      .number()
      .int()
      .min(FINANCE_MONTH_START_MIN)
      .max(FINANCE_MONTH_START_MAX)
      .optional(),
    paymentTerms: z.object(Object.fromEntries(PAYMENT_METHODS.map((m) => [m, Term]))).optional(),
  })
  .refine((b) => b.monthStartDay !== undefined || b.paymentTerms, 'nada para salvar');
const Reconcile = z.object({
  day: isoDate,
  method: z.enum(PAYMENT_METHODS),
  informedAmount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'valor com até 2 casas'),
  note: z.string().trim().min(3).max(300).optional(),
});

const ENTRY_COLS = `e.id, e.kind, e.description, e.category, e.counterparty, e.amount::text,
  e.due_date::text AS "dueDate", e.status, e.paid_at::text AS "paidAt", e.paid_method AS "paidMethod",
  e.cancel_reason AS "cancelReason", e.created_at AS "createdAt",
  (e.status = 'open' AND e.due_date < (now() AT TIME ZONE t.timezone)::date) AS overdue`;
const ENTRY_FROM = `FROM finance_entries e CROSS JOIN tenants t`;

/**
 * Financeiro: contas a pagar/receber, fluxo de caixa e conciliação diária.
 * Regras: valores em NUMERIC/centavos; lançamento pago não é apagado nem editado (só a baixa
 * ou o cancelamento de um lançamento em aberto); a conciliação é registro imutável.
 * Datas de calendário seguem o fuso do restaurante.
 */
@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('entries')
  @RequirePermission('finance:read')
  entries(
    @Query(new ZodPipe(EntriesQuery)) f: z.infer<typeof EntriesQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT ${ENTRY_COLS} ${ENTRY_FROM}
          WHERE ($1::text IS NULL OR e.kind = $1)
            AND ($2::text IS NULL OR ($2 = 'overdue' AND e.status = 'open' AND e.due_date < (now() AT TIME ZONE t.timezone)::date)
                 OR e.status = $2)
            AND ($3::date IS NULL OR e.due_date >= $3) AND ($4::date IS NULL OR e.due_date <= $4)
          ORDER BY e.status = 'open' DESC, e.due_date, e.created_at LIMIT 500`,
        [f.kind ?? null, f.status ?? null, f.from ?? null, f.to ?? null],
      ),
    );
  }

  @Post('entries')
  @RequirePermission('finance:write')
  create(
    @Body(new ZodPipe(Entry)) b: z.infer<typeof Entry>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const n = b.repeatMonths ?? 1;
      const created: string[] = [];
      for (let i = 0; i < n; i++) {
        const suffix = n > 1 ? ` (${i + 1}/${n})` : '';
        const e = await one<{ id: string }>(
          tx,
          `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            t.id,
            b.kind,
            `${b.description.slice(0, 200 - suffix.length)}${suffix}`,
            b.category ?? null,
            b.counterparty ?? null,
            b.amount,
            addMonths(b.dueDate, i),
            u.id,
          ],
        );
        created.push(e!.id);
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.entry_created',
        entity: 'finance_entry',
        entityId: created[0]!,
        data: { kind: b.kind, amount: b.amount, dueDate: b.dueDate, repeatMonths: n },
        ip: req.ip,
      });
      return { ...(await this.entry(tx, created[0]!)), repeated: n };
    });
  }

  /** Baixa (pagamento/recebimento). Exige Idempotency-Key: um clique duplo não baixa duas vezes. */
  @Post('entries/:id/settle')
  @RequirePermission('finance:write')
  settle(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Settle)) b: z.infer<typeof Settle>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const k = requireKey(key);
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      withIdempotency(tx, t.id, 'finance.settle', k, { id, ...b }, async () => {
        const e = await this.lock(tx, id);
        if (e.status !== 'open') throw new ConflictException('Lançamento não está em aberto');
        await q(
          tx,
          `UPDATE finance_entries SET status = 'paid', paid_at = COALESCE($2::date, (now() AT TIME ZONE (SELECT timezone FROM tenants))::date),
                  paid_method = $3, settled_by = $4 WHERE id = $1`,
          [id, b.paidAt ?? null, b.method, u.id],
        );
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'finance.entry_settled',
          entity: 'finance_entry',
          entityId: id,
          data: { amount: e.amount, method: b.method, paidAt: b.paidAt ?? null },
          ip: req.ip,
        });
        return this.entry(tx, id);
      }),
    );
  }

  @Post('entries/:id/cancel')
  @RequirePermission('finance:write')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ reason }))) b: { reason: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const e = await this.lock(tx, id);
      if (e.status === 'paid')
        throw new ConflictException(
          'Lançamento já baixado não pode ser cancelado; lance um estorno',
        );
      if (e.status !== 'open') throw new ConflictException('Lançamento já cancelado');
      await q(
        tx,
        `UPDATE finance_entries SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`,
        [id, b.reason],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.entry_cancelled',
        entity: 'finance_entry',
        entityId: id,
        data: { reason: b.reason },
        ip: req.ip,
      });
      return this.entry(tx, id);
    });
  }

  /**
   * Mês financeiro: o dia em que o mês começa (ex.: 5 = do dia 5 ao dia 4 do mês seguinte),
   * o "hoje" no fuso do restaurante e o mês atual já calculado.
   */
  @Get('settings')
  @RequirePermission('finance:read')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) => this.loadSettings(tx));
  }

  @Put('settings')
  @RequirePermission('finance:write')
  saveSettings(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const before = await this.loadSettings(tx);
      const terms = b.paymentTerms ? normalizePaymentTerms(b.paymentTerms) : null;
      await q(
        tx,
        `INSERT INTO finance_settings (tenant_id, month_start_day, payment_terms, updated_by)
         VALUES ($1, COALESCE($2::smallint, 1), $3::jsonb, $4)
         ON CONFLICT (tenant_id) DO UPDATE SET
           month_start_day = COALESCE($2::smallint, finance_settings.month_start_day),
           payment_terms = COALESCE($3::jsonb, finance_settings.payment_terms),
           updated_by = EXCLUDED.updated_by`,
        [t.id, b.monthStartDay ?? null, terms ? JSON.stringify(terms) : null, u.id],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.settings_updated',
        entity: 'finance_settings',
        data: {
          monthStartDay: b.monthStartDay ?? before.monthStartDay,
          before: before.monthStartDay,
          ...(terms ? { paymentTerms: terms, termsBefore: before.paymentTerms } : {}),
        },
        ip: req.ip,
      });
      return this.loadSettings(tx);
    });
  }

  /**
   * Resumo das contas em aberto + o mês financeiro (o atual, ou o período from/to pedido):
   * o que vence no mês, o que já foi pago/recebido nele e o que ainda falta.
   */
  @Get('summary')
  @RequirePermission('finance:read')
  summary(
    @Query(new ZodPipe(SummaryQuery)) p: z.infer<typeof SummaryQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const s = await this.loadSettings(tx);
      const period = p.from && p.to ? { from: p.from, to: p.to } : s.currentMonth;
      const open = await one<Record<string, string>>(
        tx,
        `WITH today AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM tenants)
         SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'payable'), 0)::numeric(14,2)::text AS "payableOpen",
                COALESCE(sum(amount) FILTER (WHERE kind = 'payable' AND due_date < today.d), 0)::numeric(14,2)::text AS "payableOverdue",
                COALESCE(sum(amount) FILTER (WHERE kind = 'payable' AND due_date BETWEEN today.d AND today.d + 7), 0)::numeric(14,2)::text AS "payableNext7",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable'), 0)::numeric(14,2)::text AS "receivableOpen",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable' AND due_date < today.d), 0)::numeric(14,2)::text AS "receivableOverdue",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable' AND due_date BETWEEN today.d AND today.d + 7), 0)::numeric(14,2)::text AS "receivableNext7"
           FROM today LEFT JOIN finance_entries e ON e.status = 'open'
          GROUP BY today.d`,
      );
      const month = await one<Record<string, string>>(
        tx,
        `SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'payable' AND due_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "payableDue",
                COALESCE(sum(amount) FILTER (WHERE kind = 'payable' AND status = 'paid' AND paid_at BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "paid",
                COALESCE(sum(amount) FILTER (WHERE kind = 'payable' AND status = 'open' AND due_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "payableLeft",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable' AND due_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "receivableDue",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable' AND status = 'paid' AND paid_at BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "received",
                COALESCE(sum(amount) FILTER (WHERE kind = 'receivable' AND status = 'open' AND due_date BETWEEN $1 AND $2), 0)::numeric(14,2)::text AS "receivableLeft"
           FROM finance_entries WHERE status <> 'cancelled'`,
        [period.from, period.to],
      );
      const cash = await one<{ sales: string; refunds: string }>(
        tx,
        `SELECT COALESCE(sum(m.amount) FILTER (WHERE m.kind = 'sale'), 0)::numeric(14,2)::text AS sales,
                COALESCE(-sum(m.amount) FILTER (WHERE m.kind = 'refund'), 0)::numeric(14,2)::text AS refunds
           FROM cash_movements m CROSS JOIN tenants tz
          WHERE m.kind IN ('sale','refund')
            AND m.created_at >= ($1::date::timestamp AT TIME ZONE tz.timezone)
            AND m.created_at < (($2::date + 1)::timestamp AT TIME ZONE tz.timezone)`,
        [period.from, period.to],
      );
      // Taxas das maquininhas dos caixas fechados no período (lançadas no fechamento).
      const fees = await one<{ fees: string }>(
        tx,
        `SELECT COALESCE(sum(fee), 0)::numeric(14,2)::text AS fees FROM finance_settlements
          WHERE day BETWEEN $1 AND $2`,
        [period.from, period.to],
      );
      // Saldo do mês em centavos inteiros: vendas + recebidas − estornos − taxas − pagas.
      const net = fromCents(
        toCents(cash!.sales) +
          toCents(month!.received!) -
          toCents(cash!.refunds) -
          toCents(fees!.fees) -
          toCents(month!.paid!),
      );
      return {
        ...open,
        month: {
          ...period,
          monthStartDay: s.monthStartDay,
          ...month,
          ...cash,
          fees: fees!.fees,
          net,
        },
      };
    });
  }

  /**
   * Fluxo de caixa diário (fuso do restaurante): entradas = vendas recebidas (caixa) +
   * contas recebidas; saídas = estornos + taxas das maquininhas + contas pagas. Mais o previsto
   * (em aberto por vencimento).
   */
  @Get('cash-flow')
  @RequirePermission('finance:read')
  cashFlow(
    @Query(new ZodPipe(Period)) p: z.infer<typeof Period>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const days = await q<{
        day: string;
        sales: string;
        refunds: string;
        received: string;
        paid: string;
        fees: string;
        expectedIn: string;
        expectedOut: string;
      }>(
        tx,
        `WITH tz AS (SELECT timezone FROM tenants),
         days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day),
         cm AS (SELECT (m.created_at AT TIME ZONE tz.timezone)::date AS day,
                       sum(m.amount) FILTER (WHERE m.kind = 'sale') AS sales,
                       -sum(m.amount) FILTER (WHERE m.kind = 'refund') AS refunds
                  FROM cash_movements m CROSS JOIN tz
                 WHERE m.kind IN ('sale','refund')
                   AND m.created_at >= ($1::date::timestamp AT TIME ZONE tz.timezone)
                   AND m.created_at < (($2::date + 1)::timestamp AT TIME ZONE tz.timezone)
                 GROUP BY 1),
         fe AS (SELECT paid_at AS day,
                       sum(amount) FILTER (WHERE kind = 'receivable') AS received,
                       sum(amount) FILTER (WHERE kind = 'payable') AS paid
                  FROM finance_entries WHERE status = 'paid' AND paid_at BETWEEN $1 AND $2 GROUP BY 1),
         sf AS (SELECT day, sum(fee) AS fees FROM finance_settlements
                 WHERE day BETWEEN $1 AND $2 GROUP BY 1),
         fo AS (SELECT due_date AS day,
                       sum(amount) FILTER (WHERE kind = 'receivable') AS expected_in,
                       sum(amount) FILTER (WHERE kind = 'payable') AS expected_out
                  FROM finance_entries WHERE status = 'open' AND due_date BETWEEN $1 AND $2 GROUP BY 1)
         SELECT days.day::text, COALESCE(cm.sales, 0)::text AS sales, COALESCE(cm.refunds, 0)::text AS refunds,
                COALESCE(fe.received, 0)::text AS received, COALESCE(fe.paid, 0)::text AS paid,
                COALESCE(sf.fees, 0)::text AS fees,
                COALESCE(fo.expected_in, 0)::text AS "expectedIn", COALESCE(fo.expected_out, 0)::text AS "expectedOut"
           FROM days LEFT JOIN cm USING (day) LEFT JOIN fe USING (day) LEFT JOIN sf USING (day)
           LEFT JOIN fo USING (day)
          ORDER BY days.day`,
        [p.from, p.to],
      );
      // Somas em centavos inteiros (nunca float).
      const sum = (k: keyof (typeof days)[number]) => days.reduce((s, d) => s + toCents(d[k]), 0);
      const rows = days.map((d) => ({
        ...d,
        net: fromCents(
          toCents(d.sales) +
            toCents(d.received) -
            toCents(d.refunds) -
            toCents(d.fees) -
            toCents(d.paid),
        ),
      }));
      const totals = {
        sales: fromCents(sum('sales')),
        refunds: fromCents(sum('refunds')),
        received: fromCents(sum('received')),
        paid: fromCents(sum('paid')),
        fees: fromCents(sum('fees')),
        expectedIn: fromCents(sum('expectedIn')),
        expectedOut: fromCents(sum('expectedOut')),
        net: fromCents(sum('sales') + sum('received') - sum('refunds') - sum('fees') - sum('paid')),
      };
      return { from: p.from, to: p.to, days: rows, totals };
    });
  }

  /** Conciliação de um dia: o que o sistema registrou por forma de pagamento × o que foi informado. */
  @Get('reconciliation')
  @RequirePermission('finance:read')
  reconciliation(
    @Query(new ZodPipe(z.object({ day: isoDate }))) b: { day: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const system = await this.systemByMethod(tx, b.day);
      const saved = await q<{ method: string }>(
        tx,
        `SELECT r.method, r.system_amount::text AS "systemAmount", r.informed_amount::text AS "informedAmount",
                r.difference::text, r.note, r.created_at AS "createdAt", us.name AS "createdByName"
           FROM finance_reconciliations r LEFT JOIN users us ON us.id = r.created_by WHERE r.day = $1`,
        [b.day],
      );
      return {
        day: b.day,
        methods: PAYMENT_METHODS.map((m) => ({
          method: m,
          systemAmount: system.get(m) ?? '0.00',
          reconciliation: saved.find((s) => s.method === m) ?? null,
        })),
      };
    });
  }

  @Post('reconciliation')
  @RequirePermission('finance:write')
  reconcile(
    @Body(new ZodPipe(Reconcile)) b: z.infer<typeof Reconcile>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const system = (await this.systemByMethod(tx, b.day)).get(b.method) ?? '0.00';
      const diff = toCents(b.informedAmount) - toCents(system);
      if (diff !== 0 && !b.note)
        throw new UnprocessableEntityException('Há diferença: explique na observação');
      const r = await one(
        tx,
        `INSERT INTO finance_reconciliations (tenant_id, day, method, system_amount, informed_amount, difference, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, day, method) DO NOTHING
         RETURNING method, system_amount::text AS "systemAmount", informed_amount::text AS "informedAmount", difference::text, note`,
        [t.id, b.day, b.method, system, b.informedAmount, fromCents(diff), b.note ?? null, u.id],
      );
      if (!r) throw new ConflictException('Este dia e forma de pagamento já foram conciliados');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.reconciled',
        entity: 'finance_reconciliation',
        data: {
          day: b.day,
          method: b.method,
          system,
          informed: b.informedAmount,
          difference: fromCents(diff),
        },
        ip: req.ip,
      });
      return r;
    });
  }

  private async systemByMethod(tx: Tx, day: string) {
    const rows = await q<{ method: string; net: string }>(
      tx,
      `SELECT m.method, sum(m.amount)::text AS net
         FROM cash_movements m CROSS JOIN tenants tz
        WHERE m.kind IN ('sale','refund')
          AND m.created_at >= ($1::date::timestamp AT TIME ZONE tz.timezone)
          AND m.created_at < (($1::date + 1)::timestamp AT TIME ZONE tz.timezone)
        GROUP BY m.method`,
      [day],
    );
    return new Map(rows.map((r) => [r.method, r.net]));
  }

  private async loadSettings(tx: Tx) {
    const r = await one<{ day: number | null; terms: unknown; today: string }>(
      tx,
      `SELECT (SELECT month_start_day FROM finance_settings) AS day,
              (SELECT payment_terms FROM finance_settings) AS terms,
              (now() AT TIME ZONE timezone)::date::text AS today FROM tenants`,
    );
    const monthStartDay = r?.day ?? 1;
    const today = r!.today;
    return {
      monthStartDay,
      today,
      currentMonth: financeMonth(today, monthStartDay),
      paymentTerms: normalizePaymentTerms(r?.terms ?? null),
    };
  }

  private async lock(tx: Tx, id: string) {
    const e = await one<{ status: string; amount: string }>(
      tx,
      `SELECT status, amount::text FROM finance_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!e) throw new NotFoundException('Lançamento não encontrado');
    return e;
  }

  private async entry(tx: Tx, id: string) {
    return one(tx, `SELECT ${ENTRY_COLS} ${ENTRY_FROM} WHERE e.id = $1`, [id]);
  }
}
