import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Fotos extras do item (além da principal), na ordem em que o cliente passa por elas. */
export const MAX_PRODUCT_PHOTOS = 8;
const Photos = z.object({
  imageIds: z
    .array(z.string().uuid())
    .max(MAX_PRODUCT_PHOTOS)
    .refine((a) => new Set(a).size === a.length, 'foto repetida'),
});
const ReviewPatch = z.object({ hidden: z.boolean() });

/**
 * Cadastro do item, lado da equipe: fotos extras do cardápio online e as avaliações que os
 * clientes deixaram (a equipe só esconde ou mostra; o texto é do cliente).
 */
@Controller({ version: '1' })
export class ProductExtrasController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('products/:id/photos')
  @RequirePermission('catalog:read')
  photos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => ({
      imageIds: (
        await q<{ id: string }>(
          tx,
          `SELECT image_id AS id FROM product_photos WHERE product_id = $1 ORDER BY position`,
          [id],
        )
      ).map((r) => r.id),
    }));
  }

  /** Troca a lista inteira de fotos extras (a ordem da lista é a ordem no cardápio). */
  @Put('products/:id/photos')
  @RequirePermission('catalog:write')
  setPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Photos)) body: z.infer<typeof Photos>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one(tx, `SELECT id FROM products WHERE id = $1`, [id]);
      // Produto de outro restaurante é indistinguível de inexistente (404, não 403).
      if (!p) throw new NotFoundException('Produto não encontrado');
      if (body.imageIds.length) {
        const n = await one<{ n: number }>(
          tx,
          `SELECT count(*)::int AS n FROM media WHERE id = ANY($1::uuid[])`,
          [body.imageIds],
        );
        if (n!.n !== body.imageIds.length) throw new NotFoundException('Foto não encontrada');
      }
      await q(tx, `DELETE FROM product_photos WHERE product_id = $1`, [id]);
      for (const [i, imageId] of body.imageIds.entries())
        await q(
          tx,
          `INSERT INTO product_photos (tenant_id, product_id, image_id, position) VALUES ($1,$2,$3,$4)`,
          [t.id, id, imageId, i],
        );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'catalog.product_photos_set',
        entity: 'product',
        entityId: id,
        data: { count: body.imageIds.length },
        ip: req.ip,
      });
      this.realtime.publish(t.id, { type: 'menu.changed' });
      return body;
    });
  }

  /** Avaliações do item, as escondidas também (a equipe decide o que aparece). */
  @Get('products/:id/reviews')
  @RequirePermission('catalog:read')
  reviews(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      q(
        tx,
        `SELECT r.id, c.name, r.rating, r.comment, r.created_at AS "createdAt",
                r.hidden_at IS NOT NULL AS hidden,
                (SELECT count(*)::int FROM product_review_likes l WHERE l.review_id = r.id) AS likes
           FROM product_reviews r JOIN customers c ON c.id = r.customer_id
          WHERE r.product_id = $1
          ORDER BY r.created_at DESC LIMIT 200`,
        [id],
      ),
    );
  }

  @Patch('product-reviews/:id')
  @RequirePermission('catalog:write')
  async setHidden(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReviewPatch)) body: z.infer<typeof ReviewPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const r = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const row = await one<{ id: string; productId: string }>(
        tx,
        `UPDATE product_reviews SET hidden_at = CASE WHEN $2 THEN coalesce(hidden_at, now()) END
          WHERE id = $1 RETURNING id, product_id AS "productId"`,
        [id, body.hidden],
      );
      if (!row) throw new NotFoundException('Avaliação não encontrada');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: body.hidden ? 'catalog.review_hidden' : 'catalog.review_shown',
        entity: 'product',
        entityId: row.productId,
        data: { reviewId: id },
        ip: req.ip,
      });
      return row;
    });
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return { id: r.id, hidden: body.hidden };
  }
}
