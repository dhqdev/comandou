import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  periodDays,
  DEFAULT_STAFF_PAY_RULE,
  describeStaffPay,
  fromCents,
  nextDay,
  ROLE_LABELS,
  staffPay,
  staffRuleEmpty,
  toCents,
  type Role,
  type StaffPayBreakdown,
  type StaffPayMethod,
  type StaffPayRule,
} from '@comandou/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { CourierPayService } from '../delivery/courier-pay.service';

const money = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'valor inválido')
  .transform((v) => fromCents(toCents(v)));
const pct = z.number().min(0).max(100).multipleOf(0.01);

export const StaffRule = z.object({
  monthly: money,
  dailyRate: money,
  salesPercent: pct,
  servicePercent: pct,
});

/** Lê o JSON do banco completando campos novos com o padrão (o formato pode crescer). */
const parseRule = (v: unknown): StaffPayRule => {
  const r = StaffRule.safeParse({ ...DEFAULT_STAFF_PAY_RULE, ...(v as object) });
  return r.success ? r.data : DEFAULT_STAFF_PAY_RULE;
};

const TZ = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;

/** Começo e fim (exclusivo) dos dias `from`..`to` no fuso do restaurante. */
const RANGE = `created_at >= ($2::date::timestamp AT TIME ZONE ${TZ})
           AND created_at < (($3::date + 1)::timestamp AT TIME ZONE ${TZ})`;

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

interface Member {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'revoked';
  since: string;
  rule: unknown;
  pix_key: string | null;
}

/** Uma pessoa na visão de pagamentos (Equipe › Pagamentos). */
export interface StaffPerson {
  userId: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  status: string;
  /** Entregador: pago pelo Acerto de Entregas (sem conta aqui). */
  courier: boolean;
  ruleText: string;
  hasRule: boolean;
  /** O que tem a receber agora (bruto; do entregador, o líquido do Acerto). */
  pending: string;
  monthEarned: string;
  draft: StaffDraft | null;
  monthPaid: string;
  scheduled: string;
  totalPaid: string;
  payouts: number;
  lastPaidAt: Date | null;
  monthDays: number;
  monthOrders: number;
  monthSales: string;
}

export interface StaffDraft extends StaffPayBreakdown {
  userId: string;
  name: string;
  role: Role;
  roleLabel: string;
  pixKey: string | null;
  rule: StaffPayRule;
  ruleText: string;
  hasRule: boolean;
  from: string;
  to: string;
  /** Último dia já pago (pagamento não cancelado no Financeiro). */
  paidUntil: string | null;
  /** Dias em que a pessoa entrou no sistema no período (o que o sistema viu). */
  workdays: number;
  /** Dias usados nas diárias (os vistos, ou os que o gerente informou). */
  days: number;
  orders: number;
  sales: string;
  service: string;
}

/**
 * Pagamento da equipe (todos os papéis menos o entregador, pago pelo Acerto de Entregas).
 * O que a pessoa tem a receber é calculado na hora: salário proporcional ao período, diárias
 * pelos dias em que ela entrou no sistema, comissão sobre as vendas e parte da taxa de serviço
 * dos pedidos que ela lançou. Pagar grava o pagamento e SEMPRE lança no Financeiro (Salários):
 * pago na hora ou agendado para um dia. Lançamento cancelado no Financeiro desfaz o pagamento.
 */
@Injectable()
export class StaffPayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly couriers: CourierPayService,
  ) {}

  private today(tx: Tx) {
    return one<{ d: string }>(
      tx,
      `SELECT to_char(now() AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d`,
    ).then((r) => r!.d);
  }

  private async member(tx: Tx, userId: string): Promise<Member> {
    const m = await one<Member>(
      tx,
      `SELECT m.user_id, u.name, u.email, m.role, m.status,
              to_char(m.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS since,
              p.rule, p.pix_key
         FROM memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN staff_pay_profiles p ON p.user_id = m.user_id
        WHERE m.user_id = $1`,
      [userId],
    );
    if (!m) throw new NotFoundException('Pessoa não encontrada na equipe');
    return m;
  }

  private async paidUntil(tx: Tx, userId: string) {
    const r = await one<{ d: string | null }>(
      tx,
      `SELECT to_char(max(p.period_to), 'YYYY-MM-DD') AS d
         FROM staff_payouts p JOIN finance_entries f ON f.id = p.finance_entry_id
        WHERE p.user_id = $1 AND f.status <> 'cancelled'`,
      [userId],
    );
    return r?.d ?? null;
  }

  /** Pedidos, vendas (itens com desconto) e taxa de serviço lançados pela pessoa no período. */
  private async sales(tx: Tx, userId: string, from: string, to: string) {
    const r = await one<{ orders: number; sales: string; service: string }>(
      tx,
      `SELECT count(*)::int AS orders,
              COALESCE(sum(GREATEST(subtotal - discount, 0)), 0)::numeric(14,2)::text AS sales,
              COALESCE(sum(surcharge), 0)::numeric(14,2)::text AS service
         FROM orders
        WHERE created_by = $1 AND status <> 'cancelled' AND ${RANGE}`,
      [userId, from, to],
    );
    return r!;
  }

  private async workdays(tx: Tx, userId: string, from: string, to: string) {
    const r = await one<{ n: number }>(
      tx,
      `SELECT count(*)::int AS n FROM staff_workdays
        WHERE user_id = $1 AND day BETWEEN $2::date AND $3::date`,
      [userId, from, to],
    );
    return r?.n ?? 0;
  }

  /**
   * Conta de um período, sem gravar. Sem `from`, começa no dia seguinte ao último pago (ou no
   * começo do mês, ou na entrada da pessoa na equipe, o que vier depois). Sem `to`, vai até hoje.
   */
  async draft(
    tx: Tx,
    userId: string,
    o: { from?: string; to?: string; days?: number; adjustments?: string } = {},
  ): Promise<StaffDraft> {
    const m = await this.member(tx, userId);
    const today = await this.today(tx);
    const paidUntil = await this.paidUntil(tx, userId);
    const monthStart = `${today.slice(0, 8)}01`;
    const auto = paidUntil ? nextDay(paidUntil) : m.since > monthStart ? m.since : monthStart;
    const from = o.from ?? auto;
    // Já pago até hoje: o período "a pagar" fica vazio (de amanhã a hoje → zero dias).
    const to = o.to ?? (from > today ? from : today);
    if (o.from || o.to) {
      if (to < from) throw new BadRequestException('O fim do período vem antes do começo');
      if (paidUntil && from <= paidUntil)
        throw new ConflictException(
          `Esse período já foi pago até ${fmtDay(paidUntil)}. Comece em ${fmtDay(nextDay(paidUntil))}.`,
        );
      if (periodDays(from, to) > 62)
        throw new BadRequestException('Pague no máximo dois meses de cada vez');
    }
    const empty = !o.from && !o.to && from > today;
    const rule = m.rule ? parseRule(m.rule) : DEFAULT_STAFF_PAY_RULE;
    const s = empty
      ? { orders: 0, sales: '0.00', service: '0.00' }
      : await this.sales(tx, userId, from, to);
    const workdays = empty ? 0 : await this.workdays(tx, userId, from, to);
    const days = o.days ?? workdays;
    if (days > periodDays(from, to))
      throw new BadRequestException('Mais dias trabalhados do que dias no período');
    const b = empty
      ? staffPay(DEFAULT_STAFF_PAY_RULE, {
          from,
          to,
          days: 0,
          sales: '0',
          service: '0',
          adjustments: o.adjustments ?? '0',
        })
      : staffPay(rule, {
          from,
          to,
          days,
          sales: s.sales,
          service: s.service,
          adjustments: o.adjustments ?? '0',
        });
    return {
      userId,
      name: m.name,
      role: m.role,
      roleLabel: ROLE_LABELS[m.role] ?? m.role,
      pixKey: m.pix_key,
      rule,
      ruleText: describeStaffPay(rule),
      hasRule: !staffRuleEmpty(rule),
      from,
      to,
      paidUntil,
      workdays,
      days,
      orders: s.orders,
      sales: s.sales,
      service: s.service,
      ...b,
    };
  }

  preview(
    ctx: Ctx,
    userId: string,
    o: { from?: string; to?: string; days?: number; adjustments?: string },
  ) {
    return this.db.withTenant(ctx, (tx) => this.draft(tx, userId, o));
  }

  /** Regra de pagamento e chave Pix de uma pessoa. */
  saveRule(ctx: Ctx, userId: string, b: { rule: StaffPayRule; pixKey?: string | null }) {
    return this.db.withTenant(ctx, async (tx) => {
      const m = await this.member(tx, userId);
      if (m.role === 'driver')
        throw new ConflictException(
          'Entregador recebe pelas corridas: a regra fica em Entregas › Acerto.',
        );
      await q(
        tx,
        `INSERT INTO staff_pay_profiles (tenant_id, user_id, rule, pix_key, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET rule = EXCLUDED.rule,
                pix_key = EXCLUDED.pix_key, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [ctx.tenantId, userId, JSON.stringify(b.rule), b.pixKey?.trim() || null, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'staff.pay_rule_updated',
        entity: 'user',
        entityId: userId,
        data: { rule: b.rule, pixKey: b.pixKey ? 'informada' : null },
        ip: ctx.ip,
      });
      return this.draft(tx, userId);
    });
  }

  /**
   * Paga um período: grava o pagamento e o lançamento em Financeiro › Salários (pago hoje, ou em
   * aberto com o vencimento escolhido). Uma operação por pessoa de cada vez (trava consultiva):
   * o mesmo período nunca é pago duas vezes.
   */
  pay(
    ctx: Ctx,
    userId: string,
    b: {
      from?: string;
      to?: string;
      days?: number;
      adjustments: string;
      method: StaffPayMethod;
      notes?: string | null;
      paidNow: boolean;
      dueDate?: string;
    },
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      await q(tx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `staff-pay:${ctx.tenantId}:${userId}`,
      ]);
      const m = await this.member(tx, userId);
      if (m.role === 'driver')
        throw new ConflictException('Entregador é pago em Entregas › Acerto.');
      const d = await this.draft(tx, userId, {
        from: b.from,
        to: b.to,
        days: b.days,
        adjustments: b.adjustments,
      });
      if (!b.from && !b.to && d.from > (await this.today(tx)))
        throw new ConflictException('Já está tudo pago até hoje');
      if (toCents(d.gross) <= 0) throw new ConflictException('Não há valor a pagar nesse período');
      if (!b.paidNow && !b.dueDate) throw new BadRequestException('Escolha o dia do pagamento');
      const fe = await one<{ id: string }>(
        tx,
        `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount,
                                      due_date, status, paid_at, paid_method, settled_by, created_by)
         VALUES ($1, 'payable', $2, 'Salários', $3, $4,
                 CASE WHEN $5 THEN (now() AT TIME ZONE ${TZ})::date ELSE $6::date END,
                 CASE WHEN $5 THEN 'paid' ELSE 'open' END,
                 CASE WHEN $5 THEN (now() AT TIME ZONE ${TZ})::date END,
                 CASE WHEN $5 THEN $7 END,
                 CASE WHEN $5 THEN $8::uuid END, $8)
         RETURNING id`,
        [
          ctx.tenantId,
          `Pagamento de ${d.name} (${d.roleLabel}) · ${fmtDay(d.from)} a ${fmtDay(d.to)}`.slice(
            0,
            200,
          ),
          d.name,
          d.gross,
          b.paidNow,
          b.dueDate ?? null,
          b.method,
          ctx.userId,
        ],
      );
      const p = await one<{ id: string }>(
        tx,
        `INSERT INTO staff_payouts (tenant_id, user_id, role, period_from, period_to, days_worked,
                orders, sales, service, salary, daily, commission, service_share, adjustments, gross,
                rule, method, notes, finance_entry_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          ctx.tenantId,
          userId,
          d.role,
          d.from,
          d.to,
          d.days,
          d.orders,
          d.sales,
          d.service,
          d.salary,
          d.daily,
          d.commission,
          d.serviceShare,
          d.adjustments,
          d.gross,
          JSON.stringify(d.rule),
          b.method,
          b.notes?.trim() || null,
          fe!.id,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'staff.payout_created',
        entity: 'staff_payout',
        entityId: p!.id,
        data: { userId, from: d.from, to: d.to, gross: d.gross, paidNow: b.paidNow },
        ip: ctx.ip,
      });
      return { id: p!.id, financeEntryId: fe!.id, ...d };
    });
  }

  private payouts(tx: Tx, userId: string | null, limit: number) {
    return q(
      tx,
      `SELECT p.id, p.user_id AS "userId", u.name, p.role,
              to_char(p.period_from, 'YYYY-MM-DD') AS "from", to_char(p.period_to, 'YYYY-MM-DD') AS "to",
              p.days_worked AS days, p.orders, p.sales::text, p.service::text, p.salary::text,
              p.daily::text, p.commission::text, p.service_share::text AS "serviceShare",
              p.adjustments::text, p.gross::text, p.method, p.notes, p.paid_at AS "createdAt",
              f.status, to_char(f.due_date, 'YYYY-MM-DD') AS "dueDate",
              to_char(f.paid_at, 'YYYY-MM-DD') AS "paidAt"
         FROM staff_payouts p
         JOIN users u ON u.id = p.user_id
         JOIN finance_entries f ON f.id = p.finance_entry_id
        WHERE ($1::uuid IS NULL OR p.user_id = $1)
        ORDER BY p.paid_at DESC
        LIMIT $2`,
      [userId, limit],
    );
  }

  history(ctx: Ctx, userId: string) {
    return this.db.withTenant(ctx, (tx) => this.payouts(tx, userId, 60));
  }

  /**
   * Visão do dono (Equipe › Pagamentos): por pessoa, o que tem a receber agora, o que foi pago
   * no mês e no total; o entregador vem do Acerto de Entregas (o que falta e o que fez no mês).
   */
  overview(ctx: Ctx, month: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const monthEnd = await one<{ d: string }>(
        tx,
        `SELECT to_char(($1::date + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD') AS d`,
        [`${month}-01`],
      );
      const from = `${month}-01`;
      const to = monthEnd!.d;
      const members = await q<{ user_id: string; status: string; role: Role; email: string }>(
        tx,
        `SELECT m.user_id, m.status, m.role, u.email FROM memberships m
           JOIN users u ON u.id = m.user_id ORDER BY m.status, u.name`,
      );
      const paid = await q<{
        user_id: string;
        month_paid: string;
        month_open: string;
        total_paid: string;
        count: number;
        last_at: Date | null;
      }>(
        tx,
        `SELECT p.user_id,
                COALESCE(sum(p.gross) FILTER (WHERE f.status = 'paid'
                  AND f.paid_at BETWEEN $1::date AND $2::date), 0)::numeric(14,2)::text AS month_paid,
                COALESCE(sum(p.gross) FILTER (WHERE f.status = 'open'), 0)::numeric(14,2)::text AS month_open,
                COALESCE(sum(p.gross) FILTER (WHERE f.status = 'paid'), 0)::numeric(14,2)::text AS total_paid,
                count(*) FILTER (WHERE f.status <> 'cancelled')::int AS count,
                max(p.paid_at) FILTER (WHERE f.status <> 'cancelled') AS last_at
           FROM staff_payouts p JOIN finance_entries f ON f.id = p.finance_entry_id
          GROUP BY p.user_id`,
        [from, to],
      );
      const linked = await q<{ id: string; user_id: string }>(
        tx,
        `SELECT id, user_id FROM couriers WHERE user_id IS NOT NULL`,
      );
      const people: StaffPerson[] = [];
      for (const m of members) {
        const pd = paid.find((x) => x.user_id === m.user_id);
        const s = await this.sales(tx, m.user_id, from, to);
        const monthDays = await this.workdays(tx, m.user_id, from, to);
        const base = {
          monthPaid: pd?.month_paid ?? '0.00',
          scheduled: pd?.month_open ?? '0.00',
          totalPaid: pd?.total_paid ?? '0.00',
          payouts: pd?.count ?? 0,
          lastPaidAt: pd?.last_at ?? null,
          monthDays,
          monthOrders: s.orders,
          monthSales: s.sales,
        };
        if (m.role === 'driver') {
          const c = linked.find((x) => x.user_id === m.user_id);
          const e = c ? await this.couriers.courierEarnings(tx, c.id) : null;
          const who = await this.member(tx, m.user_id);
          people.push({
            userId: m.user_id,
            name: who.name,
            email: m.email,
            role: m.role,
            roleLabel: ROLE_LABELS[m.role],
            status: m.status,
            courier: true,
            ruleText: e?.rule ?? 'Pelas corridas (Entregas › Acerto)',
            hasRule: true,
            pending: e ? e.pending.net : '0.00',
            monthEarned: e ? e.month.total : '0.00',
            draft: null,
            ...base,
          });
          continue;
        }
        const d = await this.draft(tx, m.user_id);
        people.push({
          userId: m.user_id,
          name: d.name,
          email: m.email,
          role: m.role,
          roleLabel: d.roleLabel,
          status: m.status,
          courier: false,
          ruleText: d.ruleText,
          hasRule: d.hasRule,
          pending: toCents(d.gross) > 0 ? d.gross : '0.00',
          monthEarned: fromCents(toCents(base.monthPaid) + toCents(base.scheduled)),
          draft: d,
          ...base,
        });
      }
      const sum = (k: 'pending' | 'monthPaid' | 'scheduled' | 'totalPaid') =>
        fromCents(people.reduce((a, p) => a + toCents(p[k]), 0));
      return {
        month,
        totals: {
          pending: sum('pending'),
          monthPaid: sum('monthPaid'),
          scheduled: sum('scheduled'),
          totalPaid: sum('totalPaid'),
          people: people.filter((p) => p.status === 'active').length,
        },
        people,
        recent: await this.payouts(tx, null, 20),
      };
    });
  }

  /**
   * Perfil de quem está logado (app do garçom › Perfil): como recebe, o que tem a receber desde
   * o último pagamento, o mês (dias, pedidos, vendas, taxa) e os pagamentos recebidos.
   */
  me(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const userId = ctx.userId!;
      const m = await this.member(tx, userId);
      const today = await this.today(tx);
      const from = `${today.slice(0, 8)}01`;
      const s = await this.sales(tx, userId, from, today);
      const all = await one<{ orders: number; sales: string }>(
        tx,
        `SELECT count(*)::int AS orders,
                COALESCE(sum(GREATEST(subtotal - discount, 0)), 0)::numeric(14,2)::text AS sales
           FROM orders WHERE created_by = $1 AND status <> 'cancelled'`,
        [userId],
      );
      const days = await q<{ day: string; first: Date; last: Date }>(
        tx,
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, first_at AS first, last_at AS last
           FROM staff_workdays WHERE user_id = $1 AND day >= $2::date ORDER BY day DESC`,
        [userId, from],
      );
      const payouts = await this.payouts(tx, userId, 12);
      const earned = await one<{ paid: string; open: string }>(
        tx,
        `SELECT COALESCE(sum(p.gross) FILTER (WHERE f.status = 'paid'), 0)::numeric(14,2)::text AS paid,
                COALESCE(sum(p.gross) FILTER (WHERE f.status = 'open'), 0)::numeric(14,2)::text AS open
           FROM staff_payouts p JOIN finance_entries f ON f.id = p.finance_entry_id
          WHERE p.user_id = $1`,
        [userId],
      );
      const pending = m.role === 'driver' ? null : await this.draft(tx, userId);
      return {
        name: m.name,
        role: m.role,
        roleLabel: ROLE_LABELS[m.role] ?? m.role,
        since: m.since,
        pending,
        month: {
          from,
          to: today,
          days: days.length,
          orders: s.orders,
          sales: s.sales,
          service: s.service,
        },
        allTime: {
          orders: all?.orders ?? 0,
          sales: all?.sales ?? '0.00',
          received: earned?.paid ?? '0.00',
          scheduled: earned?.open ?? '0.00',
        },
        workdays: days,
        payouts,
      };
    });
  }
}
