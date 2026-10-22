import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

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
        `SELECT i.product_id AS "productId", i.name, sum(i.quantity)::text AS quantity, sum(i.total)::text AS revenue
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          GROUP BY i.product_id, i.name ORDER BY sum(i.total) DESC LIMIT 20`,
        p,
      );
      return { from: r.from, to: r.to, totals, byChannel, received, topProducts };
    });
  }
}
