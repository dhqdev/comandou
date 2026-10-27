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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { isMoneyString } from '@comandou/shared';
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
  kind: z.enum(['principal', 'delivery']),
  /** Começa com os itens (e preços) de outro cardápio; sem ele, com todos os itens no preço base. */
  copyFromId: z.string().uuid().optional(),
});
const MenuUpdate = z
  .object({ name: z.string().trim().min(1).max(60), active: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
const MenuItems = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), price: money.nullable() })).max(5000),
});

export interface MenuRow {
  id: string;
  name: string;
  kind: 'principal' | 'delivery';
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
        `INSERT INTO menu_items (tenant_id, menu_id, product_id) SELECT $1, $2, id FROM products`,
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
      // Se já há um ativo do mesmo tipo, o novo nasce pausado: ativar troca um pelo outro.
      const active = !menus.some((m) => m.kind === b.kind && m.active);
      const m = await one<{ id: string }>(
        tx,
        `INSERT INTO menus (tenant_id, name, kind, active) VALUES ($1,$2,$3,$4) RETURNING id`,
        [t.id, b.name, b.kind, active],
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
          `INSERT INTO menu_items (tenant_id, menu_id, product_id) SELECT $1, $2, id FROM products`,
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
      // Ativar troca: o outro ativo do mesmo tipo é pausado na mesma transação.
      if (b.active)
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
      const cur = await one<MenuRow>(tx, `SELECT id, name, active FROM menus WHERE id = $1`, [id]);
      if (!cur) throw new NotFoundException('Cardápio não encontrado');
      if (cur.active)
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
}
