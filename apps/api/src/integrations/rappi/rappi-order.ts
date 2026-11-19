import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  fromCents,
  type ChannelCancelReason,
  type ChannelEventKind,
  type ExternalDiscount,
  type ExternalItem,
  type ExternalOrder,
  type ExternalPayment,
} from '@comandou/shared';

/**
 * Rappi (ADR 0015, Fase 12). Só tradução, sem banco nem rede: o pedido da Orders Rests API →
 * pedido normalizado, os caminhos, os motivos de recusa e a assinatura dos webhooks.
 *
 * Fontes (dev-portal.rappi.com): Authentication (token em /restaurants/auth/v1/token/login/
 * integrations, cabeçalho x-authorization), Orders Rests API e Managing user orders (pedido novo
 * só se busca UMA vez: a busca já o marca SENT; /orders/status/sent devolve os SENT dos últimos
 * 10 minutos; take, cooking_time, reject com cancel_type, ready-for-pickup) e Webhook events
 * (NEW_ORDER, ORDER_EVENT_CANCEL, ORDER_OTHER_EVENT; Rappi-Signature: t=..,sign=.. = HMAC-SHA256
 * de "t.corpo" com o segredo do webhook). Valores vêm em reais (ex.: 123.13); aqui viram string
 * decimal, nada de float daqui para dentro.
 */

export const RAPPI_PATHS = {
  token: '/restaurants/auth/v1/token/login/integrations',
  storeOrders: (store: string) =>
    `/restaurants/orders/v1/stores/${encodeURIComponent(store)}/orders`,
  sent: '/restaurants/orders/v1/orders/status/sent',
  take: (store: string, id: string, minutes?: number) =>
    `/restaurants/orders/v1/stores/${encodeURIComponent(store)}/orders/${encodeURIComponent(id)}` +
    (minutes ? `/cooking_time/${minutes}/take` : '/take'),
  reject: (store: string, id: string, type: string) =>
    `/restaurants/orders/v1/stores/${encodeURIComponent(store)}/orders/${encodeURIComponent(id)}/cancel_type/${encodeURIComponent(type)}/reject`,
  ready: (store: string, id: string) =>
    `/restaurants/orders/v1/stores/${encodeURIComponent(store)}/orders/${encodeURIComponent(id)}/ready-for-pickup`,
} as const;

/** Limites por minuto que o Comandou se impõe (a Rappi não publica; a janela usa 80% disto). */
export const RAPPI_LIMITS = { token: 10, orders: 300, sent: 120, action: 300 } as const;

type Num = number | string | null | undefined;
export interface RappiSubitem {
  sku?: string;
  id?: string | number;
  name?: string;
  type?: string;
  price?: Num;
  quantity?: Num;
}
export interface RappiItem extends RappiSubitem {
  comments?: string | string[];
  unit_price_with_discount?: Num;
  unit_price_without_discount?: Num;
  percentage_discount?: Num;
  subitems?: RappiSubitem[];
}
export interface RappiDiscount {
  value?: Num;
  description?: string;
  title?: string;
  tittle?: string;
  type?: string;
  amount_by_rappi?: Num;
  amount_by_partner?: Num;
}
export interface RappiOrderDetail {
  order_id: string | number;
  cooking_time?: Num;
  created_at?: string;
  delivery_method?: string;
  payment_method?: string;
  delivery_information?: {
    city?: string;
    complete_address?: string;
    street_number?: string;
    street_name?: string;
    neighborhood?: string;
    complement?: string;
    postal_code?: string;
  };
  totals?: {
    total_products?: Num;
    total_products_with_discount?: Num;
    total_products_without_discount?: Num;
    total_discounts?: Num;
    total_order?: Num;
    total_to_pay?: Num;
    charges?: { shipping?: Num; service_fee?: Num };
    other_totals?: { tip?: Num; total_rappi_pay?: Num; total_rappi_credits?: Num };
    othet_totals?: { tip?: Num; total_rappi_pay?: Num; total_rappi_credits?: Num };
  };
  items?: RappiItem[];
  customer?: {
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    document_type?: string;
    document_number?: string;
  };
  store?: { internal_id?: string | number; external_id?: string; name?: string };
  discounts?: RappiDiscount[];
  delivery_discount?: { total_value_discount?: Num };
}
/** A API devolve `{ order_detail: {...} }` em cada item da lista (aceita o pedido solto também). */
export type RappiOrder = { order_detail?: RappiOrderDetail } & Partial<RappiOrderDetail>;

/** Reais (número ou texto) → centavos inteiros, sem erro de ponto flutuante. */
export function rappiCents(v: Num): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : (v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const money = (v: Num) => fromCents(Math.max(0, rappiCents(v)));
const cut = (v: unknown, max: number) => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return t ? t.slice(0, max) : undefined;
};
const qtyOf = (v: Num) => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 1;
};
const LOW = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export const rappiDetail = (o: RappiOrder): RappiOrderDetail | null => {
  const d = (o?.order_detail ?? o) as RappiOrderDetail | undefined;
  return d && (typeof d.order_id === 'string' || typeof d.order_id === 'number') ? d : null;
};
export const rappiOrderId = (o: RappiOrder) => {
  const d = rappiDetail(o);
  return d ? String(d.order_id).slice(0, 100) : null;
};
export const rappiStoreOf = (o: RappiOrder) => {
  const s = rappiDetail(o)?.store?.internal_id;
  return s === undefined || s === null ? null : String(s).slice(0, 100);
};

/** Webhook/evento da Rappi → evento normalizado. Cancelamento vem só por webhook. */
export function rappiEventKind(name: unknown): ChannelEventKind {
  const t = LOW(name);
  if (t === 'new_order') return 'order.created';
  if (t.startsWith('canceled') || t.startsWith('cancelled') || t === 'order_event_cancel')
    return 'order.cancelled';
  return 'other';
}

/** Motivos de recusa que a Rappi aceita (cancel_type). */
export const RAPPI_REJECT_REASONS: ChannelCancelReason[] = [
  { code: 'ITEM_STOCKOUT', label: 'Item sem estoque' },
  { code: 'STORE_CLOSED', label: 'Restaurante fechado' },
  { code: 'OUTSIDE_DELIVERY_AREA', label: 'Fora da área de entrega' },
  { code: 'DELIVERY_METHOD_NOT_SUPPORTED', label: 'Forma de entrega que a loja não faz' },
  { code: 'ITEM_NOT_FOUND', label: 'Item que a loja não reconhece' },
  { code: 'ITEM_PRICE_INCORRECT', label: 'Preço do item diferente do da loja' },
  { code: 'ORDER_TOTAL_INCORRECT', label: 'Total do pedido diferente' },
  { code: 'POS_INTERNAL_ERROR', label: 'Erro no sistema da loja' },
];
const REJECT = new Set(RAPPI_REJECT_REASONS.map((r) => r.code));
export const rappiRejectCode = (v: unknown) => {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return REJECT.has(c) ? c : 'POS_INTERNAL_ERROR';
};

const METHOD: [RegExp, ExternalPayment['method']][] = [
  [/cash|efectivo|dinheiro/, 'cash'],
  [/pix/, 'pix'],
  [/debit|d[eé]bito/, 'debit'],
  [/voucher|vale|ticket|sodexo|alelo|vr\b/, 'voucher'],
  [/credit|card|cr[eé]dito|tarjeta/, 'credit'],
];
const methodOf = (v: unknown): ExternalPayment['method'] => {
  const t = LOW(v);
  for (const [re, m] of METHOD) if (re.test(t)) return m;
  return 'other';
};

function item(i: RappiItem): ExternalItem {
  const quantity = qtyOf(i.quantity);
  const unit = rappiCents(i.unit_price_with_discount ?? i.price);
  const subs = (i.subitems ?? []).slice(0, 100);
  // Complementos: preço por unidade do item (a linha soma complementos × quantidade do item).
  const subsCents = subs.reduce((n, s) => n + rappiCents(s.price) * qtyOf(s.quantity), 0);
  const total = Math.round((unit + subsCents) * quantity);
  const notes = Array.isArray(i.comments) ? i.comments.join(' · ') : i.comments;
  return {
    ...(cut(i.id, 100) ? { externalId: cut(i.id, 100) } : {}),
    ...(cut(i.sku, 100) ? { externalCode: cut(i.sku, 100) } : {}),
    name: cut(i.name, 200) ?? 'Item da Rappi',
    quantity,
    unit: 'un',
    unitPrice: fromCents(Math.max(0, Math.round(total / quantity))),
    total: fromCents(Math.max(0, total)),
    ...(cut(notes, 500) ? { notes: cut(notes, 500) } : {}),
    options: subs.map((s) => ({
      ...(cut(s.id, 100) ? { externalId: cut(s.id, 100) } : {}),
      ...(cut(s.sku, 100) ? { externalCode: cut(s.sku, 100) } : {}),
      name: cut(s.name, 200) ?? 'Complemento',
      quantity: qtyOf(s.quantity),
      unitPrice: money(s.price),
    })),
  };
}

function discounts(d: RappiOrderDetail): ExternalDiscount[] {
  const out: ExternalDiscount[] = [];
  for (const x of (d.discounts ?? []).slice(0, 20)) {
    const target = /delivery|shipping|env[ií]o|entrega/i.test(String(x.type ?? ''))
      ? 'delivery'
      : 'items';
    const byRappi = rappiCents(x.amount_by_rappi);
    const byPartner = rappiCents(x.amount_by_partner);
    const desc = cut(x.title ?? x.tittle ?? x.description, 120);
    if (byRappi > 0 || byPartner > 0) {
      if (byRappi > 0)
        out.push({
          amount: fromCents(byRappi),
          sponsor: 'channel',
          target,
          ...(desc ? { description: desc } : {}),
        });
      if (byPartner > 0)
        out.push({
          amount: fromCents(byPartner),
          sponsor: 'merchant',
          target,
          ...(desc ? { description: desc } : {}),
        });
    } else if (rappiCents(x.value) > 0) {
      // Sem quem paga: conta como da Rappi (não mexe na receita do restaurante).
      out.push({
        amount: money(x.value),
        sponsor: 'channel',
        target,
        ...(desc ? { description: desc } : {}),
      });
    }
  }
  return out;
}

/** Pedido da Rappi → pedido normalizado do Comandou. */
export function rappiToExternal(raw: RappiOrder): ExternalOrder {
  const d = rappiDetail(raw);
  if (!d) throw new Error('pedido da Rappi sem order_id');
  const id = String(d.order_id).slice(0, 100);
  const method = LOW(d.delivery_method);
  // delivery = entregador da Rappi; marketplace = a loja entrega; pickup = retirada.
  const fulfillment = method === 'pickup' ? 'takeout' : 'delivery';
  const deliveredBy = method === 'delivery' ? 'channel' : 'merchant';
  const t = d.totals ?? {};
  const items = (d.items ?? [])
    .filter((i) => LOW(i.type) !== 'topping')
    .slice(0, 200)
    .map(item);
  const itemsCents = items.reduce((n, i) => n + rappiCents(i.total), 0);
  const subtotal =
    t.total_products_without_discount !== undefined
      ? rappiCents(t.total_products_without_discount)
      : t.total_products !== undefined
        ? rappiCents(t.total_products)
        : itemsCents;
  const deliveryFee = rappiCents(t.charges?.shipping);
  const other = t.other_totals ?? t.othet_totals;
  const serviceFee = rappiCents(t.charges?.service_fee) + rappiCents(other?.tip);
  const disc = discounts(d);
  const discCents = disc.reduce((n, x) => n + rappiCents(x.amount), 0);
  const total = Math.max(0, subtotal + deliveryFee + serviceFee - discCents);
  // Dinheiro a cobrar na entrega/retirada; o resto foi pago no app.
  const toPay = Math.min(total, Math.max(0, rappiCents(t.total_to_pay)));
  const pm = methodOf(d.payment_method);
  const payments: ExternalPayment[] = [];
  if (toPay > 0)
    payments.push({
      prepaid: false,
      method: pm === 'other' ? 'cash' : pm,
      amount: fromCents(toPay),
    });
  if (total - toPay > 0)
    payments.push({
      prepaid: true,
      method: toPay > 0 ? 'other' : pm,
      amount: fromCents(total - toPay),
    });
  const a = d.delivery_information;
  const addressText =
    cut(a?.complete_address, 400) ??
    cut(
      [[a?.street_name, a?.street_number].filter(Boolean).join(', '), a?.neighborhood, a?.city]
        .filter(Boolean)
        .join(' - '),
      400,
    );
  const c = d.customer ?? {};
  const name = [cut(c.first_name, 60), cut(c.last_name, 1)].filter(Boolean).join(' ');
  const phone = cut(c.phone_number, 40);
  const doc = c.document_number?.replace(/\D/g, '');
  const created = d.created_at && Number.isFinite(Date.parse(d.created_at)) ? d.created_at : null;
  return {
    channel: 'rappi',
    externalId: id,
    displayCode: id.slice(-8),
    storeId: rappiStoreOf(raw) ?? '',
    createdAt: created ? new Date(created).toISOString() : new Date().toISOString(),
    fulfillment,
    timing: 'immediate',
    deliveredBy: fulfillment === 'takeout' ? 'merchant' : deliveredBy,
    customer: {
      name: name ? (name.includes(' ') ? `${name}.` : name) : 'Cliente Rappi',
      ...(phone && /^[\d+()\s.-]{8,25}$/.test(phone) ? { phone } : {}),
      ...(doc && (doc.length === 11 || doc.length === 14) ? { taxDocument: doc } : {}),
    },
    ...(fulfillment === 'delivery' && addressText
      ? {
          address: {
            text: addressText,
            ...(cut(a?.complement, 200) ? { complement: cut(a?.complement, 200) } : {}),
          },
        }
      : {}),
    items,
    totals: {
      subtotal: fromCents(Math.max(0, subtotal)),
      deliveryFee: fromCents(deliveryFee),
      serviceFee: fromCents(serviceFee),
      total: fromCents(total),
    },
    discounts: disc,
    payments,
  };
}

// ---------------------------------------------------------------------------------------------
// Assinatura dos webhooks (Rappi-Signature: t=<timestamp>,sign=<hex>)

/** Lê "t=123,sign=abc" (ordem e espaços livres). */
export function parseRappiSignature(h: unknown): { t: string; sign: string } | null {
  if (typeof h !== 'string' || h.length > 400) return null;
  const parts = Object.fromEntries(
    h.split(',').map((p) => {
      const i = p.indexOf('=');
      return i < 0 ? ['', ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = parts.t;
  const sign = parts.sign;
  if (!t || !/^\d{1,16}$/.test(t) || !sign || !/^[0-9a-fA-F]{64}$/.test(sign)) return null;
  return { t, sign: sign.toLowerCase() };
}

export function rappiSign(secret: string, t: string, raw: Buffer | string): string {
  return createHmac('sha256', secret).update(`${t}.`, 'utf8').update(raw).digest('hex');
}

/**
 * Confere a assinatura em tempo constante e a idade do aviso (até `maxAgeSeconds`, nos dois
 * sentidos: o relógio da Rappi pode estar um pouco à frente). O timestamp pode vir em segundos
 * ou milissegundos.
 */
export function verifyRappiSignature(
  secret: string,
  header: unknown,
  raw: Buffer,
  now = Date.now(),
  maxAgeSeconds = 600,
): boolean {
  const p = parseRappiSignature(header);
  if (!p) return false;
  const n = Number(p.t);
  const ms = n > 1e12 ? n : n * 1000;
  if (Math.abs(now - ms) > maxAgeSeconds * 1000) return false;
  const want = Buffer.from(rappiSign(secret, p.t, raw), 'hex');
  const got = Buffer.from(p.sign, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
