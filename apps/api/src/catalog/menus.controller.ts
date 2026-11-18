import {
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  adjustPriceCents,
  fromCents,
  isMoneyString,
  PRICE_ADJUST_MAX,
  PRICE_ADJUST_MIN,
  PRICE_ROUNDINGS,
  toCents,
} from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, type Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

const MenuCreate = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['principal', 'delivery', 'ifood']),
  /** Começa com os itens (e preços) de outro cardápio; sem ele, com todos os itens no preço base. */
  copyFromId: z.string().uuid().optional(),
  /** Cardápio do iFood: a loja do iFood que recebe este cardápio. */
  ifoodConnectionId: z.string().uuid().optional(),
});
const MenuUpdate = z
  .object({
    name: z.string().trim().min(1).max(60),
    active: z.boolean(),
    ifoodConnectionId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
const MenuItems = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), price: money.nullable() })).max(5000),
});

const PriceAdjust = z
  .object({
    percent: z.number().min(PRICE_ADJUST_MIN).max(PRICE_ADJUST_MAX),
    rounding: z.enum(PRICE_ROUNDINGS as [string, ...string[]]),
    /** Só os itens desta categoria; sem ela, o cardápio todo. */
    categoryId: z.string().uuid().nullable().optional(),
    /** Também os complementos dos itens (valem em todos os cardápios). */
    options: z.boolean().default(false),
    /** true = só calcula a prévia, sem gravar. */
    preview: z.boolean().default(false),
  })
  .refine(
    (b) => b.percent !== 0 || b.rounding !== 'none',
    'informe o percentual ou o arredondamento',
  );

interface PriceChange {
  id: string;
  name: string;
  from: string;
  to: string;
}

export interface MenuRow {
  id: string;
  name: string;
  kind: 'principal' | 'delivery' | 'ifood';
  active: boolean;
}

/**
 * Cardápios do restaurante. Na primeira vez cria o Principal e o Delivery já com todos os itens
 * no preço base, então nada muda para quem ainda não mexeu nos cardápios.
 */
export async function ensureMenus(tx: Tx, tenantId: string): Promise<MenuRow[]> {
  const sql = `SELECT id, name, kind, active FROM menus ORDER BY kind DESC, active DESC, name`;
  const rows = await q<MenuRow>(tx, sql);
  if (rows.length) return rows;
  for (const [name, kind] of [
    ['Cardápio Principal', 'principal'],
    ['Cardápio Delivery', 'delivery'],
  ]) {
    const m = await one<{ id: string }>(
      tx,
      `INSERT INTO menus (tenant_id, name, kind) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId, name, kind],
    );
    if (m)
      await q(
        tx,
        `INSERT INTO menu_items (tenant_id, menu_id, product_id) SELECT $1, $2, id FROM products WHERE system_kind IS NULL`,
        [tenantId, m.id],
      );
  }
  return q<MenuRow>(tx, sql);
}

/** Vários cardápios (Principal e Delivery), cada um com seus itens e preços. */
@Controller({ version: '1' })
export class MenusController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('menus')
  @RequirePermission('catalog:read')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      await ensureMenus(tx, t.id);
      return q(
        tx,
        `SELECT m.id, m.name, m.kind, m.active, m.updated_at AS "updatedAt",
                m.ifood_connection_id AS "ifoodConnectionId",
                (SELECT c.merchant_name FROM ifood_connections c WHERE c.id = m.ifood_connection_id) AS "ifoodMerchantName",
                m.ifood_synced_at AS "ifoodSyncedAt", m.ifood_sync_status AS "ifoodSyncStatus",
                (SELECT count(*)::int FROM menu_items mi JOIN products p ON p.id = mi.product_id
                  WHERE mi.menu_id = m.id AND p.active) AS items,
                (SELECT count(*)::int FROM menu_items mi WHERE mi.menu_id = m.id AND mi.price IS NOT NULL) AS "customPrices"
           FROM menus m ORDER BY m.kind DESC, m.active DESC, m.name`,
      );
    });
  }

  @Post('menus')
  @RequirePermission('catalog:write')
  create(
    @Body(new ZodPipe(MenuCreate)) b: z.infer<typeof MenuCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const menus = await ensureMenus(tx, t.id);
      if (menus.length >= 20) throw new ConflictException('Limite de 20 cardápios');
      const ifood = b.kind === 'ifood';
      if (ifood) await this.checkConnection(tx, b.ifoodConnectionId, null);
      else if (b.ifoodConnectionId)
        throw new BadRequestException('Só o cardápio do iFood escolhe uma loja do iFood');
      // Se já há um ativo do mesmo tipo, o novo nasce pausado: ativar troca um pelo outro.
      // Cardápios do iFood são um por loja e já nascem enviando.
      const active = ifood || !menus.some((m) => m.kind === b.kind && m.active);
      const m = await one<{ id: string }>(
        tx,
        `INSERT INTO menus (tenant_id, name, kind, active, ifood_connection_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, b.name, b.kind, active, ifood ? b.ifoodConnectionId : null],
      );
      if (b.copyFromId) {
        if (!menus.some((x) => x.id === b.copyFromId))
          throw new NotFoundException('Cardápio de origem não encontrado');
        await q(
          tx,
          `INSERT INTO menu_items (tenant_id, menu_id, product_id, price)
           SELECT $1, $2, product_id, price FROM menu_items WHERE menu_id = $3`,
          [t.id, m!.id, b.copyFromId],
        );
      } else {
        await q(
          tx,
          `INSERT INTO menu_items (tenant_id, menu_id, product_id) SELECT $1, $2, id FROM products WHERE system_kind IS NULL`,
          [t.id, m!.id],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.menu_created',
        entity: 'menu',
        entityId: m!.id,
        data: b,
        ip: req.ip,
      });
      if (active) this.realtime.publish(t.id, { type: 'menu.changed' });
      return { id: m!.id, name: b.name, kind: b.kind, active };
    });
  }

  @Patch('menus/:id')
  @RequirePermission('catalog:write')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MenuUpdate)) b: z.infer<typeof MenuUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const cur = await one<MenuRow>(tx, `SELECT id, kind FROM menus WHERE id = $1 FOR UPDATE`, [
        id,
      ]);
      if (!cur) return undefined;
      if (b.ifoodConnectionId !== undefined) {
        if (cur.kind !== 'ifood')
          throw new BadRequestException('Só o cardápio do iFood escolhe uma loja do iFood');
        await this.checkConnection(tx, b.ifoodConnectionId, id);
        await q(tx, `UPDATE menus SET ifood_connection_id = $2 WHERE id = $1`, [
          id,
          b.ifoodConnectionId,
        ]);
        // Outra loja: o que foi enviado para a anterior não vale para a nova.
        await q(tx, `DELETE FROM ifood_sync_map WHERE menu_id = $1`, [id]);
      }
      // Ativar troca: o outro ativo do mesmo tipo é pausado na mesma transação.
      // (Cardápios do iFood não trocam: cada um vai para a sua loja.)
      if (b.active && cur.kind !== 'ifood')
        await q(tx, `UPDATE menus SET active = false WHERE kind = $1 AND active AND id <> $2`, [
          cur.kind,
          id,
        ]);
      const r = await one<MenuRow>(
        tx,
        `UPDATE menus SET name = COALESCE($2, name), active = COALESCE($3, active)
          WHERE id = $1 RETURNING id, name, kind, active`,
        [id, b.name ?? null, b.active ?? null],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.menu_updated',
        entity: 'menu',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return r;
    });
    if (!row) throw new NotFoundException('Cardápio não encontrado');
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return row;
  }

  /** Só cardápio pausado pode ser apagado (o ativo está vendendo). */
  @Delete('menus/:id')
  @RequirePermission('catalog:write')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const cur = await one<MenuRow>(tx, `SELECT id, name, kind, active FROM menus WHERE id = $1`, [
        id,
      ]);
      if (!cur) throw new NotFoundException('Cardápio não encontrado');
      if (cur.active && cur.kind !== 'ifood')
        throw new ConflictException(
          'Pause o cardápio (ou ative outro do mesmo tipo) antes de apagar',
        );
      await q(tx, `DELETE FROM menus WHERE id = $1`, [id]);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.menu_deleted',
        entity: 'menu',
        entityId: id,
        data: { name: cur.name },
        ip: req.ip,
      });
    });
    return { ok: true };
  }

  /** A loja do iFood existe e não está em outro cardápio. */
  private async checkConnection(
    tx: Tx,
    connectionId: string | null | undefined,
    menuId: string | null,
  ) {
    if (!connectionId) {
      if (menuId) return;
      throw new BadRequestException('Escolha a loja do iFood que recebe este cardápio');
    }
    const c = await one<{ menu_id: string | null }>(
      tx,
      `SELECT (SELECT m.id FROM menus m WHERE m.ifood_connection_id = c.id) AS menu_id
         FROM ifood_connections c WHERE c.id = $1`,
      [connectionId],
    );
    if (!c) throw new NotFoundException('Loja do iFood não encontrada');
    if (c.menu_id && c.menu_id !== menuId)
      throw new ConflictException('Essa loja do iFood já tem um cardápio');
  }

  @Get('menus/:id/items')
  @RequirePermission('catalog:read')
  items(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(tx, `SELECT product_id AS "productId", price::text FROM menu_items WHERE menu_id = $1`, [
        id,
      ]),
    );
  }

  /** Substitui os itens do cardápio e os preços próprios (null = preço base do item). */
  @Put('menus/:id/items')
  @RequirePermission('catalog:write')
  setItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MenuItems)) b: z.infer<typeof MenuItems>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const m = await one(tx, `SELECT id FROM menus WHERE id = $1 FOR UPDATE`, [id]);
      if (!m) throw new NotFoundException('Cardápio não encontrado');
      const ids = [...new Set(b.items.map((i) => i.productId))];
      const found = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM products WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      if ((found?.n ?? 0) !== ids.length) throw new NotFoundException('Item não encontrado');
      await q(tx, `DELETE FROM menu_items WHERE menu_id = $1`, [id]);
      if (b.items.length)
        await q(
          tx,
          `INSERT INTO menu_items (tenant_id, menu_id, product_id, price)
           SELECT $1, $2, x.product_id, x.price
             FROM unnest($3::uuid[], $4::numeric[]) AS x(product_id, price)
           ON CONFLICT (tenant_id, menu_id, product_id) DO UPDATE SET price = EXCLUDED.price`,
          [t.id, id, b.items.map((i) => i.productId), b.items.map((i) => i.price)],
        );
      await q(tx, `UPDATE menus SET updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.menu_items_set',
        entity: 'menu',
        entityId: id,
        data: { items: b.items.length, customPrices: b.items.filter((i) => i.price).length },
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return { items: b.items.length };
    });
  }

  /**
   * Reajustar preços: percentual e arredondamento nos itens do cardápio (de uma categoria ou de
   * todas). O preço reajustado vira preço próprio deste cardápio; os outros não mudam. Com
   * `options`, reajusta também os complementos dos itens, que valem em todos os cardápios.
   */
  @Post('menus/:id/price-adjust')
  @RequirePermission('catalog:write')
  adjustPrices(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PriceAdjust)) b: z.infer<typeof PriceAdjust>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const m = await one(tx, `SELECT id FROM menus WHERE id = $1 FOR UPDATE`, [id]);
      if (!m) throw new NotFoundException('Cardápio não encontrado');
      const rounding = b.rounding as (typeof PRICE_ROUNDINGS)[number];
      const next = (price: string) =>
        fromCents(adjustPriceCents(toCents(price), b.percent, rounding));
      const cat = b.categoryId ?? null;
      const rows = await q<{ id: string; name: string; price: string }>(
        tx,
        `SELECT p.id, p.name, COALESCE(mi.price, p.price)::text AS price
           FROM menu_items mi JOIN products p ON p.id = mi.product_id
          WHERE mi.menu_id = $1 AND ($2::uuid IS NULL OR p.category_id = $2)
          ORDER BY p.position, p.name`,
        [id, cat],
      );
      const items: PriceChange[] = rows
        .map((r) => ({ id: r.id, name: r.name, from: r.price, to: next(r.price) }))
        .filter((r) => r.to !== r.from);
      const options: PriceChange[] = b.options
        ? (
            await q<{ id: string; name: string; price: string }>(
              tx,
              `SELECT o.id, g.name || ': ' || o.name AS name, o.price_delta::text AS price
                 FROM options o JOIN option_groups g ON g.id = o.group_id
                WHERE o.price_delta > 0 AND o.group_id IN (
                  SELECT pog.group_id FROM product_option_groups pog
                    JOIN menu_items mi ON mi.product_id = pog.product_id AND mi.menu_id = $1
                    JOIN products p ON p.id = pog.product_id
                   WHERE $2::uuid IS NULL OR p.category_id = $2)
                ORDER BY g.name, o.position, o.name`,
              [id, cat],
            )
          )
            .map((r) => ({ id: r.id, name: r.name, from: r.price, to: next(r.price) }))
            .filter((r) => r.to !== r.from)
        : [];
      if (!b.preview && (items.length || options.length)) {
        if (items.length)
          await q(
            tx,
            `UPDATE menu_items mi SET price = x.price
               FROM unnest($2::uuid[], $3::numeric[]) AS x(product_id, price)
              WHERE mi.menu_id = $1 AND mi.product_id = x.product_id`,
            [id, items.map((i) => i.id), items.map((i) => i.to)],
          );
        if (options.length)
          await q(
            tx,
            `UPDATE options o SET price_delta = x.price
               FROM unnest($1::uuid[], $2::numeric[]) AS x(id, price) WHERE o.id = x.id`,
            [options.map((o) => o.id), options.map((o) => o.to)],
          );
        await q(tx, `UPDATE menus SET updated_at = now() WHERE id = $1`, [id]);
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'catalog.menu_prices_adjusted',
          entity: 'menu',
          entityId: id,
          data: {
            percent: b.percent,
            rounding: b.rounding,
            categoryId: cat,
            items: items.length,
            options: options.length,
          },
          ip: req.ip,
        });
        this.realtime.publish(t.id, { type: 'menu.changed' });
      }
      return { applied: !b.preview, items, options };
    });
  }
}
