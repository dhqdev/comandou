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
  groupOptionCharges,
  menuKindOf,
  type ChargeRule,
  multiplyCents,
  OrderChannel,
  ordersLimitedToOwn,
  OrderStatus,
  paymentStatusFor,
  type PaymentMethod,
  roleHas,
  toCents,
  isValidKg,
  ONLINE_WEIGHT_MAX_G,
  WEIGHT_MAX_KG,
} from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { MessageEvent, MessagingService } from '../messaging/messaging.service';
import type { Ctx } from '../common/context';
import { settleRide } from '../delivery/courier-pay.service';
import { withIdempotency } from '../common/idempotency';
import { nextNumber, one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { PrintingService } from '../printing/printing.service';
import { RealtimeService } from '../realtime/realtime.service';
import { completeSeatedForTab } from '../reservations/seated';
import { PRODUCT_STOCK_MISSING } from '../stock/availability-sql';
import { StockService } from '../stock/stock.service';
import { PlanService } from '../plans/plan.service';
import { LoyaltyService, RedeemQuote } from '../loyalty/loyalty.service';

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
  /** Cliente cadastrado escolhido pela equipe (vale só fora do cardápio online). */
  customerId?: string;
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
    /** Recompensa do programa de fidelidade trocada neste pedido (exige customerId). */
    rewardId?: string;
    /** Pix pelo cardápio: o pedido nasce esperando o comprovante (orders.pix_status). */
    pix?: boolean;
    /** Pago pelo app (PagBank): nasce em análise e só é aceito depois de pago. */
    payOnline?: 'card' | 'pix';
  };
  /** Pedido mínimo (sobre o subtotal dos itens), usado pelo cardápio online. */
  minSubtotal?: string;
  /** Coordenadas do endereço de entrega (rota do entregador). */
  deliveryLocation?: { lat: number; lng: number };
}

/** O que aconteceu ao acertar um pedido de mesa entregue (concluiu? a comanda fechou?). */
export interface Settled {
  completed: boolean;
  closedTabId: string | null;
  /** Reservas sentadas na mesa que terminaram junto com a comanda (avisar a tela de Reservas). */
  reservationIds?: string[];
}
/**
 * Pedido de aplicativo: itens e valores são os do aplicativo (ADR 0015 §6). Mudar aqui deixaria o
 * Comandou diferente do que o cliente pagou e do repasse.
 */
function assertNotAppOrder(o: { source?: string | null }, what: string) {
  if (o.source === 'app')
    throw new ConflictException(
      `Pedido de aplicativo: não dá para ${what} no Comandou. Itens e valores mudam só no aplicativo.`,
    );
}

const NOT_SETTLED: Settled = { completed: false, closedTabId: null };

/** Opções de uma transição que não cabem no motivo. */
export interface TransitionExtra {
  /** Concluir com saldo como "a receber" (fiado), com motivo. Exige `orders:cancel`. */
  receivable?: boolean;
  /** Forma que o entregador recebeu na porta (vai para o acerto). */
  collectMethod?: string | null;
  /**
   * A mudança veio do aplicativo de delivery (evento do canal): não volta para o canal pela caixa
   * de saída, e o saldo do pedido é acertado pelo aplicativo (repasse) ou na entrega.
   */
  fromChannel?: boolean;
  /** Pedido de aplicativo: código do motivo de cancelamento escolhido (vai para o aplicativo). */
  channelReason?: string;
}

/** Pedido de aplicativo de delivery, já traduzido (ExternalOrdersService). */
export interface ExternalOrderInput {
  channel: OrderChannel;
  status: 'awaiting' | 'new';
  appChannel: string;
  externalCode: string;
  deliveredBy: 'merchant' | 'channel';
  scheduledFor: string | null;
  customerName: string | null;
  customerPhone: string | null;
  taxDocument: string | null;
  deliveryAddress: string | null;
  deliveryLocation: { lat: number; lng: number } | null;
  notes: string | null;
  paymentHint: string | null;
  changeFor: string | null;
  subtotal: string;
  discount: string;
  surcharge: string;
  deliveryFee: string;
  total: string;
  lines: {
    productId: string;
    name: string;
    quantity: number;
    unit: 'un' | 'kg';
    unitPrice: string;
    total: string;
    notes: string | null;
    sectorId: string | null;
    options: { optionId: string; name: string; priceDelta: string }[];
  }[];
  /**
   * O que o aplicativo paga ao restaurante por este pedido (pago online + desconto do aplicativo).
   * Vira um pagamento 'app', fora da gaveta do caixa.
   */
  appPayment?: { amount: string; method: PaymentMethod; brand: string | null } | null;
}

/** Gancho dentro da transação de cada mudança de estado (ex.: ação para o aplicativo). */
export type TransitionHook = (
  tx: Tx,
  ctx: Ctx,
  o: OrderRow,
  from: OrderStatus,
  to: OrderStatus,
  extra: TransitionExtra,
) => Promise<void>;

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
  /** staff, online ou app (aplicativo de delivery). */
  source?: string;
  app_channel?: string | null;
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
         o.delivery_address AS "deliveryAddress", o.tax_document AS "taxDocument", o.delivery_lat::text AS "deliveryLat",
         o.delivery_lng::text AS "deliveryLng", o.notes, o.cancel_reason AS "cancelReason",
         o.source, o.payment_hint AS "paymentHint", o.change_for::text AS "changeFor",
         o.app_channel AS "appChannel", o.external_code AS "externalCode",
         o.delivered_by AS "deliveredBy", o.scheduled_for AS "scheduledFor",
         CASE WHEN o.source = 'app' AND o.status = 'awaiting'
              THEN (SELECT c.confirm_by FROM channel_orders c WHERE c.order_id = o.id) END AS "appConfirmBy",
         CASE WHEN o.source = 'app' THEN (
           SELECT COALESCE(d.expires_at, d.created_at + interval '15 minutes') FROM channel_disputes d
            WHERE d.order_id = o.id AND d.status = 'open'
              AND COALESCE(d.expires_at, d.created_at + interval '15 minutes') > now()
            ORDER BY d.created_at DESC LIMIT 1) END AS "appDisputeUntil",
         CASE WHEN o.source = 'app' THEN (SELECT c.driver_status FROM channel_orders c
                                           WHERE c.order_id = o.id) END AS "appDriverStatus",
         o.accepted_at AS "acceptedAt", o.receivable_at AS "receivableAt",
         o.receivable_reason AS "receivableReason",
         o.fiado_name AS "fiadoName", o.fiado_phone AS "fiadoPhone",
         o.fiado_due_at AS "fiadoDueAt", o.fiado_at AS "fiadoAt",
         o.pix_status AS "pixStatus", o.served_at AS "servedAt",
         CASE WHEN o.pix_status IS NOT NULL THEN (
           SELECT json_build_object('id', r.id, 'status', r.status, 'contentType', r.content_type,
                                    'createdAt', r.created_at, 'amount', r.amount::text,
                                    'rejectReason', r.reject_reason, 'hasFile', r.bytes IS NOT NULL)
             FROM pix_receipts r WHERE r.order_id = o.id ORDER BY r.created_at DESC LIMIT 1)
         END AS "pixReceipt",
         o.version, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
         COALESCE((SELECT json_agg(json_build_object(
             'id', i.id, 'productId', i.product_id, 'name', i.name, 'quantity', i.quantity::text,
             'unit', i.unit, 'unitPrice', i.unit_price::text, 'total', i.total::text, 'notes', i.notes, 'status', i.status,
             'sectorId', i.sector_id, 'startedAt', i.started_at, 'readyAt', i.ready_at,
             'cancelReason', i.cancel_reason,
             'imageId', (SELECT p.image_id FROM products p WHERE p.id = i.product_id),
             'options', COALESCE((SELECT json_agg(json_build_object('id', io.option_id, 'name', io.name, 'priceDelta', io.price_delta::text))
                                  FROM order_item_options io WHERE io.order_item_id = i.id), '[]'))
           ORDER BY i.created_at, i.id) FROM order_items i WHERE i.order_id = o.id), '[]') AS items
    FROM orders o
    LEFT JOIN tabs tb ON tb.id = o.tab_id
    LEFT JOIN dining_tables dt ON dt.id = tb.table_id`;

/**
 * Taxa de serviço em centavos: percentual ("10.00") sobre a base (itens com desconto),
 * arredondada para o centavo mais próximo.
 */
export function serviceFeeCents(baseCents: number, percent: string | null): number {
  if (!percent || baseCents <= 0) return 0;
  const hundredths = toCents(percent); // "10.00" → 1000 (centésimos de ponto percentual)
  return Math.round((baseCents * hundredths) / 10_000);
}

/** Aviso ao cliente pelo WhatsApp que a mudança de status gera (ou null). */
export function statusEvent(
  from: OrderStatus,
  to: OrderStatus,
  channel: OrderChannel,
): MessageEvent | null {
  if (from === 'awaiting' && to === 'new') return 'order.accepted';
  if (to === 'ready' && (channel === 'pickup' || channel === 'counter')) return 'order.ready';
  if (to === 'dispatched' && channel === 'delivery') return 'order.dispatched';
  if (from === 'dispatched' && to === 'completed') return 'order.delivered';
  if (to === 'cancelled' && (channel === 'delivery' || channel === 'pickup'))
    return 'order.cancelled';
  return null;
}

/**
 * Garçom (lança pedidos mas não gere todos): só os pedidos do salão e os que ele lançou. Devolve o
 * filtro SQL (sobre o alias "o") e acrescenta o parâmetro em `p`; undefined para quem vê tudo.
 */
export function ownScope(ctx: Ctx, p: unknown[]): string | undefined {
  if (!ordersLimitedToOwn(ctx.user.role)) return undefined;
  p.push(ctx.userId);
  return `(o.tab_id IS NOT NULL OR o.channel = 'table' OR o.created_by = $${p.length})`;
}

/**
 * Pedido fiado ou concluído "a receber": o saldo virou conta do cliente, cobrada à parte. Não
 * segura a comanda (ao fechar, o fiado pronto conclui como "a receber") nem entra no "Receber" da
 * mesa. Sobre o alias "o".
 */
export const ON_ACCOUNT_SQL = `(o.fiado_at IS NOT NULL OR (o.status = 'completed' AND o.receivable_at IS NOT NULL))`;

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
    private readonly loyalty: LoyaltyService,
  ) {}

  // ---------------------------------------------------------------- avisos depois do COMMIT
  private readonly dispatchedHooks: ((ctx: Ctx, orderId: string) => Promise<void>)[] = [];
  private readonly tabClosedHooks: ((ctx: Ctx, tabId: string) => Promise<void>)[] = [];
  /** Pedido saiu para entrega (ex.: NFC-e do delivery vai junto com a mercadoria). */
  onDispatched(hook: (ctx: Ctx, orderId: string) => Promise<void>) {
    this.dispatchedHooks.push(hook);
  }
  /** Conta da comanda fechada (ex.: NFC-e da mesa toda). */
  onTabClosed(hook: (ctx: Ctx, tabId: string) => Promise<void>) {
    this.tabClosedHooks.push(hook);
  }
  /**
   * Dentro da transação do cancelamento (ex.: pagamento pelo app fora do caixa vira "a devolver").
   * Erro aqui desfaz o cancelamento.
   */
  private readonly cancelHooks: ((tx: Tx, ctx: Ctx, orderId: string) => Promise<void>)[] = [];
  onCancelInTx(hook: (tx: Tx, ctx: Ctx, orderId: string) => Promise<void>) {
    this.cancelHooks.push(hook);
  }
  /** Toda mudança de estado, na mesma transação. Erro aqui desfaz a mudança. */
  private readonly transitionHooks: TransitionHook[] = [];
  onTransitionInTx(hook: TransitionHook) {
    this.transitionHooks.push(hook);
  }
  /** Sem esperar e sem devolver erro: o aviso nunca desfaz a operação. */
  notifyDispatched(ctx: Ctx, orderId: string) {
    for (const h of this.dispatchedHooks) void h(ctx, orderId).catch(() => undefined);
  }
  notifyTabClosed(ctx: Ctx, tabId: string) {
    for (const h of this.tabClosedHooks) void h(ctx, tabId).catch(() => undefined);
  }

  // ---------------------------------------------------------------- consultas
  async get(ctx: Ctx, id: string) {
    const o = await this.db.withTenant(ctx, async (tx) =>
      (await this.inScope(tx, ctx, id)) ? this.detail(tx, id) : undefined,
    );
    if (!o) throw new NotFoundException('Pedido não encontrado');
    return o;
  }

  /** O garçom enxerga este pedido? (do salão ou lançado por ele; quem gere vê todos). */
  async inScope(tx: Tx, ctx: Ctx, id: string) {
    const p: unknown[] = [id];
    const scope = ownScope(ctx, p);
    return !scope || !!(await one(tx, `SELECT 1 FROM orders o WHERE o.id = $1 AND ${scope}`, p));
  }

  /** Mesma regra da consulta do pedido, para as rotas que leem o pedido por outro caminho. */
  async assertInScope(ctx: Ctx, id: string) {
    if (!(await this.db.withTenant(ctx, (tx) => this.inScope(tx, ctx, id))))
      throw new NotFoundException('Pedido não encontrado');
  }

  async detail(tx: Tx, id: string) {
    const o = await one<OrderView>(tx, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    if (!o) return undefined;
    const payments = await q(
      tx,
      `SELECT p.id, p.method, p.amount::text, p.tendered::text, p.refunded_amount::text AS "refundedAmount",
              p.cash_session_id AS "cashSessionId", p.created_at AS "createdAt", u.name AS "createdByName",
              p.app_channel AS "appChannel", p.app_method AS "appMethod", p.app_brand AS "appBrand"
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
    // Pix pelo cardápio: os comprovantes que o cliente mandou (o mais novo primeiro).
    const pixReceipts = o.pixStatus
      ? await q(
          tx,
          `SELECT r.id, r.status, r.content_type AS "contentType", r.size, r.width, r.height,
                  r.amount::text, r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt",
                  u.name AS "reviewedByName", r.reject_reason AS "rejectReason",
                  r.bytes IS NOT NULL AS "hasFile"
             FROM pix_receipts r LEFT JOIN users u ON u.id = r.reviewed_by
            WHERE r.order_id = $1 ORDER BY r.created_at DESC`,
          [id],
        )
      : [];
    // Pago pelo app (PagBank): as tentativas e a que foi paga (sem dados do cartão além do final).
    const online = await one<{ payOnline: string | null }>(
      tx,
      `SELECT pay_online AS "payOnline" FROM orders WHERE id = $1`,
      [id],
    );
    const onlineCharges = online?.payOnline
      ? await q(
          tx,
          `SELECT id, method, status, amount::text, fee_amount::text AS "feeAmount",
                  refunded_amount::text AS "refundedAmount", card_brand AS "cardBrand",
                  card_last4 AS "cardLast4", decline_reason AS "declineReason",
                  payment_id AS "paymentId", created_at AS "createdAt", paid_at AS "paidAt"
             FROM online_charges WHERE order_id = $1 ORDER BY created_at`,
          [id],
        )
      : [];
    // Aplicativo de delivery: dados do canal e as ações enviadas a ele (enviando, enviado, falhou).
    const app = o.appChannel
      ? {
          ...(await one(
            tx,
            `SELECT channel, external_id AS "externalId", display_code AS "displayCode",
                    channel_status AS "channelStatus", fulfillment, timing, delivered_by AS "deliveredBy",
                    scheduled_for AS "scheduledFor", prepare_from AS "prepareFrom",
                    confirm_by AS "confirmBy", pickup_code AS "pickupCode",
                    phone_locator AS "phoneLocator", prepaid, payment_method AS "paymentMethod",
                    payment_brand AS "paymentBrand", change_for::text AS "changeFor",
                    customer_total::text AS "customerTotal", channel_discount::text AS "channelDiscount",
                    merchant_discount::text AS "merchantDiscount", menu_difference::text AS "menuDifference",
                    unlinked_items AS "unlinkedItems"
               FROM channel_orders WHERE order_id = $1`,
            [id],
          )),
          unlinked: (
            await q<{ order_item_id: string }>(
              tx,
              `SELECT order_item_id FROM channel_order_items WHERE order_id = $1 AND NOT linked`,
              [id],
            )
          ).map((r) => r.order_item_id),
          // Negociações do cliente (cancelar, reembolso, mais tempo): a pessoa responde na tela.
          disputes: await q(
            tx,
            `SELECT id, channel, kind, message, expires_at AS "expiresAt", timeout_action AS "timeoutAction",
                    alternatives, accept_reasons AS "acceptReasons", status, decision,
                    decided_at AS "decidedAt", outcome, settled_at AS "settledAt", created_at AS "createdAt"
               FROM channel_disputes WHERE order_id = $1 ORDER BY created_at DESC`,
            [id],
          ),
          actions: await q(
            tx,
            `SELECT id, action, status, attempts, last_error AS "lastError", created_at AS "createdAt",
                    sent_at AS "sentAt", confirmed_at AS "confirmedAt"
               FROM integration_outbox WHERE order_id = $1 ORDER BY created_at, id`,
            [id],
          ),
        }
      : null;
    return {
      ...o,
      app,
      payments,
      history,
      pixReceipts,
      payOnline: online?.payOnline ?? null,
      onlineCharges,
    };
  }

  list(
    ctx: Ctx,
    f: {
      status?: string[];
      channel?: string;
      from?: string;
      to?: string;
      active?: boolean;
      mine?: boolean;
      /** Concluídos com saldo a pagar (a receber ou aguardando o acerto do entregador). */
      openBalance?: boolean;
      /** Prontos para levar: pedidos de mesa prontos que ainda não chegaram na mesa. */
      toServe?: boolean;
      /** Cancelados com Pix a devolver (comprovante que ninguém tinha conferido). */
      pixRefund?: boolean;
      limit: number;
    },
  ) {
    const where: string[] = [];
    const p: unknown[] = [];
    const scope = ownScope(ctx, p);
    if (scope) where.push(scope);
    if (f.mine) {
      p.push(ctx.userId);
      where.push(`o.created_by = $${p.length}`);
    }
    if (f.status?.length) {
      p.push(f.status);
      where.push(`o.status = ANY($${p.length}::text[])`);
    }
    if (f.active) where.push(`o.status NOT IN ('completed','cancelled')`);
    if (f.openBalance) where.push(`o.status = 'completed' AND o.paid_amount < o.total`);
    if (f.toServe) where.push(`o.channel = 'table' AND o.status = 'ready' AND o.served_at IS NULL`);
    if (f.pixRefund) where.push(`o.pix_status = 'refund_due'`);
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

  /**
   * Quantos pedidos caem em cada período (atalhos do filtro de data da tela de Pedidos).
   * Uma consulta só, com um COUNT FILTER por período; os limites vêm do navegador (fuso local).
   */
  async periodCounts(ctx: Ctx, ranges: { key: string; from: string; to: string }[]) {
    if (!ranges.length) return {} as Record<string, number>;
    const p: unknown[] = [];
    const scope = ownScope(ctx, p);
    const cols = ranges.map((r, i) => {
      p.push(r.from, r.to);
      return `COUNT(*) FILTER (WHERE o.created_at >= $${p.length - 1}::timestamptz AND o.created_at < $${p.length}::timestamptz)::int AS c${i}`;
    });
    const first = ranges.map((r) => new Date(r.from).getTime()).reduce((a, b) => Math.min(a, b));
    p.push(new Date(first).toISOString());
    const where = [`o.created_at >= $${p.length}::timestamptz`, ...(scope ? [scope] : [])];
    const sql = `SELECT ${cols.join(', ')} FROM orders o WHERE ${where.join(' AND ')}`;
    const row = await this.db.withTenant(ctx, (tx) => one<Record<string, number>>(tx, sql, p));
    return Object.fromEntries(ranges.map((r, i) => [r.key, row?.[`c${i}`] ?? 0]));
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
      // Trava a mesa: dois primeiros pedidos juntos na mesa livre caem na mesma comanda (o
      // segundo espera o primeiro abrir a comanda e entra nela).
      const table = await one<{ id: string }>(
        tx,
        `SELECT id FROM dining_tables WHERE id = $1 AND active FOR UPDATE`,
        [input.tableId],
      );
      if (!table) throw new NotFoundException('Mesa não encontrada');
      const open = await one<{ id: string }>(
        tx,
        `SELECT id FROM tabs WHERE table_id = $1 AND status = 'open' FOR UPDATE`,
        [input.tableId],
      );
      // Cliente pedindo pelo QR Code da mesa: a comanda nova já sai com o nome dele.
      tabId =
        open?.id ??
        (
          await this.openTab(tx, ctx, {
            tableId: input.tableId,
            customerName: input.online ? input.customerName : undefined,
          })
        ).id;
    }
    let serviceFee: string | null = null;
    if (tabId) {
      const tab = await one<{ status: string; service_fee_percent: string | null }>(
        tx,
        `SELECT status, service_fee_percent::text FROM tabs WHERE id = $1 FOR UPDATE`,
        [tabId],
      );
      if (!tab) throw new NotFoundException('Comanda não encontrada');
      if (tab.status !== 'open') throw new ConflictException('Comanda não está aberta');
      serviceFee = tab.service_fee_percent;
    }
    if (input.channel === 'table' && !tabId)
      throw new UnprocessableEntityException('Pedido de mesa exige mesa ou comanda');
    if (input.channel === 'delivery' && !input.deliveryAddress)
      throw new UnprocessableEntityException('Delivery exige endereço');

    const { lines, subtotal } = await this.priceLines(
      tx,
      input.channel,
      input.items,
      !!input.online,
    );

    // Fidelidade: o desconto da recompensa vem do programa (não passa pelo limite de desconto da equipe).
    let reward: RedeemQuote | null = null;
    if (input.online?.rewardId) {
      if (!input.online.customerId)
        throw new UnprocessableEntityException('Entre na sua conta para usar os pontos');
      reward = await this.loyalty.quoteRedeemIn(
        tx,
        input.online.customerId,
        input.online.rewardId,
        lines.map((l) => ({
          productId: l.p.id,
          unitBaseCents: toCents(l.p.price),
          lineBaseCents: multiplyCents(toCents(l.p.price), l.it.quantity),
        })),
        subtotal,
      );
    }

    if (input.minSubtotal && subtotal < toCents(input.minSubtotal))
      throw new UnprocessableEntityException(
        `Pedido mínimo de R$ ${input.minSubtotal.replace('.', ',')} (sem a taxa de entrega)`,
      );
    const staffDiscount = toCents(input.discount ?? '0');
    const discount = staffDiscount + (reward?.discountCents ?? 0);
    // Retirada não tem taxa de serviço nem frete: o cliente busca no balcão.
    const pickup = input.channel === 'pickup';
    const staffSurcharge = pickup ? 0 : toCents(input.surcharge ?? '0');
    const deliveryFee = pickup ? 0 : toCents(input.deliveryFee ?? '0');
    // Garçom não dá desconto nem acréscimo: isso fica com o caixa/gerente (cliente online não passa aqui).
    if (
      ctx.userId &&
      ordersLimitedToOwn(ctx.user.role) &&
      (staffDiscount > 0 || staffSurcharge > 0)
    )
      throw new ForbiddenException('Desconto e acréscimo ficam com o caixa ou o gerente');
    this.checkDiscount(ctx, staffDiscount, subtotal);
    // Comanda com taxa de serviço: o acréscimo do pedido é a taxa sobre os itens (com desconto),
    // a não ser que o caixa informe outro valor.
    const surcharge =
      input.surcharge === undefined && serviceFee && !pickup
        ? serviceFeeCents(subtotal - discount, serviceFee)
        : staffSurcharge;
    const total = subtotal - discount + surcharge + deliveryFee;
    if (total < 0) throw new UnprocessableEntityException('Desconto maior que o valor do pedido');

    const online = input.online;
    // Cliente escolhido no PDV: liga o pedido à ficha dele. Bloqueado ou inexistente (ex.: a fila
    // offline chegou depois de alguém apagar) só não liga; o nome e o telefone vão no pedido.
    const staffCustomerId =
      !online && input.customerId
        ? ((
            await one<{ id: string }>(
              tx,
              `SELECT id FROM customers WHERE id = $1 AND blocked_at IS NULL`,
              [input.customerId],
            )
          )?.id ?? null)
        : null;
    const number = await nextNumber(tx, ctx.tenantId, 'order');
    const status: OrderStatus =
      online && (!online.autoAccept || online.payOnline) ? 'awaiting' : 'new';
    const order = await one<{ id: string }>(
      tx,
      `INSERT INTO orders (tenant_id, number, channel, status, tab_id, customer_name, customer_phone, delivery_address,
                           notes, subtotal, discount, surcharge, delivery_fee, total, created_by,
                           source, public_token_hash, payment_hint, change_for, accepted_at, customer_id,
                           delivery_lat, delivery_lng, pix_status, pay_online)
       VALUES ($1,$2,$3,$15,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16,$17,$18,$19,
               CASE WHEN $15 = 'new' AND $16 = 'online' THEN now() END, $20, $21, $22, $23, $24) RETURNING id`,
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
        online?.customerId ?? staffCustomerId,
        input.deliveryLocation?.lat.toFixed(6) ?? null,
        input.deliveryLocation?.lng.toFixed(6) ?? null,
        online?.pix ? 'waiting' : null,
        online?.payOnline ?? null,
      ],
    );
    if (reward)
      await this.loyalty.recordRedeemIn(
        tx,
        ctx.tenantId,
        input.online!.customerId!,
        order!.id,
        reward,
      );
    await this.insertLines(tx, ctx, order!.id, lines);
    await this.history(tx, ctx, order!.id, null, status);
    // Baixa de insumos pela ficha técnica (trava os insumos por último). Pedido em análise também
    // baixa: o estoque fica reservado para ele (dois clientes não levam o último item) e volta se a
    // loja recusar. A cozinha só recebe quando for aceito.
    fx.stock = await this.stock.consumeForOrder(tx, ctx, order!.id);
    if (status === 'new') fx.print = await this.printing.enqueueKitchenTickets(tx, ctx, order!.id);
    // Pedido online com aceite automático: o cliente já recebe o "pedido aceito".
    if (online && status === 'new')
      await this.messaging.stage(tx, ctx.tenantId, order!.id, 'order.accepted');
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

  /**
   * Pedido de aplicativo de delivery (entrada única: ExternalOrdersService.ingest). O preço é o que
   * o aplicativo cobrou (exceção documentada ao "preço vem do banco", ADR 0015) e o pedido nunca é
   * recusado: sem limite do plano, sem conferir estoque ou cardápio (o cliente já pagou ou pediu
   * no aplicativo). Reaproveita o número, o histórico, a baixa de estoque, a cozinha e a auditoria.
   */
  async createExternalInTx(tx: Tx, ctx: Ctx, input: ExternalOrderInput) {
    const number = await nextNumber(tx, ctx.tenantId, 'order');
    const order = await one<{ id: string }>(
      tx,
      `INSERT INTO orders (tenant_id, number, channel, status, customer_name, customer_phone,
                           delivery_address, notes, subtotal, discount, surcharge, delivery_fee, total,
                           created_by, source, payment_hint, change_for, accepted_at, delivery_lat,
                           delivery_lng, tax_document, app_channel, external_code, delivered_by,
                           scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,'app',$14,$15,
               CASE WHEN $4 = 'new' THEN now() END,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        ctx.tenantId,
        number,
        input.channel,
        input.status,
        input.customerName,
        input.customerPhone,
        input.deliveryAddress,
        input.notes,
        input.subtotal,
        input.discount,
        input.surcharge,
        input.deliveryFee,
        input.total,
        input.paymentHint,
        input.changeFor,
        input.deliveryLocation?.lat.toFixed(6) ?? null,
        input.deliveryLocation?.lng.toFixed(6) ?? null,
        input.taxDocument,
        input.appChannel,
        input.externalCode,
        input.deliveredBy,
        input.scheduledFor,
      ],
    );
    const orderId = order!.id;
    const itemIds: string[] = [];
    for (const l of input.lines) {
      const item = await one<{ id: string }>(
        tx,
        `INSERT INTO order_items (tenant_id, order_id, product_id, name, quantity, unit_price, total, notes, sector_id, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          ctx.tenantId,
          orderId,
          l.productId,
          l.name,
          l.quantity,
          l.unitPrice,
          l.total,
          l.notes,
          l.sectorId,
          l.unit,
        ],
      );
      for (const o of l.options)
        await q(
          tx,
          `INSERT INTO order_item_options (tenant_id, order_item_id, option_id, name, price_delta) VALUES ($1,$2,$3,$4,$5)`,
          [ctx.tenantId, item!.id, o.optionId, o.name, o.priceDelta],
        );
      itemIds.push(item!.id);
    }
    await this.history(
      tx,
      ctx,
      orderId,
      null,
      input.status,
      `Pedido do aplicativo ${input.externalCode}`,
    );
    const appPaid = input.appPayment ? toCents(input.appPayment.amount) : 0;
    if (input.appPayment && appPaid > 0) {
      // Pago no aplicativo: sem sessão nem movimento de caixa (não é dinheiro da gaveta).
      const paidCents = Math.min(appPaid, toCents(input.total));
      await q(
        tx,
        `INSERT INTO payments (tenant_id, order_id, cash_session_id, method, amount, created_by,
                               app_channel, app_method, app_brand)
         VALUES ($1, $2, NULL, 'app', $3, NULL, $4, $5, $6)`,
        [
          ctx.tenantId,
          orderId,
          fromCents(paidCents),
          input.appChannel,
          input.appPayment.method,
          input.appPayment.brand?.slice(0, 40) || null,
        ],
      );
      await q(tx, `UPDATE orders SET paid_amount = $2, payment_status = $3 WHERE id = $1`, [
        orderId,
        fromCents(paidCents),
        paymentStatusFor(toCents(input.total), paidCents),
      ]);
    }
    const fx = { stock: 0, print: 0 };
    fx.stock = await this.consumeAppStockIn(tx, ctx, { id: orderId, number });
    if (input.status === 'new')
      fx.print = await this.printing.enqueueKitchenTickets(tx, ctx, orderId);
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: null,
      action: 'order.created',
      entity: 'order',
      entityId: orderId,
      data: {
        number,
        channel: input.channel,
        total: input.total,
        discount: input.discount,
        source: 'app',
        app: input.appChannel,
      },
      ip: ctx.ip,
    });
    return { id: orderId, number, itemIds, fx };
  }

  /**
   * Baixa de estoque do pedido de aplicativo. O pedido nunca é recusado por estoque (o cliente já
   * pediu e pagou no aplicativo): faltando insumo, a baixa volta inteira (SAVEPOINT, nada pela
   * metade), o pedido segue sem ela e os gerentes recebem o aviso para conferir o estoque.
   */
  private async consumeAppStockIn(tx: Tx, ctx: Ctx, o: { id: string; number: number }) {
    await q(tx, `SAVEPOINT app_stock`);
    try {
      const n = await this.stock.consumeForOrder(tx, ctx, o.id);
      await q(tx, `RELEASE SAVEPOINT app_stock`);
      return n;
    } catch (e) {
      const res = e instanceof ConflictException ? (e.getResponse() as { code?: string }) : null;
      if (res?.code !== 'stock_out') throw e;
      await q(tx, `ROLLBACK TO SAVEPOINT app_stock`);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.stock_short',
        entity: 'order',
        entityId: o.id,
        data: { number: o.number, message: (e as Error).message },
        ip: ctx.ip,
      });
      const users = await this.noticeTeamIn(
        tx,
        ctx.tenantId,
        ['owner', 'manager'],
        `Pedido #${o.number} do aplicativo entrou sem baixa no estoque`,
        `${(e as Error).message} O pedido seguiu normalmente; confira o estoque.`,
      );
      if (users.length) this.realtime.publishToUsers(ctx.tenantId, users, { type: 'chat.notice' });
      return 0;
    }
  }

  /** Aviso no sino para os perfis indicados. Devolve quem recebeu, para avisar em tempo real. */
  async noticeTeamIn(
    tx: Tx,
    tenantId: string,
    roles: string[],
    title: string,
    body: string,
  ): Promise<string[]> {
    const users = await q<{ id: string }>(
      tx,
      `SELECT user_id AS id FROM memberships WHERE status = 'active' AND role::text = ANY($1)`,
      [roles],
    );
    for (const u of users)
      await q(
        tx,
        `INSERT INTO chat_notices (tenant_id, user_id, kind, title, body, actor_id)
         VALUES ($1, $2, 'system', $3, $4, NULL)`,
        [tenantId, u.id, title.slice(0, 200), body.slice(0, 300)],
      );
    return users.map((u) => u.id);
  }

  /**
   * Pedido de aplicativo cancelado: o valor pago dentro do aplicativo volta ao cliente pelo próprio
   * aplicativo. Zera esses pagamentos (refunded_amount = amount), sem estorno no caixa.
   */
  async voidAppPaymentsInTx(tx: Tx, ctx: Ctx, o: OrderRow) {
    await q(
      tx,
      `UPDATE payments SET refunded_amount = amount
        WHERE order_id = $1 AND method = 'app' AND refunded_amount < amount`,
      [o.id],
    );
    return this.refreshPaidInTx(tx, ctx, o);
  }

  /** Recalcula o pago do pedido a partir dos pagamentos (depois de zerar os do aplicativo). */
  private async refreshPaidInTx(tx: Tx, ctx: Ctx, o: OrderRow) {
    const r = await one<{ paid: string }>(
      tx,
      `SELECT COALESCE(sum(amount - refunded_amount), 0)::text AS paid FROM payments WHERE order_id = $1`,
      [o.id],
    );
    const paid = toCents(r!.paid);
    if (paid === toCents(o.paid_amount)) return;
    const status = paymentStatusFor(toCents(o.total), paid);
    await q(tx, `UPDATE orders SET paid_amount = $2, payment_status = $3 WHERE id = $1`, [
      o.id,
      fromCents(paid),
      status,
    ]);
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'payment.app_voided',
      entity: 'order',
      entityId: o.id,
      data: { number: o.number, before: o.paid_amount, after: fromCents(paid) },
      ip: ctx.ip,
    });
    o.paid_amount = fromCents(paid);
    o.payment_status = status;
  }

  /** Avisa as telas depois do COMMIT de um pedido que mudou fora de uma rota (aplicativo). */
  publishChanged(
    tenantId: string,
    orderId: string,
    extra: { stock?: boolean; print?: boolean } = {},
  ) {
    if (extra.stock) this.realtime.publish(tenantId, { type: 'stock.changed' });
    if (extra.print) this.realtime.publish(tenantId, { type: 'print.changed' });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId });
  }

  /**
   * Preço e validação dos itens (produto ativo, no cardápio do canal, com estoque, opções válidas).
   * Preço SEMPRE do banco. Usado ao criar o pedido e ao acrescentar itens na edição.
   */
  private async priceLines(
    tx: Tx,
    channel: OrderChannel,
    items: OrderItemInput[],
    online: boolean,
  ) {
    // Produtos e opções vêm do banco (preço oficial). O preço e a disponibilidade são os do
    // cardápio ativo do canal (Principal no balcão/salão, Delivery na entrega/retirada).
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await q<{
      id: string;
      name: string;
      price: string;
      sector_id: string | null;
      active: boolean;
      sold_out: boolean;
      stock_missing: string[];
      sold_by_weight: boolean;
      in_menu: boolean;
      menu_name: string | null;
    }>(
      tx,
      `SELECT p.id, p.name, COALESCE(mi.price, p.price)::text AS price, p.sector_id,
              (p.active AND c.active) AS active, p.sold_out,
              ${PRODUCT_STOCK_MISSING} AS stock_missing, p.sold_by_weight, (m.id IS NULL OR mi.product_id IS NOT NULL) AS in_menu, m.name AS menu_name
         FROM products p
         -- Categoria desligada some do cardápio com os itens dela: também não entra no pedido.
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN menus m ON m.active AND m.kind = $2
         LEFT JOIN menu_items mi ON mi.menu_id = m.id AND mi.product_id = p.id
        WHERE p.id = ANY($1::uuid[])`,
      [productIds, menuKindOf(channel)],
    );
    const pmap = new Map(products.map((p) => [p.id, p]));
    const optionIds = [...new Set(items.flatMap((i) => i.optionIds ?? []))];
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
      charge: ChargeRule;
    }>(
      tx,
      `SELECT pog.product_id, g.id AS group_id, g.name, g.min_select, g.max_select, g.charge
         FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
        WHERE pog.product_id = ANY($1::uuid[]) AND g.active`,
      [productIds],
    );

    let subtotal = 0;
    const lines = items.map((it) => {
      const p = pmap.get(it.productId);
      if (!p || !p.active)
        throw new UnprocessableEntityException(
          'Um dos produtos saiu do cardápio. Atualize a tela e monte o pedido de novo.',
        );
      if (!p.in_menu)
        throw new UnprocessableEntityException(
          `${p.name} não está no ${p.menu_name ?? 'cardápio'}`,
        );
      if (p.sold_out) throw new UnprocessableEntityException(`Produto esgotado: ${p.name}`);
      // Ficha técnica sem estoque para mais uma unidade: não vende (a baixa conferiria de novo).
      if (p.stock_missing.length)
        throw new ConflictException(
          `Estoque insuficiente: ${p.name} está sem estoque (falta ${p.stock_missing.join(', ')}). Dê entrada no estoque para vender.`,
        );
      // Item por peso: a quantidade é o peso em kg (até 3 casas). Os demais vão em unidades inteiras.
      if (p.sold_by_weight) {
        if (!isValidKg(it.quantity, online ? ONLINE_WEIGHT_MAX_G / 1000 : WEIGHT_MAX_KG))
          throw new UnprocessableEntityException(`${p.name}: informe o peso em kg (ex.: 0,350)`);
      } else if (!Number.isInteger(it.quantity)) {
        throw new UnprocessableEntityException(
          `${p.name} é vendido por unidade: a quantidade precisa ser inteira`,
        );
      }
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
      // Regra de cobrança de cada grupo (soma, maior valor, média): cada opção guarda o que cobrou.
      const charged = groups.flatMap((g) => {
        const mine = chosen.filter((o) => o.group_id === g.group_id);
        const cents = groupOptionCharges(
          g.charge,
          mine.map((o) => toCents(o.price_delta)),
        );
        return mine.map((o, i) => ({ ...o, price_delta: fromCents(cents[i]!) }));
      });
      const unit = toCents(p.price) + charged.reduce((s, o) => s + toCents(o.price_delta), 0);
      const total = multiplyCents(unit, it.quantity);
      subtotal += total;
      return { p, it, chosen: charged, unit, total };
    });

    return { lines, subtotal };
  }

  private async insertLines(
    tx: Tx,
    ctx: Ctx,
    orderId: string,
    lines: Awaited<ReturnType<OrdersService['priceLines']>>['lines'],
  ) {
    const ids: string[] = [];
    for (const l of lines) {
      const item = await one<{ id: string }>(
        tx,
        `INSERT INTO order_items (tenant_id, order_id, product_id, name, quantity, unit_price, total, notes, sector_id, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          ctx.tenantId,
          orderId,
          l.p.id,
          l.p.name,
          l.it.quantity,
          fromCents(l.unit),
          fromCents(l.total),
          l.it.notes ?? null,
          l.p.sector_id,
          l.p.sold_by_weight ? 'kg' : 'un',
        ],
      );
      for (const o of l.chosen) {
        await q(
          tx,
          `INSERT INTO order_item_options (tenant_id, order_item_id, option_id, name, price_delta) VALUES ($1,$2,$3,$4,$5)`,
          [ctx.tenantId, item!.id, o.id, o.name, o.price_delta],
        );
      }
      ids.push(item!.id);
    }
    return ids;
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
    // A comanda nasce com a taxa de serviço configurada no salão (o caixa pode tirar depois).
    const tab = await one<{ id: string; number: number }>(
      tx,
      `INSERT INTO tabs (tenant_id, number, table_id, customer_name, opened_by, service_fee_percent)
       VALUES ($1,$2,$3,$4,$5,
               (SELECT NULLIF(service_fee_percent, 0) FROM salon_settings WHERE tenant_id = $1))
       RETURNING id, number`,
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
    // A nota da comanda cobre todos os pedidos dela.
    const doc = await one<{ status: string }>(
      tx,
      `SELECT status FROM fiscal_documents
        WHERE (order_id = $1 OR tab_id = (SELECT tab_id FROM orders WHERE id = $1))
          AND status IN ('pending','processing','authorized','cancelling') LIMIT 1`,
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
              delivery_fee::text, paid_amount::text, payment_status, tab_id, version, source,
              app_channel
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
  async transitionInTx(
    tx: Tx,
    ctx: Ctx,
    o: OrderRow,
    to: OrderStatus,
    reason?: string,
    extra: TransitionExtra = {},
  ) {
    if (o.status === to) return;
    if (!canTransition(o.status, to, o.channel)) {
      throw new ConflictException(`Transição inválida: ${o.status} → ${to}`);
    }
    // Concluir com saldo: só a entrega (vai para o acerto do entregador) ou "a receber" pelo gerente.
    const balance = toCents(o.total) - toCents(o.paid_amount);
    // Pedido de aplicativo: concluído pelo canal ou pago no aplicativo, quem acerta é o repasse.
    const settledByChannel =
      o.source === 'app' &&
      (extra.fromChannel ||
        !!(await one(tx, `SELECT 1 FROM channel_orders WHERE order_id = $1 AND prepaid`, [o.id])));
    if (to === 'completed' && balance > 0 && o.status !== 'dispatched' && !settledByChannel) {
      // Fiado marcado (por quem pode dar fiado): conclui como "a receber" sem pedir de novo.
      const fiado = await one<{ fiado_name: string }>(
        tx,
        `SELECT fiado_name FROM orders WHERE id = $1 AND fiado_at IS NOT NULL`,
        [o.id],
      );
      if (fiado && !extra.receivable) {
        extra = { ...extra, receivable: true };
        reason = reason || `Fiado: ${fiado.fiado_name}`;
      }
      if (!extra.receivable)
        throw new ConflictException(
          'Pedido com saldo a pagar: receba antes de concluir, ou conclua como "a receber"',
        );
      if (!fiado && !roleHas(ctx.user.role, 'orders:cancel'))
        throw new ForbiddenException('Concluir sem pagamento ("a receber") exige o gerente');
      if (!reason) throw new UnprocessableEntityException('Informe o motivo do "a receber"');
      await q(
        tx,
        `UPDATE orders SET receivable_at = now(), receivable_by = $2, receivable_reason = $3 WHERE id = $1`,
        [o.id, ctx.userId, reason],
      );
    }
    // Recusar um pedido em análise não exige gerente: nada foi produzido, cobrado ou baixado.
    const rejecting = o.status === 'awaiting' && to === 'cancelled';
    if (to === 'cancelled') {
      // Aplicativo: depois de aceito, o cancelamento é pedido ao aplicativo ("Cancelamento
      // solicitado") e só vale quando ele confirmar. Cancelar direto deixaria o cliente sem saber.
      if (o.source === 'app' && !rejecting && !extra.fromChannel)
        throw new ConflictException(
          'Pedido de aplicativo: peça o cancelamento ao aplicativo (o pedido fica "Cancelamento solicitado" até ele confirmar)',
        );
      await this.assertNoLiveFiscalDocument(tx, o.id, 'cancelar o pedido');
      if (!rejecting && !extra.fromChannel && !roleHas(ctx.user.role, 'orders:cancel'))
        throw new ForbiddenException('Cancelamento exige autorização');
      // Pago no aplicativo: o aplicativo devolve ao cliente; aqui só some o pago.
      if (o.source === 'app') await this.voidAppPaymentsInTx(tx, ctx, o);
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
      // Insumos voltam ao estoque (movimento de estorno; nada é apagado). Na recusa, devolve a reserva.
      await this.stock.restoreForOrder(tx, ctx, o.id);
    }
    if (o.status === 'awaiting' && to === 'new') {
      // Pago pelo app: só vai para a cozinha depois de pago.
      const unpaid = await one(
        tx,
        `SELECT 1 FROM orders o WHERE o.id = $1 AND o.pay_online IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM online_charges c WHERE c.order_id = o.id AND c.status = 'paid')`,
        [o.id],
      );
      if (unpaid)
        throw new ConflictException('Este pedido é pago pelo app e o cliente ainda não pagou');
      // Aceite do pedido online: imprime na cozinha. O estoque já foi reservado ao criar (pedido
      // antigo, de antes da reserva, baixa agora: consumeForOrder não baixa duas vezes).
      await q(tx, `UPDATE orders SET accepted_at = now() WHERE id = $1`, [o.id]);
      if (o.source === 'app') await this.consumeAppStockIn(tx, ctx, o);
      else await this.stock.consumeForOrder(tx, ctx, o.id);
      await this.printing.enqueueKitchenTickets(tx, ctx, o.id);
    }
    if (o.status === 'dispatched') {
      // Saindo de "saiu para entrega": encerra a entrega em andamento e encurta o link de rastreio.
      // O ganho do entregador na corrida fica gravado agora, pela regra vigente.
      // Entregue com saldo: o valor fica com o entregador até o acerto no caixa.
      const collect = to === 'completed' && balance > 0;
      const ended = await q<{ id: string }>(
        tx,
        `UPDATE deliveries SET status = $2, finished_at = now(), failure_reason = $3,
                tracking_expires_at = LEAST(tracking_expires_at, now() + interval '30 minutes'),
                collect_status = CASE WHEN $4 THEN 'pending' ELSE collect_status END,
                collect_amount = CASE WHEN $4 THEN $5::numeric END,
                collect_method = CASE WHEN $4 THEN COALESCE($6, (SELECT payment_hint FROM orders WHERE id = $1)) END
          WHERE order_id = $1 AND status = 'out' RETURNING id`,
        [
          o.id,
          to === 'completed' ? 'delivered' : 'failed',
          to === 'completed' ? null : (reason ?? null),
          collect,
          fromCents(Math.max(balance, 0)),
          extra.collectMethod ?? null,
        ],
      );
      for (const d of ended)
        await settleRide(tx, d.id, to === 'completed' ? 'delivered' : 'failed');
    }
    if (to === 'ready') {
      await q(
        tx,
        `UPDATE order_items SET status = 'ready', ready_at = now() WHERE order_id = $1 AND status IN ('pending','preparing')`,
        [o.id],
      );
    }
    // Voltou para a cozinha (item novo ou reaberto): o pedido de mesa precisa ser levado de novo.
    await q(
      tx,
      `UPDATE orders SET status = $2, version = version + 1,
              cancel_reason = CASE WHEN $2 IN ('cancelled','cancel_requested') THEN COALESCE($3, cancel_reason) ELSE cancel_reason END,
              served_at = CASE WHEN $2 IN ('new','in_production') THEN NULL ELSE served_at END,
              served_by = CASE WHEN $2 IN ('new','in_production') THEN NULL ELSE served_by END
        WHERE id = $1`,
      [o.id, to, reason || null],
    );
    await this.history(tx, ctx, o.id, o.status, to, reason);
    if (to === 'cancelled') {
      await this.pixRefundDueIn(tx, ctx, o.id);
      for (const h of this.cancelHooks) await h(tx, ctx, o.id);
    }
    // Fidelidade: pedido concluído rende pontos; cancelado devolve os pontos trocados nele.
    if (to === 'completed') await this.loyalty.earnForOrderIn(tx, ctx.tenantId, o.id);
    if (to === 'cancelled') await this.loyalty.refundForOrderIn(tx, ctx.tenantId, o.id);
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
    // O próprio cliente cancelando pelo cardápio (sem usuário da equipe) não recebe aviso.
    // Pedido de aplicativo: quem avisa o cliente é o próprio aplicativo.
    const event = o.source === 'app' ? null : statusEvent(o.status, to, o.channel);
    if (event && (event !== 'order.cancelled' || ctx.userId))
      await this.messaging.stage(tx, ctx.tenantId, o.id, event);
    for (const h of this.transitionHooks) await h(tx, ctx, o, o.status, to, extra);
    o.status = to;
    o.version += 1;
  }

  /**
   * Pedido cancelado com o comprovante do Pix esperando conferência: o cliente pode já ter pago e
   * nada entrou no caixa. Fica "Pix a devolver" até a equipe dizer que devolveu ou que o Pix não
   * chegou (com o Pix já aprovado, o cancelamento exige o estorno antes).
   */
  private async pixRefundDueIn(tx: Tx, ctx: Ctx, orderId: string) {
    const due = await one<{ id: string; amount: string }>(
      tx,
      `WITH o AS (
         UPDATE orders SET pix_status = 'refund_due'
          WHERE id = $1 AND pix_status = 'submitted' RETURNING id)
       SELECT r.id, r.amount::text FROM pix_receipts r JOIN o ON o.id = r.order_id
        WHERE r.status = 'submitted' ORDER BY r.created_at DESC LIMIT 1`,
      [orderId],
    );
    if (!due) return;
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'order.pix_refund_due',
      entity: 'order',
      entityId: orderId,
      data: { receiptId: due.id, amount: due.amount },
      ip: ctx.ip,
    });
  }

  /**
   * Pedido de mesa chegou na mesa: o garçom tocou "Entreguei" (ou o cliente, que busca no balcão,
   * "Já peguei"). A equipe pode marcar o que a cozinha esqueceu de dar pronto (fica pronto junto).
   * Pago, o pedido conclui na hora; a comanda paga pelo Pix do cardápio sem mais nada em aberto
   * fecha sozinha e a mesa fica livre.
   */
  async markServed(ctx: Ctx, id: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      await this.lockTabOf(tx, id);
      const o = await this.lock(tx, id);
      if (o.channel !== 'table')
        throw new ConflictException('Só pedidos de mesa são entregues na mesa');
      const served = await one<{ at: Date | null }>(
        tx,
        `SELECT served_at AS at FROM orders WHERE id = $1`,
        [id],
      );
      // Toque repetido (ou dois garçons ao mesmo tempo): já está entregue.
      if (served?.at || o.status === 'completed')
        return { order: await this.detail(tx, id), settled: NOT_SETTLED, changed: false };
      const staff = ctx.userId !== null;
      // Quem gere os pedidos (não o garçom) pode marcar o que a cozinha não deu como pronto.
      const force = staff && !ordersLimitedToOwn(ctx.user.role);
      if (force && (o.status === 'new' || o.status === 'in_production')) {
        await this.transitionInTx(tx, ctx, o, 'ready', 'Entregue na mesa');
        o.status = 'ready';
        o.version += 1;
      }
      if (o.status !== 'ready')
        throw new ConflictException(
          o.status === 'cancelled'
            ? `Pedido #${o.number} está cancelado`
            : o.status === 'awaiting'
              ? `Pedido #${o.number} ainda não foi aceito`
              : `Pedido #${o.number} ainda está em preparo`,
        );
      await q(
        tx,
        `UPDATE orders SET served_at = now(), served_by = $2, version = version + 1 WHERE id = $1`,
        [id, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.served',
        entity: 'order',
        entityId: id,
        data: { number: o.number, by: staff ? 'staff' : 'customer' },
        ip: ctx.ip,
      });
      const settled = await this.settleServedIn(tx, ctx, id);
      return { order: await this.detail(tx, id), settled, changed: true };
    });
    if (res.changed) this.publishSettled(ctx, id, res.order?.tabId ?? null, res.settled);
    return res.order;
  }

  /** Trava a comanda do pedido antes dele (a mesma ordem da comanda: comanda → pedidos). */
  async lockTabOf(tx: Tx, orderId: string) {
    await q(
      tx,
      `SELECT 1 FROM tabs WHERE id = (SELECT tab_id FROM orders WHERE id = $1) FOR UPDATE`,
      [orderId],
    );
  }

  /**
   * Pedido de mesa entregue e pago (na entrega ou quando o Pix é aprovado depois): conclui. Se ele
   * foi pago pelo Pix do cardápio e a comanda ficou sem saldo e sem nada em aberto, a comanda fecha
   * sozinha: o cliente pagou e recebeu, a mesa fica livre (pedir de novo abre outra).
   * Quem chama já travou a comanda e o pedido (lockTabOf + lock).
   */
  async settleServedIn(tx: Tx, ctx: Ctx, orderId: string): Promise<Settled> {
    const o = await one<OrderRow & { served_at: Date | null; pix_status: string | null }>(
      tx,
      `SELECT id, number, channel, status, total::text, subtotal::text, discount::text, surcharge::text,
              delivery_fee::text, paid_amount::text, payment_status, tab_id, version, served_at, pix_status
         FROM orders WHERE id = $1`,
      [orderId],
    );
    if (!o || o.channel !== 'table' || o.status !== 'ready' || !o.served_at) return NOT_SETTLED;
    if (toCents(o.paid_amount) < toCents(o.total)) return NOT_SETTLED;
    await this.transitionInTx(tx, ctx, o, 'completed', 'Entregue na mesa');
    if (!o.tab_id || o.pix_status !== 'approved') return { completed: true, closedTabId: null };
    const left = await one<{ open: number; due: string; number: number }>(
      tx,
      `SELECT count(o.id) FILTER (WHERE o.status NOT IN ('completed','cancelled'))::int AS open,
              COALESCE(sum(o.total - o.paid_amount)
                FILTER (WHERE o.status <> 'cancelled' AND NOT ${ON_ACCOUNT_SQL}), 0)::text AS due,
              tb.number
         FROM tabs tb LEFT JOIN orders o ON o.tab_id = tb.id
        WHERE tb.id = $1 AND tb.status = 'open'
        GROUP BY tb.id`,
      [o.tab_id],
    );
    if (!left || left.open > 0 || toCents(left.due) > 0)
      return { completed: true, closedTabId: null };
    await q(
      tx,
      `UPDATE tabs SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`,
      [o.tab_id, ctx.userId],
    );
    const reservationIds = await completeSeatedForTab(tx, o.tab_id);
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'tab.closed',
      entity: 'tab',
      entityId: o.tab_id,
      data: { number: left.number, auto: 'pix_paid_and_served' },
      ip: ctx.ip,
    });
    return { completed: true, closedTabId: o.tab_id, reservationIds };
  }

  /** Avisos depois do COMMIT de markServed/settleServedIn. */
  publishSettled(ctx: Ctx, orderId: string, tabId: string | null, settled: Settled) {
    this.realtime.publish(ctx.tenantId, {
      type: 'order.changed',
      orderId,
      ...(settled.completed ? { status: 'completed' as const } : {}),
    });
    if (tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId });
    if (settled.closedTabId) this.notifyTabClosed(ctx, settled.closedTabId);
    this.publishReservations(ctx, settled.reservationIds);
  }

  /** A comanda fechou e levou a reserva junto: a tela de Reservas atualiza o cartão na hora. */
  publishReservations(ctx: Ctx, ids: string[] | undefined) {
    for (const reservationId of ids ?? [])
      this.realtime.publish(ctx.tenantId, { type: 'reservation.changed', reservationId });
  }

  async transition(
    ctx: Ctx,
    id: string,
    to: OrderStatus,
    opts: {
      reason?: string;
      expectedVersion?: number;
      receivable?: boolean;
      channelReason?: string;
    },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      // "Saiu para entrega" sempre registra o entregador (e o link de rastreio): POST /orders/:id/dispatch.
      if (to === 'dispatched' && o.channel === 'delivery')
        throw new ConflictException('Para despachar, escolha o entregador na tela Entregas');
      if (opts.expectedVersion !== undefined && opts.expectedVersion !== o.version) {
        throw new ConflictException('O pedido foi alterado por outra pessoa; atualize a tela');
      }
      // Recusar pedido online em análise: o cliente vê o motivo no acompanhamento.
      if (to === 'cancelled' && o.status === 'awaiting' && !opts.reason?.trim())
        throw new UnprocessableEntityException('Informe o motivo da recusa (o cliente vê)');
      await this.transitionInTx(tx, ctx, o, to, opts.reason, {
        receivable: opts.receivable,
        ...(opts.channelReason ? { channelReason: opts.channelReason } : {}),
      });
      return this.detail(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: id, status: to });
    if (to === 'cancelled' || to === 'new')
      this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    if (to === 'new') this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    if (res?.tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res.tabId });
    return res;
  }

  /** Desconto/acréscimo/frete após a criação. Não pode deixar o total abaixo do já pago. */
  async adjust(
    ctx: Ctx,
    id: string,
    b: { discount?: string; surcharge?: string; deliveryFee?: string; reason: string },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, id);
      if (o.status === 'completed' || o.status === 'cancelled')
        throw new ConflictException('Pedido encerrado');
      assertNotAppOrder(o, 'mudar valores');
      await this.assertNoLiveFiscalDocument(tx, o.id, 'mudar o valor');
      const subtotal = toCents(o.subtotal);
      const discount = b.discount !== undefined ? toCents(b.discount) : toCents(o.discount);
      // Comanda com taxa de serviço: mudar o desconto refaz a taxa (se o acréscimo não veio junto).
      const fee =
        b.surcharge === undefined && o.tab_id
          ? (
              await one<{ p: string | null }>(
                tx,
                `SELECT service_fee_percent::text AS p FROM tabs WHERE id = $1`,
                [o.tab_id],
              )
            )?.p
          : null;
      // Retirada não tem taxa de serviço nem frete: o ajuste zera os dois.
      const pickup = o.channel === 'pickup';
      const surcharge = pickup
        ? 0
        : b.surcharge !== undefined
          ? toCents(b.surcharge)
          : fee
            ? serviceFeeCents(subtotal - discount, fee)
            : toCents(o.surcharge);
      this.checkDiscount(ctx, discount, subtotal);
      const deliveryFee = pickup
        ? 0
        : b.deliveryFee !== undefined
          ? toCents(b.deliveryFee)
          : toCents(o.delivery_fee);
      const total = subtotal - discount + surcharge + deliveryFee;
      const paid = toCents(o.paid_amount);
      if (total < paid) throw new ConflictException('Novo total ficaria menor que o valor já pago');
      await q(
        tx,
        `UPDATE orders SET discount = $2, surcharge = $3, delivery_fee = $4, total = $5, payment_status = $6,
                version = version + 1 WHERE id = $1`,
        [
          id,
          fromCents(discount),
          fromCents(surcharge),
          fromCents(deliveryFee),
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
          from: { discount: o.discount, surcharge: o.surcharge, deliveryFee: o.delivery_fee },
          to: {
            discount: fromCents(discount),
            surcharge: fromCents(surcharge),
            deliveryFee: fromCents(deliveryFee),
          },
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
   * Cancela UM item do pedido (pedido errado, item que acabou, cliente desistiu). Exige
   * `orders:cancel` e motivo; refaz subtotal e total (e a taxa de serviço da comanda), devolve
   * o estoque do item e avisa o setor que produz. Não pode deixar o total abaixo do já pago
   * nem mexer em pedido com NFC-e viva. O último item se cancela cancelando o pedido.
   */
  async cancelItem(ctx: Ctx, orderId: string, itemId: string, reason?: string) {
    if (!roleHas(ctx.user.role, 'orders:cancel'))
      throw new ForbiddenException('Cancelar item exige autorização do gerente');
    const fx = { stock: 0, print: 0 };
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, orderId);
      if (o.status === 'completed' || o.status === 'cancelled')
        throw new ConflictException('Pedido encerrado: não dá para cancelar item');
      assertNotAppOrder(o, 'cancelar um item');
      await this.assertNoLiveFiscalDocument(tx, o.id, 'cancelar um item');
      const item = await one<{ name: string; status: string; total: string }>(
        tx,
        `SELECT name, status, total::text FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [itemId, o.id],
      );
      if (!item) throw new NotFoundException('Item não encontrado neste pedido');
      if (item.status === 'cancelled') throw new ConflictException('Item já cancelado');
      const others = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND id <> $2 AND status <> 'cancelled'`,
        [o.id, itemId],
      );
      if (!others!.n)
        throw new ConflictException('É o último item do pedido: cancele o pedido inteiro');
      const subtotal = toCents(o.subtotal) - toCents(item.total);
      const discount = toCents(o.discount);
      if (discount > subtotal)
        throw new ConflictException(
          'O desconto ficaria maior que o pedido: ajuste o desconto antes de cancelar o item',
        );
      const tab = o.tab_id
        ? await one<{ service_fee_percent: string | null }>(
            tx,
            `SELECT service_fee_percent::text FROM tabs WHERE id = $1`,
            [o.tab_id],
          )
        : null;
      const surcharge = tab?.service_fee_percent
        ? serviceFeeCents(subtotal - discount, tab.service_fee_percent)
        : toCents(o.surcharge);
      const total = subtotal - discount + surcharge + toCents(o.delivery_fee);
      const paid = toCents(o.paid_amount);
      if (total < paid)
        throw new ConflictException(
          'O pedido já tem pagamento acima do novo total: estorne a diferença antes de cancelar o item',
        );
      await q(
        tx,
        `UPDATE order_items SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now()
          WHERE id = $1`,
        [itemId, reason || null, ctx.userId],
      );
      await q(
        tx,
        `UPDATE orders SET subtotal = $2, surcharge = $3, total = $4, payment_status = $5,
                version = version + 1 WHERE id = $1`,
        [
          o.id,
          fromCents(subtotal),
          fromCents(surcharge),
          fromCents(total),
          paymentStatusFor(total, paid),
        ],
      );
      fx.stock = await this.stock.restoreForItem(tx, ctx, o.id, itemId);
      if (o.status !== 'awaiting') {
        fx.print = await this.printing.enqueueItemCancel(tx, ctx, o.id, itemId, reason);
      }
      // Sobrou só item pronto: o pedido fica pronto (a cozinha não espera o que saiu).
      if (o.status === 'in_production' || o.status === 'new') {
        const pending = await one<{ n: number }>(
          tx,
          `SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND status IN ('pending','preparing')`,
          [o.id],
        );
        if (!pending!.n) {
          o.version += 1;
          await this.transitionInTx(tx, ctx, o, 'ready', 'Itens restantes prontos');
        }
      }
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.item_cancelled',
        entity: 'order',
        entityId: o.id,
        data: {
          itemId,
          name: item.name,
          total: item.total,
          reason,
          newTotal: fromCents(total),
        },
        ip: ctx.ip,
      });
      return this.detail(tx, o.id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    this.realtime.publish(ctx.tenantId, { type: 'kitchen.changed', orderId });
    if (fx.stock) this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    if (fx.print) this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    if (res?.tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res.tabId });
    return res;
  }

  /**
   * Edita um pedido já lançado: acrescenta itens, muda quantidade e observação dos itens,
   * tira itens (cancela) e troca a observação do pedido, tudo numa transação só.
   *  - Acrescentar, aumentar e mudar observação: `orders:manage`. Tirar e diminuir: `orders:cancel`
   *    (a mesma regra de cancelar item).
   *  - Item que a cozinha já começou não muda no lugar: aumentar vira uma linha nova com a
   *    diferença (a cozinha faz só o que falta); por peso o peso é corrigido no lugar.
   *  - Estoque acompanha (devolve o que saiu, baixa o que entrou) e a cozinha recebe o aviso.
   *  - Refaz subtotal, taxa de serviço e total; não deixa o total abaixo do já pago, nem mexe em
   *    pedido com NFC-e viva ou já encerrado.
   */
  async editItems(
    ctx: Ctx,
    orderId: string,
    b: {
      expectedVersion?: number;
      add?: OrderItemInput[];
      change?: { itemId: string; quantity?: number; notes?: string | null }[];
      remove?: string[];
      notes?: string | null;
      reason?: string;
    },
  ) {
    const add = b.add ?? [];
    const change = b.change ?? [];
    const remove = [...new Set(b.remove ?? [])];
    if (!add.length && !change.length && !remove.length && b.notes === undefined)
      throw new UnprocessableEntityException('Nada para alterar');
    const fx = { stock: 0, print: 0 };
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.lock(tx, orderId);
      if (b.expectedVersion !== undefined && b.expectedVersion !== o.version)
        throw new ConflictException(
          'O pedido mudou enquanto você editava. Confira e tente de novo.',
        );
      // Pedido de aplicativo: a observação interna pode; itens e valores mandam no aplicativo.
      if (add.length || change.length || remove.length) assertNotAppOrder(o, 'mudar os itens');
      if (!['new', 'in_production', 'ready'].includes(o.status))
        throw new ConflictException(
          o.status === 'awaiting'
            ? 'Aceite o pedido antes de editar'
            : o.status === 'dispatched'
              ? 'O pedido já saiu para entrega'
              : 'Este pedido não pode mais ser editado',
        );
      await this.assertNoLiveFiscalDocument(tx, o.id, 'editar o pedido');
      const kitchen = o.status !== 'awaiting';
      const cur = await q<{
        id: string;
        product_id: string;
        name: string;
        quantity: string;
        unit: string;
        unit_price: string;
        notes: string | null;
        status: string;
        sector_id: string | null;
      }>(
        tx,
        `SELECT id, product_id, name, quantity::text, unit, unit_price::text, notes, status, sector_id
           FROM order_items WHERE order_id = $1 AND status <> 'cancelled' ORDER BY id FOR UPDATE`,
        [o.id],
      );
      const byId = new Map(cur.map((i) => [i.id, i]));
      const needCancel = () => {
        if (!roleHas(ctx.user.role, 'orders:cancel'))
          throw new ForbiddenException('Tirar ou diminuir item exige autorização do gerente');
      };
      const log: Record<string, unknown>[] = [];

      // 1) Tirar itens.
      for (const id of remove) {
        const it = byId.get(id);
        if (!it) throw new NotFoundException('Item não encontrado neste pedido');
        needCancel();
        await q(
          tx,
          `UPDATE order_items SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now()
            WHERE id = $1`,
          [id, b.reason || 'Pedido editado', ctx.userId],
        );
        fx.stock += await this.stock.restoreForItem(tx, ctx, o.id, id);
        if (kitchen && it.status !== 'ready')
          fx.print += await this.printing.enqueueItemCancel(tx, ctx, o.id, id, b.reason);
        log.push({ removed: id, name: it.name, quantity: it.quantity });
      }

      // 2) Quantidade e observação.
      const newIds: string[] = [];
      for (const c of change) {
        if (remove.includes(c.itemId)) continue;
        const it = byId.get(c.itemId);
        if (!it) throw new NotFoundException('Item não encontrado neste pedido');
        const kg = it.unit === 'kg';
        const from = Number(it.quantity);
        const to = c.quantity ?? from;
        if (kg ? !isValidKg(to, WEIGHT_MAX_KG) : !Number.isInteger(to) || to < 1)
          throw new UnprocessableEntityException(
            kg
              ? `${it.name}: informe o peso em kg (ex.: 0,350)`
              : `${it.name}: quantidade inválida`,
          );
        const notes = c.notes === undefined ? it.notes : c.notes?.trim() || null;
        if (to === from && notes === it.notes) continue;
        if (to < from) needCancel();
        const unit = toCents(it.unit_price);
        const started = it.status !== 'pending';
        if (!kg && started && to > from) {
          // A cozinha já pegou o item: a diferença vai como um item novo, com as mesmas opções.
          const extra = await one<{ id: string }>(
            tx,
            `INSERT INTO order_items (tenant_id, order_id, product_id, name, quantity, unit_price, total, notes, sector_id, unit)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'un') RETURNING id`,
            [
              ctx.tenantId,
              o.id,
              it.product_id,
              it.name,
              to - from,
              it.unit_price,
              fromCents(multiplyCents(unit, to - from)),
              notes,
              it.sector_id,
            ],
          );
          await q(
            tx,
            `INSERT INTO order_item_options (tenant_id, order_item_id, option_id, name, price_delta)
             SELECT tenant_id, $2, option_id, name, price_delta FROM order_item_options WHERE order_item_id = $1`,
            [it.id, extra!.id],
          );
          newIds.push(extra!.id);
          log.push({ item: it.id, name: it.name, added: to - from });
          continue;
        }
        // No lugar: devolve o que o item baixou e baixa de novo com a quantidade nova.
        if (to !== from)
          fx.stock += await this.stock.restoreForItem(tx, ctx, o.id, it.id, 'Item alterado');
        await q(tx, `UPDATE order_items SET quantity = $2, total = $3, notes = $4 WHERE id = $1`, [
          it.id,
          to,
          fromCents(multiplyCents(unit, to)),
          notes,
        ]);
        if (to !== from) fx.stock += await this.stock.consumeForItems(tx, ctx, o.id, [it.id]);
        if (kitchen && it.status !== 'ready')
          fx.print += await this.printing.enqueueItemChange(tx, ctx, o.id, it.id, {
            kind: 'changed',
            fromQty: it.quantity,
            fromNotes: it.notes,
          });
        log.push({ item: it.id, name: it.name, from: it.quantity, to, notes });
      }

      // 3) Itens novos (preço e regras do cardápio do canal, como num pedido novo).
      if (add.length) {
        const { lines } = await this.priceLines(tx, o.channel, add, false);
        const ids = await this.insertLines(tx, ctx, o.id, lines);
        newIds.push(...ids);
        for (const l of lines) log.push({ added: l.p.name, quantity: l.it.quantity });
      }
      if (newIds.length) {
        fx.stock += await this.stock.consumeForItems(tx, ctx, o.id, newIds);
        if (kitchen)
          for (const id of newIds)
            fx.print += await this.printing.enqueueItemChange(tx, ctx, o.id, id, { kind: 'added' });
      }

      // 4) Observação do pedido.
      if (b.notes !== undefined) {
        const notes = b.notes?.trim() || null;
        await q(tx, `UPDATE orders SET notes = $2 WHERE id = $1`, [o.id, notes]);
        log.push({ orderNotes: notes });
      }

      // 5) Totais.
      const left = await one<{ n: number; sum: string }>(
        tx,
        `SELECT count(*)::int AS n, COALESCE(sum(total), 0)::text AS sum
           FROM order_items WHERE order_id = $1 AND status <> 'cancelled'`,
        [o.id],
      );
      if (!left!.n)
        throw new ConflictException('O pedido ficaria sem itens: para isso, cancele o pedido');
      const subtotal = toCents(left!.sum);
      const discount = toCents(o.discount);
      if (discount > subtotal)
        throw new ConflictException(
          'O desconto ficaria maior que o pedido: ajuste o desconto antes de tirar itens',
        );
      const tab = o.tab_id
        ? await one<{ service_fee_percent: string | null }>(
            tx,
            `SELECT service_fee_percent::text FROM tabs WHERE id = $1`,
            [o.tab_id],
          )
        : null;
      const surcharge = tab?.service_fee_percent
        ? serviceFeeCents(subtotal - discount, tab.service_fee_percent)
        : toCents(o.surcharge);
      const total = subtotal - discount + surcharge + toCents(o.delivery_fee);
      const paid = toCents(o.paid_amount);
      if (total < paid)
        throw new ConflictException(
          'O pedido já tem pagamento acima do novo total: estorne a diferença antes de tirar itens',
        );
      await q(
        tx,
        `UPDATE orders SET subtotal = $2, surcharge = $3, total = $4, payment_status = $5,
                version = version + 1 WHERE id = $1`,
        [
          o.id,
          fromCents(subtotal),
          fromCents(surcharge),
          fromCents(total),
          paymentStatusFor(total, paid),
        ],
      );
      const oldTotal = o.total;
      o.version += 1;
      o.total = fromCents(total);

      // 6) Status: item novo reabre o pedido pronto; sobrou só item pronto, fica pronto.
      const open = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND status IN ('pending','preparing')`,
        [o.id],
      );
      if (open!.n && o.status === 'ready') {
        await this.transitionInTx(tx, ctx, o, 'in_production', 'Itens acrescentados');
      } else if (!open!.n && (o.status === 'new' || o.status === 'in_production')) {
        await this.transitionInTx(tx, ctx, o, 'ready', 'Itens restantes prontos');
      }

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.edited',
        entity: 'order',
        entityId: o.id,
        data: {
          changes: log,
          reason: b.reason ?? null,
          from: oldTotal,
          newTotal: fromCents(total),
        },
        ip: ctx.ip,
      });
      return this.detail(tx, o.id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    this.realtime.publish(ctx.tenantId, { type: 'kitchen.changed', orderId });
    if (fx.stock) this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    if (fx.print) this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    if (res?.tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res.tabId });
    return res;
  }

  /**
   * Move o pedido inteiro para outra comanda aberta (transferência entre mesas/comandas).
   * Ordem de travas: comandas (por id) → pedido, a mesma do pagamento de comanda, evitando deadlock.
   * Garçom só move o que enxerga (pedidos do salão e os que ele lançou): o resto é 404, como na
   * consulta. Delivery e pedido ainda em análise não entram em comanda.
   */
  async moveToTab(ctx: Ctx, id: string, tabId: string) {
    let fromTab: string | null = null;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const p: unknown[] = [id];
      const scope = ownScope(ctx, p);
      const cur = await one<{ tab_id: string | null }>(
        tx,
        `SELECT o.tab_id FROM orders o WHERE o.id = $1${scope ? ` AND ${scope}` : ''}`,
        p,
      );
      if (!cur) throw new NotFoundException('Pedido não encontrado');
      if (cur.tab_id === tabId) throw new ConflictException('O pedido já está nesta comanda');
      const tabIds = [tabId, cur.tab_id].filter((x): x is string => !!x).sort();
      const tabs = await q<{ id: string; status: string; fee: string | null }>(
        tx,
        `SELECT id, status, service_fee_percent::text AS fee FROM tabs
          WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
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
      if (o.channel === 'delivery')
        throw new ConflictException('Pedido de delivery não entra em comanda');
      if (o.status === 'awaiting')
        throw new ConflictException('Aceite o pedido antes de mover para a comanda');
      await this.assertNoLiveFiscalDocument(tx, o.id, 'mover o pedido');
      fromTab = o.tab_id;
      // A taxa de serviço segue a comanda de destino (como a troca de taxa da comanda).
      const fromFee = tabs.find((t) => t.id === o.tab_id)?.fee ?? null;
      const base = toCents(o.subtotal) - toCents(o.discount);
      // Retirada não tem taxa de serviço, em nenhuma comanda.
      const surcharge =
        target.fee !== fromFee && o.channel !== 'pickup'
          ? serviceFeeCents(base, target.fee)
          : toCents(o.surcharge);
      const total = base + surcharge + toCents(o.delivery_fee);
      const paid = toCents(o.paid_amount);
      if (surcharge !== toCents(o.surcharge)) {
        assertNotAppOrder(o, 'mudar valores');
        if (total < paid)
          throw new ConflictException(
            `Pedido #${o.number} já foi pago com a taxa: estorne a diferença antes de mover`,
          );
      }
      await q(
        tx,
        `UPDATE orders SET tab_id = $2, surcharge = $3, total = $4, payment_status = $5,
                version = version + 1 WHERE id = $1`,
        [id, tabId, fromCents(surcharge), fromCents(total), paymentStatusFor(total, paid)],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.moved',
        entity: 'order',
        entityId: id,
        data: { fromTab: o.tab_id, toTab: tabId, surcharge: fromCents(surcharge) },
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
