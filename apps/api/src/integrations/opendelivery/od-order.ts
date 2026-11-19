import { createHmac } from 'node:crypto';
import {
  fromCents,
  type ChannelAction,
  type ChannelCancelReason,
  type ChannelEventKind,
  type DriverStatus,
  type ExternalDiscount,
  type ExternalItem,
  type ExternalOption,
  type ExternalOrder,
  type ExternalPayment,
} from '@comandou/shared';
import type {
  ChannelDispute,
  ChannelDriverUpdate,
  ChannelSettlement,
} from '../channels/channel-adapter';

/**
 * Open Delivery (Abrasel) V1 e a Keeta, que fala Open Delivery 1.5 com ajustes (ADR 0015, Fase 10).
 * Só tradução, sem banco nem rede: pedido e eventos do padrão → pedido e eventos normalizados do
 * Comandou, os caminhos da Order API e a assinatura da Keeta. Valores do padrão vêm como
 * `{ value: 12.9, currency: 'BRL' }`; aqui viram string decimal ("12.90"), nada de float daqui para
 * dentro.
 *
 * Fontes: docs da Keeta (api-docs.mykeeta.com/apis/opendelivery: polling, ack, orders, confirm,
 * requestCancellation, acceptRefund, merchantOnboarding, assinatura), da 99Food (Plataforma
 * Aberta, seção Open Delivery Protocol: token por loja, polling com eventType/fromTime,
 * acceptCancellation/denyCancellation, pickedUp) e o padrão V1
 * (abrasel-nacional.github.io/opendelivery).
 */

/** Caminhos da V1 (iguais na Keeta, a partir da base do aplicativo). */
export const OD_PATHS = {
  token: '/oauth/token',
  polling: '/v1/events:polling',
  ack: '/v1/events/acknowledgment',
  order: (id: string) => `/v1/orders/${encodeURIComponent(id)}`,
  action: (id: string, verb: string) => `/v1/orders/${encodeURIComponent(id)}/${verb}`,
  onboarding: '/v1/merchantOnboarding',
} as const;

/**
 * Limites por minuto que o Comandou se impõe (o padrão e a Keeta não publicam números; a janela
 * usa 80% disto). Polling é por loja a cada 30 s, então sobra folga.
 */
export const OD_LIMITS = {
  polling: 600,
  ack: 600,
  order: 300,
  action: 300,
  onboarding: 30,
  token: 30,
} as const;

/** Ids por ack (o padrão não fixa; lote pequeno para não estourar o corpo). */
export const OD_ACK_BATCH = 500;

type Num = number | string | null | undefined;
export interface OdPrice {
  value?: Num;
  currency?: string;
}
interface OdOption {
  id?: string;
  name?: string;
  externalCode?: string;
  quantity?: Num;
  unitPrice?: OdPrice;
  totalPrice?: OdPrice;
  specialInstructions?: string;
}
interface OdItem extends OdOption {
  unit?: string;
  optionsPrice?: OdPrice;
  observations?: string;
  options?: OdOption[];
}
export interface OdOrder {
  id: string;
  type?: string;
  fulfillment?: { orderType?: string };
  displayId?: string;
  createdAt?: string;
  orderTiming?: string;
  preparationStartDateTime?: string;
  merchant?: { id?: string; name?: string };
  items?: OdItem[];
  otherFees?: { name?: string; type?: string; receivedBy?: string; price?: OdPrice }[];
  discounts?: {
    amount?: OdPrice;
    target?: string;
    sponsorshipValues?: { name?: string; amount?: OdPrice }[];
  }[];
  total?: {
    itemsPrice?: OdPrice;
    otherFees?: OdPrice;
    discount?: OdPrice;
    orderAmount?: OdPrice;
  };
  payments?: {
    methods?: {
      value?: Num;
      type?: string;
      method?: string;
      brand?: string;
      changeFor?: Num;
    }[];
  };
  customer?: {
    name?: string;
    documentNumber?: string;
    phone?: { number?: string; localizer?: string };
  };
  schedule?: { scheduledDateTimeStart?: string; scheduledDateTimeEnd?: string };
  delivery?: {
    deliveredBy?: string;
    pickupCode?: string;
    deliveryAddress?: {
      street?: string;
      number?: string;
      district?: string;
      city?: string;
      complement?: string;
      reference?: string;
      formattedAddress?: string;
      coordinates?: { latitude?: Num; longitude?: Num };
    };
  };
  takeout?: { takeoutDateTime?: string };
  indoor?: { mode?: string; place?: string; tab?: string; indoorDateTime?: string };
  extraInfo?: string;
}

/** Reais (número ou texto) → centavos inteiros, sem erro de ponto flutuante. */
export function odCents(v: Num | OdPrice): number {
  const raw = v !== null && typeof v === 'object' ? v.value : v;
  const n = typeof raw === 'string' ? Number(raw) : (raw ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const money = (v: Num | OdPrice) => fromCents(Math.max(0, odCents(v)));
const cut = (v: unknown, max: number) => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, max) : undefined;
};
const qtyOf = (v: Num) => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 1;
};
const validIso = (v?: string) => (v && Number.isFinite(Date.parse(v)) ? v : undefined);
const UP = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

const KIND: Record<string, ChannelEventKind> = {
  CREATED: 'order.created',
  CONFIRMED: 'order.confirmed',
  PREPARING: 'order.preparing',
  READY_FOR_PICKUP: 'order.ready',
  DISPATCHED: 'order.dispatched',
  PICKED_UP: 'order.dispatched',
  ORDER_COLLECTED: 'order.dispatched',
  DELIVERED: 'order.delivered',
  CONCLUDED: 'order.concluded',
  CANCELLATION_REQUESTED: 'order.cancellation_requested',
  CANCELLATION_REQUEST_DENIED: 'order.cancellation_denied',
  CANCELLATION_REQUEST_ACCEPTED: 'order.cancelled',
  CANCELLED: 'order.cancelled',
  USER_REFUND_REQUEST: 'order.dispute',
  REFUNDED: 'order.dispute_settled',
  REFUND_FAILED: 'order.dispute_settled',
  // 99Food: o cliente pede para cancelar; a loja aceita ou nega (CANCELLED_DENIED encerra).
  ORDER_CANCELLATION_REQUEST: 'order.dispute',
  CANCELLED_DENIED: 'order.dispute_settled',
};

/** Tipos que a 99Food entrega no polling (o que não estiver na lista ela dá ack sozinha). */
export const OD_99FOOD_EVENT_TYPES = [
  'CREATED',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'DISPATCHED',
  'DELIVERED',
  'CONCLUDED',
  'CANCELLATION_REQUESTED',
  'CANCELLATION_REQUEST_DENIED',
  'CANCELLED',
  'ORDER_CANCELLATION_REQUEST',
  'CANCELLED_DENIED',
] as const;

/** Pedido do cliente: reembolso (Keeta) ou cancelamento (99Food). */
const isCancelRequest = (type: unknown) => UP(type) === 'ORDER_CANCELLATION_REQUEST';
const isCancelSettle = (type: unknown) => UP(type) === 'CANCELLED_DENIED';

/** Avisos do entregador do aplicativo (só o passo; nada de nome, telefone ou posição). */
const DRIVER: Record<string, DriverStatus> = {
  PICKUP_ONGOING: 'to_store',
  RIDER_ARRIVED_AT_STORE: 'at_store',
  DELIVERY_ONGOING: 'collected',
  ARRIVED_AT_CUSTOMER: 'at_customer',
};

/** Tipo do evento → evento normalizado. O resto (ex.: RECOMMENDED_PREPARATION_START) vira 'other'. */
export function odEventKind(type: unknown): ChannelEventKind {
  const t = UP(type);
  if (KIND[t]) return KIND[t];
  if (DRIVER[t]) return 'delivery.update';
  return 'other';
}

export function odDriverUpdate(type: unknown): ChannelDriverUpdate | null {
  const s = DRIVER[UP(type)];
  return s ? { status: s } : null;
}

/** `metadata` dos eventos vem como texto JSON (Keeta); aceita objeto também. */
export function odMetadata(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === 'object') return meta as Record<string, unknown>;
  if (typeof meta === 'string' && meta.length <= 20_000) {
    try {
      const v = JSON.parse(meta) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Pedido de reembolso do cliente (Keeta USER_REFUND_REQUEST): aceitar ou recusar, por uma pessoa. */
export function odRefundDispute(orderId: string, meta: unknown): ChannelDispute {
  const m = odMetadata(meta);
  const items = Array.isArray(m.refundProducts) ? m.refundProducts.length : 0;
  const reason = cut(m.reason ?? m.refundReason, 300);
  return {
    externalId: `${orderId.slice(0, 80)}:refund`,
    kind: 'REFUND_REQUEST',
    ...(reason || items
      ? {
          message: [reason, items ? `${items} item(ns) no pedido de reembolso` : null]
            .filter(Boolean)
            .join(' · '),
        }
      : {}),
    alternatives: [],
    acceptReasons: [],
  };
}

export function odRefundSettlement(orderId: string, type: unknown): ChannelSettlement {
  return {
    externalId: `${orderId.slice(0, 80)}:refund`,
    outcome: UP(type) === 'REFUNDED' ? 'REFUNDED' : 'REFUND_FAILED',
  };
}

/** Pedido de cancelamento do cliente (99Food ORDER_CANCELLATION_REQUEST): aceitar ou negar. */
export function odCancelDispute(orderId: string): ChannelDispute {
  return {
    externalId: `${orderId.slice(0, 80)}:cancel`,
    kind: 'CANCELLATION',
    alternatives: [],
    acceptReasons: [],
  };
}

/** Pedido do cliente que chegou no evento, conforme o tipo. */
export function odDispute(orderId: string, type: unknown, meta: unknown): ChannelDispute {
  return isCancelRequest(type) ? odCancelDispute(orderId) : odRefundDispute(orderId, meta);
}

/** Fim do pedido do cliente, conforme o tipo. */
export function odSettlement(orderId: string, type: unknown): ChannelSettlement {
  return isCancelSettle(type)
    ? { externalId: `${orderId.slice(0, 80)}:cancel`, outcome: 'CANCELLED_DENIED' }
    : odRefundSettlement(orderId, type);
}

/** Pedido do cliente de cancelamento (e não de reembolso)? Pelo id que o Comandou deu a ele. */
export const odIsCancelDispute = (disputeId: unknown) =>
  typeof disputeId === 'string' && disputeId.endsWith(':cancel');

/**
 * Código ao negar o cancelamento pedido pelo cliente (99Food aceita só estes dois): pela frase da
 * pessoa, "saiu para entrega" ou, no resto, "o prato já está pronto".
 */
export function odDenyCode(reason: unknown): 'OUT_FOR_DELIVERY' | 'DISH_ALREADY_DONE' {
  const t = typeof reason === 'string' ? reason.toLowerCase() : '';
  return /saiu|a caminho|em rota|entregador|entrega/.test(t)
    ? 'OUT_FOR_DELIVERY'
    : 'DISH_ALREADY_DONE';
}

/**
 * Ação do Comandou → verbo da Order API (null = não existe neste aplicativo). O pedido do cliente
 * é de reembolso (Keeta) ou de cancelamento (99Food), pelo id da negociação.
 */
export function odVerb(action: ChannelAction, disputeId?: unknown): string | null {
  switch (action) {
    case 'confirm':
      return 'confirm';
    case 'start_preparation':
      return 'preparing';
    case 'ready':
      return 'readyForPickup';
    case 'dispatch':
      return 'dispatch';
    case 'delivered':
      return 'delivered';
    case 'reject':
    case 'request_cancellation':
      return 'requestCancellation';
    case 'picked_up':
      return 'pickedUp';
    case 'dispute_accept':
      return odIsCancelDispute(disputeId) ? 'acceptCancellation' : 'acceptRefund';
    case 'dispute_reject':
      return odIsCancelDispute(disputeId) ? 'denyCancellation' : 'rejectRefund';
    default:
      return null;
  }
}

/** Motivos de cancelamento do padrão (os mesmos na Keeta). */
export const OD_CANCEL_REASONS: ChannelCancelReason[] = [
  { code: 'SYSTEMIC_ISSUES', label: 'Problemas de sistema' },
  { code: 'DUPLICATE_APPLICATION', label: 'Pedido em duplicidade' },
  { code: 'UNAVAILABLE_ITEM', label: 'Item indisponível' },
  { code: 'RESTAURANT_WITHOUT_DELIVERY_PERSON', label: 'Restaurante sem entregador' },
  { code: 'OUTDATED_MENU', label: 'Cardápio desatualizado' },
  { code: 'ORDER_OUTSIDE_THE_DELIVERY_AREA', label: 'Pedido fora da área de entrega' },
  { code: 'BLOCKED_CUSTOMER', label: 'Cliente bloqueado' },
  { code: 'OUTSIDE_DELIVERY_HOURS', label: 'Fora do horário de entrega' },
  {
    code: 'INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT',
    label: 'Dificuldades internas do restaurante',
  },
  { code: 'RISK_AREA', label: 'Área de risco' },
  { code: 'DELIVERY_PROBLEM', label: 'Problema na entrega' },
];
export const OD_DEFAULT_CANCEL_CODE = 'INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT';
const CANCEL_CODES = new Set(OD_CANCEL_REASONS.map((r) => r.code));
export const odCancelCode = (v: unknown) => {
  const c = UP(v);
  return CANCEL_CODES.has(c) ? c : OD_DEFAULT_CANCEL_CODE;
};

const METHOD: Record<string, ExternalPayment['method']> = {
  CREDIT: 'credit',
  CREDIT_DEBIT: 'credit',
  DEBIT: 'debit',
  PIX: 'pix',
  CASH: 'cash',
  MEAL_VOUCHER: 'voucher',
  FOOD_VOUCHER: 'voucher',
};

function options(list: OdOption[] | undefined): ExternalOption[] {
  return (list ?? []).slice(0, 100).map((op) => {
    const q = qtyOf(op.quantity);
    const unit =
      op.unitPrice !== undefined ? odCents(op.unitPrice) : Math.round(odCents(op.totalPrice) / q);
    return {
      ...(cut(op.id, 100) ? { externalId: cut(op.id, 100) } : {}),
      ...(cut(op.externalCode, 100) ? { externalCode: cut(op.externalCode, 100) } : {}),
      name: cut(op.name, 200) ?? 'Complemento',
      quantity: q,
      unitPrice: fromCents(Math.max(0, unit)),
    };
  });
}

function item(i: OdItem): ExternalItem {
  const quantity = qtyOf(i.quantity);
  // O total da linha é o que vale (item + complementos, como o aplicativo cobrou).
  const total =
    i.totalPrice !== undefined
      ? odCents(i.totalPrice)
      : Math.round(odCents(i.unitPrice) * quantity) + odCents(i.optionsPrice);
  const notes = cut(i.observations ?? i.specialInstructions, 500);
  return {
    ...(cut(i.id, 100) ? { externalId: cut(i.id, 100) } : {}),
    ...(cut(i.externalCode, 100) ? { externalCode: cut(i.externalCode, 100) } : {}),
    name: cut(i.name, 200) ?? 'Item do aplicativo',
    quantity,
    unit: UP(i.unit) === 'KG' ? 'kg' : 'un',
    unitPrice: fromCents(Math.max(0, Math.round(total / quantity))),
    total: fromCents(Math.max(0, total)),
    ...(notes ? { notes } : {}),
    options: options(i.options),
  };
}

function discounts(o: OdOrder): ExternalDiscount[] {
  const out: ExternalDiscount[] = [];
  for (const d of o.discounts ?? []) {
    const target = UP(d.target) === 'DELIVERY_FEE' ? 'delivery' : 'items';
    const parts = (d.sponsorshipValues ?? []).filter((s) => odCents(s.amount) > 0);
    if (!parts.length) {
      // Sem quem paga: conta como do aplicativo (não mexe na receita do restaurante).
      if (odCents(d.amount) > 0) out.push({ amount: money(d.amount), sponsor: 'channel', target });
      continue;
    }
    for (const s of parts) {
      const who = UP(s.name);
      out.push({
        amount: money(s.amount),
        sponsor: who === 'MERCHANT' || who === 'CHAIN' ? 'merchant' : 'channel',
        target,
        ...(who ? { description: `Desconto ${who}` } : {}),
      });
    }
  }
  return out.slice(0, 20);
}

function payments(o: OdOrder): ExternalPayment[] {
  return (o.payments?.methods ?? [])
    .filter((m) => odCents(m.value) > 0)
    .slice(0, 10)
    .map((m) => {
      const change = odCents(m.changeFor);
      const method = METHOD[UP(m.method)] ?? 'other';
      return {
        prepaid: UP(m.type) !== 'PENDING',
        method,
        amount: money(m.value),
        ...(cut(m.brand, 40) ? { brand: cut(m.brand, 40) } : {}),
        ...(method === 'cash' && change > 0 ? { changeFor: fromCents(change) } : {}),
      };
    });
}

/**
 * Nome do cliente só se parecer um nome: a Keeta pode mandar os dados cifrados (só abrem com
 * batchDecrypt em entrega própria), e um texto cifrado não serve na tela nem na comanda.
 */
function nameOf(v: unknown, fallback: string) {
  const t = cut(v, 120);
  if (!t) return fallback;
  if (t.length > 40 && !/\s/.test(t)) return fallback;
  return t;
}

/**
 * `extraInfo` da 99Food: "localizador: 12345678; código de retirada: 6795; precisa de talheres:
 * sim". O localizador e o código de retirada vão para os campos deles; o resto fica na observação.
 */
export function odExtraInfo(v: unknown): { locator?: string; pickupCode?: string; rest?: string } {
  const t = typeof v === 'string' ? v.slice(0, 2000) : '';
  if (!t.trim()) return {};
  const out: { locator?: string; pickupCode?: string; rest?: string } = {};
  const rest: string[] = [];
  for (const part of t.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(p);
    const key = m?.[1]!.trim().toLowerCase() ?? '';
    const val = m?.[2]!.trim() ?? '';
    if (key === 'localizador' && /^[\d\s-]{2,20}$/.test(val)) out.locator = val.slice(0, 40);
    else if (/^c[oó]digo de retirada$/.test(key) && /^[\w-]{2,20}$/.test(val)) out.pickupCode = val;
    else rest.push(p);
  }
  if (rest.length) out.rest = rest.join(' · ');
  return out;
}

/** Pedido do Open Delivery (V1, Keeta, 99Food) → pedido normalizado do Comandou. */
export function odToExternal(o: OdOrder, channel: string, label = 'aplicativo'): ExternalOrder {
  const type = UP(o.fulfillment?.orderType ?? o.type);
  const fulfillment =
    type === 'TAKEOUT'
      ? 'takeout'
      : type === 'INDOOR' || type === 'DINE_IN'
        ? 'dine_in'
        : 'delivery';
  const scheduled = UP(o.orderTiming) === 'SCHEDULED';
  const createdAt = validIso(o.createdAt) ?? new Date().toISOString();
  const prepareFrom = validIso(o.preparationStartDateTime);
  const scheduledFor = scheduled
    ? validIso(
        o.schedule?.scheduledDateTimeStart ??
          o.takeout?.takeoutDateTime ??
          o.indoor?.indoorDateTime,
      )
    : undefined;
  const a = o.delivery?.deliveryAddress;
  const street = [a?.street, a?.number].filter(Boolean).join(', ');
  const addressText =
    cut(a?.formattedAddress, 400) ??
    cut([street, a?.district, a?.city].filter(Boolean).join(' - '), 400);
  const lat = Number(a?.coordinates?.latitude);
  const lng = Number(a?.coordinates?.longitude);
  const doc = o.customer?.documentNumber?.replace(/\D/g, '');
  const phone = cut(o.customer?.phone?.number, 40);
  const fees = (o.otherFees ?? []).map((f) => ({ type: UP(f.type), cents: odCents(f.price) }));
  const deliveryFee = fees
    .filter((f) => f.type === 'DELIVERY_FEE')
    .reduce((n, f) => n + f.cents, 0);
  const otherFees = fees.filter((f) => f.type !== 'DELIVERY_FEE').reduce((n, f) => n + f.cents, 0);
  const itemsList = (o.items ?? []).slice(0, 200).map(item);
  const subtotal =
    o.total?.itemsPrice !== undefined
      ? odCents(o.total.itemsPrice)
      : itemsList.reduce((n, i) => n + odCents(i.total), 0);
  const extra = odExtraInfo(o.extraInfo);
  const locator = cut(o.customer?.phone?.localizer, 40) ?? extra.locator;
  const pickupCode = cut(o.delivery?.pickupCode, 40) ?? extra.pickupCode;
  const notes = [
    extra.rest,
    o.indoor?.place && `Mesa ${o.indoor.place}`,
    o.indoor?.tab && `Comanda ${o.indoor.tab}`,
  ]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .join(' · ');
  return {
    channel,
    externalId: o.id,
    displayCode: cut(o.displayId, 40) ?? o.id.slice(0, 8),
    storeId: (o.merchant?.id ?? '').toLowerCase(),
    createdAt,
    fulfillment,
    timing: scheduled ? 'scheduled' : 'immediate',
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(prepareFrom ? { prepareFrom } : {}),
    deliveredBy:
      fulfillment === 'delivery' && UP(o.delivery?.deliveredBy) !== 'MERCHANT'
        ? 'channel'
        : 'merchant',
    customer: {
      name: nameOf(o.customer?.name, `Cliente ${label}`),
      // Telefone só se for um número (cifrado ou localizador não serve para ligar).
      ...(phone && /^[\d+()\s.-]{8,25}$/.test(phone) ? { phone } : {}),
      ...(locator ? { phoneLocator: locator } : {}),
      ...(doc && (doc.length === 11 || doc.length === 14) ? { taxDocument: doc } : {}),
    },
    ...(fulfillment === 'delivery' && addressText
      ? {
          address: {
            text: addressText,
            ...(cut(a?.complement, 200) ? { complement: cut(a?.complement, 200) } : {}),
            ...(cut(a?.reference, 200) ? { reference: cut(a?.reference, 200) } : {}),
            ...(Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
              ? { lat, lng }
              : {}),
          },
        }
      : {}),
    items: itemsList,
    totals: {
      subtotal: fromCents(Math.max(0, subtotal)),
      deliveryFee: fromCents(Math.max(0, deliveryFee)),
      serviceFee: fromCents(Math.max(0, otherFees)),
      total: money(o.total?.orderAmount),
    },
    discounts: discounts(o),
    payments: payments(o),
    ...(notes ? { notes: notes.slice(0, 1000) } : {}),
    ...(pickupCode ? { pickupCode } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Assinatura da Keeta (X-App-Signature)

/**
 * JSON canônico (RFC 8785, JCS) para o que o Comandou manda: chaves em ordem (código UTF-16, como
 * o `sort` do JS), sem espaços, números e textos como o JSON.stringify (que segue o ECMAScript,
 * a mesma regra da JCS). Valores `undefined` somem, como no JSON.
 */
export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('número inválido no JSON');
    return JSON.stringify(v) ?? 'null';
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : jcs(x))).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${jcs(x)}`).join(',')}}`;
}

/**
 * Texto assinado pela Keeta: URL sem a query + "&" + parâmetros em ordem alfabética (chave=valor,
 * unidos por "&") + "&" + corpo canônico. Sem parâmetros, a URL vai direto ao corpo; corpo vazio
 * ("", "{}") fica de fora, com o seu "&".
 */
export function keetaSignatureString(
  url: string,
  params: Record<string, string | null | undefined>,
  body: string | undefined,
): string {
  let s = url;
  for (const k of Object.keys(params).sort()) s += `&${k}=${params[k] ?? ''}`;
  if (body && body !== '{}') s += `&${body}`;
  return s;
}

/** HMAC-SHA256 do texto com o client secret, em Base64. */
export function keetaSignature(secret: string, signatureString: string): string {
  return createHmac('sha256', secret).update(signatureString, 'utf8').digest('base64');
}
