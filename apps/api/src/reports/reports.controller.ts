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

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const Period = z
  .object({
    from: Day,
    to: Day,
    channel: z.enum(['counter', 'table', 'delivery', 'pickup']).optional(),
  })
  .refine((r) => r.from <= r.to, 'período inválido')
  .refine(
    (r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 366,
    'período máximo de 1 ano',
  )
  .refine(
    (r) => Number(r.from.slice(0, 4)) >= 2000 && Number(r.to.slice(0, 4)) <= 2100,
    'data inválida',
  );

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

  /**
   * Análise do período (datas no fuso do restaurante, "to" inclusive) comparada ao período anterior
   * de mesmo tamanho: totais, série diária, mapa dia×hora, produtos (com o período anterior, para
   * tendência e engenharia de cardápio), produtos parados, canais, pagamentos, cancelamentos,
   * equipe, clientes novos × recorrentes e tempo de preparo. Os insights são montados na tela.
   */
  @Get('insights')
  @RequirePermission('reports:read')
  insights(
    @Query(new ZodPipe(Period)) r: z.infer<typeof Period>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const tz = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;
      const b = await one<{ a: Date; b: Date; pa: Date; tz: string; today: string; days: number }>(
        tx,
        `SELECT ($1::date::timestamp AT TIME ZONE ${tz}) AS a,
                (($2::date + 1)::timestamp AT TIME ZONE ${tz}) AS b,
                (($1::date - ($2::date - $1::date + 1))::timestamp AT TIME ZONE ${tz}) AS pa,
                ${tz} AS tz, to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS today,
                ($2::date - $1::date + 1)::int AS days`,
        [r.from, r.to],
      );
      const { a, b: z1, pa, tz: zone } = b!;
      // Filtro de canal opcional: $4 nulo = todos.
      const ch = r.channel ?? null;
      const W = (n: number) =>
        `o.status <> 'cancelled' AND ($${n}::text IS NULL OR o.channel = $${n})`;
      const orderCost = `(SELECT COALESCE(sum(${ITEM_COST}), 0) FROM order_items i
                           WHERE i.order_id = o.id AND i.status <> 'cancelled')`;
      const custKey = `COALESCE(o.customer_id::text, NULLIF(regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g'), ''))`;

      const totalsOf = (from: Date, to: Date) =>
        one(
          tx,
          `SELECT count(*) FILTER (WHERE ${W(3)})::int AS orders,
                  count(*) FILTER (WHERE o.status = 'cancelled' AND ($3::text IS NULL OR o.channel = $3))::int AS cancelled,
                  COALESCE(sum(o.total) FILTER (WHERE o.status = 'cancelled' AND ($3::text IS NULL OR o.channel = $3)), 0)::text AS "cancelledValue",
                  COALESCE(sum(o.total) FILTER (WHERE ${W(3)}), 0)::text AS revenue,
                  COALESCE(sum(o.discount) FILTER (WHERE ${W(3)}), 0)::text AS discounts,
                  COALESCE(sum(o.delivery_fee) FILTER (WHERE ${W(3)}), 0)::text AS "deliveryFees",
                  COALESCE(round(sum(${orderCost}) FILTER (WHERE ${W(3)}), 2), 0)::text AS cost,
                  count(DISTINCT ${custKey}) FILTER (WHERE ${W(3)})::int AS customers
             FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2`,
          [from, to, ch],
        );
      const totals = await totalsOf(a, z1);
      const previous = await totalsOf(pa, a);

      const daily = await q(
        tx,
        `SELECT to_char(o.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, count(*)::int AS orders,
                sum(o.total)::text AS revenue, round(sum(${orderCost}), 2)::text AS cost,
                sum(o.delivery_fee)::text AS "deliveryFees"
           FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${W(4)}
          GROUP BY 1 ORDER BY 1`,
        [pa, z1, zone, ch],
      );
      const heat = await q(
        tx,
        `SELECT extract(dow FROM o.created_at AT TIME ZONE $3)::int AS dow,
                extract(hour FROM o.created_at AT TIME ZONE $3)::int AS hour,
                count(*)::int AS orders, sum(o.total)::text AS revenue
           FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${W(4)}
          GROUP BY 1, 2`,
        [a, z1, zone, ch],
      );
      const products = await q(
        tx,
        `SELECT i.product_id AS "productId", max(i.name) AS name, max(c.name) AS category,
                COALESCE(sum(i.quantity) FILTER (WHERE o.created_at >= $1), 0)::text AS quantity,
                COALESCE(sum(i.total) FILTER (WHERE o.created_at >= $1), 0)::text AS revenue,
                COALESCE(round(sum(${ITEM_COST}) FILTER (WHERE o.created_at >= $1), 2), 0)::text AS cost,
                COALESCE(sum(i.quantity) FILTER (WHERE o.created_at < $1), 0)::text AS "prevQuantity",
                COALESCE(sum(i.total) FILTER (WHERE o.created_at < $1), 0)::text AS "prevRevenue",
                bool_and(${HAS_RECIPE}) AS "hasRecipe"
           FROM order_items i JOIN orders o ON o.id = i.order_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE o.created_at >= $4 AND o.created_at < $2 AND ${W(3)} AND i.status <> 'cancelled'
          GROUP BY i.product_id ORDER BY sum(i.total) FILTER (WHERE o.created_at >= $1) DESC NULLS LAST
          LIMIT 300`,
        [a, z1, ch, pa],
      );
      // Produtos ativos que não venderam nada no período (só faz sentido sem filtro de canal).
      const idle = await q(
        tx,
        `SELECT p.id AS "productId", p.name, c.name AS category, p.price::text AS price
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.active AND NOT p.sold_out AND p.created_at < $1
            AND NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
                             WHERE i.product_id = p.id AND o.created_at >= $1 AND o.created_at < $2
                               AND o.status <> 'cancelled' AND i.status <> 'cancelled')
          ORDER BY c.position, p.name LIMIT 30`,
        [a, z1],
      );
      const channels = await q(
        tx,
        `SELECT o.channel, count(*) FILTER (WHERE o.created_at >= $1)::int AS orders,
                COALESCE(sum(o.total) FILTER (WHERE o.created_at >= $1), 0)::text AS revenue,
                count(*) FILTER (WHERE o.created_at < $1)::int AS "prevOrders",
                COALESCE(sum(o.total) FILTER (WHERE o.created_at < $1), 0)::text AS "prevRevenue"
           FROM orders o WHERE o.created_at >= $4 AND o.created_at < $2 AND ${W(3)}
          GROUP BY 1 ORDER BY sum(o.total) FILTER (WHERE o.created_at >= $1) DESC NULLS LAST`,
        [a, z1, ch, pa],
      );
      const payments = await q(
        tx,
        `SELECT method, COALESCE(sum(amount), 0)::text AS net, count(*) FILTER (WHERE kind = 'sale')::int AS count
           FROM cash_movements WHERE kind IN ('sale','refund') AND created_at >= $1 AND created_at < $2
          GROUP BY method ORDER BY sum(amount) DESC`,
        [a, z1],
      );
      const cancellations = await q(
        tx,
        `SELECT COALESCE(NULLIF(trim(o.cancel_reason), ''), 'Sem motivo informado') AS reason,
                count(*)::int AS count, sum(o.total)::text AS value
           FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status = 'cancelled'
            AND ($3::text IS NULL OR o.channel = $3)
          GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
        [a, z1, ch],
      );
      const staff = await q(
        tx,
        `SELECT u.id, u.name, count(*)::int AS orders, sum(o.total)::text AS revenue,
                round(avg(o.total), 2)::text AS ticket
           FROM orders o JOIN users u ON u.id = o.created_by
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${W(3)}
          GROUP BY u.id, u.name ORDER BY sum(o.total) DESC LIMIT 10`,
        [a, z1, ch],
      );
      // Cliente identificado (conta ou telefone): novo = primeiro pedido da vida caiu no período.
      const customers = await one(
        tx,
        `WITH cur AS (
           SELECT ${custKey} AS k, count(*)::int AS n, sum(o.total) AS v, max(COALESCE(o.customer_name, '')) AS name
             FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2 AND ${W(3)}
              AND ${custKey} IS NOT NULL
            GROUP BY 1),
         firsts AS (
           SELECT ${custKey} AS k, min(o.created_at) AS f FROM orders o
            WHERE o.status <> 'cancelled' AND ${custKey} IN (SELECT k FROM cur) GROUP BY 1)
         SELECT count(*)::int AS identified,
                count(*) FILTER (WHERE f.f >= $1)::int AS "new",
                count(*) FILTER (WHERE cur.n > 1)::int AS "repeat",
                COALESCE(sum(cur.v), 0)::text AS revenue,
                COALESCE((SELECT json_agg(x) FROM (SELECT name, n AS orders, v::text AS revenue FROM cur
                           WHERE name <> '' ORDER BY v DESC LIMIT 5) x), '[]') AS top
           FROM cur JOIN firsts f ON f.k = cur.k`,
        [a, z1, ch],
      );
      // Tempo de preparo: do pedido até o item ficar pronto na cozinha (minutos).
      const kitchen = await one(
        tx,
        `SELECT round(avg(extract(epoch FROM (i.ready_at - o.created_at)) / 60)::numeric, 1)::text AS avg,
                round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (i.ready_at - o.created_at)) / 60))::numeric, 1)::text AS p90,
                count(*)::int AS items
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND ${W(3)}
            AND i.ready_at IS NOT NULL AND i.ready_at > o.created_at
            AND i.ready_at < o.created_at + interval '6 hours'`,
        [a, z1, ch],
      );
      const expenses = await one<{ paid: string; count: number }>(
        tx,
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS paid, count(*)::int AS count FROM finance_entries
          WHERE kind = 'payable' AND status = 'paid' AND paid_at >= $1::date AND paid_at <= $2::date`,
        [r.from, r.to],
      );
      return {
        from: r.from,
        to: r.to,
        days: b!.days,
        today: b!.today,
        channel: ch,
        totals,
        previous,
        daily,
        heat,
        products,
        idle: ch ? [] : idle,
        channels,
        payments,
        cancellations,
        staff,
        customers,
        kitchen,
        expenses,
      };
    });
  }
}
