import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const FamilyIn = z.object({
  name: z.string().trim().min(1).max(60),
  active: z.boolean().default(true),
  countsAsProduct: z.boolean().default(false),
});
const FamilyPatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    active: z.boolean(),
    countsAsProduct: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const COLS = `f.id, f.name, f.active, f.counts_as_product AS "countsAsProduct",
  (SELECT count(*)::int FROM products p WHERE p.family_id = f.id) AS items`;

/** Famílias de itens: agrupam as vendas nos relatórios (independem da categoria do cardápio). */
@Controller({ version: '1' })
export class FamiliesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('item-families')
  @RequirePermission('catalog:read')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(tx, `SELECT ${COLS} FROM item_families f ORDER BY f.active DESC, f.name`),
    );
  }

  @Post('item-families')
  @RequirePermission('catalog:write')
  create(
    @Body(new ZodPipe(FamilyIn)) b: z.infer<typeof FamilyIn>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO item_families (tenant_id, name, active, counts_as_product) VALUES ($1,$2,$3,$4) RETURNING id`,
        [t.id, b.name, b.active, b.countsAsProduct],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.family_created',
        entity: 'item_family',
        entityId: r!.id,
        data: b,
        ip: req.ip,
      });
      return one(tx, `SELECT ${COLS} FROM item_families f WHERE f.id = $1`, [r!.id]);
    });
  }

  @Patch('item-families/:id')
  @RequirePermission('catalog:write')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(FamilyPatch)) b: z.infer<typeof FamilyPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `UPDATE item_families SET name = COALESCE($2, name), active = COALESCE($3, active),
           counts_as_product = COALESCE($4, counts_as_product) WHERE id = $1 RETURNING id`,
        [id, b.name ?? null, b.active ?? null, b.countsAsProduct ?? null],
      );
      if (!r) return undefined;
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.family_updated',
        entity: 'item_family',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return one(tx, `SELECT ${COLS} FROM item_families f WHERE f.id = $1`, [id]);
    });
    if (!row) throw new NotFoundException('Família não encontrada');
    return row;
  }
}
