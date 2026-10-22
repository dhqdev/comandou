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
import { and, asc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { isMoneyString } from '@pedemais/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { categories, products } from '../database/schema';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas, ex.: "12.90"')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

const CategoryCreate = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(10_000).optional(),
});
const ProductCreate = z.object({
  categoryId: z.string().uuid(),
  sectorId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  price: money,
});
const ProductUpdate = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    price: money,
    active: z.boolean(),
    soldOut: z.boolean(),
    categoryId: z.string().uuid(),
    sectorId: z.string().uuid().nullable(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

/** Nenhum endpoint aceita tenant_id do cliente: ele vem sempre do contexto resolvido. */
@Controller({ version: '1' })
export class CatalogController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  @RequirePermission('catalog:read')
  listCategories(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      tx.select().from(categories).orderBy(asc(categories.position), asc(categories.name)),
    );
  }

  @Post('categories')
  @RequirePermission('catalog:write')
  createCategory(
    @Body(new ZodPipe(CategoryCreate)) body: z.infer<typeof CategoryCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ tenantId: t.id, name: body.name, position: body.position ?? 0 })
        .returning();
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.category_created',
        entity: 'category',
        entityId: row.id,
        data: { name: row.name },
        ip: req.ip,
      });
      return row;
    });
  }

  @Get('products')
  @RequirePermission('catalog:read')
  listProducts(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      tx.select().from(products).orderBy(asc(products.name)),
    );
  }

  @Get('products/:id')
  @RequirePermission('catalog:read')
  async getProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const [r] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
      return r;
    });
    // Produto de outro restaurante é indistinguível de inexistente (404, não 403).
    if (!row) throw new NotFoundException('Produto não encontrado');
    return row;
  }

  @Post('products')
  @RequirePermission('catalog:write')
  createProduct(
    @Body(new ZodPipe(ProductCreate)) body: z.infer<typeof ProductCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const [cat] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.categoryId))
        .limit(1);
      if (!cat) throw new NotFoundException('Categoria não encontrada');
      const [row] = await tx
        .insert(products)
        .values({
          tenantId: t.id,
          categoryId: body.categoryId,
          name: body.name,
          description: body.description ?? null,
          price: body.price,
          sectorId: body.sectorId ?? null,
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.product_created',
        entity: 'product',
        entityId: row.id,
        data: { name: row.name, price: row.price },
        ip: req.ip,
      });
      return row;
    });
  }

  @Patch('products/:id')
  @RequirePermission('catalog:write')
  async updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ProductUpdate)) body: z.infer<typeof ProductUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const [r] = await tx
        .update(products)
        .set(body)
        .where(and(eq(products.id, id), eq(products.tenantId, t.id)))
        .returning();
      if (r) {
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'catalog.product_updated',
          entity: 'product',
          entityId: r.id,
          data: { changes: body },
          ip: req.ip,
        });
      }
      return r;
    });
    if (!row) throw new NotFoundException('Produto não encontrado');
    return row;
  }
}
