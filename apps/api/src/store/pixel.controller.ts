import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { StoreService } from './store.service';

/** Eventos que o cardápio online manda (o "pixel" do Comandou, como o da Meta). */
export const PIXEL_EVENTS = [
  'visit',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'purchase',
  'search',
  'click_category',
  'click_banner',
  'favorite',
] as const;

/** Passos do funil: cada sessão conta no passo mais adiante que chegou (e em todos antes dele). */
const FUNNEL = ['visit', 'view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'purchase'];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v?.toLowerCase() || undefined);

const PixelEvent = z.object({
  type: z.enum(PIXEL_EVENTS),
  productId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  value: z.number().min(0).max(1_000_000).optional(),
  quantity: z.number().min(0).max(10_000).optional(),
  term: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v?.toLowerCase() || undefined),
});

const PixelBatch = z.object({
  /** Sessão (a aba aberta) e visitante (o navegador): ids aleatórios do aparelho, sem dado pessoal. */
  sid: z.string().uuid(),
  vid: z.string().uuid(),
  ctx: z
    .object({
      device: z.enum(['phone', 'tablet', 'desktop']).optional(),
      source: text(60),
      medium: text(60),
      campaign: text(80),
      table: z.boolean().optional(),
    })
    .optional(),
  events: z.array(PixelEvent).min(1).max(40),
});
type PixelBatch = z.infer<typeof PixelBatch>;

/**
 * Pixel do cardápio online: o cardápio do cliente manda, em lotes, o que acontece (visita, clique
 * no item, sacola, finalização, pedido, busca, categoria, banner, favorito). Público e sem dado
 * pessoal. Cardápio desligado não grava nada.
 */
@Controller({ path: 'store/pixel', version: '1' })
export class StorePixelController {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: StoreService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 90 } })
  @Post()
  @HttpCode(204)
  async collect(
    @Body(new ZodPipe(PixelBatch)) b: PixelBatch,
    @CurrentTenant() t: ResolvedTenant,
  ): Promise<void> {
    await this.db.withTenant({ tenantId: t.id }, async (tx) => {
      const s = await this.store.settingsIn(tx);
      if (!s.enabled) return;
      await record(tx, t.id, b);
    });
  }
}

/** Grava o lote. A visita entra uma vez por sessão; só ela guarda aparelho, origem e campanha. */
async function record(tx: Tx, tenantId: string, b: PixelBatch) {
  const c: Partial<NonNullable<PixelBatch['ctx']>> = b.ctx ?? {};
  await q(
    tx,
    `INSERT INTO menu_events (tenant_id, session_id, visitor_id, type, product_id, target_id, value,
                              quantity, term, device, source, medium, campaign, at_table)
     SELECT $1, $2, $3, x.type, x."productId", x."targetId", round(x.value, 2), round(x.quantity, 3),
            NULLIF(x.term, ''),
            CASE WHEN x.type = 'visit' THEN $5 END, CASE WHEN x.type = 'visit' THEN $6 END,
            CASE WHEN x.type = 'visit' THEN $7 END, CASE WHEN x.type = 'visit' THEN $8 END, $9
       FROM jsonb_to_recordset($4::jsonb) AS x(type text, "productId" uuid, "targetId" uuid,
                                               value numeric, quantity numeric, term text)
     ON CONFLICT DO NOTHING`,
    [
      tenantId,
      b.sid,
      b.vid,
      JSON.stringify(b.events),
      c.device ?? null,
      c.source ?? null,
      c.medium ?? null,
      c.campaign ?? null,
      !!c.table,
    ],
  );
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const Period = z
  .object({ from: Day, to: Day })
  .refine((r) => r.from <= r.to, 'período inválido')
  .refine(
    (r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 366,
    'período máximo de 1 ano',
  )
  .refine(
    (r) => Number(r.from.slice(0, 4)) >= 2000 && Number(r.to.slice(0, 4)) <= 2100,
    'data inválida',
  );

/** Relatório do pixel do cardápio online (Relatórios › Cardápio online). */
@Controller({ path: 'reports', version: '1' })
export class MenuPixelReportController {
  constructor(private readonly db: DatabaseService) {}

  @Get('menu-pixel')
  @RequirePermission('reports:read')
  report(
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
      const { a, b: z1, pa, tz: zone, today, days } = b!;
      const RANGE = `e.at >= $1 AND e.at < $2`;

      const totalsOf = async (from: Date, to: Date) => {
        const ev = await one<Record<string, number>>(
          tx,
          `SELECT count(*) FILTER (WHERE e.type = 'visit')::int AS visits,
                  count(DISTINCT e.visitor_id) FILTER (WHERE e.type = 'visit')::int AS visitors,
                  count(*) FILTER (WHERE e.type = 'view_item')::int AS "itemViews",
                  count(*) FILTER (WHERE e.type = 'add_to_cart')::int AS adds,
                  count(*) FILTER (WHERE e.type = 'search')::int AS searches,
                  count(DISTINCT e.session_id) FILTER (WHERE e.type = 'purchase')::int AS "buyerSessions"
             FROM menu_events e WHERE ${RANGE}`,
          [from, to],
        );
        const ord = await one<{ orders: number; revenue: string }>(
          tx,
          `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::text AS revenue
             FROM orders WHERE source = 'online' AND status <> 'cancelled'
              AND created_at >= $1 AND created_at < $2`,
          [from, to],
        );
        return { ...ev!, ...ord! };
      };
      const totals = await totalsOf(a, z1);
      const previous = await totalsOf(pa, a);

      const funnelRow = await one<Record<string, number>>(
        tx,
        `SELECT ${FUNNEL.map(
          (_, i) =>
            `count(DISTINCT e.session_id) FILTER (WHERE e.type IN (${FUNNEL.slice(i)
              .map((s) => `'${s}'`)
              .join(',')}))::int AS s${i}`,
        ).join(', ')}
           FROM menu_events e WHERE ${RANGE}`,
        [a, z1],
      );
      const funnel = FUNNEL.map((step, i) => ({ step, sessions: funnelRow![`s${i}`] ?? 0 }));

      const daily = await q(
        tx,
        `SELECT d.day,
                COALESCE(ev.visits, 0)::int AS visits, COALESCE(ev."itemViews", 0)::int AS "itemViews",
                COALESCE(ev.adds, 0)::int AS adds, COALESCE(o.orders, 0)::int AS orders
           FROM (SELECT to_char(g, 'YYYY-MM-DD') AS day
                   FROM generate_series($4::date, $5::date, interval '1 day') g) d
           LEFT JOIN (SELECT to_char(e.at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
                             count(*) FILTER (WHERE e.type = 'visit') AS visits,
                             count(*) FILTER (WHERE e.type = 'view_item') AS "itemViews",
                             count(*) FILTER (WHERE e.type = 'add_to_cart') AS adds
                        FROM menu_events e WHERE ${RANGE} GROUP BY 1) ev ON ev.day = d.day
           LEFT JOIN (SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, count(*) AS orders
                        FROM orders WHERE source = 'online' AND status <> 'cancelled'
                         AND created_at >= $1 AND created_at < $2 GROUP BY 1) o ON o.day = d.day
          ORDER BY d.day`,
        [a, z1, zone, r.from, r.to],
      );

      const byHour = await q(
        tx,
        `SELECT extract(hour FROM e.at AT TIME ZONE $3)::int AS hour, count(*)::int AS visits
           FROM menu_events e WHERE ${RANGE} AND e.type = 'visit' GROUP BY 1 ORDER BY 1`,
        [a, z1, zone],
      );

      const products = await q<{
        productId: string;
        name: string | null;
        category: string | null;
        views: number;
        viewSessions: number;
        adds: number;
        addSessions: number;
        favorites: number;
        sold?: string;
      }>(
        tx,
        `SELECT e.product_id AS "productId", p.name, c.name AS category,
                count(*) FILTER (WHERE e.type = 'view_item')::int AS views,
                count(DISTINCT e.session_id) FILTER (WHERE e.type = 'view_item')::int AS "viewSessions",
                count(*) FILTER (WHERE e.type = 'add_to_cart')::int AS adds,
                count(DISTINCT e.session_id) FILTER (WHERE e.type = 'add_to_cart')::int AS "addSessions",
                count(*) FILTER (WHERE e.type = 'favorite')::int AS favorites
           FROM menu_events e
           LEFT JOIN products p ON p.id = e.product_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${RANGE} AND e.product_id IS NOT NULL
            AND e.type IN ('view_item', 'add_to_cart', 'favorite')
          GROUP BY 1, 2, 3
          ORDER BY views DESC, adds DESC LIMIT 100`,
        [a, z1],
      );
      const sold = await q<{ productId: string; sold: string }>(
        tx,
        `SELECT i.product_id AS "productId", sum(i.quantity)::text AS sold
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.source = 'online' AND o.status <> 'cancelled' AND i.status <> 'cancelled'
            AND o.created_at >= $1 AND o.created_at < $2
          GROUP BY 1`,
        [a, z1],
      );
      const soldBy = new Map(sold.map((x) => [x.productId, x.sold]));
      for (const p of products) p.sold = soldBy.get(p.productId) ?? '0';

      const searches = await q(
        tx,
        `SELECT e.term, count(*)::int AS count,
                count(*) FILTER (WHERE e.quantity = 0)::int AS "noResults"
           FROM menu_events e WHERE ${RANGE} AND e.type = 'search' AND e.term IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`,
        [a, z1],
      );

      // Visitas por origem, aparelho e campanha, com quantas sessões chegaram ao pedido.
      const bought = `EXISTS (SELECT 1 FROM menu_events x WHERE x.tenant_id = e.tenant_id
                                AND x.session_id = e.session_id AND x.type = 'purchase')`;
      const groupBy = (expr: string, where = 'true') =>
        q<{ key: string | null; visits: number; buyers: number }>(
          tx,
          `SELECT ${expr} AS key, count(*)::int AS visits, count(*) FILTER (WHERE ${bought})::int AS buyers
             FROM menu_events e WHERE ${RANGE} AND e.type = 'visit' AND ${where}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
          [a, z1],
        );
      const sources = await groupBy(
        `CASE WHEN e.at_table THEN 'mesa' ELSE COALESCE(e.source, 'direto') END`,
      );
      const devices = await groupBy(`COALESCE(e.device, 'desktop')`);
      const campaigns = await groupBy(`e.campaign`, `e.campaign IS NOT NULL`);

      const categories = await q(
        tx,
        `SELECT e.target_id AS id, c.name, count(*)::int AS clicks
           FROM menu_events e LEFT JOIN categories c ON c.id = e.target_id
          WHERE ${RANGE} AND e.type = 'click_category'
          GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
        [a, z1],
      );
      const banners = await q(
        tx,
        `SELECT e.target_id AS id, sb.title AS name, count(*)::int AS clicks
           FROM menu_events e LEFT JOIN store_banners sb ON sb.id = e.target_id
          WHERE ${RANGE} AND e.type = 'click_banner'
          GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
        [a, z1],
      );

      return {
        from: r.from,
        to: r.to,
        today,
        days,
        totals,
        previous,
        funnel,
        daily,
        byHour,
        products,
        searches,
        sources,
        devices,
        campaigns,
        categories,
        banners,
      };
    });
  }
}
