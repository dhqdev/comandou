import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  buildDre,
  feeCents,
  fromCents,
  PAYMENT_METHODS,
  settlementDate,
  toCents,
  type PaymentMethod,
} from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { loadPaymentTerms, postCashSession } from './closing';
import { loadDreRaw } from './dre-data';

const Period = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, 'período inválido')
  .refine(
    (p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86_400_000,
    'período máximo de 1 ano',
  );
const SettlementsQuery = z.object({
  status: z.enum(['pending', 'received', 'all']).default('pending'),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
const DreQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    basis: z.enum(['accrual', 'cash']).default('accrual'),
    prevFrom: isoDate.optional(),
    prevTo: isoDate.optional(),
  })
  .refine((p) => p.from <= p.to, 'período inválido')
  .refine((p) => !p.prevFrom === !p.prevTo, 'informe o início e o fim do período anterior')
  .refine(
    (p) => Date.parse(p.to) - Date.parse(p.from) <= 366 * 86_400_000,
    'período máximo de 1 ano',
  );

interface SessionRow {
  id: string;
  number: number;
  status: 'open' | 'closed';
  registerName: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  closedByName: string | null;
  day: string;
  difference: string | null;
  cashDifference: string | null;
  closingNote: string | null;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Fechamento do dia no financeiro, recebíveis das maquininhas e DRE.
 *
 * Cada caixa fechado vira, na mesma transação do fechamento, um recebível por forma de pagamento
 * (bruto, taxa, líquido e dia previsto na conta). Esta tela junta os caixas por dia do movimento
 * (o dia em que abriram) e mostra o que já foi lançado, o que falta e o que já caiu no banco.
 */
@Controller({ path: 'finance', version: '1' })
export class FinanceCloseController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('closings')
  @RequirePermission('finance:read')
  closings(
    @Query(new ZodPipe(Period)) p: z.infer<typeof Period>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const sessions = await q<SessionRow>(
        tx,
        `SELECT s.id, s.number, s.status, r.name AS "registerName", s.opened_at AS "openedAt",
                s.closed_at AS "closedAt", uo.name AS "openedByName", uc.name AS "closedByName",
                (s.opened_at AT TIME ZONE tz.timezone)::date::text AS day, s.difference::text,
                CASE WHEN s.status = 'closed' THEN
                  (COALESCE((s.counted->>'cash')::numeric, 0) - COALESCE((s.expected->>'cash')::numeric, 0))::numeric(14,2)::text
                END AS "cashDifference",
                s.closing_note AS "closingNote"
           FROM cash_sessions s CROSS JOIN tenants tz
           JOIN cash_registers r ON r.id = s.register_id
           LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
          WHERE s.opened_at >= ($1::date::timestamp AT TIME ZONE tz.timezone)
            AND s.opened_at < (($2::date + 1)::timestamp AT TIME ZONE tz.timezone)
          ORDER BY s.opened_at`,
        [p.from, p.to],
      );
      const ids = sessions.map((s) => s.id);
      const moves = ids.length
        ? await q<{ sessionId: string; method: PaymentMethod; kind: string; total: string }>(
            tx,
            `SELECT cash_session_id AS "sessionId", method, kind, sum(amount)::text AS total
               FROM cash_movements WHERE cash_session_id = ANY($1::uuid[]) GROUP BY 1, 2, 3`,
            [ids],
          )
        : [];
      const settled = ids.length
        ? await q<{
            sessionId: string;
            method: PaymentMethod;
            gross: string;
            fee: string;
            net: string;
            expectedDate: string;
            receivedAt: string | null;
          }>(
            tx,
            `SELECT fs.cash_session_id AS "sessionId", fs.method, fs.gross::text, fs.fee::text, fs.net::text,
                    fs.expected_date::text AS "expectedDate", r.day::text AS "receivedAt"
               FROM finance_settlements fs LEFT JOIN bank_reconciliations r ON r.id = fs.reconciliation_id
              WHERE fs.cash_session_id = ANY($1::uuid[])`,
            [ids],
          )
        : [];
      const orders = ids.length
        ? await q<{ sessionId: string; orders: number; discounts: string; deliveryFees: string }>(
            tx,
            `SELECT x.sid AS "sessionId", count(*)::int AS orders,
                    COALESCE(sum(o.discount), 0)::text AS discounts,
                    COALESCE(sum(o.delivery_fee), 0)::text AS "deliveryFees"
               FROM (SELECT DISTINCT ON (order_id) order_id, cash_session_id AS sid
                       FROM cash_movements WHERE kind = 'sale' AND cash_session_id = ANY($1::uuid[])
                      ORDER BY order_id, id) x
               JOIN orders o ON o.id = x.order_id GROUP BY x.sid`,
            [ids],
          )
        : [];
      const terms = await loadPaymentTerms(tx);

      type MethodRow = {
        method: PaymentMethod;
        gross: number;
        fee: number;
        net: number;
        expectedDate: string;
        received: number;
        estimated: boolean;
      };
      type DayAcc = {
        day: string;
        sessions: (SessionRow & { posted: boolean; sales: string })[];
        methods: Map<PaymentMethod, MethodRow>;
        t: Record<string, number>;
      };
      const days = new Map<string, DayAcc>();
      for (const s of sessions) {
        const d: DayAcc = days.get(s.day) ?? {
          day: s.day,
          sessions: [],
          methods: new Map(),
          t: {
            orders: 0,
            discounts: 0,
            deliveryFees: 0,
            supplies: 0,
            withdrawals: 0,
            opening: 0,
            cashDifference: 0,
          },
        };
        days.set(s.day, d);
        const mv = moves.filter((m) => m.sessionId === s.id);
        const st = settled.filter((x) => x.sessionId === s.id);
        let sales = 0;
        for (const m of PAYMENT_METHODS) {
          const gross = mv
            .filter((x) => x.method === m && (x.kind === 'sale' || x.kind === 'refund'))
            .reduce((a, x) => a + toCents(x.total), 0);
          sales += gross;
          const posted = st.find((x) => x.method === m);
          if (!gross && !posted) continue;
          const row = d.methods.get(m) ?? {
            method: m,
            gross: 0,
            fee: 0,
            net: 0,
            expectedDate: '',
            received: 0,
            estimated: false,
          };
          const fee = posted
            ? toCents(posted.fee)
            : m === 'cash'
              ? 0
              : feeCents(gross, terms[m].feePercent);
          const exp =
            posted?.expectedDate ?? settlementDate(s.day, m === 'cash' ? 0 : terms[m].days);
          row.gross += posted ? toCents(posted.gross) : gross;
          row.fee += fee;
          row.net += posted ? toCents(posted.net) : gross - fee;
          if (posted?.receivedAt) row.received += toCents(posted.net);
          row.expectedDate = row.expectedDate && row.expectedDate > exp ? row.expectedDate : exp;
          row.estimated ||= !posted;
          d.methods.set(m, row);
        }
        const kindSum = (k: string) =>
          mv.filter((x) => x.kind === k).reduce((a, x) => a + toCents(x.total), 0);
        d.t.supplies! += kindSum('supply');
        d.t.withdrawals! -= kindSum('withdrawal');
        d.t.opening! += kindSum('opening');
        if (s.cashDifference) d.t.cashDifference! += toCents(s.cashDifference);
        const o = orders.find((x) => x.sessionId === s.id);
        if (o) {
          d.t.orders! += o.orders;
          d.t.discounts! += toCents(o.discounts);
          d.t.deliveryFees! += toCents(o.deliveryFees);
        }
        // Sem venda não há o que lançar: conta como lançado.
        const nothing = PAYMENT_METHODS.every(
          (m) =>
            mv
              .filter((x) => x.method === m && (x.kind === 'sale' || x.kind === 'refund'))
              .reduce((a, x) => a + toCents(x.total), 0) === 0,
        );
        d.sessions.push({
          ...s,
          posted: s.status === 'closed' && (st.length > 0 || nothing),
          sales: fromCents(sales),
        });
      }
      return {
        from: p.from,
        to: p.to,
        days: [...days.values()]
          .sort((a, b) => b.day.localeCompare(a.day))
          .map((d) => {
            const methods = [...d.methods.values()].sort(
              (a, b) => PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method),
            );
            const gross = methods.reduce((a, m) => a + m.gross, 0);
            const fee = methods.reduce((a, m) => a + m.fee, 0);
            const status = d.sessions.some((s) => s.status === 'open')
              ? 'open'
              : d.sessions.every((s) => s.posted)
                ? 'posted'
                : 'pending';
            return {
              day: d.day,
              status,
              sessions: d.sessions,
              methods: methods.map((m) => ({
                method: m.method,
                gross: fromCents(m.gross),
                fee: fromCents(m.fee),
                net: fromCents(m.net),
                expectedDate: m.expectedDate,
                received: m.received !== 0 && m.received === m.net,
                receivedAmount: fromCents(m.received),
                estimated: m.estimated,
              })),
              totals: {
                gross: fromCents(gross),
                fee: fromCents(fee),
                net: fromCents(gross - fee),
                orders: d.t.orders,
                ticket: d.t.orders ? fromCents(Math.round(gross / d.t.orders!)) : '0.00',
                discounts: fromCents(d.t.discounts!),
                deliveryFees: fromCents(d.t.deliveryFees!),
                opening: fromCents(d.t.opening!),
                supplies: fromCents(d.t.supplies!),
                withdrawals: fromCents(d.t.withdrawals!),
                cashDifference: fromCents(d.t.cashDifference!),
              },
            };
          }),
      };
    });
  }

  /** Lança no financeiro um caixa fechado antes desta função existir (ou que ficou de fora). */
  @Post('closings/:sessionId/post')
  @RequirePermission('finance:write')
  post(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const s = await one<{ status: string }>(
        tx,
        `SELECT status FROM cash_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      if (!s) throw new NotFoundException('Sessão de caixa não encontrada');
      if (s.status !== 'closed')
        throw new ConflictException(
          'O caixa ainda está aberto: ele vai para o financeiro ao fechar',
        );
      const posted = await postCashSession(tx, t.id, u.id, sessionId);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'finance.session_posted',
        entity: 'cash_session',
        entityId: sessionId,
        data: { posted },
        ip: req.ip,
      });
      return { posted };
    });
  }

  /** Recebíveis dos caixas (a receber das maquininhas, PIX e vale) e o que já caiu. */
  @Get('settlements')
  @RequirePermission('finance:read')
  settlements(
    @Query(new ZodPipe(SettlementsQuery)) f: z.infer<typeof SettlementsQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const rows = await q(
        tx,
        `SELECT fs.id, fs.day::text, fs.method, fs.gross::text, fs.fee_percent::text AS "feePercent",
                fs.fee::text, fs.net::text, fs.expected_date::text AS "expectedDate",
                fs.cash_session_id AS "sessionId", s.number AS "sessionNumber", cr.name AS "registerName",
                fs.reconciliation_id AS "reconciliationId", r.day::text AS "receivedAt", r.kind AS "receivedBy",
                r.difference::text AS "reconciliationDifference",
                (fs.reconciliation_id IS NULL AND fs.expected_date < (now() AT TIME ZONE tz.timezone)::date) AS late
           FROM finance_settlements fs CROSS JOIN tenants tz
           JOIN cash_sessions s ON s.id = fs.cash_session_id
           JOIN cash_registers cr ON cr.id = s.register_id
           LEFT JOIN bank_reconciliations r ON r.id = fs.reconciliation_id
          WHERE ($1::text = 'all' OR ($1::text = 'pending') = (fs.reconciliation_id IS NULL))
            AND ($2::date IS NULL OR fs.expected_date >= $2) AND ($3::date IS NULL OR fs.expected_date <= $3)
          ORDER BY fs.expected_date, fs.method, s.number LIMIT 1000`,
        [f.status, f.from ?? null, f.to ?? null],
      );
      const totals = await one<{ pending: string; late: string; next7: string; count: number }>(
        tx,
        `WITH today AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM tenants)
         SELECT COALESCE(sum(net), 0)::numeric(14,2)::text AS pending,
                COALESCE(sum(net) FILTER (WHERE expected_date < today.d), 0)::numeric(14,2)::text AS late,
                COALESCE(sum(net) FILTER (WHERE expected_date BETWEEN today.d AND today.d + 7), 0)::numeric(14,2)::text AS next7,
                count(fs.id)::int AS count
           FROM today LEFT JOIN finance_settlements fs ON fs.reconciliation_id IS NULL
          GROUP BY today.d`,
      );
      return { rows, totals };
    });
  }

  /**
   * DRE gerencial do período (e do período anterior, para comparar): do faturamento ao lucro,
   * com o CMV, as despesas por grupo do plano de contas e os indicadores do setor.
   */
  @Get('dre')
  @RequirePermission('finance:read')
  dre(
    @Query(new ZodPipe(DreQuery)) p: z.infer<typeof DreQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
    const prev =
      p.prevFrom && p.prevTo
        ? { from: p.prevFrom, to: p.prevTo }
        : { from: addDays(p.from, -(len + 1)), to: addDays(p.from, -1) };
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const [cur, before] = [
        await loadDreRaw(tx, p.from, p.to, p.basis),
        await loadDreRaw(tx, prev.from, prev.to, p.basis),
      ];
      return {
        from: p.from,
        to: p.to,
        basis: p.basis,
        dre: buildDre(cur),
        previous: { ...prev, dre: buildDre(before) },
      };
    });
  }
}
