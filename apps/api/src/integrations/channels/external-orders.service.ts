import { Injectable } from '@nestjs/common';
import {
  comandouTotals,
  fromCents,
  orderChannelOf,
  toCents,
  type ExternalItem,
  type ExternalOrder,
} from '@comandou/shared';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { OrdersService, type ExternalOrderInput } from '../../orders/orders.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ChannelOutboxService } from './channel-outbox.service';
import { channelCtx, type StoreRow } from './channel-stores.service';
import { parseExternalOrder } from './external-order.schema';

const HEX12 = /^(?:CMD|OP)-([0-9a-f]{12})$/i;

/** Chave do item do canal para o vínculo: o código, ou o nome quando o canal não manda código. */
export function itemKeyOf(i: Pick<ExternalItem, 'externalCode' | 'name'>) {
  const code = i.externalCode?.trim();
  return code ? `code:${code.slice(0, 190)}` : `name:${i.name.trim().toLowerCase().slice(0, 190)}`;
}

interface ProductHit {
  id: string;
  name: string;
  sector_id: string | null;
  menu_price: string;
  code: string | null;
  hex: string;
}

type Line = ExternalOrderInput['lines'][number] & {
  itemKey: string;
  /** Nome como veio do aplicativo (o pedido usa o do cardápio quando há vínculo). */
  channelName: string;
  externalCode: string | null;
  appUnitPrice: string;
  menuUnitPrice: string | null;
  linked: boolean;
};

export interface IngestResult {
  orderId: string;
  created: boolean;
}

/**
 * ENTRADA ÚNICA dos pedidos de aplicativo (ADR 0015). Todo canal (polling, webhook, teste) chega
 * aqui com o pedido normalizado. Idempotente em (restaurante, canal, id externo): o mesmo pedido
 * nunca entra duas vezes, nem com dois eventos chegando juntos (trava por pedido na transação).
 *
 * O preço é o que o aplicativo cobrou; a diferença para o cardápio fica guardada. Item sem vínculo
 * NUNCA faz recusar o pedido: entra com o nome e o preço do aplicativo, marcado "sem vínculo".
 */
@Injectable()
export class ExternalOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly outbox: ChannelOutboxService,
    private readonly realtime: RealtimeService,
  ) {}

  async ingest(tenantId: string, store: StoreRow, raw: ExternalOrder): Promise<IngestResult> {
    const fx = { stock: 0, print: 0 };
    const res = await this.db.withTenant({ tenantId }, (tx) =>
      this.ingestInTx(tx, tenantId, store, raw, fx),
    );
    if (res.created) this.afterCommit(tenantId, res.orderId, fx);
    return res;
  }

  afterCommit(tenantId: string, orderId: string, fx: { stock: number; print: number }) {
    this.orders.publishChanged(tenantId, orderId, { stock: !!fx.stock, print: !!fx.print });
    this.realtime.publish(tenantId, { type: 'channels.changed' });
  }

  async ingestInTx(
    tx: Tx,
    tenantId: string,
    store: StoreRow,
    raw: ExternalOrder,
    fx: { stock: number; print: number },
  ): Promise<IngestResult> {
    const o = parseExternalOrder(raw);
    if (o.channel !== store.channel || o.storeId.toLowerCase() !== store.store_id)
      throw new Error('pedido de outra loja');
    // Dois eventos do mesmo pedido ao mesmo tempo: um espera o outro terminar.
    await q(tx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `channel-order:${tenantId}:${o.channel}:${o.externalId}`,
    ]);
    const existing = await one<{ order_id: string }>(
      tx,
      `SELECT order_id FROM channel_orders WHERE channel = $1 AND external_id = $2`,
      [o.channel, o.externalId],
    );
    if (existing) return { orderId: existing.order_id, created: false };

    const ctx = channelCtx(tenantId);
    const lines = await this.resolveLines(tx, tenantId, store, o.items);
    const t = comandouTotals(o);
    const onDelivery = o.payments.find((p) => !p.prepaid);
    const prepaid = o.payments.length > 0 && !onDelivery;
    const addr = o.address
      ? [
          o.address.text,
          o.address.complement,
          o.address.reference && `Ref.: ${o.address.reference}`,
        ]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 500)
      : null;
    const status = store.auto_accept ? 'new' : 'awaiting';
    // O aplicativo paga ao restaurante tudo menos o que o cliente paga na entrega (pago online e o
    // desconto bancado pelo aplicativo). Isso vira um pagamento 'app', fora da gaveta do caixa.
    const dueOnDelivery = o.payments
      .filter((p) => !p.prepaid)
      .reduce((n, p) => n + toCents(p.amount), 0);
    const appCents = Math.max(0, toCents(t.total) - dueOnDelivery);
    const firstPrepaid = o.payments.find((p) => p.prepaid);
    const created = await this.orders.createExternalInTx(tx, ctx, {
      channel: orderChannelOf(o.fulfillment),
      status,
      appChannel: o.channel,
      externalCode: o.displayCode,
      deliveredBy: o.deliveredBy,
      scheduledFor: o.timing === 'scheduled' ? (o.scheduledFor ?? null) : null,
      customerName: o.customer.name || 'Cliente do aplicativo',
      customerPhone: o.customer.phone ?? null,
      taxDocument: o.customer.taxDocument ?? null,
      deliveryAddress: o.fulfillment === 'delivery' ? (addr ?? 'Endereço no aplicativo') : null,
      deliveryLocation:
        o.address?.lat !== undefined && o.address?.lng !== undefined
          ? { lat: o.address.lat, lng: o.address.lng }
          : null,
      notes: o.notes ?? null,
      paymentHint: onDelivery?.method ?? null,
      changeFor: onDelivery?.changeFor ?? null,
      subtotal: t.subtotal,
      discount: t.discount,
      surcharge: t.surcharge,
      deliveryFee: t.deliveryFee,
      total: t.total,
      lines,
      appPayment: appCents
        ? {
            amount: fromCents(appCents),
            method: firstPrepaid?.method ?? 'other',
            brand: firstPrepaid?.brand ?? null,
          }
        : null,
    });
    fx.stock += created.fx.stock;
    fx.print += created.fx.print;

    const unlinked = lines.filter((l) => !l.linked).length;
    const diff = lines
      .filter((l) => l.linked && l.menuUnitPrice !== null)
      .reduce(
        (s, l) =>
          s + Math.round((toCents(l.appUnitPrice) - toCents(l.menuUnitPrice!)) * l.quantity),
        0,
      );
    await q(
      tx,
      `INSERT INTO channel_orders (tenant_id, order_id, channel, store_ref, store_id, external_id,
                                   display_code, channel_status, fulfillment, timing, delivered_by,
                                   scheduled_for, prepare_from, confirm_by, pickup_code, phone_locator,
                                   prepaid, payment_method, payment_brand, change_for, customer_total,
                                   channel_discount, merchant_discount, menu_difference, unlinked_items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'order.created',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23,$24)`,
      [
        tenantId,
        created.id,
        o.channel,
        store.id,
        store.store_id,
        o.externalId,
        o.displayCode,
        o.fulfillment,
        o.timing,
        o.deliveredBy,
        o.timing === 'scheduled' ? (o.scheduledFor ?? null) : null,
        o.prepareFrom ?? null,
        o.deadlines?.confirmBy ?? null,
        o.pickupCode ?? null,
        o.customer.phoneLocator ?? null,
        prepaid,
        (onDelivery ?? o.payments[0])?.method ?? null,
        (onDelivery ?? o.payments[0])?.brand ?? null,
        onDelivery?.changeFor ?? null,
        o.totals.total,
        t.channelDiscount,
        t.discount,
        fromCents(diff),
        unlinked,
      ],
    );
    for (const [i, l] of lines.entries())
      await q(
        tx,
        `INSERT INTO channel_order_items (tenant_id, order_item_id, order_id, channel, item_key,
                                          external_code, name, app_unit_price, menu_unit_price, linked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tenantId,
          created.itemIds[i],
          created.id,
          o.channel,
          l.itemKey,
          l.externalCode,
          l.channelName,
          l.appUnitPrice,
          l.menuUnitPrice,
          l.linked,
        ],
      );
    // Aceite automático: o aplicativo precisa saber que aceitamos.
    if (status === 'new') await this.outbox.enqueueInTx(tx, tenantId, created.id, 'confirm');
    await q(tx, `UPDATE channel_stores SET last_order_at = now() WHERE id = $1`, [store.id]);
    return { orderId: created.id, created: true };
  }

  /**
   * Item do canal → produto do Comandou, nesta ordem: vínculo pelo código, código do produto,
   * código que o próprio Comandou mandou no cardápio (CMD-…), vínculo pelo nome. Sem nada disso,
   * entra no produto técnico "Item de aplicativo (sem vínculo)" com o nome e o preço do aplicativo.
   */
  private async resolveLines(
    tx: Tx,
    tenantId: string,
    store: StoreRow,
    items: ExternalItem[],
  ): Promise<Line[]> {
    const keys = [...new Set(items.flatMap((i) => [itemKeyOf(i), itemKeyOf({ name: i.name })]))];
    const links = new Map(
      (
        await q<{ item_key: string; product_id: string }>(
          tx,
          `SELECT item_key, product_id FROM channel_item_links WHERE channel = $1 AND item_key = ANY($2::text[])`,
          [store.channel, keys],
        )
      ).map((r) => [r.item_key, r.product_id]),
    );
    const codes = [
      ...new Set(items.map((i) => i.externalCode?.trim()).filter((c): c is string => !!c)),
    ];
    const hexes = codes
      .map((c) => HEX12.exec(c)?.[1]?.toLowerCase())
      .filter((h): h is string => !!h);
    // Preço do cardápio para a comparação: o do cardápio do iFood da loja, senão o de delivery.
    const menu = await one<{ id: string }>(
      tx,
      `SELECT id FROM menus
        WHERE (kind = 'ifood' AND ifood_connection_id = $1) OR (kind = 'delivery' AND active)
        ORDER BY (kind = 'ifood') DESC LIMIT 1`,
      [store.ifood_connection_id],
    );
    const products = await q<ProductHit>(
      tx,
      `SELECT p.id, p.name, p.sector_id, COALESCE(mi.price, p.price)::text AS menu_price, p.code,
              left(replace(p.id::text, '-', ''), 12) AS hex
         FROM products p LEFT JOIN menu_items mi ON mi.menu_id = $4 AND mi.product_id = p.id
        WHERE p.system_kind IS NULL
          AND (p.id = ANY($1::uuid[]) OR upper(p.code) = ANY($2::text[])
               OR left(replace(p.id::text, '-', ''), 12) = ANY($3::text[]))`,
      [[...new Set(links.values())], codes.map((c) => c.toUpperCase()), hexes, menu?.id ?? null],
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    const byCode = new Map(products.filter((p) => p.code).map((p) => [p.code!.toUpperCase(), p]));
    const byHex = new Map(products.map((p) => [p.hex, p]));

    const optHexes = [
      ...new Set(
        items.flatMap((i) =>
          i.options
            .map((o) => HEX12.exec(o.externalCode ?? '')?.[1]?.toLowerCase())
            .filter((h): h is string => !!h),
        ),
      ),
    ];
    const options = optHexes.length
      ? new Map(
          (
            await q<{ id: string; hex: string }>(
              tx,
              `SELECT id, left(replace(id::text, '-', ''), 12) AS hex FROM options
                WHERE left(replace(id::text, '-', ''), 12) = ANY($1::text[])`,
              [optHexes],
            )
          ).map((o) => [o.hex, o.id]),
        )
      : new Map<string, string>();

    let unlinkedProduct: string | null = null;
    const lines: Line[] = [];
    for (const it of items) {
      const key = itemKeyOf(it);
      const code = it.externalCode?.trim();
      const hex = code ? HEX12.exec(code)?.[1]?.toLowerCase() : undefined;
      const p =
        byId.get(links.get(key) ?? '') ??
        (code ? byCode.get(code.toUpperCase()) : undefined) ??
        (hex ? byHex.get(hex) : undefined) ??
        byId.get(links.get(itemKeyOf({ name: it.name })) ?? '');
      const chosen: { optionId: string; name: string; priceDelta: string }[] = [];
      const extraNotes: string[] = [];
      let optionCents = 0;
      for (const op of it.options) {
        const ohex = HEX12.exec(op.externalCode ?? '')?.[1]?.toLowerCase();
        const optId = ohex ? options.get(ohex) : undefined;
        const each = toCents(op.unitPrice);
        optionCents += Math.round(each * op.quantity);
        const label = `${op.quantity > 1 ? `${op.quantity}x ` : ''}${op.name}`.slice(0, 120);
        if (p && optId)
          chosen.push({
            optionId: optId,
            name: label,
            priceDelta: fromCents(Math.round(each * op.quantity)),
          });
        else extraNotes.push(label);
      }
      if (!p) unlinkedProduct ??= await this.ensureUnlinkedProduct(tx, tenantId);
      const notes = [it.notes, extraNotes.length ? `+ ${extraNotes.join(', ')}` : null]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 500);
      lines.push({
        productId: p?.id ?? unlinkedProduct!,
        name: (p ? p.name : it.name).slice(0, 200),
        quantity: it.quantity,
        unit: it.unit ?? 'un',
        unitPrice: it.unitPrice,
        total: it.total,
        notes: notes || null,
        sectorId: p?.sector_id ?? null,
        options: chosen,
        itemKey: key,
        channelName: it.name.slice(0, 200),
        externalCode: code ?? null,
        appUnitPrice: it.unitPrice,
        // Preço do cardápio da mesma linha (produto + opções que vieram com preço no aplicativo).
        menuUnitPrice: p ? fromCents(toCents(p.menu_price) + optionCents) : null,
        linked: !!p,
      });
    }
    return lines;
  }

  /** Produto técnico (inativo, categoria escondida) que segura os itens sem vínculo. */
  private async ensureUnlinkedProduct(tx: Tx, tenantId: string): Promise<string> {
    await q(
      tx,
      `INSERT INTO categories (tenant_id, name, active, system_kind)
       VALUES ($1, 'Aplicativos (sem vínculo)', false, 'channel_unlinked')
       ON CONFLICT (tenant_id, system_kind) WHERE system_kind IS NOT NULL DO NOTHING`,
      [tenantId],
    );
    await q(
      tx,
      `INSERT INTO products (tenant_id, category_id, name, price, active, system_kind)
       SELECT $1, c.id, 'Item de aplicativo (sem vínculo)', 0, false, 'channel_unlinked'
         FROM categories c WHERE c.system_kind = 'channel_unlinked'
       ON CONFLICT (tenant_id, system_kind) WHERE system_kind IS NOT NULL DO NOTHING`,
      [tenantId],
    );
    const p = await one<{ id: string }>(
      tx,
      `SELECT id FROM products WHERE system_kind = 'channel_unlinked'`,
    );
    return p!.id;
  }
}
