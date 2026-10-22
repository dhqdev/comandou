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
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PAYMENT_METHODS, fromCents, isMoneyString, toCents } from '@pedemais/shared';
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
});
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
      const e = await one<{ id: string }>(
        tx,
        `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          t.id,
          b.kind,
          b.description,
          b.category ?? null,
          b.counterparty ?? null,
          b.amount,
          b.dueDate,
          u.id,
        ],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.entry_created',
        entity: 'finance_entry',
        entityId: e!.id,
        data: { kind: b.kind, amount: b.amount, dueDate: b.dueDate },
        ip: req.ip,
      });
      return this.entry(tx, e!.id);
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

  @Get('summary')
  @RequirePermission('finance:read')
  summary(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      one(
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
      ),
    );
  }

  /**
   * Fluxo de caixa diário (fuso do restaurante): entradas = vendas recebidas (caixa) +
   * contas recebidas; saídas = estornos + contas pagas. Mais o previsto (em aberto por vencimento).
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
         fo AS (SELECT due_date AS day,
                       sum(amount) FILTER (WHERE kind = 'receivable') AS expected_in,
                       sum(amount) FILTER (WHERE kind = 'payable') AS expected_out
                  FROM finance_entries WHERE status = 'open' AND due_date BETWEEN $1 AND $2 GROUP BY 1)
         SELECT days.day::text, COALESCE(cm.sales, 0)::text AS sales, COALESCE(cm.refunds, 0)::text AS refunds,
                COALESCE(fe.received, 0)::text AS received, COALESCE(fe.paid, 0)::text AS paid,
                COALESCE(fo.expected_in, 0)::text AS "expectedIn", COALESCE(fo.expected_out, 0)::text AS "expectedOut"
           FROM days LEFT JOIN cm USING (day) LEFT JOIN fe USING (day) LEFT JOIN fo USING (day)
          ORDER BY days.day`,
        [p.from, p.to],
      );
      // Somas em centavos inteiros (nunca float).
      const sum = (k: keyof (typeof days)[number]) => days.reduce((s, d) => s + toCents(d[k]), 0);
      const rows = days.map((d) => ({
        ...d,
        net: fromCents(
          toCents(d.sales) + toCents(d.received) - toCents(d.refunds) - toCents(d.paid),
        ),
      }));
      const totals = {
        sales: fromCents(sum('sales')),
        refunds: fromCents(sum('refunds')),
        received: fromCents(sum('received')),
        paid: fromCents(sum('paid')),
        expectedIn: fromCents(sum('expectedIn')),
        expectedOut: fromCents(sum('expectedOut')),
        net: fromCents(sum('sales') + sum('received') - sum('refunds') - sum('paid')),
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
