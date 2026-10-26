import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/**
 * Custo estimado de cada item vendido: ficha técnica do produto + das opções escolhidas, pelo
 * custo médio atual dos insumos. Item sem ficha conta custo zero (a tela avisa).
 */
const ITEM_COST = `(i.quantity * (
    COALESCE((SELECT sum(pr.quantity * si.avg_cost) FROM product_recipes pr
               JOIN stock_items si ON si.id = pr.stock_item_id WHERE pr.product_id = i.product_id), 0)
  + COALESCE((SELECT sum(orc.quantity * si.avg_cost) FROM order_item_options oio
               JOIN option_recipes orc ON orc.option_id = oio.option_id
               JOIN stock_items si ON si.id = orc.stock_item_id WHERE oio.order_item_id = i.id), 0)))`;
const HAS_RECIPE = `EXISTS (SELECT 1 FROM product_recipes pr WHERE pr.product_id = i.product_id)`;

const Month = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM')
    .refine((m) => Number(m.slice(0, 4)) >= 2000 && Number(m.slice(0, 4)) <= 2100, 'mês inválido'),
});

const Range = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    cashSessionId: z.string().uuid().optional(),
  })
  .refine((r) => new Date(r.from) < new Date(r.to), 'período inválido')
  .refine(
    (r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 366 * 86_400_000,
    'período máximo de 1 ano',
  );

/**
 * Relatório de vendas. Separa:
 *  - faturamento (pedidos criados no período, exceto cancelados) — visão de vendas;
 *  - recebimentos (pagamentos − estornos registrados no período) — visão de caixa.
 * As duas visões podem divergir (pedido de ontem pago hoje, venda a receber etc.).
 */
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('sales')
  @RequirePermission('reports:read')
  sales(
    @Query(new ZodPipe(Range)) r: z.infer<typeof Range>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = [r.from, r.to];
      const totals = await one(
        tx,
        `SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
                count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                COALESCE(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::text AS revenue,
                COALESCE(sum(subtotal) FILTER (WHERE status <> 'cancelled'), 0)::text AS subtotal,
                COALESCE(sum(discount) FILTER (WHERE status <> 'cancelled'), 0)::text AS discounts,
                COALESCE(sum(surcharge) FILTER (WHERE status <> 'cancelled'), 0)::text AS surcharges,
                COALESCE(sum(delivery_fee) FILTER (WHERE status <> 'cancelled'), 0)::text AS "deliveryFees",
                COALESCE(sum(total - paid_amount) FILTER (WHERE status <> 'cancelled'), 0)::text AS receivable,
                COALESCE(round(avg(total) FILTER (WHERE status <> 'cancelled'), 2), 0)::text AS "averageTicket"
           FROM orders WHERE created_at >= $1 AND created_at < $2`,
        p,
      );
      const byChannel = await q(
        tx,
        `SELECT channel, count(*)::int AS orders, sum(total)::text AS revenue
           FROM orders WHERE created_at >= $1 AND created_at < $2 AND status <> 'cancelled'
          GROUP BY channel ORDER BY channel`,
        p,
      );
      const received = await q(
        tx,
        `SELECT method,
                COALESCE(sum(amount) FILTER (WHERE kind = 'sale'), 0)::text AS received,
                COALESCE(-sum(amount) FILTER (WHERE kind = 'refund'), 0)::text AS refunded,
                sum(amount)::text AS net
           FROM cash_movements WHERE kind IN ('sale','refund') AND created_at >= $1 AND created_at < $2
          GROUP BY method ORDER BY method`,
        p,
      );
      const topProducts = await q(
        tx,
        `SELECT i.product_id AS "productId", i.name, sum(i.quantity)::text AS quantity, sum(i.total)::text AS revenue,
                round(sum(${ITEM_COST}), 2)::text AS cost, bool_and(${HAS_RECIPE}) AS "hasRecipe"
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          GROUP BY i.product_id, i.name ORDER BY sum(i.total) DESC LIMIT 20`,
        p,
      );
      const cost = await one<{ cost: string }>(
        tx,
        `SELECT COALESCE(round(sum(${ITEM_COST}), 2), 0)::text AS cost
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled' AND i.status <> 'cancelled'`,
        p,
      );
      return {
        from: r.from,
        to: r.to,
        totals: { ...totals, cost: cost!.cost },
        byChannel,
        received,
        topProducts,
      };
    });
  }

  /**
   * Calendário do mês (no fuso do restaurante): por dia, pedidos, faturamento, custo estimado e
   * lucro bruto; no mês, os mais vendidos com margem, dias da semana, horários de pico, despesas
   * pagas e comparação com o mês anterior.
   * Lucro bruto = faturamento − taxas de entrega − custo dos insumos (ficha técnica).
   */
  @Get('calendar')
  @RequirePermission('reports:read')
  calendar(
    @Query(new ZodPipe(Month)) m: z.infer<typeof Month>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const tz = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;
      const b = await one<{ a: Date; b: Date; pa: Date; tz: string; today: string }>(
        tx,
        `SELECT ($1::date::timestamp AT TIME ZONE ${tz}) AS a,
                (($1::date + interval '1 month')::timestamp AT TIME ZONE ${tz}) AS b,
                (($1::date - interval '1 month')::timestamp AT TIME ZONE ${tz}) AS pa,
                ${tz} AS tz, to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS today`,
        [`${m.month}-01`],
      );
      const p = [b!.a, b!.b, b!.tz];
      // Custo por pedido (só itens não cancelados).
      const orderCost = `(SELECT COALESCE(sum(${ITEM_COST}), 0) FROM order_items i
                           WHERE i.order_id = o.id AND i.status <> 'cancelled')`;
      const days = await q(
        tx,
        `SELECT to_char(o.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE o.status <> 'cancelled')::int AS orders,
                count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
                COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS revenue,
                COALESCE(sum(o.delivery_fee) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS "deliveryFees",
                COALESCE(round(sum(${orderCost}) FILTER (WHERE o.status <> 'cancelled'), 2), 0)::text AS cost
           FROM orders o
          WHERE o.created_at >= $1 AND o.created_at < $2
          GROUP BY 1 ORDER BY 1`,
        p,
      );
      const reservations = await q(
        tx,
        `SELECT to_char(starts_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, count(*)::int AS count,
                sum(party_size)::int AS people
           FROM reservations
          WHERE starts_at >= $1 AND starts_at < $2 AND status NOT IN ('cancelled','no_show')
          GROUP BY 1`,
        p,
      );
      const topProducts = await q(
        tx,
        `SELECT i.product_id AS "productId", i.name, sum(i.quantity)::text AS quantity,
                sum(i.total)::text AS revenue, round(sum(${ITEM_COST}), 2)::text AS cost,
                bool_and(${HAS_RECIPE}) AS "hasRecipe"
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          GROUP BY i.product_id, i.name ORDER BY sum(i.total) DESC LIMIT 15`,
        [b!.a, b!.b],
      );
      const coverage = await one<{ items: string; withoutRecipe: string }>(
        tx,
        `SELECT COALESCE(sum(i.total), 0)::numeric(14,2)::text AS items,
                COALESCE(sum(i.total) FILTER (WHERE NOT ${HAS_RECIPE}), 0)::numeric(14,2)::text AS "withoutRecipe"
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled' AND i.status <> 'cancelled'`,
        [b!.a, b!.b],
      );
      const byHour = await q(
        tx,
        `SELECT extract(hour FROM o.created_at AT TIME ZONE $3)::int AS hour, count(*)::int AS orders,
                sum(o.total)::text AS revenue
           FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled'
          GROUP BY 1 ORDER BY 1`,
        p,
      );
      const byChannel = await q(
        tx,
        `SELECT channel, count(*)::int AS orders, sum(total)::text AS revenue
           FROM orders WHERE created_at >= $1 AND created_at < $2 AND status <> 'cancelled'
          GROUP BY channel ORDER BY sum(total) DESC`,
        [b!.a, b!.b],
      );
      const expenses = await one<{ paid: string; count: number }>(
        tx,
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS paid, count(*)::int AS count FROM finance_entries
          WHERE kind = 'payable' AND status = 'paid' AND paid_at >= $1::date
            AND paid_at < ($1::date + interval '1 month')::date`,
        [`${m.month}-01`],
      );
      const previous = await one<{ orders: number; revenue: string }>(
        tx,
        `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::numeric(14,2)::text AS revenue FROM orders
          WHERE created_at >= $1 AND created_at < $2 AND status <> 'cancelled'`,
        [b!.pa, b!.a],
      );
      return {
        month: m.month,
        today: b!.today,
        days,
        reservations,
        topProducts,
        coverage,
        byHour,
        byChannel,
        expenses,
        previous,
      };
    });
  }
}
