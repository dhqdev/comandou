import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { couponDiscount, fromCents, normalizeCouponCode, type CouponKind } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';

export interface CouponInput {
  code: string;
  title: string;
  description: string | null;
  kind: CouponKind;
  value: string | null;
  maxDiscount: string | null;
  minOrder: string;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  perCustomer: number;
  firstOrderOnly: boolean;
  listed: boolean;
  active: boolean;
  imageId: string | null;
  position: number;
}
export interface Coupon extends Omit<CouponInput, 'startsAt' | 'endsAt'> {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Cupom escolhido no pedido, ainda sem o pedido gravado. */
export interface CouponQuote {
  couponId: string;
  code: string;
  title: string;
  /** Desconto nos itens (centavos). Na entrega grátis, a taxa que deixa de ser cobrada. */
  discountCents: number;
  freeDelivery: boolean;
}

const COLS = `c.id, c.code, c.title, c.description, c.kind, c.value::text, c.max_discount::text AS "maxDiscount",
  c.min_order::text AS "minOrder", c.starts_at AS "startsAt", c.ends_at AS "endsAt",
  c.max_uses AS "maxUses", c.per_customer AS "perCustomer", c.first_order_only AS "firstOrderOnly",
  c.listed, c.active, c.image_id AS "imageId", c.position`;
const MAX_COUPONS = 100;
const mediaUrl = (id: string | null) => (id ? `/api/v1/media/${id}` : null);

/** Usos que valem (devolvido no cancelamento não conta). */
const USES_SQL = `(SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.refunded_at IS NULL)::int`;

/**
 * Cupons da loja: o dono cria (porcentagem, valor ou entrega grátis, com validade, mínimo e
 * limites), o cliente vê os da vitrine na aba Cupons do app e usa no pedido pelo código. No balcão,
 * a equipe registra o uso pelo PIN do cliente. Cada pedido usa no máximo um cupom; cancelado, o uso
 * volta (refunded_at) e o limite do cliente também.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private check(b: Partial<CouponInput>) {
    if (b.kind === 'free_delivery') return;
    if (!b.value || Number(b.value) <= 0)
      throw new UnprocessableEntityException('Informe o valor do desconto');
    if (b.kind === 'percent' && Number(b.value) > 100)
      throw new UnprocessableEntityException('A porcentagem vai até 100%');
    if (b.startsAt && b.endsAt && new Date(b.endsAt) <= new Date(b.startsAt))
      throw new UnprocessableEntityException('O fim da validade precisa ser depois do início');
  }

  private listIn(tx: Tx) {
    return q<Coupon & { uses: number; discountTotal: string }>(
      tx,
      `SELECT ${COLS}, ${USES_SQL} AS uses,
              (SELECT COALESCE(sum(r.discount), 0) FROM coupon_redemptions r
                WHERE r.coupon_id = c.id AND r.refunded_at IS NULL)::text AS "discountTotal"
         FROM coupons c ORDER BY c.position, c.created_at DESC`,
    );
  }

  list(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.listIn(tx));
  }

  async create(ctx: Ctx, b: CouponInput) {
    this.check(b);
    const code = normalizeCouponCode(b.code);
    return this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM coupons`);
      if ((n?.n ?? 0) >= MAX_COUPONS)
        throw new ConflictException(`Limite de ${MAX_COUPONS} cupons. Apague os antigos.`);
      const dup = await one(tx, `SELECT 1 FROM coupons WHERE code = $1`, [code]);
      if (dup) throw new ConflictException(`Já existe um cupom com o código ${code}`);
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO coupons (tenant_id, code, title, description, kind, value, max_discount, min_order,
                              starts_at, ends_at, max_uses, per_customer, first_order_only, listed,
                              active, image_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          ctx.tenantId,
          code,
          b.title,
          b.description,
          b.kind,
          b.kind === 'free_delivery' ? null : b.value,
          b.kind === 'percent' ? b.maxDiscount : null,
          b.minOrder,
          b.startsAt,
          b.endsAt,
          b.maxUses,
          b.perCustomer,
          b.firstOrderOnly,
          b.listed,
          b.active,
          b.imageId,
          b.position ?? n?.n ?? 0,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'coupon.created',
        entity: 'coupon',
        entityId: r!.id,
        data: { code, kind: b.kind, value: b.value },
        ip: ctx.ip,
      });
      return (await this.listIn(tx)).find((c) => c.id === r!.id)!;
    });
  }

  async update(ctx: Ctx, id: string, patch: Partial<CouponInput>) {
    return this.db.withTenant(ctx, async (tx) => {
      const cur = (await this.listIn(tx)).find((c) => c.id === id);
      if (!cur) throw new NotFoundException('Cupom não encontrado');
      const next = {
        ...cur,
        startsAt: cur.startsAt?.toISOString() ?? null,
        endsAt: cur.endsAt?.toISOString() ?? null,
        ...patch,
      };
      next.code = normalizeCouponCode(next.code);
      this.check(next);
      if (next.code !== cur.code) {
        const dup = await one(tx, `SELECT 1 FROM coupons WHERE code = $1 AND id <> $2`, [
          next.code,
          id,
        ]);
        if (dup) throw new ConflictException(`Já existe um cupom com o código ${next.code}`);
      }
      await q(
        tx,
        `UPDATE coupons SET code = $2, title = $3, description = $4, kind = $5, value = $6,
                max_discount = $7, min_order = $8, starts_at = $9, ends_at = $10, max_uses = $11,
                per_customer = $12, first_order_only = $13, listed = $14, active = $15,
                image_id = $16, position = $17
          WHERE id = $1`,
        [
          id,
          next.code,
          next.title,
          next.description,
          next.kind,
          next.kind === 'free_delivery' ? null : next.value,
          next.kind === 'percent' ? next.maxDiscount : null,
          next.minOrder,
          next.startsAt,
          next.endsAt,
          next.maxUses,
          next.perCustomer,
          next.firstOrderOnly,
          next.listed,
          next.active,
          next.imageId,
          next.position,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'coupon.updated',
        entity: 'coupon',
        entityId: id,
        data: { code: next.code, changes: Object.keys(patch) },
        ip: ctx.ip,
      });
      return (await this.listIn(tx)).find((c) => c.id === id)!;
    });
  }

  /** Cupom já usado não some (o histórico dos pedidos aponta para ele): desative. */
  async remove(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const used = await one(tx, `SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 LIMIT 1`, [
        id,
      ]);
      if (used) throw new ConflictException('Este cupom já foi usado: desligue-o em vez de apagar');
      const r = await one(tx, `DELETE FROM coupons WHERE id = $1 RETURNING code`, [id]);
      if (!r) throw new NotFoundException('Cupom não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'coupon.deleted',
        entity: 'coupon',
        entityId: id,
        ip: ctx.ip,
      });
    });
    return { ok: true };
  }

  /** Quem usou o cupom (últimos 50 usos). */
  uses(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT r.id, r.discount::text, r.channel, r.refunded_at AS "refundedAt", r.created_at AS "createdAt",
                o.number AS "orderNumber", cu.name AS "customerName"
           FROM coupon_redemptions r
           LEFT JOIN orders o ON o.id = r.order_id
           LEFT JOIN customers cu ON cu.id = r.customer_id
          WHERE r.coupon_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [id],
      ),
    );
  }

  // ---------------------------------------------------------------- regras de uso

  /**
   * Por que o cupom não vale agora para este cliente (null = vale). `subtotalCents` null pula o
   * pedido mínimo (a aba Cupons mostra antes de a sacola existir).
   */
  private async blockIn(
    tx: Tx,
    c: Coupon,
    customerId: string | null,
    subtotalCents: number | null,
  ): Promise<string | null> {
    const now = Date.now();
    if (!c.active) return 'Este cupom não está mais valendo';
    if (c.startsAt && c.startsAt.getTime() > now)
      return `Vale a partir de ${c.startsAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    if (c.endsAt && c.endsAt.getTime() <= now) return 'Este cupom venceu';
    if (c.maxUses) {
      const u = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1 AND refunded_at IS NULL`,
        [c.id],
      );
      if ((u?.n ?? 0) >= c.maxUses) return 'Os cupons desta promoção acabaram';
    }
    if (customerId) {
      const mine = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM coupon_redemptions
          WHERE coupon_id = $1 AND customer_id = $2 AND refunded_at IS NULL`,
        [c.id, customerId],
      );
      if ((mine?.n ?? 0) >= c.perCustomer)
        return c.perCustomer === 1
          ? 'Você já usou este cupom'
          : 'Você já usou este cupom o máximo de vezes';
      if (c.firstOrderOnly) {
        const before = await one(
          tx,
          `SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'cancelled' LIMIT 1`,
          [customerId],
        );
        if (before) return 'Vale só no primeiro pedido';
      }
    }
    if (subtotalCents !== null && subtotalCents < Math.round(Number(c.minOrder) * 100))
      return `Vale em pedidos a partir de R$ ${c.minOrder.replace('.', ',')}`;
    return null;
  }

  private byCodeIn(tx: Tx, code: string, lock = false) {
    return one<Coupon>(
      tx,
      `SELECT ${COLS} FROM coupons c WHERE c.code = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [normalizeCouponCode(code)],
    );
  }

  /**
   * Desconto do cupom no pedido do cardápio (dentro da transação que cria o pedido). Trava o
   * cupom: dois pedidos juntos não passam do limite de usos.
   */
  async quoteIn(
    tx: Tx,
    customerId: string,
    code: string,
    subtotalCents: number,
    deliveryFeeCents: number,
    channel: string,
  ): Promise<CouponQuote> {
    const c = await this.byCodeIn(tx, code, true);
    if (!c) throw new UnprocessableEntityException('Cupom não encontrado');
    const why = await this.blockIn(tx, c, customerId, subtotalCents);
    if (why) throw new UnprocessableEntityException(why);
    if (c.kind === 'free_delivery' && channel !== 'delivery')
      throw new UnprocessableEntityException('Este cupom vale só para entrega');
    if (c.kind === 'free_delivery' && deliveryFeeCents <= 0)
      throw new UnprocessableEntityException('A entrega deste pedido já é grátis');
    return {
      couponId: c.id,
      code: c.code,
      title: c.title,
      discountCents: couponDiscount(c, subtotalCents, deliveryFeeCents),
      freeDelivery: c.kind === 'free_delivery',
    };
  }

  /** Grava o uso no pedido; `staffUserId` = usado pela equipe na Nova venda (canal "store"). */
  async recordIn(
    tx: Tx,
    tenantId: string,
    customerId: string,
    orderId: string,
    c: CouponQuote,
    staffUserId?: string | null,
  ) {
    await q(
      tx,
      `INSERT INTO coupon_redemptions (tenant_id, coupon_id, customer_id, order_id, discount, channel, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenantId,
        c.couponId,
        customerId,
        orderId,
        fromCents(c.discountCents),
        staffUserId === undefined ? 'online' : 'store',
        staffUserId ?? null,
      ],
    );
  }

  /** Pedido cancelado: o uso do cupom volta (o cliente pode usar de novo). */
  async refundForOrderIn(tx: Tx, orderId: string) {
    await q(
      tx,
      `UPDATE coupon_redemptions SET refunded_at = now() WHERE order_id = $1 AND refunded_at IS NULL`,
      [orderId],
    );
  }

  /** Cupom do pedido (o acompanhamento e o detalhe mostram o código). */
  async ofOrderIn(tx: Tx, orderId: string) {
    return one<{ code: string; title: string; discount: string }>(
      tx,
      `SELECT c.code, c.title, r.discount::text FROM coupon_redemptions r
         JOIN coupons c ON c.id = r.coupon_id WHERE r.order_id = $1`,
      [orderId],
    );
  }

  // ---------------------------------------------------------------- cardápio (cliente)

  private publicOf(c: Coupon, block: string | null, usedByMe: number) {
    return {
      id: c.id,
      code: c.code,
      title: c.title,
      description: c.description,
      kind: c.kind,
      value: c.value,
      maxDiscount: c.maxDiscount,
      minOrder: c.minOrder,
      endsAt: c.endsAt,
      firstOrderOnly: c.firstOrderOnly,
      perCustomer: c.perCustomer,
      imageUrl: mediaUrl(c.imageId),
      usedByMe,
      // Por que não dá para usar agora (null = dá).
      blocked: block,
    };
  }

  /** Aba Cupons: os da vitrine que estão valendo e, com a conta aberta, se ainda dá para usar. */
  async publicList(tenantId: string, customerId: string | null) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const list = await q<Coupon>(
        tx,
        `SELECT ${COLS} FROM coupons c
          WHERE c.active AND c.listed AND (c.starts_at IS NULL OR c.starts_at <= now())
            AND (c.ends_at IS NULL OR c.ends_at > now())
          ORDER BY c.position, c.created_at DESC LIMIT 50`,
      );
      const out = [];
      for (const c of list) {
        const block = await this.blockIn(tx, c, customerId, null);
        // Esgotado para todo mundo não aparece na vitrine.
        if (block === 'Os cupons desta promoção acabaram') continue;
        const used = customerId
          ? ((
              await one<{ n: number }>(
                tx,
                `SELECT count(*)::int AS n FROM coupon_redemptions
                  WHERE coupon_id = $1 AND customer_id = $2 AND refunded_at IS NULL`,
                [c.id, customerId],
              )
            )?.n ?? 0)
          : 0;
        out.push(this.publicOf(c, block, used));
      }
      return out;
    });
  }

  /**
   * O cliente digita um código (aba Cupons ou sacola): diz se vale e quanto sai nesta sacola.
   * Sem conta, confere só o cupom (o pedido pede a conta).
   */
  async publicCheck(
    tenantId: string,
    customerId: string | null,
    code: string,
    subtotalCents: number | null,
    deliveryFeeCents: number,
    channel: string | null,
  ) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const c = await this.byCodeIn(tx, code);
      if (!c) throw new UnprocessableEntityException('Cupom não encontrado');
      const block = await this.blockIn(tx, c, customerId, subtotalCents);
      const wrongChannel =
        c.kind === 'free_delivery' && channel && channel !== 'delivery'
          ? 'Este cupom vale só para entrega'
          : null;
      return {
        coupon: this.publicOf(c, block ?? wrongChannel, 0),
        discount:
          subtotalCents !== null && !block && !wrongChannel
            ? fromCents(couponDiscount(c, subtotalCents, deliveryFeeCents))
            : null,
      };
    });
  }

  /** Cliente do PIN mostrado no app (balcão). */
  private async pinCustomerIn(tx: Tx, pin: string) {
    const m = await one<{ id: string }>(
      tx,
      `SELECT m.customer_id AS id FROM loyalty_members m JOIN customers c ON c.id = m.customer_id
        WHERE m.pin = $1 AND c.blocked_at IS NULL`,
      [pin],
    );
    if (!m) throw new NotFoundException('PIN não encontrado. Confira com o cliente.');
    return m.id;
  }

  /** Balcão: registra o uso do cupom pelo PIN do cliente (o desconto é dado no caixa). */
  async useAtStore(ctx: Ctx, pin: string, couponId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const customerId = await this.pinCustomerIn(tx, pin);
      const c = await one<Coupon>(tx, `SELECT ${COLS} FROM coupons c WHERE c.id = $1 FOR UPDATE`, [
        couponId,
      ]);
      if (!c) throw new NotFoundException('Cupom não encontrado');
      const why = await this.blockIn(tx, c, customerId, null);
      if (why) throw new UnprocessableEntityException(why);
      await q(
        tx,
        `INSERT INTO coupon_redemptions (tenant_id, coupon_id, customer_id, discount, channel, created_by)
         VALUES ($1,$2,$3,$4,'store',$5)`,
        [ctx.tenantId, c.id, customerId, c.kind === 'fixed' ? c.value : '0', ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'coupon.used_at_store',
        entity: 'coupon',
        entityId: c.id,
        data: { code: c.code, customerId },
        ip: ctx.ip,
      });
      return { ok: true, code: c.code, title: c.title };
    });
  }

  /** Cupons que o cliente do PIN ainda pode usar no balcão. */
  async forPin(ctx: Ctx, pin: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const customerId = await this.pinCustomerIn(tx, pin);
      const list = await q<Coupon>(
        tx,
        `SELECT ${COLS} FROM coupons c WHERE c.active
            AND (c.starts_at IS NULL OR c.starts_at <= now()) AND (c.ends_at IS NULL OR c.ends_at > now())
          ORDER BY c.position, c.created_at DESC LIMIT 50`,
      );
      const out = [];
      for (const c of list) {
        const block = await this.blockIn(tx, c, customerId, null);
        out.push(this.publicOf(c, block, 0));
      }
      return out;
    });
  }
}
