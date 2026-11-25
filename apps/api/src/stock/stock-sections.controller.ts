import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { positiveQty, unitCost, uuid } from '../common/schemas';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { StockCostsService } from './stock-costs.service';
import { StockOpsService } from './stock-ops.service';
import { StockService, TODAY_SQL } from './stock.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
/** Fator de conversão: positivo, até 6 casas ("12", "0.001"). */
const factor = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,6})?$/, 'fator com até 6 casas')
  .refine((v) => Number(v) > 0, 'fator deve ser maior que zero');
const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;

const Receipt = z.object({
  supplier: optText(80),
  invoice: optText(60),
  receivedOn: day.optional(),
  note: optText(300),
  lines: z
    .array(
      z.object({
        stockItemId: uuid,
        quantity: positiveQty,
        unit: z.string().trim().min(1).max(12),
        factor,
        unitCost: unitCost.optional(),
        lotCode: z.string().trim().min(1).max(40).optional(),
        madeOn: day.optional(),
        expiresOn: day.optional(),
      }),
    )
    .min(1)
    .max(100),
});
const Production = z.object({
  note: optText(300),
  lines: z
    .array(
      z.object({
        stockItemId: uuid,
        quantity: positiveQty,
        lotCode: z.string().trim().min(1).max(40).optional(),
        expiresOn: day.nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});
const Lot = z.object({
  stockItemId: uuid,
  quantity: positiveQty,
  code: z.string().trim().min(1).max(40).optional(),
  madeOn: day.optional(),
  expiresOn: day.optional(),
  note: optText(300),
});
const CloseLot = z.object({
  status: z.enum(['used', 'discarded']),
  note: z.string().trim().min(3).max(300).optional(),
  /**
   * Descarte: quanto foi para o lixo. O lote guarda a quantidade de quando entrou e não sabe
   * quanto já foi usado; sem este número, vale o lote inteiro (até o saldo do insumo).
   */
  quantity: positiveQty.optional(),
});
const LotsQuery = z.object({ itemId: uuid.optional() });
const PrepRecipe = z.object({
  yield: positiveQty,
  lines: z
    .array(z.object({ stockItemId: uuid, quantity: positiveQty }))
    .max(50)
    .refine((l) => new Set(l.map((x) => x.stockItemId)).size === l.length, 'insumo repetido'),
});
const Factor = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]{1,12}$/, 'sigla com até 12 letras ou números'),
  name: z.string().trim().min(1).max(60),
  unit: z.enum(UNITS),
  factor: factor.refine((v) => /^\d{1,8}(\.\d{1,4})?$/.test(v), 'fator com até 4 casas'),
  stockItemId: uuid.nullable().optional(),
});

const LOT_SELECT = `
  SELECT l.id, l.code, l.stock_item_id AS "stockItemId", s.name AS "itemName", s.code AS "itemCode", s.unit,
         l.quantity::text, l.made_on::text AS "madeOn", l.expires_on::text AS "expiresOn", l.status, l.origin,
         r.code AS "receiptCode", r.id AS "receiptId", p.code AS "productionCode", l.note,
         l.created_at AS "createdAt", l.closed_at AS "closedAt"
    FROM stock_lots l
    JOIN stock_items s ON s.id = l.stock_item_id
    LEFT JOIN stock_receipts r ON r.id = l.receipt_id
    LEFT JOIN stock_productions p ON p.id = l.production_id`;
const FACTOR_SELECT = `
  SELECT f.id, f.code, f.name, f.unit, f.factor::text, f.stock_item_id AS "stockItemId", s.name AS "itemName"
    FROM stock_unit_factors f LEFT JOIN stock_items s ON s.id = f.stock_item_id`;

/**
 * Seções do Estoque além dos insumos: ficha de preparo, lotes e validade, recebimento,
 * produção e fatores de conversão.
 */
@Controller({ path: 'stock', version: '1' })
export class StockSectionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly stock: StockService,
    private readonly ops: StockOpsService,
    private readonly audit: AuditService,
    private readonly costs: StockCostsService,
  ) {}

  @Get('items/:id')
  @RequirePermission('stock:read')
  item(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), (tx) => this.stock.item(tx, id));
  }

  // ------------------------------------------------------------ ficha de preparo
  @Get('item-recipes')
  @RequirePermission('stock:read')
  itemRecipes(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT r.stock_item_id AS "itemId", r.ingredient_id AS "stockItemId", r.quantity::text
           FROM stock_item_recipes r ORDER BY r.stock_item_id`,
      ),
    );
  }

  @Put('items/:id/recipe')
  @RequirePermission('stock:write')
  prepRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PrepRecipe)) b: z.infer<typeof PrepRecipe>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ctx = ctxOf(t, u, req);
    return this.db.withTenant(ctx, async (tx) => {
      const it = await one(tx, `SELECT id FROM stock_items WHERE id = $1`, [id]);
      if (!it) throw new NotFoundException('Insumo não encontrado');
      // Ficha circular (o molho leva a massa e a massa leva o molho) deixaria o custo sem fim.
      if (b.lines.length) {
        const loop = await one<{ name: string }>(
          tx,
          `WITH RECURSIVE up(id) AS (
             SELECT $1::uuid
             UNION
             SELECT r.stock_item_id FROM stock_item_recipes r JOIN up ON r.ingredient_id = up.id)
           SELECT s.name FROM stock_items s
            WHERE s.id = ANY($2::uuid[]) AND s.id <> $1 AND s.id IN (SELECT id FROM up) LIMIT 1`,
          [id, b.lines.map((l) => l.stockItemId)],
        );
        if (loop)
          throw new ConflictException(
            `${loop.name} já leva este preparo na ficha dele: um não pode levar o outro`,
          );
      }
      const snap = await this.costs.before(tx, [id]);
      await q(tx, `UPDATE stock_items SET recipe_yield = $2 WHERE id = $1`, [id, b.yield]);
      await q(tx, `DELETE FROM stock_item_recipes WHERE stock_item_id = $1`, [id]);
      for (const l of b.lines) {
        await q(
          tx,
          `INSERT INTO stock_item_recipes (tenant_id, stock_item_id, ingredient_id, quantity) VALUES ($1,$2,$3,$4)`,
          [t.id, id, l.stockItemId, l.quantity],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.recipe_prep',
        entity: 'stock_item',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      // O custo do preparo passa a ser o da ficha (e sobe em cascata para quem o usa).
      if (b.lines.length)
        await q(
          tx,
          `UPDATE stock_items SET avg_cost = stock_prep_cost(id), cost_changed_at = now()
            WHERE id = $1 AND stock_prep_cost(id) IS NOT NULL AND avg_cost <> stock_prep_cost(id)`,
          [id],
        );
      await this.costs.after(tx, ctx, snap, 'prep_recipe', 'Ficha de preparo alterada');
      return this.stock.item(tx, id);
    });
  }

  // ------------------------------------------------------------ lotes
  @Get('lots')
  @RequirePermission('stock:read')
  lots(
    @Query(new ZodPipe(LotsQuery)) f: z.infer<typeof LotsQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `${LOT_SELECT} WHERE ($1::uuid IS NULL OR l.stock_item_id = $1)
          ORDER BY (l.status = 'available') DESC, l.expires_on NULLS LAST, l.created_at DESC
          LIMIT 1000`,
        [f.itemId ?? null],
      ),
    );
  }

  /** Lote de algo que já está no estoque (etiquetar o que chegou antes): não mexe no saldo. */
  @Post('lots')
  @RequirePermission('stock:write')
  createLot(
    @Body(new ZodPipe(Lot)) b: z.infer<typeof Lot>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO stock_lots (tenant_id, stock_item_id, code, quantity, made_on, expires_on, origin, note, created_by)
         VALUES ($1,$2,$3,$4,coalesce($5::date, ${TODAY_SQL}),$6,'manual',$7,$8) RETURNING id`,
        [
          t.id,
          b.stockItemId,
          b.code ?? null,
          b.quantity,
          b.madeOn ?? null,
          b.expiresOn ?? null,
          b.note,
          u.id,
        ],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.lot_created',
        entity: 'stock_lot',
        entityId: r!.id,
        data: b,
        ip: req.ip,
      });
      return one(tx, `${LOT_SELECT} WHERE l.id = $1`, [r!.id]);
    });
  }

  @Post('lots/:id/close')
  @RequirePermission('stock:write')
  closeLot(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CloseLot)) b: z.infer<typeof CloseLot>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.ops.closeLot(ctxOf(t, u, req), id, b);
  }

  // ------------------------------------------------------------ recebimento
  @Get('receipts')
  @RequirePermission('stock:read')
  receipts(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT r.id, r.code, r.supplier, r.invoice, r.received_on::text AS "receivedOn", r.note,
                r.total::text, r.created_at AS "createdAt", us.name AS "createdByName",
                (SELECT count(*)::int FROM stock_receipt_lines l WHERE l.receipt_id = r.id) AS "linesCount"
           FROM stock_receipts r LEFT JOIN users us ON us.id = r.created_by
          ORDER BY r.received_on DESC, r.created_at DESC LIMIT 500`,
      ),
    );
  }

  @Get('receipts/:id')
  @RequirePermission('stock:read')
  receipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one(
        tx,
        `SELECT r.id, r.code, r.supplier, r.invoice, r.received_on::text AS "receivedOn", r.note,
                r.total::text, r.created_at AS "createdAt", us.name AS "createdByName"
           FROM stock_receipts r LEFT JOIN users us ON us.id = r.created_by WHERE r.id = $1`,
        [id],
      );
      if (!r) throw new NotFoundException('Recebimento não encontrado');
      const lines = await q(
        tx,
        `SELECT l.id::text, l.stock_item_id AS "stockItemId", s.name AS "itemName", s.unit,
                l.quantity::text, l.unit_cost::text AS "unitCost", l.entered_quantity::text AS "enteredQuantity",
                l.entered_unit AS "enteredUnit", l.factor::text, lt.code AS "lotCode",
                lt.expires_on::text AS "expiresOn",
                round(l.quantity * l.unit_cost, 2)::text AS total
           FROM stock_receipt_lines l
           JOIN stock_items s ON s.id = l.stock_item_id
           LEFT JOIN stock_lots lt ON lt.id = l.lot_id
          WHERE l.receipt_id = $1 ORDER BY l.id`,
        [id],
      );
      return { ...r, lines };
    });
  }

  @Post('receipts')
  @RequirePermission('stock:write')
  receive(
    @Body(new ZodPipe(Receipt)) b: z.infer<typeof Receipt>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.ops.receive(ctxOf(t, u, req), b);
  }

  // ------------------------------------------------------------ produção
  @Get('productions')
  @RequirePermission('stock:read')
  productions(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `SELECT p.id, p.code, p.stock_item_id AS "stockItemId", s.name AS "itemName", s.unit,
                p.quantity::text, p.total_cost::text AS "totalCost", p.note, p.created_at AS "createdAt",
                us.name AS "createdByName", l.code AS "lotCode", l.expires_on::text AS "expiresOn"
           FROM stock_productions p
           JOIN stock_items s ON s.id = p.stock_item_id
           LEFT JOIN users us ON us.id = p.created_by
           LEFT JOIN stock_lots l ON l.production_id = p.id
          ORDER BY p.created_at DESC, p.code DESC LIMIT 200`,
      ),
    );
  }

  @Post('productions')
  @RequirePermission('stock:write')
  produce(
    @Body(new ZodPipe(Production)) b: z.infer<typeof Production>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.ops.produce(ctxOf(t, u, req), b);
  }

  // ------------------------------------------------------------ fatores de conversão
  @Get('factors')
  @RequirePermission('stock:read')
  factors(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(tx, `${FACTOR_SELECT} ORDER BY upper(f.code), s.name NULLS FIRST`),
    );
  }

  @Post('factors')
  @RequirePermission('stock:write')
  createFactor(
    @Body(new ZodPipe(Factor)) b: z.infer<typeof Factor>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.saveFactor(t, u, req, null, b);
  }

  @Patch('factors/:id')
  @RequirePermission('stock:write')
  updateFactor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Factor)) b: z.infer<typeof Factor>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.saveFactor(t, u, req, id, b);
  }

  @Delete('factors/:id')
  @RequirePermission('stock:write')
  deleteFactor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await one(tx, `DELETE FROM stock_unit_factors WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Fator não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'stock.factor_deleted',
        entity: 'stock_unit_factor',
        entityId: id,
        data: {},
        ip: req.ip,
      });
      return { id };
    });
  }

  private saveFactor(
    t: ResolvedTenant,
    u: AuthenticatedUser,
    req: Request,
    id: string | null,
    b: z.infer<typeof Factor>,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      if (b.stockItemId) {
        const it = await one<{ unit: string }>(tx, `SELECT unit FROM stock_items WHERE id = $1`, [
          b.stockItemId,
        ]);
        if (!it) throw new NotFoundException('Insumo não encontrado');
        b.unit = it.unit as (typeof UNITS)[number];
      }
      const r = id
        ? await one<{ id: string }>(
            tx,
            `UPDATE stock_unit_factors SET code = $2, name = $3, unit = $4, factor = $5, stock_item_id = $6
              WHERE id = $1 RETURNING id`,
            [id, b.code, b.name, b.unit, b.factor, b.stockItemId ?? null],
          )
        : await one<{ id: string }>(
            tx,
            `INSERT INTO stock_unit_factors (tenant_id, code, name, unit, factor, stock_item_id)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [t.id, b.code, b.name, b.unit, b.factor, b.stockItemId ?? null],
          );
      if (!r) throw new NotFoundException('Fator não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: id ? 'stock.factor_updated' : 'stock.factor_created',
        entity: 'stock_unit_factor',
        entityId: r.id,
        data: b,
        ip: req.ip,
      });
      return one(tx, `${FACTOR_SELECT} WHERE f.id = $1`, [r.id]);
    });
  }
}
