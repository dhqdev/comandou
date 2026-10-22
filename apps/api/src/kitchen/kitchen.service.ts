import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { roleHas } from '@pedemais/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OrderRow, OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';

type ItemAction = 'start' | 'ready' | 'reopen';

/**
 * Cozinha (KDS). Cada setor vê apenas os itens dele. Avanço automático do pedido:
 *  - o primeiro item iniciado leva o pedido de "novo" para "em produção";
 *  - quando todos os itens não cancelados ficam prontos, o pedido vira "pronto";
 *  - reabrir um item (exige permissão e motivo) devolve um pedido "pronto" para "em produção".
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Fila do setor (sectorId = 'none' para itens sem setor). Inclui limites de aviso/atraso. */
  board(ctx: Ctx, sectorId?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const sector =
        sectorId && sectorId !== 'none'
          ? await one<{
              id: string;
              name: string;
              warnAfterMin: number;
              lateAfterMin: number;
              channels: string[];
            }>(
              tx,
              `SELECT id, name, warn_after_min AS "warnAfterMin", late_after_min AS "lateAfterMin", channels FROM production_sectors WHERE id = $1`,
              [sectorId],
            )
          : undefined;
      if (sectorId && sectorId !== 'none' && !sector)
        throw new NotFoundException('Setor não encontrado');
      const p: unknown[] = [];
      let itemFilter = `i.status <> 'cancelled'`;
      if (sector) {
        p.push(sector.id);
        itemFilter += ` AND i.sector_id = $${p.length}`;
      } else if (sectorId === 'none') {
        itemFilter += ` AND i.sector_id IS NULL`;
      }
      let orderFilter = `o.status IN ('new','in_production','ready','cancel_requested')`;
      if (sector) {
        p.push(sector.channels);
        orderFilter += ` AND o.channel = ANY($${p.length}::text[])`;
      }
      const orders = await q(
        tx,
        `SELECT o.id, o.number, o.channel, o.status, o.notes, o.version, o.created_at AS "createdAt",
                dt.label AS "tableLabel", tb.number AS "tabNumber", o.customer_name AS "customerName",
                json_agg(json_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity::text, 'notes', i.notes,
                  'status', i.status, 'startedAt', i.started_at, 'readyAt', i.ready_at, 'sectorId', i.sector_id,
                  'options', COALESCE((SELECT json_agg(io.name) FROM order_item_options io WHERE io.order_item_id = i.id), '[]'))
                  ORDER BY i.created_at, i.id) AS items
           FROM orders o
           JOIN order_items i ON i.order_id = o.id AND ${itemFilter}
           LEFT JOIN tabs tb ON tb.id = o.tab_id
           LEFT JOIN dining_tables dt ON dt.id = tb.table_id
          WHERE ${orderFilter}
          GROUP BY o.id, dt.label, tb.number
          ORDER BY o.created_at
          LIMIT 300`,
        p,
      );
      return {
        sector: sector ?? null,
        warnAfterMin: sector?.warnAfterMin ?? 10,
        lateAfterMin: sector?.lateAfterMin ?? 20,
        serverTime: new Date().toISOString(),
        orders,
      };
    });
  }

  private async afterItemChange(tx: Tx, ctx: Ctx, o: OrderRow) {
    const counts = await one<{ open: number; started: number }>(
      tx,
      `SELECT count(*) FILTER (WHERE status IN ('pending','preparing'))::int AS open,
              count(*) FILTER (WHERE status IN ('preparing','ready'))::int AS started
         FROM order_items WHERE order_id = $1 AND status <> 'cancelled'`,
      [o.id],
    );
    if (counts!.open === 0 && (o.status === 'new' || o.status === 'in_production')) {
      await this.orders.transitionInTx(tx, ctx, o, 'ready');
    } else if (counts!.open > 0 && o.status === 'ready') {
      await this.orders.transitionInTx(tx, ctx, o, 'in_production', 'Item reaberto na cozinha');
    } else if (counts!.started > 0 && o.status === 'new') {
      await this.orders.transitionInTx(tx, ctx, o, 'in_production');
    }
    await q(tx, `UPDATE orders SET version = version + 1 WHERE id = $1`, [o.id]);
  }

  private checkOrder(o: OrderRow) {
    if (!['new', 'in_production', 'ready'].includes(o.status)) {
      throw new ConflictException(
        o.status === 'cancel_requested'
          ? 'Pedido com cancelamento solicitado'
          : 'Pedido não está na cozinha',
      );
    }
  }

  async item(ctx: Ctx, itemId: string, action: ItemAction, reason?: string) {
    if (action === 'reopen') {
      if (!roleHas(ctx.user.role, 'kitchen:reopen'))
        throw new ForbiddenException('Reabrir item exige autorização');
      if (!reason) throw new UnprocessableEntityException('Informe o motivo para reabrir');
    }
    let orderId = '';
    const res = await this.db.withTenant(ctx, async (tx) => {
      const ref = await one<{ order_id: string }>(
        tx,
        `SELECT order_id FROM order_items WHERE id = $1`,
        [itemId],
      );
      if (!ref) throw new NotFoundException('Item não encontrado');
      const o = await this.orders.lock(tx, ref.order_id);
      orderId = o.id;
      this.checkOrder(o);
      const it = await one<{ status: string; name: string }>(
        tx,
        `SELECT status, name FROM order_items WHERE id = $1`,
        [itemId],
      );
      const from = it!.status;
      const sql: Record<ItemAction, { from: string[]; set: string }> = {
        start: { from: ['pending'], set: `status = 'preparing', started_at = now()` },
        ready: {
          from: ['pending', 'preparing'],
          set: `status = 'ready', ready_at = now(), started_at = COALESCE(started_at, now())`,
        },
        reopen: { from: ['ready'], set: `status = 'preparing', ready_at = NULL` },
      };
      if (!sql[action].from.includes(from))
        throw new ConflictException(`Item "${it!.name}" está ${from}`);
      await q(tx, `UPDATE order_items SET ${sql[action].set} WHERE id = $1`, [itemId]);
      if (action === 'reopen') {
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'kitchen.item_reopened',
          entity: 'order_item',
          entityId: itemId,
          data: { orderId: o.id, reason },
          ip: ctx.ip,
        });
      }
      await this.afterItemChange(tx, ctx, o);
      return {
        orderId: o.id,
        itemId,
        status: action === 'ready' ? 'ready' : 'preparing',
        orderStatus: o.status,
      };
    });
    this.realtime.publish(ctx.tenantId, { type: 'kitchen.changed', orderId });
    this.realtime.publish(ctx.tenantId, {
      type: 'order.changed',
      orderId,
      status: res.orderStatus,
    });
    return res;
  }

  /** Avança todos os itens do pedido (opcionalmente só de um setor): iniciar ou marcar pronto. */
  async bump(ctx: Ctx, orderId: string, to: 'preparing' | 'ready', sectorId?: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      this.checkOrder(o);
      const p: unknown[] = [orderId];
      let filter = '';
      if (sectorId === 'none') filter = ' AND sector_id IS NULL';
      else if (sectorId) {
        p.push(sectorId);
        filter = ` AND sector_id = $2`;
      }
      const updated = await q(
        tx,
        to === 'preparing'
          ? `UPDATE order_items SET status = 'preparing', started_at = now() WHERE order_id = $1 AND status = 'pending'${filter} RETURNING id`
          : `UPDATE order_items SET status = 'ready', ready_at = now(), started_at = COALESCE(started_at, now())
              WHERE order_id = $1 AND status IN ('pending','preparing')${filter} RETURNING id`,
        p,
      );
      if (!updated.length) throw new ConflictException('Nada para avançar neste pedido');
      await this.afterItemChange(tx, ctx, o);
      return { orderId, updated: updated.length, orderStatus: o.status };
    });
    this.realtime.publish(ctx.tenantId, { type: 'kitchen.changed', orderId });
    this.realtime.publish(ctx.tenantId, {
      type: 'order.changed',
      orderId,
      status: res.orderStatus,
    });
    return res;
  }
}
