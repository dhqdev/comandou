import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { roleHas } from '@comandou/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Validade do link de rastreio enquanto o pedido está na rua. */
export const TRACKING_TTL_HOURS = 4;

const trackingHash = (token: string) => createHash('sha256').update(token).digest();

export const DELIVERY_SELECT = `
  SELECT d.id, d.status, d.order_id AS "orderId", o.number AS "orderNumber", o.status AS "orderStatus",
         o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
         o.delivery_address AS "deliveryAddress", o.total::text, (o.total - o.paid_amount)::text AS balance,
         o.payment_status AS "paymentStatus", d.courier_id AS "courierId", c.name AS "courierName",
         d.dispatched_at AS "dispatchedAt", d.finished_at AS "finishedAt", d.failure_reason AS "failureReason",
         d.last_lat::text AS "lastLat", d.last_lng::text AS "lastLng", d.last_location_at AS "lastLocationAt",
         d.tracking_expires_at AS "trackingExpiresAt"
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN couriers c ON c.id = d.courier_id`;

/**
 * Entregas. O status do pedido continua sendo a fonte da verdade da operação
 * (pronto → saiu para entrega → concluído); a entrega registra quem levou, quando,
 * a última localização informada e o link público de rastreio (só o hash fica no banco).
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  private newToken() {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: trackingHash(token) };
  }

  private canManage(ctx: Ctx) {
    return roleHas(ctx.user.role, 'delivery:manage');
  }

  list(ctx: Ctx, scope: 'active' | 'today') {
    return this.db.withTenant(ctx, async (tx) => {
      const mine = !this.canManage(ctx);
      return q(
        tx,
        `${DELIVERY_SELECT} CROSS JOIN tenants tz
          WHERE ($1 = 'active' AND d.status = 'out'
                 OR $1 = 'today' AND (d.dispatched_at AT TIME ZONE tz.timezone)::date = (now() AT TIME ZONE tz.timezone)::date)
            AND (NOT $2 OR c.user_id = $3)
          ORDER BY d.dispatched_at DESC LIMIT 200`,
        [scope, mine, ctx.userId],
      );
    });
  }

  /** Despacha um pedido de delivery pronto com um entregador. Devolve o link de rastreio (uma vez). */
  async dispatch(ctx: Ctx, orderId: string, courierId: string) {
    const token = this.newToken();
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (o.channel !== 'delivery')
        throw new ConflictException('Só pedidos de delivery saem para entrega');
      if (o.status !== 'ready')
        throw new ConflictException('O pedido precisa estar pronto para sair');
      const c = await one<{ active: boolean }>(tx, `SELECT active FROM couriers WHERE id = $1`, [
        courierId,
      ]);
      if (!c) throw new NotFoundException('Entregador não encontrado');
      if (!c.active) throw new ConflictException('Entregador inativo');
      await this.orders.transitionInTx(tx, ctx, o, 'dispatched');
      const d = await one<{ id: string }>(
        tx,
        `INSERT INTO deliveries (tenant_id, order_id, courier_id, tracking_hash, tracking_expires_at, created_by)
         VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5), $6) RETURNING id`,
        [ctx.tenantId, orderId, courierId, token.hash, TRACKING_TTL_HOURS, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery.dispatched',
        entity: 'delivery',
        entityId: d!.id,
        data: { orderId, courierId },
        ip: ctx.ip,
      });
      return one<{ id: string }>(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [d!.id]);
    });
    this.publish(ctx, res!.id, orderId);
    return { delivery: res, trackingPath: `/rastreio/${token.token}` };
  }

  /** Trava pedido → entrega (mesma ordem do resto do sistema) e confere quem pode mexer. */
  private async lockOut(tx: Tx, ctx: Ctx, id: string) {
    const cur = await one<{ order_id: string }>(
      tx,
      `SELECT order_id FROM deliveries WHERE id = $1`,
      [id],
    );
    if (!cur) throw new NotFoundException('Entrega não encontrada');
    const o = await this.orders.lock(tx, cur.order_id);
    const d = await one<{ id: string; status: string; courier_user: string | null }>(
      tx,
      `SELECT d.id, d.status, c.user_id AS courier_user FROM deliveries d JOIN couriers c ON c.id = d.courier_id
        WHERE d.id = $1 FOR UPDATE OF d`,
      [id],
    );
    if (!this.canManage(ctx) && d!.courier_user !== ctx.userId)
      throw new ForbiddenException('Esta entrega é de outro entregador');
    if (d!.status !== 'out') throw new ConflictException('Esta entrega já foi encerrada');
    return { o, d: d! };
  }

  async complete(ctx: Ctx, id: string) {
    let orderId = '';
    const res = await this.db.withTenant(ctx, async (tx) => {
      const { o } = await this.lockOut(tx, ctx, id);
      orderId = o.id;
      await this.orders.transitionInTx(tx, ctx, o, 'completed', 'Entrega concluída');
      return one(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [id]);
    });
    this.publish(ctx, id, orderId);
    return res;
  }

  /** Entrega não realizada: o pedido volta para "pronto" e pode sair de novo. */
  async fail(ctx: Ctx, id: string, reason: string) {
    let orderId = '';
    const res = await this.db.withTenant(ctx, async (tx) => {
      const { o } = await this.lockOut(tx, ctx, id);
      orderId = o.id;
      await this.orders.transitionInTx(tx, ctx, o, 'ready', reason);
      return one(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [id]);
    });
    this.publish(ctx, id, orderId);
    return res;
  }

  async location(ctx: Ctx, id: string, lat: number, lng: number) {
    await this.db.withTenant(ctx, async (tx) => {
      const d = await one<{ status: string; courier_user: string | null }>(
        tx,
        `SELECT d.status, c.user_id AS courier_user FROM deliveries d JOIN couriers c ON c.id = d.courier_id WHERE d.id = $1`,
        [id],
      );
      if (!d) throw new NotFoundException('Entrega não encontrada');
      if (d.courier_user !== ctx.userId)
        throw new ForbiddenException('Só o entregador da corrida envia a localização');
      if (d.status !== 'out') throw new ConflictException('Esta entrega já foi encerrada');
      await q(
        tx,
        `UPDATE deliveries SET last_lat = $2, last_lng = $3, last_location_at = now() WHERE id = $1`,
        [id, lat.toFixed(6), lng.toFixed(6)],
      );
    });
    this.realtime.publish(ctx.tenantId, { type: 'delivery.changed', deliveryId: id });
    return { ok: true };
  }

  /** Gera um novo link de rastreio (o anterior deixa de funcionar). */
  async newTrackingLink(ctx: Ctx, id: string) {
    const token = this.newToken();
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE deliveries SET tracking_hash = $2, tracking_expires_at = now() + make_interval(hours => $3)
          WHERE id = $1 AND status = 'out' RETURNING id`,
        [id, token.hash, TRACKING_TTL_HOURS],
      );
      if (!r) throw new ConflictException('Só entregas em andamento têm link de rastreio');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery.tracking_link',
        entity: 'delivery',
        entityId: id,
        ip: ctx.ip,
      });
    });
    return { trackingPath: `/rastreio/${token.token}` };
  }

  /**
   * Consulta pública do link de rastreio. Mostra o mínimo: número e situação do pedido, primeiro
   * nome do entregador e a última localização (só enquanto está na rua). Nunca endereço ou telefone.
   */
  async publicTrack(tenantId: string, tenantName: string, token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
      throw new NotFoundException('Link de rastreio inválido');
    const d = await this.db.withTenant({ tenantId }, (tx) =>
      one<{
        status: string;
        expired: boolean;
        order_number: number;
        courier: string;
        dispatched_at: Date;
        finished_at: Date | null;
        lat: string | null;
        lng: string | null;
        location_at: Date | null;
      }>(
        tx,
        `SELECT d.status, d.tracking_expires_at < now() AS expired, o.number AS order_number,
                split_part(c.name, ' ', 1) AS courier, d.dispatched_at, d.finished_at,
                d.last_lat::text AS lat, d.last_lng::text AS lng, d.last_location_at AS location_at
           FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN couriers c ON c.id = d.courier_id
          WHERE d.tracking_hash = $1`,
        [trackingHash(token)],
      ),
    );
    if (!d) throw new NotFoundException('Link de rastreio inválido');
    if (d.expired) throw new GoneException('Este link de rastreio expirou');
    const out = d.status === 'out';
    return {
      restaurant: tenantName,
      orderNumber: d.order_number,
      status: d.status,
      courier: d.courier,
      dispatchedAt: d.dispatched_at,
      finishedAt: d.finished_at,
      location: out && d.lat && d.lng ? { lat: d.lat, lng: d.lng, at: d.location_at } : null,
    };
  }

  private publish(ctx: Ctx, deliveryId: string, orderId: string) {
    this.realtime.publish(ctx.tenantId, { type: 'delivery.changed', deliveryId });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
  }
}
