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
import { ITEM_SELECT, StockService } from './stock.service';

const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;
const Item = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.enum(UNITS),
  minQuantity: qty.optional(),
  allowNegative: z.boolean().optional(),
  active: z.boolean().optional(),
});
const Entry = z.object({
  kind: z.enum(['purchase', 'loss', 'count']),
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
  limit: z.coerce.number().int().min(1).max(500).default(100),
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
      q(tx, `${ITEM_SELECT} ORDER BY active DESC, name`),
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
        `INSERT INTO stock_items (tenant_id, name, unit, min_quantity, allow_negative, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.id, b.name, b.unit, b.minQuantity ?? '0', b.allowNegative ?? false, b.active ?? true],
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
                allow_negative = COALESCE($5, allow_negative), active = COALESCE($6, active)
          WHERE id = $1`,
        [
          id,
          b.name ?? null,
          b.unit ?? null,
          b.minQuantity ?? null,
          b.allowNegative ?? null,
          b.active ?? null,
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
                us.name AS "createdByName"
           FROM stock_movements m
           JOIN stock_items s ON s.id = m.stock_item_id
           LEFT JOIN orders o ON o.id = m.order_id
           LEFT JOIN users us ON us.id = m.created_by
          WHERE ($1::uuid IS NULL OR m.stock_item_id = $1)
          ORDER BY m.id DESC LIMIT $2`,
        [f.itemId ?? null, f.limit],
      ),
    );
  }

  // ------------------------------------------------------------ fichas técnicas
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
