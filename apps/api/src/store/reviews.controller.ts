import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { autoAvatar, CUSTOMER_AVATARS } from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentTenant, Public } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { ResolvedTenant } from '../tenancy/tenant.types';
import { cookieOf, Customer, CUSTOMER_COOKIE, CustomersService } from './customers.service';
import { StoreService } from './store.service';

const Review = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => v || null),
});

interface ReviewRow {
  id: string;
  customerId: string;
  name: string;
  avatar: string | null;
  rating: number;
  comment: string | null;
  createdAt: Date;
  likes: number;
  liked: boolean;
  ordered: boolean;
}

/** Só o primeiro nome de quem avaliou, e o avatar desenhado (a foto do perfil é particular). */
function present(r: ReviewRow, me: Customer | null) {
  const { customerId, avatar, name, ...rest } = r;
  return {
    ...rest,
    name: name.trim().split(/\s+/)[0] ?? name,
    avatar:
      avatar && (CUSTOMER_AVATARS as readonly string[]).includes(avatar)
        ? avatar
        : autoAvatar(customerId),
    mine: !!me && me.id === customerId,
  };
}

const COLS = (me: string) => `r.id, r.customer_id AS "customerId", c.name, c.avatar, r.rating,
  r.comment, r.created_at AS "createdAt",
  (SELECT count(*)::int FROM product_review_likes l WHERE l.review_id = r.id) AS likes,
  EXISTS (SELECT 1 FROM product_review_likes l WHERE l.review_id = r.id AND l.customer_id = ${me}) AS liked,
  EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE o.customer_id = r.customer_id AND i.product_id = r.product_id
             AND o.status <> 'cancelled') AS ordered`;

/**
 * Avaliações de cada item no cardápio online. Ler é público; avaliar e curtir (o coração numa
 * avaliação) pedem a conta aberta. Uma avaliação por cliente e item: avaliar de novo troca a nota.
 * Quem já pediu o item ganha o selo "Pediu este item".
 */
@Controller({ path: 'store/products', version: '1' })
export class StoreReviewsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly customers: CustomersService,
    private readonly store: StoreService,
    private readonly realtime: RealtimeService,
  ) {}

  private async me(t: ResolvedTenant, req: Request) {
    return this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
  }
  private async who(t: ResolvedTenant, req: Request) {
    const c = await this.me(t, req);
    if (!c) throw new UnauthorizedException('Entre na sua conta para avaliar');
    return c;
  }
  /** Cardápio ligado e item à venda; avaliar também pede as contas de cliente ligadas. */
  private async open(tx: Tx, productId: string, writing: boolean) {
    const s = await this.store.settingsIn(tx);
    if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
    if (writing && !s.accountsEnabled)
      throw new ForbiddenException('Esta loja não está recebendo avaliações');
    const p = await one(tx, `SELECT id FROM products WHERE id = $1 AND active`, [productId]);
    if (!p) throw new NotFoundException('Produto não encontrado');
    return s;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get(':id/reviews')
  async list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const me = await this.me(t, req);
    return this.db.withTenant({ tenantId: t.id }, async (tx) => {
      const s = await this.open(tx, id, false);
      const meId = me ? '$2::uuid' : 'NULL::uuid';
      const args = me ? [id, me.id] : [id];
      const stats = await q<{ rating: number; n: number }>(
        tx,
        `SELECT rating, count(*)::int AS n FROM product_reviews
          WHERE product_id = $1 AND hidden_at IS NULL GROUP BY rating`,
        [id],
      );
      // Primeiro as mais curtidas e com texto; depois as mais novas.
      const rows = await q<ReviewRow>(
        tx,
        `SELECT ${COLS(meId)} FROM product_reviews r JOIN customers c ON c.id = r.customer_id
          WHERE r.product_id = $1 AND r.hidden_at IS NULL
          ORDER BY likes DESC, (r.comment IS NOT NULL) DESC, r.created_at DESC LIMIT 30`,
        args,
      );
      const mine = me
        ? await one<ReviewRow>(
            tx,
            `SELECT ${COLS('$2::uuid')} FROM product_reviews r JOIN customers c ON c.id = r.customer_id
              WHERE r.product_id = $1 AND r.customer_id = $2`,
            [id, me.id],
          )
        : undefined;
      const count = stats.reduce((a, x) => a + x.n, 0);
      const sum = stats.reduce((a, x) => a + x.rating * x.n, 0);
      return {
        average: count ? Math.round((sum / count) * 10) / 10 : null,
        count,
        // Quantas avaliações de 1 a 5 estrelas (posição 0 = 1 estrela).
        breakdown: [1, 2, 3, 4, 5].map((n) => stats.find((x) => x.rating === n)?.n ?? 0),
        reviews: rows.map((r) => present(r, me)),
        mine: mine ? present(mine, me) : null,
        canReview: s.accountsEnabled,
      };
    });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Put(':id/reviews')
  async save(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Review)) b: z.infer<typeof Review>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const me = await this.who(t, req);
    const r = await this.db.withTenant({ tenantId: t.id }, async (tx) => {
      await this.open(tx, id, true);
      // Mudou a avaliação: volta a aparecer só se não estava escondida pela equipe.
      await q(
        tx,
        `INSERT INTO product_reviews (tenant_id, product_id, customer_id, rating, comment)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (product_id, customer_id)
           DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`,
        [t.id, id, me.id, b.rating, b.comment],
      );
      return one<ReviewRow>(
        tx,
        `SELECT ${COLS('$2::uuid')} FROM product_reviews r JOIN customers c ON c.id = r.customer_id
          WHERE r.product_id = $1 AND r.customer_id = $2`,
        [id, me.id],
      );
    });
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return present(r!, me);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Delete(':id/reviews')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const me = await this.who(t, req);
    await this.db.withTenant({ tenantId: t.id }, (tx) =>
      q(tx, `DELETE FROM product_reviews WHERE product_id = $1 AND customer_id = $2`, [id, me.id]),
    );
    this.realtime.publish(t.id, { type: 'menu.changed' });
    return { ok: true };
  }

  /** Coração numa avaliação: liga ou desliga. Devolve o total novo. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(':id/reviews/:reviewId/like')
  async like(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('reviewId', new ParseUUIDPipe()) reviewId: string,
    @Body(new ZodPipe(z.object({ liked: z.boolean() }))) b: { liked: boolean },
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const me = await this.who(t, req);
    return this.db.withTenant({ tenantId: t.id }, async (tx) => {
      await this.open(tx, id, true);
      const r = await one(
        tx,
        `SELECT id FROM product_reviews WHERE id = $1 AND product_id = $2 AND hidden_at IS NULL`,
        [reviewId, id],
      );
      if (!r) throw new NotFoundException('Avaliação não encontrada');
      if (b.liked)
        await q(
          tx,
          `INSERT INTO product_review_likes (tenant_id, review_id, customer_id) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [t.id, reviewId, me.id],
        );
      else
        await q(tx, `DELETE FROM product_review_likes WHERE review_id = $1 AND customer_id = $2`, [
          reviewId,
          me.id,
        ]);
      const n = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM product_review_likes WHERE review_id = $1`,
        [reviewId],
      );
      return { liked: b.liked, likes: n!.n };
    });
  }
}
