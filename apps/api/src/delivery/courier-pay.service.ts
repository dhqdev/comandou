import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  COURIER_PAY_MODES,
  COURIER_TAX_REGIMES,
  courierTaxes,
  DEFAULT_COURIER_PAY_RULE,
  DEFAULT_COURIER_TAX_SETTINGS,
  deliveryPay,
  describePayRule,
  fromCents,
  routeDistanceM,
  toCents,
  type CourierPayRule,
  type CourierTaxRegime,
  type CourierTaxSettings,
} from '@comandou/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';

const money = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'valor inválido')
  .transform((v) => fromCents(toCents(v)));
const pct = z.number().min(0).max(100).multipleOf(0.01);

export const PayRule = z.object({
  mode: z.enum(COURIER_PAY_MODES as [CourierPayRule['mode'], ...CourierPayRule['mode'][]]),
  fixed: money,
  perKm: money,
  kmIncluded: z.number().min(0).max(100).multipleOf(0.1),
  feePercent: pct,
  minPerDelivery: money,
  failedPercent: pct,
  dailyRate: money,
});

export const TaxSettings = z.object({
  inssRate: pct,
  inssCeiling: money,
  withholdIrrf: z.boolean(),
  issRate: pct,
  employerRate: pct,
});

export const TaxRegime = z.enum(COURIER_TAX_REGIMES as [CourierTaxRegime, ...CourierTaxRegime[]]);

/** Lê o JSON do banco completando campos novos com o padrão (o formato pode crescer). */
const parseRule = (v: unknown): CourierPayRule => {
  const r = PayRule.safeParse({ ...DEFAULT_COURIER_PAY_RULE, ...(v as object) });
  return r.success ? r.data : DEFAULT_COURIER_PAY_RULE;
};
const parseTaxes = (v: unknown): CourierTaxSettings => {
  const r = TaxSettings.safeParse({ ...DEFAULT_COURIER_TAX_SETTINGS, ...(v as object) });
  return r.success ? r.data : DEFAULT_COURIER_TAX_SETTINGS;
};

/** Ponto da loja (o mesmo de delivery.service; repetido aqui para não criar ciclo com pedidos). */
async function storeAt(tx: Tx) {
  const s = await one<{ lat: string | null; lng: string | null }>(
    tx,
    `SELECT store_lat::text AS lat, store_lng::text AS lng FROM tenant_store_settings`,
  );
  return s?.lat && s.lng ? { lat: Number(s.lat), lng: Number(s.lng) } : null;
}

async function payConfig(tx: Tx) {
  const s = await one<{ rule: unknown; taxes: unknown; updated_at: Date }>(
    tx,
    `SELECT rule, taxes, updated_at FROM courier_pay_settings`,
  );
  return {
    rule: parseRule(s?.rule ?? {}),
    taxes: parseTaxes(s?.taxes ?? {}),
    updatedAt: s?.updated_at ?? null,
  };
}

/** Regra do entregador: a própria ou, sem ela, a da loja. */
export async function courierRule(tx: Tx, courierId: string) {
  const c = await one<{ pay_rule: unknown }>(tx, `SELECT pay_rule FROM couriers WHERE id = $1`, [
    courierId,
  ]);
  return c?.pay_rule ? parseRule(c.pay_rule) : (await payConfig(tx)).rule;
}

/**
 * Grava a distância e o ganho da corrida ao encerrar (entregue ou não), pela regra de agora.
 * Chamado na mesma transação que encerra a entrega (pelo entregador, pelo painel ou pelo pedido).
 */
export async function settleRide(tx: Tx, deliveryId: string, status: 'delivered' | 'failed') {
  const d = await one<{ courier_id: string; fee: string; lat: string | null; lng: string | null }>(
    tx,
    `SELECT d.courier_id, o.delivery_fee::text AS fee, o.delivery_lat::text AS lat, o.delivery_lng::text AS lng
       FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`,
    [deliveryId],
  );
  if (!d) return;
  const rule = await courierRule(tx, d.courier_id);
  const dist = routeDistanceM(
    await storeAt(tx),
    d.lat && d.lng ? { lat: Number(d.lat), lng: Number(d.lng) } : null,
  );
  const pay = deliveryPay(rule, { fee: d.fee, distanceM: dist, status });
  await q(
    tx,
    `UPDATE deliveries SET distance_m = $2, courier_pay = $3, payout_pending = true WHERE id = $1`,
    [deliveryId, dist, pay.amount],
  );
}

/** Estimativa de ganho das corridas na rua (o motoboy vê antes de entregar). */
export async function rideEstimates(
  tx: Tx,
  rows: { id: string; courierId: string; status: string }[],
) {
  const out: Record<string, string> = {};
  const open = rows.filter((r) => r.status === 'out');
  if (!open.length) return out;
  const store = await storeAt(tx);
  const info = await q<{ id: string; fee: string; lat: string | null; lng: string | null }>(
    tx,
    `SELECT d.id, o.delivery_fee::text AS fee, o.delivery_lat::text AS lat, o.delivery_lng::text AS lng
       FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ANY($1::uuid[])`,
    [open.map((r) => r.id)],
  );
  const rules = new Map<string, CourierPayRule>();
  for (const r of open) {
    if (!rules.has(r.courierId)) rules.set(r.courierId, await courierRule(tx, r.courierId));
    const i = info.find((x) => x.id === r.id);
    if (!i) continue;
    out[r.id] = deliveryPay(rules.get(r.courierId)!, {
      fee: i.fee,
      distanceM: routeDistanceM(
        store,
        i.lat && i.lng ? { lat: Number(i.lat), lng: Number(i.lng) } : null,
      ),
      status: 'delivered',
    }).amount;
  }
  return out;
}

const TZ = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;

interface CourierRow {
  id: string;
  name: string;
  tax_regime: CourierTaxRegime;
  pay_rule: unknown;
  pix_key: string | null;
  active: boolean;
}

export interface PayoutDraft {
  courierId: string;
  courierName: string;
  pixKey: string | null;
  taxRegime: CourierTaxRegime;
  periodFrom: string | null;
  periodTo: string;
  deliveries: number;
  failed: number;
  daysWorked: number;
  distanceM: number;
  rides: string;
  daily: string;
  adjustments: string;
  gross: string;
  inss: string;
  irrf: string;
  iss: string;
  withheld: string;
  net: string;
  employer: string;
  cost: string;
  rule: string;
}

/**
 * Ganhos dos entregadores. O valor de cada corrida é gravado quando ela encerra, pela regra
 * daquele momento (do entregador ou, sem regra própria, da loja). O repasse junta as corridas
 * pendentes até um dia, soma as diárias e calcula as retenções conforme o regime do motoboy.
 */
@Injectable()
export class CourierPayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  settingsIn(tx: Tx) {
    return payConfig(tx);
  }

  settings(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = await this.settingsIn(tx);
      return { ...s, description: describePayRule(s.rule) };
    });
  }

  saveSettings(ctx: Ctx, b: { rule: CourierPayRule; taxes: CourierTaxSettings }) {
    return this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `INSERT INTO courier_pay_settings (tenant_id, rule, taxes, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id) DO UPDATE SET rule = EXCLUDED.rule, taxes = EXCLUDED.taxes,
                updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [ctx.tenantId, JSON.stringify(b.rule), JSON.stringify(b.taxes), ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier_pay.settings_updated',
        entity: 'courier_pay_settings',
        entityId: ctx.tenantId,
        data: b,
        ip: ctx.ip,
      });
      const s = await this.settingsIn(tx);
      return { ...s, description: describePayRule(s.rule) };
    });
  }

  /** Regime, regra própria (null = a da loja) e chave Pix do entregador. */
  updateCourier(
    ctx: Ctx,
    id: string,
    b: { taxRegime?: CourierTaxRegime; payRule?: CourierPayRule | null; pixKey?: string | null },
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE couriers SET tax_regime = COALESCE($2, tax_regime),
                pay_rule = CASE WHEN $3 THEN $4::jsonb ELSE pay_rule END,
                pix_key = CASE WHEN $5 THEN $6 ELSE pix_key END
          WHERE id = $1 RETURNING id`,
        [
          id,
          b.taxRegime ?? null,
          b.payRule !== undefined,
          b.payRule ? JSON.stringify(b.payRule) : null,
          b.pixKey !== undefined,
          b.pixKey || null,
        ],
      );
      if (!r) throw new NotFoundException('Entregador não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier.pay_updated',
        entity: 'courier',
        entityId: id,
        data: b,
        ip: ctx.ip,
      });
      return { ok: true };
    });
  }

  private async courier(tx: Tx, id: string) {
    const c = await one<CourierRow>(
      tx,
      `SELECT id, name, tax_regime, pay_rule, pix_key, active FROM couriers WHERE id = $1`,
      [id],
    );
    if (!c) throw new NotFoundException('Entregador não encontrado');
    return c;
  }

  private async ruleOf(tx: Tx, c: CourierRow) {
    const s = await this.settingsIn(tx);
    return { rule: c.pay_rule ? parseRule(c.pay_rule) : s.rule, taxes: s.taxes, own: !!c.pay_rule };
  }

  /** Recalcula as corridas ainda não pagas com a regra atual (depois de mudar a regra). */
  recalculatePending(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<{ id: string; status: 'delivered' | 'failed' }>(
        tx,
        `SELECT id, status FROM deliveries WHERE payout_pending FOR UPDATE`,
      );
      for (const r of rows) await settleRide(tx, r.id, r.status);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier_pay.recalculated',
        entity: 'courier_pay_settings',
        entityId: ctx.tenantId,
        data: { deliveries: rows.length },
        ip: ctx.ip,
      });
      return { updated: rows.length };
    });
  }

  /** Repasse calculado (sem gravar): corridas pendentes do entregador até o dia `until`. */
  private async draft(
    tx: Tx,
    courierId: string,
    until: string,
    adjustments: string,
  ): Promise<PayoutDraft> {
    const c = await this.courier(tx, courierId);
    const { rule, taxes } = await this.ruleOf(tx, c);
    const agg = await one<{
      delivered: number;
      failed: number;
      days: number;
      distance: string;
      rides: string;
      first: string | null;
    }>(
      tx,
      `SELECT count(*) FILTER (WHERE d.status = 'delivered')::int AS delivered,
              count(*) FILTER (WHERE d.status = 'failed')::int AS failed,
              count(DISTINCT (d.finished_at AT TIME ZONE ${TZ})::date)
                FILTER (WHERE d.status = 'delivered')::int AS days,
              COALESCE(sum(d.distance_m), 0)::text AS distance,
              COALESCE(sum(d.courier_pay), 0)::numeric(14,2)::text AS rides,
              to_char(min((d.finished_at AT TIME ZONE ${TZ})::date), 'YYYY-MM-DD') AS first
         FROM deliveries d
        WHERE d.courier_id = $1 AND d.payout_pending
          AND (d.finished_at AT TIME ZONE ${TZ})::date <= $2::date`,
      [courierId, until],
    );
    const a = agg!;
    const daily = a.days * toCents(rule.dailyRate);
    const gross = toCents(a.rides) + daily + toCents(adjustments);
    if (gross < 0) throw new ConflictException('O desconto é maior que o valor a receber');
    const month = await one<{ gross: string; inss: string; irrf: string }>(
      tx,
      `SELECT COALESCE(sum(gross), 0)::numeric(14,2)::text AS gross,
              COALESCE(sum(inss), 0)::numeric(14,2)::text AS inss,
              COALESCE(sum(irrf), 0)::numeric(14,2)::text AS irrf
         FROM courier_payouts
        WHERE courier_id = $1 AND tax_regime = 'autonomo'
          AND date_trunc('month', paid_at AT TIME ZONE ${TZ}) = date_trunc('month', now() AT TIME ZONE ${TZ})`,
      [courierId],
    );
    const t = courierTaxes(c.tax_regime, fromCents(gross), taxes, month!);
    return {
      courierId,
      courierName: c.name,
      pixKey: c.pix_key,
      taxRegime: c.tax_regime,
      periodFrom: a.first,
      periodTo: until,
      deliveries: a.delivered,
      failed: a.failed,
      daysWorked: a.days,
      distanceM: Number(a.distance),
      rides: a.rides,
      daily: fromCents(daily),
      adjustments: fromCents(toCents(adjustments)),
      ...t,
      rule: describePayRule(rule),
    };
  }

  private today(tx: Tx) {
    return one<{ d: string }>(tx, `SELECT to_char(now() AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d`);
  }

  preview(ctx: Ctx, courierId: string, until: string | undefined, adjustments: string) {
    return this.db.withTenant(ctx, async (tx) =>
      this.draft(tx, courierId, until ?? (await this.today(tx))!.d, adjustments),
    );
  }

  /**
   * Paga o entregador: grava o repasse, marca as corridas como pagas e, se pedido, lança no
   * Financeiro o valor pago (já baixado) e as retenções a recolher (vencem no dia 20 do mês
   * seguinte, como a guia do INSS e do IRRF).
   */
  pay(
    ctx: Ctx,
    b: {
      courierId: string;
      until?: string;
      adjustments: string;
      method: 'cash' | 'pix' | 'transfer' | 'other';
      notes?: string | null;
      toFinance: boolean;
    },
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      // Uma operação por entregador de cada vez: evita pagar a mesma corrida duas vezes.
      await q(tx, `SELECT id FROM couriers WHERE id = $1 FOR UPDATE`, [b.courierId]);
      const until = b.until ?? (await this.today(tx))!.d;
      const d = await this.draft(tx, b.courierId, until, b.adjustments);
      if (d.deliveries + d.failed === 0 && toCents(d.adjustments) === 0)
        throw new ConflictException('Nenhuma corrida pendente para pagar até esse dia');
      if (toCents(d.gross) === 0) throw new ConflictException('Não há valor a pagar');
      let financeId: string | null = null;
      if (b.toFinance) {
        const fe = await one<{ id: string }>(
          tx,
          `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date,
                                        status, paid_at, paid_method, settled_by, created_by)
           VALUES ($1,'payable',$2,'Entregadores',$3,$4,(now() AT TIME ZONE ${TZ})::date,'paid',
                   (now() AT TIME ZONE ${TZ})::date,$5,$6,$6) RETURNING id`,
          [
            ctx.tenantId,
            `Repasse ao entregador ${d.courierName} (${d.deliveries} entregas)`,
            d.courierName,
            d.net,
            b.method === 'transfer' ? 'transfer' : b.method,
            ctx.userId,
          ],
        );
        financeId = fe!.id;
        const taxesDue = toCents(d.withheld) + toCents(d.employer);
        if (taxesDue > 0)
          await q(
            tx,
            `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date, created_by)
             VALUES ($1,'payable',$2,'Impostos',$3,$4,
                     (date_trunc('month', now() AT TIME ZONE ${TZ}) + interval '1 month 19 days')::date,$5)`,
            [
              ctx.tenantId,
              `Impostos do repasse de ${d.courierName} (INSS, IRRF, ISS e patronal)`,
              'Receita Federal / Prefeitura',
              fromCents(taxesDue),
              ctx.userId,
            ],
          );
      }
      const p = await one<{ id: string }>(
        tx,
        `INSERT INTO courier_payouts (tenant_id, courier_id, period_from, period_to, deliveries, days_worked,
                distance_m, rides, daily, adjustments, gross, inss, irrf, iss, net, employer, tax_regime,
                method, notes, finance_entry_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [
          ctx.tenantId,
          b.courierId,
          d.periodFrom,
          d.periodTo,
          d.deliveries,
          d.daysWorked,
          d.distanceM,
          d.rides,
          d.daily,
          d.adjustments,
          d.gross,
          d.inss,
          d.irrf,
          d.iss,
          d.net,
          d.employer,
          d.taxRegime,
          b.method,
          b.notes || null,
          financeId,
          ctx.userId,
        ],
      );
      await q(
        tx,
        `UPDATE deliveries SET payout_pending = false, payout_id = $2
          WHERE courier_id = $1 AND payout_pending AND (finished_at AT TIME ZONE ${TZ})::date <= $3::date`,
        [b.courierId, p!.id, until],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier.payout_created',
        entity: 'courier_payout',
        entityId: p!.id,
        data: { courierId: b.courierId, gross: d.gross, net: d.net, until },
        ip: ctx.ip,
      });
      return { id: p!.id, ...d };
    });
  }

  /**
   * Relatório do mês para o dono: por entregador, o que ganhou no mês (corridas encerradas no
   * mês + diárias), quanto foi pago e retido, o que falta pagar e quanto custou para a loja;
   * por dia, o custo com entregadores; e as taxas de entrega cobradas dos clientes.
   */
  report(ctx: Ctx, month: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = await this.settingsIn(tx);
      const b = await one<{ a: Date; z: Date; tz: string }>(
        tx,
        `SELECT ($1::date::timestamp AT TIME ZONE ${TZ}) AS a,
                (($1::date + interval '1 month')::timestamp AT TIME ZONE ${TZ}) AS z, ${TZ} AS tz`,
        [`${month}-01`],
      );
      const p = [b!.a, b!.z, b!.tz];
      const couriers = await q<CourierRow & { phone: string | null }>(
        tx,
        `SELECT id, name, phone, tax_regime, pay_rule, pix_key, active FROM couriers ORDER BY active DESC, name`,
      );
      const rides = await q<{
        courier_id: string;
        delivered: number;
        failed: number;
        days: number;
        distance: string;
        rides: string;
      }>(
        tx,
        `SELECT courier_id, count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
                count(*) FILTER (WHERE status = 'failed')::int AS failed,
                count(DISTINCT (finished_at AT TIME ZONE $3)::date) FILTER (WHERE status = 'delivered')::int AS days,
                COALESCE(sum(distance_m), 0)::text AS distance,
                COALESCE(sum(courier_pay), 0)::numeric(14,2)::text AS rides
           FROM deliveries WHERE finished_at >= $1 AND finished_at < $2 AND status <> 'out'
          GROUP BY courier_id`,
        p,
      );
      const paid = await q<{
        courier_id: string;
        count: number;
        gross: string;
        withheld: string;
        net: string;
        employer: string;
      }>(
        tx,
        `SELECT courier_id, count(*)::int AS count, sum(gross)::numeric(14,2)::text AS gross,
                sum(inss + irrf + iss)::numeric(14,2)::text AS withheld,
                sum(net)::numeric(14,2)::text AS net, sum(employer)::numeric(14,2)::text AS employer
           FROM courier_payouts WHERE paid_at >= $1 AND paid_at < $2 GROUP BY courier_id`,
        [b!.a, b!.z],
      );
      const pending = await q<{ courier_id: string; count: number; rides: string; days: number }>(
        tx,
        `SELECT courier_id, count(*)::int AS count, sum(courier_pay)::numeric(14,2)::text AS rides,
                count(DISTINCT (finished_at AT TIME ZONE ${TZ})::date) FILTER (WHERE status = 'delivered')::int AS days
           FROM deliveries WHERE payout_pending GROUP BY courier_id`,
      );
      const lines = await Promise.all(
        couriers.map(async (c) => {
          const rule = c.pay_rule ? parseRule(c.pay_rule) : s.rule;
          const r = rides.find((x) => x.courier_id === c.id);
          const pd = paid.find((x) => x.courier_id === c.id);
          const pe = pending.find((x) => x.courier_id === c.id);
          const daily = (r?.days ?? 0) * toCents(rule.dailyRate);
          const earned = toCents(r?.rides ?? '0') + daily;
          // Custo estimado do mês: o que ganhou + patronal (autônomo, fora do Simples).
          const employer =
            c.tax_regime === 'autonomo' ? Math.round((earned * s.taxes.employerRate) / 100) : 0;
          const pendingGross = pe ? toCents(pe.rides) + pe.days * toCents(rule.dailyRate) : 0;
          const pendingTaxes = pendingGross
            ? (await this.draft(tx, c.id, '2999-12-31', '0')).withheld
            : '0.00';
          return {
            courierId: c.id,
            name: c.name,
            phone: c.phone,
            active: c.active,
            taxRegime: c.tax_regime,
            pixKey: c.pix_key,
            ownRule: !!c.pay_rule,
            payRule: c.pay_rule ? rule : null,
            rule: describePayRule(rule),
            delivered: r?.delivered ?? 0,
            failed: r?.failed ?? 0,
            daysWorked: r?.days ?? 0,
            distanceM: Number(r?.distance ?? 0),
            rides: r?.rides ?? '0.00',
            daily: fromCents(daily),
            earned: fromCents(earned),
            employerEstimate: fromCents(employer),
            costEstimate: fromCents(earned + employer),
            paidCount: pd?.count ?? 0,
            paidGross: pd?.gross ?? '0.00',
            paidWithheld: pd?.withheld ?? '0.00',
            paidNet: pd?.net ?? '0.00',
            paidEmployer: pd?.employer ?? '0.00',
            pendingRides: pe?.count ?? 0,
            pendingGross: fromCents(pendingGross),
            pendingWithheld: pendingTaxes,
            pendingNet: fromCents(pendingGross - toCents(pendingTaxes)),
          };
        }),
      );
      const days = await q<{ day: string; deliveries: number; cost: string }>(
        tx,
        `SELECT to_char(finished_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE status = 'delivered')::int AS deliveries,
                COALESCE(sum(courier_pay), 0)::numeric(14,2)::text AS cost
           FROM deliveries WHERE finished_at >= $1 AND finished_at < $2 AND status <> 'out'
          GROUP BY 1 ORDER BY 1`,
        p,
      );
      const fees = await one<{ orders: number; fees: string }>(
        tx,
        `SELECT count(*)::int AS orders, COALESCE(sum(delivery_fee), 0)::numeric(14,2)::text AS fees
           FROM orders WHERE channel = 'delivery' AND status <> 'cancelled'
            AND created_at >= $1 AND created_at < $2`,
        [b!.a, b!.z],
      );
      const payouts = await q(
        tx,
        `SELECT p.id, p.courier_id AS "courierId", c.name AS "courierName", p.period_from::text AS "periodFrom",
                p.period_to::text AS "periodTo", p.deliveries, p.days_worked AS "daysWorked",
                p.distance_m AS "distanceM", p.rides::text, p.daily::text, p.adjustments::text, p.gross::text,
                p.inss::text, p.irrf::text, p.iss::text, p.net::text, p.employer::text,
                p.tax_regime AS "taxRegime", p.method, p.notes, p.paid_at AS "paidAt",
                (p.finance_entry_id IS NOT NULL) AS "inFinance"
           FROM courier_payouts p JOIN couriers c ON c.id = p.courier_id
          WHERE p.paid_at >= $1 AND p.paid_at < $2 ORDER BY p.paid_at DESC`,
        [b!.a, b!.z],
      );
      const sum = (k: keyof (typeof lines)[number]) =>
        fromCents(lines.reduce((a, l) => a + toCents(String(l[k])), 0));
      return {
        month,
        settings: { ...s, description: describePayRule(s.rule) },
        totals: {
          delivered: lines.reduce((a, l) => a + l.delivered, 0),
          failed: lines.reduce((a, l) => a + l.failed, 0),
          distanceM: lines.reduce((a, l) => a + l.distanceM, 0),
          earned: sum('earned'),
          costEstimate: sum('costEstimate'),
          paidNet: sum('paidNet'),
          paidWithheld: sum('paidWithheld'),
          paidEmployer: sum('paidEmployer'),
          pendingGross: sum('pendingGross'),
          pendingNet: sum('pendingNet'),
          deliveryFees: fees!.fees,
          deliveryOrders: fees!.orders,
        },
        couriers: lines,
        days,
        payouts,
      };
    });
  }

  /**
   * Central do entregador: quanto ganhou hoje, na semana (desde segunda) e no mês, o que falta
   * receber (com a estimativa das retenções), as últimas corridas e os repasses recebidos.
   */
  async courierEarnings(tx: Tx, courierId: string) {
    const c = await this.courier(tx, courierId);
    const { rule } = await this.ruleOf(tx, c);
    const periods = await q<{
      period: 'today' | 'week' | 'month';
      delivered: number;
      failed: number;
      days: number;
      distance: string;
      rides: string;
    }>(
      tx,
      `WITH b AS (SELECT (now() AT TIME ZONE ${TZ})::date AS today)
       SELECT x.period, count(d.id) FILTER (WHERE d.status = 'delivered')::int AS delivered,
              count(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
              count(DISTINCT (d.finished_at AT TIME ZONE ${TZ})::date) FILTER (WHERE d.status = 'delivered')::int AS days,
              COALESCE(sum(d.distance_m), 0)::text AS distance,
              COALESCE(sum(d.courier_pay), 0)::numeric(14,2)::text AS rides
         FROM b CROSS JOIN LATERAL (VALUES
                ('today', b.today),
                ('week', date_trunc('week', b.today)::date),
                ('month', date_trunc('month', b.today)::date)) AS x(period, since)
         LEFT JOIN deliveries d ON d.courier_id = $1 AND d.status <> 'out'
              AND (d.finished_at AT TIME ZONE ${TZ})::date >= x.since
        GROUP BY x.period`,
      [courierId],
    );
    const period = (k: 'today' | 'week' | 'month') => {
      const r = periods.find((p) => p.period === k)!;
      const daily = r.days * toCents(rule.dailyRate);
      return {
        delivered: r.delivered,
        failed: r.failed,
        distanceM: Number(r.distance),
        rides: r.rides,
        daily: fromCents(daily),
        total: fromCents(toCents(r.rides) + daily),
      };
    };
    const pending = await this.draft(tx, courierId, '2999-12-31', '0');
    const recent = await q(
      tx,
      `SELECT d.id, o.number AS "orderNumber", d.status, d.finished_at AS "finishedAt",
              d.distance_m AS "distanceM", d.courier_pay::text AS pay, (d.payout_id IS NOT NULL) AS paid
         FROM deliveries d JOIN orders o ON o.id = d.order_id
        WHERE d.courier_id = $1 AND d.status <> 'out'
        ORDER BY d.finished_at DESC LIMIT 15`,
      [courierId],
    );
    // Últimos 7 dias (hoje incluso), para o gráfico do Início do app do entregador.
    const days = await q<{ day: string; delivered: number; rides: string }>(
      tx,
      `WITH b AS (SELECT (now() AT TIME ZONE ${TZ})::date AS today)
       SELECT g.day::date::text AS day,
              count(d.id) FILTER (WHERE d.status = 'delivered')::int AS delivered,
              COALESCE(sum(d.courier_pay), 0)::numeric(14,2)::text AS rides
         FROM b CROSS JOIN generate_series(b.today::timestamp - interval '6 days', b.today::timestamp, interval '1 day') AS g(day)
         LEFT JOIN deliveries d ON d.courier_id = $1 AND d.status <> 'out'
              AND (d.finished_at AT TIME ZONE ${TZ})::date = g.day::date
        GROUP BY g.day ORDER BY g.day`,
      [courierId],
    );
    const payouts = await q(
      tx,
      `SELECT id, period_from::text AS "periodFrom", period_to::text AS "periodTo", deliveries,
              gross::text, (inss + irrf + iss)::numeric(14,2)::text AS withheld, net::text, method,
              paid_at AS "paidAt"
         FROM courier_payouts WHERE courier_id = $1 ORDER BY paid_at DESC LIMIT 12`,
      [courierId],
    );
    return {
      rule: describePayRule(rule),
      dailyRate: rule.dailyRate,
      taxRegime: c.tax_regime,
      today: period('today'),
      week: period('week'),
      month: period('month'),
      pending: {
        rides: pending.deliveries + pending.failed,
        gross: pending.gross,
        withheld: pending.withheld,
        net: pending.net,
      },
      recent,
      payouts,
      last7: days.map((d) => ({
        day: d.day,
        delivered: d.delivered,
        total: fromCents(toCents(d.rides) + (d.delivered > 0 ? toCents(rule.dailyRate) : 0)),
      })),
    };
  }

  /** Central do entregador com login: acha o cadastro dele pelo usuário. */
  myEarnings(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one<{ id: string }>(tx, `SELECT id FROM couriers WHERE user_id = $1`, [
        ctx.userId,
      ]);
      if (!c)
        throw new NotFoundException(
          'Seu login ainda não está ligado a um entregador. Peça ao restaurante.',
        );
      return this.courierEarnings(tx, c.id);
    });
  }

  earningsByCourier(tenantId: string, courierId: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.courierEarnings(tx, courierId));
  }
}
