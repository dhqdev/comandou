import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromCents, toCents } from '@pedemais/shared';
import { AuditService } from '../audit/audit.service';
import { CashService, changeFor, PaymentInput } from '../cash/cash.service';
import type { Ctx } from '../common/context';
import { withIdempotency } from '../common/idempotency';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { ORDER_SELECT, OrderRow, OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';

const TAB_SELECT = `
  SELECT tb.id, tb.number, tb.status, tb.customer_name AS "customerName", tb.table_id AS "tableId",
         dt.label AS "tableLabel", tb.opened_at AS "openedAt", tb.closed_at AS "closedAt",
         COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS total,
         COALESCE(sum(o.paid_amount), 0)::text AS paid,
         COALESCE(sum(o.total - o.paid_amount) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS balance,
         count(o.id) FILTER (WHERE o.status <> 'cancelled')::int AS "orderCount"
    FROM tabs tb
    LEFT JOIN dining_tables dt ON dt.id = tb.table_id
    LEFT JOIN orders o ON o.tab_id = tb.id`;

/**
 * Comandas (atendimentos de mesa/balcão). Uma comanda agrupa pedidos até a conta ser fechada.
 * Divisão de conta: o cliente pode pagar a comanda em várias partes (por valor, ou escolhendo
 * pedidos específicos); cada parte vira pagamentos nos pedidos, do mais antigo ao mais novo.
 */
@Injectable()
export class TabsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly cash: CashService,
    private readonly realtime: RealtimeService,
  ) {}

  list(ctx: Ctx, status: 'open' | 'closed' = 'open') {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `${TAB_SELECT} WHERE tb.status = $1 GROUP BY tb.id, dt.label ORDER BY tb.opened_at DESC LIMIT 200`,
        [status],
      ),
    );
  }

  async detail(tx: Tx, id: string) {
    const tab = await one<{ id: string; status: string }>(
      tx,
      `${TAB_SELECT} WHERE tb.id = $1 GROUP BY tb.id, dt.label`,
      [id],
    );
    if (!tab) return undefined;
    const orders = await q(tx, `${ORDER_SELECT} WHERE o.tab_id = $1 ORDER BY o.created_at, o.id`, [
      id,
    ]);
    return { ...tab, orders };
  }

  async get(ctx: Ctx, id: string) {
    const t = await this.db.withTenant(ctx, (tx) => this.detail(tx, id));
    if (!t) throw new NotFoundException('Comanda não encontrada');
    return t;
  }

  async open(ctx: Ctx, b: { tableId?: string; customerName?: string }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      if (b.tableId) {
        const table = await one(tx, `SELECT id FROM dining_tables WHERE id = $1 AND active`, [
          b.tableId,
        ]);
        if (!table) throw new NotFoundException('Mesa não encontrada');
        const busy = await one(tx, `SELECT id FROM tabs WHERE table_id = $1 AND status = 'open'`, [
          b.tableId,
        ]);
        if (busy) throw new ConflictException('Mesa já está ocupada');
      }
      const tab = await this.orders.openTab(tx, ctx, b);
      return this.detail(tx, tab.id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res!.id });
    return res;
  }

  private async lockTab(tx: Tx, id: string) {
    const tab = await one<{ id: string; status: string; table_id: string | null; number: number }>(
      tx,
      `SELECT id, status, table_id, number FROM tabs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!tab) throw new NotFoundException('Comanda não encontrada');
    return tab;
  }

  private lockOrders(tx: Tx, tabId: string) {
    return q<OrderRow & { created_at: string }>(
      tx,
      `SELECT id, number, channel, status, total::text, subtotal::text, discount::text, surcharge::text,
              delivery_fee::text, paid_amount::text, payment_status, tab_id, version
         FROM orders WHERE tab_id = $1 ORDER BY created_at, id FOR UPDATE`,
      [tabId],
    );
  }

  /** Transferência de mesa: a comanda inteira vai para outra mesa livre. */
  async transfer(ctx: Ctx, id: string, tableId: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const tab = await this.lockTab(tx, id);
      if (tab.status !== 'open') throw new ConflictException('Comanda não está aberta');
      if (tab.table_id === tableId) throw new ConflictException('A comanda já está nesta mesa');
      const table = await one(tx, `SELECT id FROM dining_tables WHERE id = $1 AND active`, [
        tableId,
      ]);
      if (!table) throw new NotFoundException('Mesa não encontrada');
      const busy = await one(tx, `SELECT id FROM tabs WHERE table_id = $1 AND status = 'open'`, [
        tableId,
      ]);
      if (busy) throw new ConflictException('Mesa de destino está ocupada');
      await q(tx, `UPDATE tabs SET table_id = $2 WHERE id = $1`, [id, tableId]);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'tab.transferred',
        entity: 'tab',
        entityId: id,
        data: { fromTable: tab.table_id, toTable: tableId },
        ip: ctx.ip,
      });
      return this.detail(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: id });
    return res;
  }

  /**
   * Paga parte (ou todo) o saldo da comanda. O valor é distribuído entre os pedidos em aberto,
   * do mais antigo ao mais novo (ou só entre `orderIds`, para dividir por consumo).
   */
  async pay(ctx: Ctx, id: string, b: PaymentInput & { orderIds?: string[] }, idemKey?: string) {
    const touched: string[] = [];
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'tab.pay', idemKey, { id, ...b }, async () => {
        const session = await one<{ status: string }>(
          tx,
          `SELECT status FROM cash_sessions WHERE id = $1 FOR SHARE`,
          [b.cashSessionId],
        );
        if (!session) throw new NotFoundException('Sessão de caixa não encontrada');
        if (session.status !== 'open')
          throw new ConflictException('Caixa fechado: abra um caixa para continuar');
        const tab = await this.lockTab(tx, id);
        if (tab.status !== 'open') throw new ConflictException('Comanda não está aberta');
        const orders = (await this.lockOrders(tx, id)).filter(
          (o) =>
            o.status !== 'cancelled' &&
            toCents(o.total) > toCents(o.paid_amount) &&
            (!b.orderIds || b.orderIds.includes(o.id)),
        );
        if (b.orderIds && b.orderIds.some((oid) => !orders.find((o) => o.id === oid))) {
          throw new UnprocessableEntityException('Pedido inválido ou já pago para esta comanda');
        }
        const balance = orders.reduce((s, o) => s + toCents(o.total) - toCents(o.paid_amount), 0);
        let remaining = toCents(b.amount);
        if (remaining <= 0) throw new UnprocessableEntityException('Valor deve ser maior que zero');
        if (remaining > balance)
          throw new ConflictException(`Valor maior que o saldo (${fromCents(balance)})`);
        const change = changeFor(b, remaining);
        const payments = [];
        for (const o of orders) {
          if (remaining === 0) break;
          const part = Math.min(remaining, toCents(o.total) - toCents(o.paid_amount));
          payments.push(
            await this.cash.applyPayment(tx, ctx, o, {
              cashSessionId: b.cashSessionId,
              method: b.method,
              amountCents: part,
            }),
          );
          touched.push(o.id);
          remaining -= part;
        }
        return { payments, change, tab: await this.detail(tx, id) };
      }),
    );
    for (const oid of touched)
      this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: oid });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: id });
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: b.cashSessionId });
    return res;
  }

  /**
   * Fecha a conta: todos os pedidos não cancelados precisam estar pagos e fora de produção.
   * Pedidos prontos/entregues passam a "concluído". A mesa fica livre.
   */
  async close(ctx: Ctx, id: string) {
    const changed: string[] = [];
    const res = await this.db.withTenant(ctx, async (tx) => {
      const tab = await this.lockTab(tx, id);
      if (tab.status !== 'open') throw new ConflictException('Comanda não está aberta');
      const orders = (await this.lockOrders(tx, id)).filter((o) => o.status !== 'cancelled');
      const unpaid = orders.filter((o) => toCents(o.paid_amount) < toCents(o.total));
      if (unpaid.length)
        throw new ConflictException(`Há saldo em aberto em ${unpaid.length} pedido(s)`);
      const pending = orders.filter((o) =>
        ['new', 'in_production', 'cancel_requested'].includes(o.status),
      );
      if (pending.length)
        throw new ConflictException(`Há ${pending.length} pedido(s) ainda em produção`);
      for (const o of orders) {
        if (o.status === 'ready' || o.status === 'dispatched') {
          await this.orders.transitionInTx(tx, ctx, o, 'completed', 'Conta fechada');
          changed.push(o.id);
        }
      }
      await q(
        tx,
        `UPDATE tabs SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`,
        [id, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'tab.closed',
        entity: 'tab',
        entityId: id,
        data: { number: tab.number, orders: orders.length },
        ip: ctx.ip,
      });
      return this.detail(tx, id);
    });
    for (const oid of changed)
      this.realtime.publish(ctx.tenantId, {
        type: 'order.changed',
        orderId: oid,
        status: 'completed',
      });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: id });
    return res;
  }
}
