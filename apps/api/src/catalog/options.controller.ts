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
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { isMoneyString } from '@pedemais/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

const OptionIn = z.object({
  name: z.string().trim().min(1).max(80),
  priceDelta: money.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
const GroupIn = z
  .object({
    name: z.string().trim().min(1).max(80),
    minSelect: z.number().int().min(0).max(50).default(0),
    maxSelect: z.number().int().min(1).max(50).default(1),
    options: z.array(OptionIn).max(100).default([]),
  })
  .refine((g) => g.minSelect <= g.maxSelect, 'mínimo maior que máximo');
const OptionPatch = OptionIn.partial().extend({ active: z.boolean().optional() });
const LinkIn = z.object({ groupIds: z.array(z.string().uuid()).max(30) });

const GROUPS_SQL = `
  SELECT g.id, g.name, g.min_select AS "minSelect", g.max_select AS "maxSelect", g.active,
         COALESCE(json_agg(json_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta::text,
                  'position', o.position, 'active', o.active) ORDER BY o.position, o.name)
                  FILTER (WHERE o.id IS NOT NULL), '[]') AS options
    FROM option_groups g LEFT JOIN options o ON o.group_id = g.id
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
        `INSERT INTO option_groups (tenant_id, name, min_select, max_select) VALUES ($1,$2,$3,$4) RETURNING id`,
        [t.id, b.name, b.minSelect, b.maxSelect],
      );
      for (const [i, o] of b.options.entries()) {
        await q(
          tx,
          `INSERT INTO options (tenant_id, group_id, name, price_delta, position) VALUES ($1,$2,$3,$4,$5)`,
          [t.id, g!.id, o.name, o.priceDelta ?? '0', o.position ?? i],
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

  /** Cardápio consolidado para vender: categorias ativas → produtos ativos → grupos → opções ativas. */
  @Get('menu')
  @RequirePermission('catalog:read')
  menu(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT c.id, c.name,
           COALESCE((SELECT json_agg(json_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price::text,
               'soldOut', p.sold_out, 'sectorId', p.sector_id,
               'optionGroups', COALESCE((SELECT json_agg(json_build_object(
                   'id', g.id, 'name', g.name, 'minSelect', g.min_select, 'maxSelect', g.max_select,
                   'options', COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta::text)
                                        ORDER BY o.position, o.name)
                                       FROM options o WHERE o.group_id = g.id AND o.active), '[]'))
                 ORDER BY pog.position)
                 FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
                WHERE pog.product_id = p.id AND g.active), '[]'))
             ORDER BY p.position, p.name)
             FROM products p WHERE p.category_id = c.id AND p.active), '[]') AS products
           FROM categories c WHERE c.active ORDER BY c.position, c.name`,
      ),
    );
  }
}
