import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  canTransition,
  DISCOUNT_FREE_LIMIT_PERCENT,
  fromCents,
  multiplyCents,
  OrderChannel,
  OrderStatus,
  paymentStatusFor,
  roleHas,
  toCents,
} from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import type { Ctx } from '../common/context';
import { withIdempotency } from '../common/idempotency';
import { nextNumber, one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { PrintingService } from '../printing/printing.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StockService } from '../stock/stock.service';
import { PlanService } from '../plans/plan.service';

export interface OrderItemInput {
  productId: string;
  quantity: number;
  notes?: string;
  optionIds?: string[];
}

export interface CreateOrderInput {
  channel: OrderChannel;
  tabId?: string;
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  notes?: string;
  deliveryFee?: string;
  discount?: string;
  surcharge?: string;
  items: OrderItemInput[];
  /** Cardápio online: nasce "em análise" (awaiting) se o aceite automático estiver desligado. */
  online?: {
    tokenHash: Buffer;
    autoAccept: boolean;
    paymentHint?: string;
    changeFor?: string;
    /** Cliente com conta aberta no cardápio (orders.customer_id). */
    customerId?: string;
  };
  /** Pedido mínimo (sobre o subtotal dos itens), usado pelo cardápio online. */
  minSubtotal?: string;
  /** Coordenadas do endereço de entrega (rota do entregador). */
  deliveryLocation?: { lat: number; lng: number };
}

export interface OrderRow {
  id: string;
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  total: string;
  subtotal: string;
  discount: string;
  surcharge: string;
  delivery_fee: string;
  paid_amount: string;
  payment_status: string;
  tab_id: string | null;
  version: number;
}

/** Pedido como devolvido pela API (campos principais tipados). */
export interface OrderView {
  id: string;
  number: number;
  status: OrderStatus;
  version: number;
  tabId: string | null;
  [key: string]: unknown;
}

export const ORDER_SELECT = `
  SELECT o.id, o.number, o.channel, o.status, o.payment_status AS "paymentStatus",
         o.subtotal::text, o.discount::text, o.surcharge::text, o.delivery_fee::text AS "deliveryFee",
         o.total::text, o.paid_amount::text AS "paidAmount", (o.total - o.paid_amount)::text AS "balance",
         o.tab_id AS "tabId", tb.number AS "tabNumber", dt.label AS "tableLabel",
         o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
         o.delivery_address AS "deliveryAddress", o.delivery_lat::text AS "deliveryLat",
         o.delivery_lng::text AS "deliveryLng", o.notes, o.cancel_reason AS "cancelReason",
         o.source, o.payment_hint AS "paymentHint", o.change_for::text AS "changeFor",
         o.accepted_at AS "acceptedAt",
         o.version, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
         COALESCE((SELECT json_agg(json_build_object(
             'id', i.id, 'productId', i.product_id, 'name', i.name, 'quantity', i.quantity::text,
             'unitPrice', i.unit_price::text, 'total', i.total::text, 'notes', i.notes, 'status', i.status,
             'sectorId', i.sector_id, 'startedAt', i.started_at, 'readyAt', i.ready_at,
             'options', COALESCE((SELECT json_agg(json_build_object('id', io.option_id, 'name', io.name, 'priceDelta', io.price_delta::text))
                                  FROM order_item_options io WHERE io.order_item_id = i.id), '[]'))
           ORDER BY i.created_at, i.id) FROM order_items i WHERE i.order_id = o.id), '[]') AS items
    FROM orders o
    LEFT JOIN tabs tb ON tb.id = o.tab_id
    LEFT JOIN dining_tables dt ON dt.id = tb.table_id`;

/**
 * Regras de pedido. Toda alteração de estado:
 *  - roda em transação com RLS do tenant;
 *  - trava a linha do pedido (SELECT … FOR UPDATE) e confere a transição permitida;
 *  - grava histórico + auditoria e incrementa `version`;
 *  - publica o evento de tempo real só depois do COMMIT.
 * Preços SEMPRE vêm do banco; valores enviados pelo cliente para itens são ignorados.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly stock: StockService,
    private readonly printing: PrintingService,
    private readonly messaging: MessagingService,
    private readonly plans: PlanService,
  ) {}

  // ---------------------------------------------------------------- consultas
  async get(ctx: Ctx, id: string) {
    const o = await this.db.withTenant(ctx, (tx) => this.detail(tx, id));
    if (!o) throw new NotFoundException('Pedido não encontrado');
    return o;
  }

  async detail(tx: Tx, id: string) {
    const o = await one<OrderView>(tx, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    if (!o) return undefined;
    const payments = await q(
      tx,
      `SELECT p.id, p.method, p.amount::text, p.tendered::text, p.refunded_amount::text AS "refundedAmount",
              p.cash_session_id AS "cashSessionId", p.created_at AS "createdAt", u.name AS "createdByName"
         FROM payments p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.order_id = $1 ORDER BY p.created_at`,
      [id],
    );
    const history = await q(
      tx,
      `SELECT h.from_status AS "from", h.to_status AS "to", h.reason, h.created_at AS "at", u.name AS "actorName"
         FROM order_status_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.order_id = $1 ORDER BY h.id`,
      [id],
    );
    return { ...o, payments, history };
  }

  list(
    ctx: Ctx,
    f: {
      status?: string[];
      channel?: string;
      from?: string;
      to?: string;
      active?: boolean;
      limit: number;
    },
  ) {
    const where: string[] = [];
    const p: unknown[] = [];
    if (f.status?.length) {
      p.push(f.status);
      where.push(`o.status = ANY($${p.length}::text[])`);
    }
    if (f.active) where.push(`o.status NOT IN ('completed','cancelled')`);
    if (f.channel) {
      p.push(f.channel);
      where.push(`o.channel = $${p.length}`);
    }
    if (f.from) {
      p.push(f.from);
      where.push(`o.created_at >= $${p.length}::timestamptz`);
    }
    if (f.to) {
      p.push(f.to);
      where.push(`o.created_at < $${p.length}::timestamptz`);
    }
    p.push(f.limit);
    const sql = `${ORDER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT $${p.length}`;
    return this.db.withTenant(ctx, (tx) => q(tx, sql, p));
  }

  // ---------------------------------------------------------------- criação
  async create(ctx: Ctx, input: CreateOrderInput, idemKey?: string) {
    const fx = { stock: 0, print: 0 };
    const result = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'order.create', idemKey, input, () =>
        this.createInTx(tx, ctx, input, fx),
      ),
    );
    if (fx.stock) this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    if (fx.print) this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    this.realtime.publish(ctx.tenantId, {
      type: 'order.changed',
      orderId: result.id,
      status: result.status,
      version: result.version,
    });
    if (result.tabId)
      this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: result.tabId });
    return result;
  }

  private async createInTx(
    tx: Tx,
    ctx: Ctx,
    input: CreateOrderInput,
    fx: { stock: number; print: number },
  ) {
    if (!input.items.length) throw new UnprocessableEntityException('Pedido sem itens');
    await this.plans.assertCanAdd(tx, 'orders_month');

    // Comanda: obrigatória para mesa; pode ser aberta automaticamente pela mesa.
    let tabId = input.tabId ?? null;
    if (input.tableId && !tabId) {
      const table = await one<{ id: string }>(
        tx,
        `SELECT id FROM dining_tables WHERE id = $1 AND active`,
        [input.tableId],
      );
      if (!table) throw new NotFoundException('Mesa não encontrada');
      const open = await one<{ id: string }>(
        tx,
        `SELECT id FROM tabs WHERE table_id = $1 AND status = 'open' FOR UPDATE`,
        [input.tableId],
      );
      tabId = open?.id ?? (await this.openTab(tx, ctx, { tableId: input.tableId })).id;
    }
    if (tabId) {
      const tab = await one<{ status: string }>(
        tx,
        `SELECT status FROM tabs WHERE id = $1 FOR UPDATE`,
        [tabId],
      );
      if (!tab) throw new NotFoundException('Comanda não encontrada');
      if (tab.status !== 'open') throw new ConflictException('Comanda não está aberta');
    }
    if (input.channel === 'table' && !tabId)
      throw new UnprocessableEntityException('Pedido de mesa exige mesa ou comanda');
    if (input.channel === 'delivery' && !input.deliveryAddress)
      throw new UnprocessableEntityException('Delivery exige endereço');

    // Produtos e opções vêm do banco (preço oficial).
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await q<{
      id: string;
      name: string;
      price: string;
      sector_id: string | null;
      active: boolean;
      sold_out: boolean;
    }>(
      tx,
      `SELECT id, name, price::text, sector_id, active, sold_out FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const pmap = new Map(products.map((p) => [p.id, p]));
    const optionIds = [...new Set(input.items.flatMap((i) => i.optionIds ?? []))];
    const opts = optionIds.length
      ? await q<{
          id: string;
          name: string;
          price_delta: string;
          group_id: string;
          active: boolean;
        }>(
          tx,
          `SELECT id, name, price_delta::text, group_id, active FROM options WHERE id = ANY($1::uuid[])`,
          [optionIds],
        )
      : [];
    const omap = new Map(opts.map((o) => [o.id, o]));
    const links = await q<{
      product_id: string;
      group_id: string;
      name: string;
      min_select: number;
      max_select: number;
    }>(
      tx,
      `SELECT pog.product_id, g.id AS group_id, g.name, g.min_select, g.max_select
         FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
        WHERE pog.product_id = ANY($1::uuid[]) AND g.active`,
      [productIds],
    );

    let subtotal = 0;
    const lines = input.items.map((it) => {
      const p = pmap.get(it.productId);
      if (!p || !p.active) throw new UnprocessableEntityException('Produto indisponível');
      if (p.sold_out) throw new UnprocessableEntityException(`Produto esgotado: ${p.name}`);
      const groups = links.filter((l) => l.product_id === p.id);
      const chosen = [...new Set(it.optionIds ?? [])].map((id) => {
        const o = omap.get(id);
        if (!o || !o.active || !groups.some((g) => g.group_id === o.group_id)) {
          throw new UnprocessableEntityException(`Opção inválida para ${p.name}`);
        }
        return o;
      });
      for (const g of groups) {
        const n = chosen.filter((o) => o.group_id === g.group_id).length;
        if (n < g.min_select || n > g.max_select) {
          throw new UnprocessableEntityException(
            `${p.name}: escolha de ${g.min_select} a ${g.max_select} em "${g.name}"`,
          );
        }
      }
      const unit = toCents(p.price) + chosen.reduce((s, o) => s + toCents(o.price_delta), 0);
      const total = multiplyCents(unit, it.quantity);
      subtotal += total;
      return { p, it, chosen, unit, total };
    });

    if (input.minSubtotal && subtotal < toCents(input.minSubtotal))
      throw new UnprocessableEntityException(
        `Pedido mínimo de R$ ${input.minSubtotal.replace('.', ',')} (sem a taxa de entrega)`,
      );
    const discount = toCents(input.discount ?? '0');
    const surcharge = toCents(input.surcharge ?? '0');
    const deliveryFee = toCents(input.deliveryFee ?? '0');
    this.checkDiscount(ctx, discount, subtotal);
    const total = subtotal - discount + surcharge + deliveryFee;
    if (total < 0) throw new UnprocessableEntityException('Desconto maior que o valor do pedido');

    const number = await nextNumber(tx, ctx.tenantId, 'order');
    const online = input.online;
    const status: OrderStatus = online && !online.autoAccept ? 'awaiting' : 'new';
    const order = await one<{ id: string }>(
      tx,
      `INSERT INTO orders (tenant_id, number, channel, status, tab_id, customer_name, customer_phone, delivery_address,
                           notes, subtotal, discount, surcharge, delivery_fee, total, created_by,
                           source, public_token_hash, payment_hint, change_for, accepted_at, customer_id,
                           delivery_lat, delivery_lng)
       VALUES ($1,$2,$3,$15,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16,$17,$18,$19,
               CASE WHEN $15 = 'new' AND $16 = 'online' THEN now() END, $20, $21, $22) RETURNING id`,
      [
        ctx.tenantId,
        number,
        input.channel,
        tabId,
        input.customerName ?? null,
        input.customerPhone ?? null,
        input.deliveryAddress ?? null,
        input.notes ?? null,
        fromCents(subtotal),
        fromCents(discount),
        fromCents(surcharge),
        fromCents(deliveryFee),
        fromCents(total),
        ctx.userId,
        status,
        online ? 'online' : 'staff',
        online?.tokenHash ?? null,
        online?.paymentHint ?? null,
        online?.changeFor ?? null,
        online?.customerId ?? null,
        input.deliveryLocation?.lat.toFixed(6) ?? null,
        input.deliveryLocation?.lng.toFixed(6) ?? null,
      ],
    );
    for (const l of lines) {
      const item = await one<{ id: string }>(
        tx,
        `INSERT INTO order_items (tenant_id, order_id, product_id, name, quantity, unit_price, total, notes, sector_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          ctx.tenantId,
          order!.id,
          l.p.id,
          l.p.name,
          l.it.quantity,
          fromCents(l.unit),
          fromCents(l.total),
          l.it.notes ?? null,
          l.p.sector_id,
        ],
      );
      for (const o of l.chosen) {
        await q(
          tx,
          `INSERT INTO order_item_options (tenant_id, order_item_id, option_id, name, price_delta) VALUES ($1,$2,$3,$4,$5)`,
          [ctx.tenantId, item!.id, o.id, o.name, o.price_delta],
        );
      }
    }
    await this.history(tx, ctx, order!.id, null, status);
    // Baixa de insumos pela ficha técnica (trava os insumos por último) e comandas de impressão.
    // Pedido em análise só baixa estoque e imprime quando for aceito.
    if (status === 'new') {
      fx.stock = await this.stock.consumeForOrder(tx, ctx, order!.id);
      fx.print = await this.printing.enqueueKitchenTickets(tx, ctx, order!.id);
    }
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'order.created',
      entity: 'order',
      entityId: order!.id,
      data: {
        number,
        channel: input.channel,
        total: fromCents(total),
        discount: fromCents(discount),
        source: online ? 'online' : 'staff',
      },
      ip: ctx.ip,
    });
    return (await this.detail(tx, order!.id))!;
  }

  private checkDiscount(ctx: Ctx, discount: number, base: number) {
    if (discount <= 0) return;
    if (discount > base)
      throw new UnprocessableEntityException('Desconto maior que o valor do pedido');
    const pct = base === 0 ? 100 : (discount * 100) / base;
    if (pct > DISCOUNT_FREE_LIMIT_PERCENT && !roleHas(ctx.user.role, 'orders:discount')) {
      throw new ForbiddenException(
        `Desconto acima de ${DISCOUNT_FREE_LIMIT_PERCENT}% exige autorização de gerente`,
      );
    }
  }

  async openTab(tx: Tx, ctx: Ctx, input: { tableId?: string; customerName?: string }) {
    const number = await nextNumber(tx, ctx.tenantId, 'tab');
    const tab = await one<{ id: string; number: number }>(
      tx,
      `INSERT INTO tabs (tenant_id, number, table_id, customer_name, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, number`,
      [ctx.tenantId, number, input.tableId ?? null, input.customerName ?? null, ctx.userId],
    );
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'tab.opened',
      entity: 'tab',
      entityId: tab!.id,
      data: { number, tableId: input.tableId ?? null },
      ip: ctx.ip,
    });
    return tab!;
  }

  /** Pedido com nota fiscal emitida (ou em emissão) não é cancelado nem estornado sem cancelar a nota. */
  async assertNoLiveFiscalDocument(tx: Tx, orderId: string, action: string) {
    const doc = await one<{ status: string }>(
      tx,
      `SELECT status FROM fiscal_documents
        WHERE order_id = $1 AND status IN ('pending','processing','authorized','cancelling') LIMIT 1`,
      [orderId],
    );
    if (doc)
      throw new ConflictException(
        doc.status === 'authorized'
          ? `Pedido com NFC-e autorizada: cancele a nota antes de ${action}`
          : `Pedido com NFC-e em emissão: aguarde o resultado antes de ${action}`,
      );
  }

  // ---------------------------------------------------------------- estados
  async lock(tx: Tx, id: string): Promise<OrderRow> {
    const o = await one<OrderRow>(
      tx,
      `SELECT id, number, channel, status, total::text, subtotal::text, discount::text, surcharge::text,
              delivery_fee::text, paid_amount::text, payment_status, tab_id, version
         FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!o) throw new NotFoundException('Pedido não encontrado');
    return o;
  }

  async history(
    tx: Tx,
    ctx: Ctx,
    orderId: string,
    from: string | null,
    to: string,
    reason?: string,
  ) {
    await q(
      tx,
      `INSERT INTO order_status_history (tenant_id, order_id, from_status, to_status, actor_id, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.tenantId, orderId, from, to, ctx.userId, reason ?? null],
    );
  }

  /** Aplica a transição dentro de uma transação já aberta (usado também pela cozinha). */
  async transitionInTx(tx: Tx, ctx: Ctx, o: OrderRow, to: OrderStatus, reason?: string) {
    if (o.status === to) return;
    if (!canTransition(o.status, to, o.channel)) {
      throw new ConflictException(`Transição inválida: ${o.status} → ${to}`);
    }
    // Recusar um pedido em análise não exige gerente: nada foi produzido, cobrado ou baixado.
    const rejecting = o.status === 'awaiting' && to === 'cancelled';
    if (to === 'cancelled') {
      await this.assertNoLiveFiscalDocument(tx, o.id, 'cancelar o pedido');
      if (!rejecting && !roleHas(ctx.user.role, 'orders:cancel'))
        throw new ForbiddenException('Cancelamento exige autorização');
      if (!reason) throw new UnprocessableEntityException('Informe o motivo do cancelamento');
      if (toCents(o.paid_amount) > 0) {
        throw new ConflictException(
          'Pedido com pagamento: estorne os pagamentos antes de cancelar',
        );
      }
      await q(
        tx,
        `UPDATE order_items SET status = 'cancelled' WHERE order_id = $1 AND status <> 'cancelled'`,
        [o.id],
      );
      // Insumos voltam ao estoque (movimento de estorno; nada é apagado).
      if (!rejecting) await this.stock.restoreForOrder(tx, ctx, o.id);
    }
    if (o.status === 'awaiting' && to === 'new') {
      // Aceite do pedido online: só agora baixa estoque e imprime na cozinha.
      await q(tx, `UPDATE orders SET accepted_at = now() WHERE id = $1`, [o.id]);
      await this.stock.consumeForOrder(tx, ctx, o.id);
      await this.printing.enqueueKitchenTickets(tx, ctx, o.id);
    }
    if (o.status === 'dispatched') {
      // Saindo de "saiu para entrega": encerra a entrega em andamento e encurta o link de rastreio.
      await q(
        tx,
        `UPDATE deliveries SET status = $2, finished_at = now(), failure_reason = $3,
                tracking_expires_at = LEAST(tracking_expires_at, now() + interval '30 minutes')
          WHERE order_id = $1 AND status = 'out'`,
        [
          o.id,
          to === 'completed' ? 'delivered' : 'failed',
          to === 'completed' ? null : (reason ?? null),
        ],
      );
    }
    if (to === 'cancel_requested' && !reason)
      throw new UnprocessableEntityException('Informe o motivo');
    if (to === 'ready') {
      await q(
        tx,
        `UPDATE order_items SET status = 'ready', ready_at = now() WHERE order_id = $1 AND status IN ('pending','preparing')`,
        [o.id],
      );
    }
    await q(
      tx,
      `UPDATE orders SET status = $2, version = version + 1, cancel_reason = CASE WHEN $2 IN ('cancelled','cancel_requested') THEN $3 ELSE cancel_reason END WHERE id = $1`,
      [o.id, to, reason ?? null],
    );
    await this.history(tx, ctx, o.id, o.status, to, reason);
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: `order.status.${to}`,
      entity: 'order',
      entityId: o.id,
      data: { from: o.status, to, reason: reason ?? null },
      ip: ctx.ip,
    });
    // Aviso ao cliente pelo WhatsApp: gravado nesta mesma transação (só sai se ela for gravada).
    if (to === 'ready' && (o.channel === 'pickup' || o.channel === 'counter'))
      await this.messaging.stage(tx, ctx.tenantId, o.id, 'order.ready');
    if (to === 'dispatched' && o.channel === 'delivery')
      await this.messaging.stage(tx, ctx.tenantId, o.id, 'order.dispatched');
    o.status = to;
    o.version += 1;
  }

  async transition(
    ctx: Ctx,
    id: string,
    to: OrderStatus,
    opts: { reason?: string; expectedVersion?: number },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      // "Saiu para entrega" sempre registra o entregador (e o link de rastreio): POST /orders/:id/dispatch.
      if (to === 'dispatched' && o.channel === 'delivery')
        throw new ConflictException('Para despachar, escolha o entregador na tela Entregas');
      if (opts.expectedVersion !== undefined && opts.expectedVersion !== o.version) {
        throw new ConflictException('O pedido foi alterado por outra pessoa; atualize a tela');
      }
      await this.transitionInTx(tx, ctx, o, to, opts.reason);
      return this.detail(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: id, status: to });
    if (to === 'cancelled' || to === 'new')
      this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    if (to === 'new') this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    if (res?.tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res.tabId });
    return res;
  }

  /** Desconto/acréscimo após a criação. Não pode deixar o total abaixo do já pago. */
  async adjust(ctx: Ctx, id: string, b: { discount?: string; surcharge?: string; reason: string }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (o.status === 'completed' || o.status === 'cancelled')
        throw new ConflictException('Pedido encerrado');
      const subtotal = toCents(o.subtotal);
      const discount = b.discount !== undefined ? toCents(b.discount) : toCents(o.discount);
      const surcharge = b.surcharge !== undefined ? toCents(b.surcharge) : toCents(o.surcharge);
      this.checkDiscount(ctx, discount, subtotal);
      const total = subtotal - discount + surcharge + toCents(o.delivery_fee);
      const paid = toCents(o.paid_amount);
      if (total < paid) throw new ConflictException('Novo total ficaria menor que o valor já pago');
      await q(
        tx,
        `UPDATE orders SET discount = $2, surcharge = $3, total = $4, payment_status = $5, version = version + 1 WHERE id = $1`,
        [
          id,
          fromCents(discount),
          fromCents(surcharge),
          fromCents(total),
          paymentStatusFor(total, paid),
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.adjusted',
        entity: 'order',
        entityId: id,
        data: {
          from: { discount: o.discount, surcharge: o.surcharge },
          to: { discount: fromCents(discount), surcharge: fromCents(surcharge) },
          reason: b.reason,
        },
        ip: ctx.ip,
      });
      return this.detail(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: id });
    return res;
  }

  /**
   * Move o pedido inteiro para outra comanda aberta (transferência entre mesas/comandas).
   * Ordem de travas: comandas (por id) → pedido, a mesma do pagamento de comanda, evitando deadlock.
   */
  async moveToTab(ctx: Ctx, id: string, tabId: string) {
    let fromTab: string | null = null;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const cur = await one<{ tab_id: string | null }>(
        tx,
        `SELECT tab_id FROM orders WHERE id = $1`,
        [id],
      );
      if (!cur) throw new NotFoundException('Pedido não encontrado');
      if (cur.tab_id === tabId) throw new ConflictException('O pedido já está nesta comanda');
      const tabIds = [tabId, cur.tab_id].filter((x): x is string => !!x).sort();
      const tabs = await q<{ id: string; status: string }>(
        tx,
        `SELECT id, status FROM tabs WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [tabIds],
      );
      const target = tabs.find((t) => t.id === tabId);
      if (!target) throw new NotFoundException('Comanda não encontrada');
      if (target.status !== 'open')
        throw new ConflictException('Comanda de destino não está aberta');
      const o = await this.lock(tx, id);
      if (o.tab_id !== cur.tab_id)
        throw new ConflictException('O pedido foi alterado; tente novamente');
      if (o.status === 'cancelled' || o.status === 'completed')
        throw new ConflictException('Pedido encerrado');
      fromTab = o.tab_id;
      await q(tx, `UPDATE orders SET tab_id = $2, version = version + 1 WHERE id = $1`, [
        id,
        tabId,
      ]);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.moved',
        entity: 'order',
        entityId: id,
        data: { fromTab: o.tab_id, toTab: tabId },
        ip: ctx.ip,
      });
      return this.detail(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: id });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId });
    if (fromTab) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: fromTab });
    return res;
  }
}
