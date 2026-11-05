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
  Req,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { isMoneyString } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { one, q } from '../common/sql';
import { DatabaseService, type Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ensureMenus } from './menus.controller';
import { categories, products } from '../database/schema';
import { PlanService } from '../plans/plan.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const money = z
  .string()
  .refine(isMoneyString, 'valor monetário com até 2 casas, ex.: "12.90"')
  .refine((v) => !v.startsWith('-'), 'valor não pode ser negativo');

/** Emoji da categoria (um símbolo, com variações de cor e junções). */
const icon = z.string().trim().min(1).max(16).nullable();
const CategoryCreate = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(10_000).optional(),
  icon: icon.optional(),
  sectorId: z.string().uuid().nullable().optional(),
});
const CategoryUpdate = z
  .object({
    name: z.string().trim().min(1).max(80),
    position: z.number().int().min(0).max(10_000),
    active: z.boolean(),
    imageId: z.string().uuid().nullable(),
    icon,
    /** Cozinha da categoria: os itens dela passam a ir para essa cozinha. */
    sectorId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
/** Campos fiscais do produto (NFC-e). null limpa e volta a usar o padrão do restaurante. */
const fiscalFields = {
  ncm: z
    .string()
    .regex(/^[0-9]{8}$/, 'NCM com 8 dígitos')
    .nullable(),
  cfop: z
    .string()
    .regex(/^[0-9]{4}$/, 'CFOP com 4 dígitos')
    .nullable(),
  fiscalCode: z
    .string()
    .regex(/^[0-9]{2,3}$/, 'CSOSN/CST com 2 ou 3 dígitos')
    .nullable(),
  fiscalOrigin: z.number().int().min(0).max(8).nullable(),
  fiscalUnit: z.string().trim().min(1).max(6).nullable(),
  fiscalRuleId: z.string().uuid().nullable(),
  cest: z
    .string()
    .regex(/^[0-9]{7}$/, 'CEST com 7 dígitos')
    .nullable(),
};

/** Cadastro do item: código interno, família, custo informado, venda por peso e código de barras. */
const itemFields = {
  code: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null)),
  familyId: z.string().uuid().nullable(),
  cost: money.nullable(),
  soldByWeight: z.boolean(),
  /** Tara em kg (pote, prato) descontada do peso lido na balança: "0.020". */
  weightTare: z.string().regex(/^\d(\.\d{1,3})?$/, 'tara em kg, até 3 casas (ex.: 0.020)'),
  barcode: z
    .string()
    .regex(/^[0-9]{4,14}$/, 'código de barras só com números (4 a 14)')
    .nullable(),
  barcodeType: z.enum(['fixed', 'weight', 'value']),
};
const MenuPrice = z.object({ menuId: z.string().uuid(), price: money.nullable() });

const ProductCreate = z.object({
  categoryId: z.string().uuid(),
  sectorId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  price: money,
  imageId: z.string().uuid().nullable().optional(),
  featured: z.boolean().optional(),
  badge: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .transform((v) => v || null),
  /** Em quais cardápios entra (e com que preço). Sem a lista, entra em todos com o preço base. */
  menus: z.array(MenuPrice).max(20).optional(),
  ...z.object(fiscalFields).partial().shape,
  ...z.object(itemFields).partial().shape,
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
    imageId: z.string().uuid().nullable(),
    featured: z.boolean(),
    badge: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .transform((v) => v || null),
    ...fiscalFields,
    ...itemFields,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');
const ProductMenus = z.object({ menus: z.array(MenuPrice).max(20) });

/** Próximo código livre no padrão IT-000001 (os digitados à mão em outro formato não contam). */
async function nextItemCode(tx: Tx) {
  const r = await one<{ n: number }>(
    tx,
    `SELECT COALESCE(max(substring(code from '^IT-([0-9]{1,9})$')::int), 0) + 1 AS n FROM products`,
  );
  return `IT-${String(r?.n ?? 1).padStart(6, '0')}`;
}

/** Cozinha (setor de produção) do restaurante; outra id vira 404, não erro de banco. */
async function assertSector(tx: Tx, sectorId: string) {
  const s = await one(tx, `SELECT id FROM production_sectors WHERE id = $1`, [sectorId]);
  if (!s) throw new NotFoundException('Cozinha não encontrada');
}

async function assertFreeCode(tx: Tx, code: string | null | undefined, exceptId?: string) {
  if (!code) return;
  const dup = await one(
    tx,
    `SELECT 1 FROM products WHERE upper(code) = upper($1) AND id IS DISTINCT FROM $2::uuid`,
    [code, exceptId ?? null],
  );
  if (dup) throw new ConflictException(`O código ${code} já é de outro item`);
}

async function assertFreeBarcode(tx: Tx, barcode: string | null | undefined, exceptId?: string) {
  if (!barcode) return;
  const dup = await one<{ name: string }>(
    tx,
    `SELECT name FROM products WHERE barcode = $1 AND id IS DISTINCT FROM $2::uuid`,
    [barcode, exceptId ?? null],
  );
  if (dup) throw new ConflictException(`Este código de barras já é do item ${dup.name}`);
}

/** Nenhum endpoint aceita tenant_id do cliente: ele vem sempre do contexto resolvido. */
@Controller({ version: '1' })
export class CatalogController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly realtime: RealtimeService,
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
      if (body.sectorId) await assertSector(tx, body.sectorId);
      const [row] = await tx
        .insert(categories)
        .values({
          tenantId: t.id,
          name: body.name,
          position: body.position ?? 0,
          icon: body.icon ?? null,
          sectorId: body.sectorId ?? null,
        })
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

  @Patch('categories/:id')
  @RequirePermission('catalog:write')
  async updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CategoryUpdate)) body: z.infer<typeof CategoryUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      if (body.sectorId) await assertSector(tx, body.sectorId);
      const [r] = await tx
        .update(categories)
        .set(body)
        .where(and(eq(categories.id, id), eq(categories.tenantId, t.id)))
        .returning();
      // Escolher a cozinha da categoria leva todos os itens dela para essa cozinha.
      if (r && body.sectorId !== undefined)
        await q(tx, `UPDATE products SET sector_id = $2 WHERE category_id = $1`, [
          id,
          body.sectorId,
        ]);
      if (r) {
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'catalog.category_updated',
          entity: 'category',
          entityId: r.id,
          data: { changes: body },
          ip: req.ip,
        });
      }
      return r;
    });
    if (!row) throw new NotFoundException('Categoria não encontrada');
    return row;
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
        .select({ id: categories.id, sectorId: categories.sectorId })
        .from(categories)
        .where(eq(categories.id, body.categoryId))
        .limit(1);
      if (!cat) throw new NotFoundException('Categoria não encontrada');
      await this.plans.assertCanAdd(tx, 'products');
      await assertFreeCode(tx, body.code);
      await assertFreeBarcode(tx, body.barcode);
      const [row] = await tx
        .insert(products)
        .values({
          tenantId: t.id,
          categoryId: body.categoryId,
          name: body.name,
          description: body.description ?? null,
          price: body.price,
          // Sem cozinha informada, o item vai para a cozinha da categoria.
          sectorId: body.sectorId === undefined ? cat.sectorId : body.sectorId,
          imageId: body.imageId ?? null,
          featured: body.featured ?? false,
          badge: body.badge ?? null,
          ncm: body.ncm ?? null,
          cfop: body.cfop ?? null,
          fiscalCode: body.fiscalCode ?? null,
          fiscalOrigin: body.fiscalOrigin ?? null,
          fiscalUnit: body.fiscalUnit ?? null,
          fiscalRuleId: body.fiscalRuleId ?? null,
          cest: body.cest ?? null,
          code: body.code || (await nextItemCode(tx)),
          familyId: body.familyId ?? null,
          cost: body.cost ?? null,
          soldByWeight: body.soldByWeight ?? false,
          weightTare: body.weightTare ?? '0',
          barcode: body.barcode ?? null,
          barcodeType: body.barcodeType ?? 'fixed',
        })
        .returning();
      // Entra nos cardápios escolhidos; sem escolha, em todos (com o preço base).
      const menus = await ensureMenus(tx, t.id);
      const wanted = body.menus ?? menus.map((m) => ({ menuId: m.id, price: null }));
      for (const m of wanted) {
        if (!menus.some((x) => x.id === m.menuId))
          throw new NotFoundException('Cardápio não encontrado');
        await q(
          tx,
          `INSERT INTO menu_items (tenant_id, menu_id, product_id, price) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, menu_id, product_id) DO UPDATE SET price = EXCLUDED.price`,
          [t.id, m.menuId, row.id, m.price],
        );
      }
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.product_created',
        entity: 'product',
        entityId: row.id,
        data: { name: row.name, price: row.price },
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
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
      if (body.active === true) {
        // Reativar um produto conta no limite de produtos ativos do plano.
        const [cur] = await tx
          .select({ active: products.active })
          .from(products)
          .where(eq(products.id, id))
          .limit(1);
        if (cur && !cur.active) await this.plans.assertCanAdd(tx, 'products');
      }
      await assertFreeCode(tx, body.code, id);
      await assertFreeBarcode(tx, body.barcode, id);
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
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return row;
  }

  /** Em quais cardápios o item aparece e com que preço (null = preço base). */
  @Get('products/:id/menus')
  @RequirePermission('catalog:read')
  productMenus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(tx, `SELECT menu_id AS "menuId", price::text FROM menu_items WHERE product_id = $1`, [id]),
    );
  }

  /** Substitui os cardápios do item (os que não vierem na lista deixam de mostrá-lo). */
  @Put('products/:id/menus')
  @RequirePermission('catalog:write')
  setProductMenus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ProductMenus)) body: z.infer<typeof ProductMenus>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one(tx, `SELECT id FROM products WHERE id = $1`, [id]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      const menus = await ensureMenus(tx, t.id);
      if (body.menus.some((m) => !menus.some((x) => x.id === m.menuId)))
        throw new NotFoundException('Cardápio não encontrado');
      await q(tx, `DELETE FROM menu_items WHERE product_id = $1`, [id]);
      for (const m of body.menus)
        await q(
          tx,
          `INSERT INTO menu_items (tenant_id, menu_id, product_id, price) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, menu_id, product_id) DO UPDATE SET price = EXCLUDED.price`,
          [t.id, m.menuId, id, m.price],
        );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.product_menus_set',
        entity: 'product',
        entityId: id,
        data: body,
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return body.menus;
    });
  }
}
