import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { positiveQty, qty, unitCost, uuid } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AVAILABILITY_SQL } from './availability-sql';
import { ITEM_SELECT, StockService } from './stock.service';

const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;
/** Texto opcional: vazio vira null (limpa o campo). */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const Item = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.enum(UNITS),
  minQuantity: qty.optional(),
  allowNegative: z.boolean().optional(),
  active: z.boolean().optional(),
  category: optText(40).optional(),
  supplier: optText(80).optional(),
  /** Vazio no cadastro = código automático (IN-000001). */
  code: optText(30).optional(),
  barcode: optText(40).optional(),
  shelfLifeDays: z.number().int().min(1).max(3650).nullable().optional(),
});
const Count = z.object({
  note: z.string().trim().min(3).max(300),
  lines: z
    .array(z.object({ stockItemId: uuid, quantity: qty }))
    .min(1)
    .max(500)
    .refine((l) => new Set(l.map((x) => x.stockItemId)).size === l.length, 'insumo repetido'),
});
/** Percentual com até 2 casas ("6.5"). */
const pct = (max: number) =>
  z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, 'percentual com até 2 casas')
    .refine((v) => Number(v) <= max, `máximo ${max}%`);
const PricingSettings = z
  .object({
    taxPercent: pct(60),
    feePercent: pct(30),
    fixedPercent: pct(80),
    targetMargin: pct(80),
  })
  .refine(
    (s) =>
      Number(s.taxPercent) +
        Number(s.feePercent) +
        Number(s.fixedPercent) +
        Number(s.targetMargin) <=
      90,
    'a soma dos percentuais deve ficar em até 90%',
  );
const ProductPricing = z.object({ targetMargin: pct(80).nullable() });
const Entry = z.object({
  kind: z.enum(['purchase', 'loss', 'withdrawal', 'count']),
  quantity: qty,
  unitCost: unitCost.optional(),
  note: z.string().trim().min(3).max(300).optional(),
});
const Recipe = z.object({
  lines: z
    .array(z.object({ stockItemId: uuid, quantity: positiveQty }))
    .max(50)
    .refine((l) => new Set(l.map((x) => x.stockItemId)).size === l.length, 'insumo repetido'),
});
const MovementsQuery = z.object({
  itemId: uuid.optional(),
  /** "out" = só saídas (venda, perda, produção, saída avulsa, contagem para menos). */
  direction: z.enum(['in', 'out']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

@Controller({ path: 'stock', version: '1' })
export class StockController {
  constructor(
    private readonly db: DatabaseService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('items')
  @RequirePermission('stock:read')
  items(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(tx, `${ITEM_SELECT} ORDER BY s.active DESC, s.name`),
    );
  }

  @Post('items')
  @RequirePermission('stock:write')
  async create(
    @Body(new ZodPipe(Item)) b: z.infer<typeof Item>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const res = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO stock_items (tenant_id, name, unit, min_quantity, allow_negative, active, category, supplier,
                                  code, barcode, shelf_life_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          t.id,
          b.name,
          b.unit,
          b.minQuantity ?? '0',
          b.allowNegative ?? false,
          b.active ?? true,
          b.category ?? null,
          b.supplier ?? null,
          b.code ?? null,
          b.barcode ?? null,
          b.shelfLifeDays ?? null,
        ],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.item_created',
        entity: 'stock_item',
        entityId: r!.id,
        data: { name: b.name, unit: b.unit },
        ip: req.ip,
      });
      return this.stock.item(tx, r!.id);
    });
    this.realtime.publish(t.id, { type: 'stock.changed' });
    return res;
  }

  @Patch('items/:id')
  @RequirePermission('stock:write')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Item.partial())) b: Partial<z.infer<typeof Item>>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const res = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      const cur = await one<{ unit: string; quantity: string; allow_negative: boolean }>(
        tx,
        `SELECT unit, quantity::text, allow_negative FROM stock_items WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur) throw new NotFoundException('Insumo não encontrado');
      if (b.unit && b.unit !== cur.unit) {
        const used = await one(
          tx,
          `SELECT 1 FROM stock_movements WHERE stock_item_id = $1 LIMIT 1`,
          [id],
        );
        if (used)
          throw new ConflictException('A unidade não pode mudar depois de haver movimentos');
      }
      if (b.allowNegative === false && cur.quantity.startsWith('-'))
        throw new ConflictException('Saldo negativo: ajuste o estoque antes de bloquear negativos');
      await q(
        tx,
        `UPDATE stock_items SET name = COALESCE($2, name), unit = COALESCE($3, unit),
                min_quantity = COALESCE($4::numeric, min_quantity),
                allow_negative = COALESCE($5, allow_negative), active = COALESCE($6, active),
                category = CASE WHEN $7 THEN $8 ELSE category END,
                supplier = CASE WHEN $9 THEN $10 ELSE supplier END,
                code = COALESCE($11, code),
                barcode = CASE WHEN $12 THEN $13 ELSE barcode END,
                shelf_life_days = CASE WHEN $14 THEN $15::int ELSE shelf_life_days END
          WHERE id = $1`,
        [
          id,
          b.name ?? null,
          b.unit ?? null,
          b.minQuantity ?? null,
          b.allowNegative ?? null,
          b.active ?? null,
          b.category !== undefined,
          b.category ?? null,
          b.supplier !== undefined,
          b.supplier ?? null,
          b.code ?? null,
          b.barcode !== undefined,
          b.barcode ?? null,
          b.shelfLifeDays !== undefined,
          b.shelfLifeDays ?? null,
        ],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.item_updated',
        entity: 'stock_item',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return this.stock.item(tx, id);
    });
    this.realtime.publish(t.id, { type: 'stock.changed' });
    return res;
  }

  /** Entrada, perda ou contagem. */
  @Post('items/:id/movements')
  @RequirePermission('stock:write')
  entry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Entry)) b: z.infer<typeof Entry>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (b.kind !== 'count' && Number(b.quantity) <= 0)
      throw new ConflictException('Quantidade deve ser maior que zero');
    return this.stock.entry(ctxOf(t, u, req), id, b);
  }

  @Get('movements')
  @RequirePermission('stock:read')
  movements(
    @Query(new ZodPipe(MovementsQuery)) f: z.infer<typeof MovementsQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT m.id::text, m.stock_item_id AS "stockItemId", s.name AS "itemName", s.unit, m.kind,
                m.quantity::text, m.unit_cost::text AS "unitCost", m.balance_after::text AS "balanceAfter",
                m.order_id AS "orderId", o.number AS "orderNumber", m.note, m.created_at AS "createdAt",
                us.name AS "createdByName", m.count_id AS "countId",
                round(m.quantity * m.unit_cost, 2)::text AS "value", s.code AS "itemCode",
                rc.code AS "receiptCode", rc.id AS "receiptId", pr.code AS "productionCode",
                lt.code AS "lotCode"
           FROM stock_movements m
           JOIN stock_items s ON s.id = m.stock_item_id
           LEFT JOIN orders o ON o.id = m.order_id
           LEFT JOIN users us ON us.id = m.created_by
           LEFT JOIN stock_receipts rc ON rc.id = m.receipt_id
           LEFT JOIN stock_productions pr ON pr.id = m.production_id
           LEFT JOIN stock_lots lt ON lt.id = m.lot_id
          WHERE ($1::uuid IS NULL OR m.stock_item_id = $1)
            AND ($3::text IS NULL OR ($3 = 'out' AND m.quantity < 0) OR ($3 = 'in' AND m.quantity > 0))
            AND ($4::date IS NULL OR m.created_at >= $4::date)
          ORDER BY m.id DESC LIMIT $2`,
        [f.itemId ?? null, f.limit, f.direction ?? null, f.from ?? null],
      ),
    );
  }

  // ------------------------------------------------------------ inventário em lote
  /** Contagem de vários insumos de uma vez (inventário do setor ou geral). */
  @Post('counts')
  @RequirePermission('stock:write')
  count(
    @Body(new ZodPipe(Count)) b: z.infer<typeof Count>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.stock.count(ctxOf(t, u, req), b);
  }

  @Get('counts')
  @RequirePermission('stock:read')
  counts(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT c.id, c.note, c.items_counted AS "itemsCounted", c.items_changed AS "itemsChanged",
                c.value_delta::text AS "valueDelta", c.created_at AS "createdAt", us.name AS "createdByName"
           FROM stock_counts c LEFT JOIN users us ON us.id = c.created_by
          ORDER BY c.created_at DESC LIMIT 30`,
      ),
    );
  }

  // ------------------------------------------------------------ precificação
  /**
   * Custo de cada produto e adicional pela ficha técnica (custo médio atual dos insumos),
   * vendas dos últimos 30 dias e os parâmetros de preço. Margens e preço sugerido são
   * calculados na tela a partir destes números.
   */
  @Get('pricing')
  @RequirePermission('stock:write', 'reports:read')
  pricing(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const settings = await one(
        tx,
        `SELECT tax_percent::text AS "taxPercent", fee_percent::text AS "feePercent",
                fixed_percent::text AS "fixedPercent", target_margin::text AS "targetMargin"
           FROM pricing_settings`,
      );
      const products = await q(
        tx,
        `SELECT p.id, p.name, c.name AS "categoryName", p.price::text, p.active,
                rc.cost::text AS cost, (rc.cost IS NOT NULL) AS "hasRecipe",
                coalesce(rc.missing, false) AS "missingCost",
                pp.target_margin::text AS "targetMargin",
                coalesce(sv.qty, 0)::text AS "sold30", coalesce(sv.revenue, 0)::text AS "revenue30"
           FROM products p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN LATERAL (
             SELECT round(sum(r.quantity * si.avg_cost), 4) AS cost, bool_or(si.avg_cost = 0) AS missing
               FROM product_recipes r JOIN stock_items si ON si.id = r.stock_item_id
              WHERE r.product_id = p.id) rc ON true
           LEFT JOIN product_pricing pp ON pp.product_id = p.id
           LEFT JOIN (
             SELECT i.product_id, sum(i.quantity) AS qty, round(sum(i.quantity * i.unit_price), 2) AS revenue
               FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE o.status <> 'cancelled' AND i.status <> 'cancelled'
                AND o.created_at >= now() - interval '30 days'
              GROUP BY i.product_id) sv ON sv.product_id = p.id
          ORDER BY c.position, c.name, p.position, p.name`,
      );
      const options = await q(
        tx,
        `SELECT o.id, o.name, g.name AS "groupName", o.price_delta::text AS price, o.active,
                rc.cost::text AS cost, (rc.cost IS NOT NULL) AS "hasRecipe",
                coalesce(rc.missing, false) AS "missingCost"
           FROM options o
           JOIN option_groups g ON g.id = o.group_id
           LEFT JOIN LATERAL (
             SELECT round(sum(r.quantity * si.avg_cost), 4) AS cost, bool_or(si.avg_cost = 0) AS missing
               FROM option_recipes r JOIN stock_items si ON si.id = r.stock_item_id
              WHERE r.option_id = o.id) rc ON true
          WHERE g.active
          ORDER BY g.name, o.position, o.name`,
      );
      // CMV realizado: o que as vendas consumiram, pelo custo do momento da venda.
      const summary = await one(
        tx,
        `SELECT (SELECT coalesce(sum(total), 0) FROM orders
                  WHERE status <> 'cancelled' AND created_at >= now() - interval '30 days')::text AS "revenue30",
                (SELECT round(coalesce(-sum(m.quantity * coalesce(m.unit_cost, s.avg_cost)), 0), 2)
                   FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id
                  WHERE m.kind IN ('sale','sale_reversal') AND m.created_at >= now() - interval '30 days')::text AS "cogs30",
                (SELECT round(coalesce(-sum(m.quantity * coalesce(m.unit_cost, s.avg_cost)), 0), 2)
                   FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id
                  WHERE m.kind = 'loss' AND m.created_at >= now() - interval '30 days')::text AS "losses30"`,
      );
      return {
        settings: settings ?? {
          taxPercent: '6.00',
          feePercent: '4.00',
          fixedPercent: '30.00',
          targetMargin: '15.00',
        },
        products,
        options,
        summary,
      };
    });
  }

  @Put('pricing/settings')
  @RequirePermission('stock:write')
  pricingSettings(
    @Body(new ZodPipe(PricingSettings)) b: z.infer<typeof PricingSettings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      await q(
        tx,
        `INSERT INTO pricing_settings (tenant_id, tax_percent, fee_percent, fixed_percent, target_margin)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id) DO UPDATE SET tax_percent = EXCLUDED.tax_percent,
           fee_percent = EXCLUDED.fee_percent, fixed_percent = EXCLUDED.fixed_percent,
           target_margin = EXCLUDED.target_margin`,
        [t.id, b.taxPercent, b.feePercent, b.fixedPercent, b.targetMargin],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.pricing_settings',
        entity: 'tenant',
        entityId: t.id,
        data: b,
        ip: req.ip,
      });
      return one(
        tx,
        `SELECT tax_percent::text AS "taxPercent", fee_percent::text AS "feePercent",
                fixed_percent::text AS "fixedPercent", target_margin::text AS "targetMargin"
           FROM pricing_settings`,
      );
    });
  }

  /** Lucro desejado próprio do produto; null volta a usar o padrão do restaurante. */
  @Put('pricing/products/:id')
  @RequirePermission('stock:write')
  productPricing(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ProductPricing)) b: z.infer<typeof ProductPricing>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const p = await one(tx, `SELECT id FROM products WHERE id = $1`, [id]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      if (b.targetMargin === null) {
        await q(tx, `DELETE FROM product_pricing WHERE product_id = $1`, [id]);
      } else {
        const s = await one<{ others: string }>(
          tx,
          `SELECT (tax_percent + fee_percent + fixed_percent)::text AS others FROM pricing_settings`,
        );
        if (Number(s?.others ?? '40') + Number(b.targetMargin) > 90)
          throw new UnprocessableEntityException(
            'Com esse lucro, impostos, taxas e despesas passam de 90% do preço',
          );
        await q(
          tx,
          `INSERT INTO product_pricing (tenant_id, product_id, target_margin) VALUES ($1,$2,$3)
           ON CONFLICT (tenant_id, product_id) DO UPDATE SET target_margin = EXCLUDED.target_margin`,
          [t.id, id, b.targetMargin],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.pricing_product',
        entity: 'product',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return { productId: id, targetMargin: b.targetMargin };
    });
  }

  // ------------------------------------------------------------ fichas técnicas
  /**
   * Quanto dá para vender de cada item do cardápio com o estoque de hoje, pela ficha técnica.
   * Fica no cardápio (catalog:read) para quem cuida dos itens ver o alerta sem acesso ao estoque.
   */
  @Get('availability')
  @RequirePermission('catalog:read')
  availability(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) => q(tx, AVAILABILITY_SQL));
  }

  @Get('recipes')
  @RequirePermission('stock:read')
  recipes(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => ({
      products: await q(
        tx,
        `SELECT r.product_id AS "productId", r.stock_item_id AS "stockItemId", r.quantity::text
           FROM product_recipes r ORDER BY r.product_id`,
      ),
      options: await q(
        tx,
        `SELECT r.option_id AS "optionId", r.stock_item_id AS "stockItemId", r.quantity::text
           FROM option_recipes r ORDER BY r.option_id`,
      ),
    }));
  }

  @Put('recipes/products/:id')
  @RequirePermission('stock:write')
  productRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Recipe)) b: z.infer<typeof Recipe>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const p = await one(tx, `SELECT id FROM products WHERE id = $1 FOR UPDATE`, [id]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      return this.saveRecipe(tx, t.id, u.id, req.ip, 'product', id, b.lines);
    });
  }

  @Put('recipes/options/:id')
  @RequirePermission('stock:write')
  optionRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Recipe)) b: z.infer<typeof Recipe>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const o = await one(tx, `SELECT id FROM options WHERE id = $1 FOR UPDATE`, [id]);
      if (!o) throw new NotFoundException('Opção não encontrada');
      return this.saveRecipe(tx, t.id, u.id, req.ip, 'option', id, b.lines);
    });
  }

  private async saveRecipe(
    tx: Tx,
    tenantId: string,
    userId: string,
    ip: string | undefined,
    kind: 'product' | 'option',
    id: string,
    lines: { stockItemId: string; quantity: string }[],
  ) {
    const table = kind === 'product' ? 'product_recipes' : 'option_recipes';
    const col = kind === 'product' ? 'product_id' : 'option_id';
    await q(tx, `DELETE FROM ${table} WHERE ${col} = $1`, [id]);
    for (const l of lines) {
      await q(
        tx,
        `INSERT INTO ${table} (tenant_id, ${col}, stock_item_id, quantity) VALUES ($1,$2,$3,$4)`,
        [tenantId, id, l.stockItemId, l.quantity],
      );
    }
    await this.audit.record(tx, {
      tenantId,
      actorUserId: userId,
      action: `stock.recipe_${kind}`,
      entity: kind,
      entityId: id,
      data: { lines },
      ip,
    });
    return q(
      tx,
      `SELECT stock_item_id AS "stockItemId", quantity::text FROM ${table} WHERE ${col} = $1 ORDER BY stock_item_id`,
      [id],
    );
  }
}
