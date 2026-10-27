import {
  Body,
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
import { isMoneyString, menuKindOf } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { menuTreeSql } from './menu-sql';

const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

const OptionIn = z.object({
  name: z.string().trim().min(1).max(80),
  priceDelta: money.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  isDefault: z.boolean().optional(),
});
const groupShape = {
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['additional', 'variation', 'flavor', 'remove']).default('additional'),
  charge: z.enum(['sum', 'max', 'average']).default('sum'),
  minSelect: z.number().int().min(0).max(50).default(0),
  maxSelect: z.number().int().min(1).max(50).default(1),
};
const GroupIn = z
  .object({ ...groupShape, options: z.array(OptionIn).max(100).default([]) })
  .refine((g) => g.minSelect <= g.maxSelect, 'mínimo maior que máximo');
/** Edição completa: opção com id é atualizada, sem id é criada; a que sumiu da lista é arquivada. */
const GroupPut = z
  .object({
    ...groupShape,
    active: z.boolean().default(true),
    options: z
      .array(OptionIn.extend({ id: z.string().uuid().optional(), active: z.boolean().optional() }))
      .max(100),
  })
  .refine((g) => g.minSelect <= g.maxSelect, 'mínimo maior que máximo');
const OptionPatch = OptionIn.partial().extend({ active: z.boolean().optional() });
const MenuQuery = z.object({
  channel: z.enum(['counter', 'table', 'delivery', 'pickup']).default('counter'),
});
const LinkIn = z.object({ groupIds: z.array(z.string().uuid()).max(30) });

const GROUPS_SQL = `
  SELECT g.id, g.name, g.min_select AS "minSelect", g.max_select AS "maxSelect", g.active,
         g.kind, g.charge,
         (SELECT count(*)::int FROM product_option_groups pog WHERE pog.group_id = g.id) AS "productCount",
         COALESCE(json_agg(json_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta::text,
                  'position', o.position, 'active', o.active, 'isDefault', o.is_default) ORDER BY o.position, o.name)
                  FILTER (WHERE o.id IS NOT NULL), '[]') AS options
    FROM option_groups g LEFT JOIN options o ON o.group_id = g.id AND NOT o.archived
   GROUP BY g.id ORDER BY g.name`;

/** Adicionais e variações (grupos de opções) e o cardápio consolidado para o PDV. */
@Controller({ version: '1' })
export class OptionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('option-groups')
  @RequirePermission('catalog:read')
  groups(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) => q(tx, GROUPS_SQL));
  }

  @Post('option-groups')
  @RequirePermission('catalog:write')
  createGroup(
    @Body(new ZodPipe(GroupIn)) b: z.infer<typeof GroupIn>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const g = await one<{ id: string }>(
        tx,
        `INSERT INTO option_groups (tenant_id, name, min_select, max_select, kind, charge)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.id, b.name, b.minSelect, b.maxSelect, b.kind, b.charge],
      );
      for (const [i, o] of b.options.entries()) {
        await q(
          tx,
          `INSERT INTO options (tenant_id, group_id, name, price_delta, position, is_default) VALUES ($1,$2,$3,$4,$5,$6)`,
          [t.id, g!.id, o.name, o.priceDelta ?? '0', o.position ?? i, o.isDefault ?? false],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.option_group_created',
        entity: 'option_group',
        entityId: g!.id,
        data: { name: b.name },
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return (await q<{ id: string }>(tx, GROUPS_SQL)).find((x) => x.id === g!.id);
    });
  }

  @Put('option-groups/:id')
  @RequirePermission('catalog:write')
  async saveGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(GroupPut)) b: z.infer<typeof GroupPut>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const g = await one(
        tx,
        `UPDATE option_groups SET name = $2, min_select = $3, max_select = $4, kind = $5, charge = $6, active = $7
          WHERE id = $1 RETURNING id`,
        [id, b.name, b.minSelect, b.maxSelect, b.kind, b.charge, b.active],
      );
      if (!g) return undefined;
      const current = await q<{ id: string }>(
        tx,
        `SELECT id FROM options WHERE group_id = $1 AND NOT archived`,
        [id],
      );
      const kept = new Set(b.options.flatMap((o) => (o.id ? [o.id] : [])));
      if ([...kept].some((k) => !current.some((c) => c.id === k)))
        throw new UnprocessableEntityException('Opção não pertence a este grupo');
      // Opção que saiu da lista fica arquivada (pedidos antigos e fichas técnicas apontam para ela).
      const gone = current.filter((c) => !kept.has(c.id)).map((c) => c.id);
      if (gone.length)
        await q(
          tx,
          `UPDATE options SET archived = true, active = false, is_default = false WHERE id = ANY($1::uuid[])`,
          [gone],
        );
      for (const [i, o] of b.options.entries()) {
        if (o.id)
          await q(
            tx,
            `UPDATE options SET name = $2, price_delta = $3, position = $4, is_default = $5,
               active = COALESCE($6, active) WHERE id = $1`,
            [o.id, o.name, o.priceDelta ?? '0', i, o.isDefault ?? false, o.active ?? null],
          );
        else
          await q(
            tx,
            `INSERT INTO options (tenant_id, group_id, name, price_delta, position, is_default, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [t.id, id, o.name, o.priceDelta ?? '0', i, o.isDefault ?? false, o.active ?? true],
          );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.option_group_updated',
        entity: 'option_group',
        entityId: id,
        data: { name: b.name, options: b.options.length, archived: gone.length },
        ip: req.ip,
      });
      return (await q<{ id: string }>(tx, GROUPS_SQL)).find((x) => x.id === id);
    });
    if (!row) throw new NotFoundException('Grupo não encontrado');
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return row;
  }

  @Post('option-groups/:id/options')
  @RequirePermission('catalog:write')
  async addOption(
    @Param('id', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodPipe(OptionIn)) b: z.infer<typeof OptionIn>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const g = await one(tx, `SELECT id FROM option_groups WHERE id = $1`, [groupId]);
      if (!g) throw new NotFoundException('Grupo não encontrado');
      const o = await one<{ id: string }>(
        tx,
        `INSERT INTO options (tenant_id, group_id, name, price_delta, position) VALUES ($1,$2,$3,$4,COALESCE($5,0))
         RETURNING id, name, price_delta::text AS "priceDelta", position, active`,
        [t.id, groupId, b.name, b.priceDelta ?? '0', b.position ?? null],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.option_created',
        entity: 'option',
        entityId: o!.id,
        data: b,
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return o;
    });
  }

  @Patch('options/:id')
  @RequirePermission('catalog:write')
  async updateOption(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(OptionPatch)) b: z.infer<typeof OptionPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one(
        tx,
        `UPDATE options SET name = COALESCE($2, name), price_delta = COALESCE($3, price_delta),
           position = COALESCE($4, position), active = COALESCE($5, active)
         WHERE id = $1 RETURNING id, name, price_delta::text AS "priceDelta", position, active`,
        [id, b.name ?? null, b.priceDelta ?? null, b.position ?? null, b.active ?? null],
      );
      if (r)
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'catalog.option_updated',
          entity: 'option',
          entityId: id,
          data: b,
          ip: req.ip,
        });
      return r;
    });
    if (!row) throw new NotFoundException('Opção não encontrada');
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return row;
  }

  /** Vínculos produto ↔ grupo (para a tela de cardápio). */
  @Get('product-option-groups')
  @RequirePermission('catalog:read')
  links(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT product_id AS "productId", group_id AS "groupId", position FROM product_option_groups ORDER BY product_id, position`,
      ),
    );
  }

  /** Define (substitui) os grupos de opções de um produto, na ordem enviada. */
  @Put('products/:id/option-groups')
  @RequirePermission('catalog:write')
  async linkGroups(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body(new ZodPipe(LinkIn)) b: z.infer<typeof LinkIn>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one(tx, `SELECT id FROM products WHERE id = $1`, [productId]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      const found = await q<{ id: string }>(
        tx,
        `SELECT id FROM option_groups WHERE id = ANY($1::uuid[])`,
        [b.groupIds],
      );
      if (found.length !== new Set(b.groupIds).size)
        throw new UnprocessableEntityException('Grupo de opções inválido');
      await q(tx, `DELETE FROM product_option_groups WHERE product_id = $1`, [productId]);
      for (const [i, gid] of [...new Set(b.groupIds)].entries()) {
        await q(
          tx,
          `INSERT INTO product_option_groups (tenant_id, product_id, group_id, position) VALUES ($1,$2,$3,$4)`,
          [t.id, productId, gid, i],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.product_groups_set',
        entity: 'product',
        entityId: productId,
        data: b,
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return { productId, groupIds: [...new Set(b.groupIds)] };
    });
  }

  /**
   * Cardápio consolidado para vender num canal: categorias ativas → itens do cardápio do canal
   * (com o preço dele) → grupos → opções ativas. Sem canal, vale o balcão.
   */
  @Get('menu')
  @RequirePermission('catalog:read')
  menu(
    @Query(new ZodPipe(MenuQuery)) query: z.infer<typeof MenuQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(tx, menuTreeSql(`'sectorId', p.sector_id, 'code', p.code,`), [menuKindOf(query.channel)]),
    );
  }
}
