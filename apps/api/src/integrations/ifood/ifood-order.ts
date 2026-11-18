import {
  fromCents,
  type ChannelAction,
  type ChannelEventKind,
  type ExternalDiscount,
  type ExternalItem,
  type ExternalOption,
  type ExternalOrder,
  type ExternalPayment,
} from '@comandou/shared';

/**
 * Pedido e eventos do iFood → pedido e eventos normalizados do Comandou (ADR 0015). Só tradução,
 * sem banco nem rede: testado à parte. Valores do iFood vêm em reais com ponto (12.9), viram
 * string decimal ("12.90") aqui; nada de float daqui para dentro.
 *
 * Fontes: Order API (detalhes, benefícios com sponsorshipValues, payments.methods, delivery,
 * takeout, indoor) e Events API (code/fullCode). Os caminhos ficam em IFOOD_PATHS, num lugar só.
 */
export const IFOOD_PATHS = {
  polling: '/events/v1.0/events:polling',
  ack: '/events/v1.0/events/acknowledgment',
  order: (id: string) => `/order/v1.0/orders/${encodeURIComponent(id)}`,
  action: (id: string, verb: string) => `/order/v1.0/orders/${encodeURIComponent(id)}/${verb}`,
} as const;

/** Limites do iFood por minuto (a janela usa 80%). */
export const IFOOD_LIMITS = {
  polling: 6000,
  ack: 6000,
  order: 3000,
  action: 3000,
  cancellation: 300,
} as const;

/** Até 100 lojas por x-polling-merchants e 2.000 ids por ack. */
export const IFOOD_ACK_BATCH = 2000;

/** Prazo do iFood para confirmar (passou, ele cancela sozinho). */
export const IFOOD_CONFIRM_MINUTES = 8;

/** Código do evento (curto ou longo) → evento normalizado. O resto vira 'other' (ack e registra). */
const KIND: Record<string, ChannelEventKind> = {
  PLC: 'order.created',
  PLACED: 'order.created',
  CFM: 'order.confirmed',
  CONFIRMED: 'order.confirmed',
  PRS: 'order.preparing',
  PREPARATION_STARTED: 'order.preparing',
  SPS: 'order.preparing',
  SEPARATION_STARTED: 'order.preparing',
  RTP: 'order.ready',
  READY_TO_PICKUP: 'order.ready',
  DSP: 'order.dispatched',
  DISPATCHED: 'order.dispatched',
  CON: 'order.concluded',
  CONCLUDED: 'order.concluded',
  CAN: 'order.cancelled',
  CANCELLED: 'order.cancelled',
  CAR: 'order.cancellation_requested',
  CANCELLATION_REQUESTED: 'order.cancellation_requested',
  CARF: 'order.cancellation_denied',
  CANCELLATION_REQUEST_FAILED: 'order.cancellation_denied',
  CCR: 'order.dispute',
  CONSUMER_CANCELLATION_REQUESTED: 'order.dispute',
  HSD: 'order.dispute',
  HANDSHAKE_DISPUTE: 'order.dispute',
  HSS: 'order.dispute_settled',
  HANDSHAKE_SETTLEMENT: 'order.dispute_settled',
};

/** Eventos do grupo de entrega (entregador do iFood a caminho, chegou...): só registro na Fase 2. */
const DELIVERY_CODES = new Set([
  'ADR',
  'ASSIGN_DRIVER',
  'GTO',
  'GOING_TO_ORIGIN',
  'AAO',
  'ARRIVED_AT_ORIGIN',
  'CLT',
  'COLLECTED',
  'AAD',
  'ARRIVED_AT_DESTINATION',
  'RDA',
  'REQUEST_DRIVER_AVAILABILITY',
  'DELIVERY_DROP_CODE_REQUESTED',
  'DELIVERY_PICKUP_CODE_REQUESTED',
]);

export function ifoodEventKind(code?: string, fullCode?: string): ChannelEventKind {
  for (const c of [fullCode, code]) {
    const k = c ? KIND[c.toUpperCase()] : undefined;
    if (k) return k;
  }
  if ([fullCode, code].some((c) => c && DELIVERY_CODES.has(c.toUpperCase())))
    return 'delivery.update';
  return 'other';
}

/** Ação do Comandou → verbo da Order API. null = o iFood não tem essa ação (não manda nada). */
export function ifoodVerb(action: ChannelAction): string | null {
  switch (action) {
    case 'confirm':
      return 'confirm';
    case 'start_preparation':
      return 'startPreparation';
    case 'ready':
      return 'readyToPickup';
    case 'dispatch':
      return 'dispatch';
    case 'reject':
    case 'request_cancellation':
      return 'requestCancellation';
    default:
      // Entregue: quem conclui é o iFood (CONCLUDED até 2 h depois da entrega).
      return null;
  }
}

/** Motivo padrão da recusa: "Dificuldades internas do restaurante" (a lista por pedido vem na Fase 3). */
export const IFOOD_DEFAULT_CANCEL_CODE = '509';

// ---------------------------------------------------------------------------------------------
// Pedido

type Num = number | string | null | undefined;

interface IfoodOption {
  id?: string;
  name?: string;
  externalCode?: string;
  quantity?: Num;
  unitPrice?: Num;
  price?: Num;
  addition?: Num;
  customizations?: IfoodOption[];
}

interface IfoodItem {
  id?: string;
  name?: string;
  externalCode?: string;
  unit?: string;
  quantity?: Num;
  unitPrice?: Num;
  price?: Num;
  optionsPrice?: Num;
  totalPrice?: Num;
  observations?: string;
  options?: IfoodOption[];
}

export interface IfoodOrder {
  id: string;
  displayId?: string;
  orderType?: string;
  orderTiming?: string;
  createdAt?: string;
  preparationStartDateTime?: string;
  extraInfo?: string;
  merchant?: { id?: string; name?: string };
  customer?: {
    name?: string;
    documentNumber?: string;
    phone?: { number?: string; localizer?: string };
  };
  items?: IfoodItem[];
  benefits?: {
    value?: Num;
    target?: string;
    sponsorshipValues?: { name?: string; value?: Num }[];
  }[];
  total?: {
    subTotal?: Num;
    deliveryFee?: Num;
    benefits?: Num;
    orderAmount?: Num;
    additionalFees?: Num;
  };
  additionalFees?: { type?: string; value?: Num }[];
  payments?: {
    prepaid?: Num;
    pending?: Num;
    methods?: {
      value?: Num;
      method?: string;
      type?: string;
      prepaid?: boolean;
      card?: { brand?: string };
      cash?: { changeFor?: Num };
    }[];
  };
  delivery?: {
    deliveredBy?: string;
    deliveryDateTime?: string;
    pickupCode?: string;
    observations?: string;
    deliveryAddress?: {
      formattedAddress?: string;
      streetName?: string;
      streetNumber?: string;
      neighborhood?: string;
      city?: string;
      complement?: string;
      reference?: string;
      coordinates?: { latitude?: Num; longitude?: Num };
    };
  };
  takeout?: { takeoutDateTime?: string };
  indoor?: { deliveryDateTime?: string; table?: string };
  schedule?: { deliveryDateTimeStart?: string; deliveryDateTimeEnd?: string };
}

/** Reais do iFood (número) → centavos inteiros, sem erro de ponto flutuante. */
export function ifoodCents(v: Num): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const money = (v: Num) => fromCents(Math.max(0, ifoodCents(v)));
const cut = (v: string | undefined | null, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};
const qtyOf = (v: Num) => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 1;
};

const METHOD: Record<string, ExternalPayment['method']> = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  PIX: 'pix',
  CASH: 'cash',
  MEAL_VOUCHER: 'voucher',
  FOOD_VOUCHER: 'voucher',
  GIFT_CARD: 'voucher',
};

function options(list: IfoodOption[] | undefined, depth = 0): ExternalOption[] {
  if (!list?.length || depth > 2) return [];
  return list.flatMap((op) => {
    const q = qtyOf(op.quantity);
    const unit =
      op.unitPrice !== undefined && op.unitPrice !== null
        ? ifoodCents(op.unitPrice)
        : Math.round(ifoodCents(op.price ?? op.addition) / q);
    const self: ExternalOption = {
      ...(cut(op.id, 100) ? { externalId: cut(op.id, 100) } : {}),
      ...(cut(op.externalCode, 100) ? { externalCode: cut(op.externalCode, 100) } : {}),
      name: cut(op.name, 200) ?? 'Complemento',
      quantity: q,
      unitPrice: fromCents(Math.max(0, unit)),
    };
    return [self, ...options(op.customizations, depth + 1)];
  });
}

function item(i: IfoodItem): ExternalItem {
  const quantity = qtyOf(i.quantity);
  const isKg = i.unit?.toUpperCase() === 'KG';
  // O total da linha é o que vale (item + complementos, como o iFood cobrou).
  const total =
    i.totalPrice !== undefined && i.totalPrice !== null
      ? ifoodCents(i.totalPrice)
      : ifoodCents(i.price) + ifoodCents(i.optionsPrice);
  return {
    ...(cut(i.id, 100) ? { externalId: cut(i.id, 100) } : {}),
    ...(cut(i.externalCode, 100) ? { externalCode: cut(i.externalCode, 100) } : {}),
    name: cut(i.name, 200) ?? 'Item do iFood',
    quantity,
    unit: isKg ? 'kg' : 'un',
    unitPrice: fromCents(Math.max(0, Math.round(total / quantity))),
    total: fromCents(Math.max(0, total)),
    ...(cut(i.observations, 500) ? { notes: cut(i.observations, 500) } : {}),
    options: options(i.options).slice(0, 100),
  };
}

function discounts(o: IfoodOrder): ExternalDiscount[] {
  const out: ExternalDiscount[] = [];
  for (const b of o.benefits ?? []) {
    const target = b.target?.toUpperCase() === 'DELIVERY_FEE' ? 'delivery' : 'items';
    const parts = (b.sponsorshipValues ?? []).filter((s) => ifoodCents(s.value) > 0);
    if (!parts.length) {
      // Sem quem paga: o iFood manda sempre; se faltar, conta como do iFood (não mexe na receita).
      if (ifoodCents(b.value) > 0) out.push({ amount: money(b.value), sponsor: 'channel', target });
      continue;
    }
    for (const s of parts) {
      const who = s.name?.toUpperCase();
      out.push({
        amount: money(s.value),
        sponsor: who === 'MERCHANT' || who === 'CHAIN' ? 'merchant' : 'channel',
        target,
        ...(who ? { description: `Benefício ${who}` } : {}),
      });
    }
  }
  return out.slice(0, 20);
}

function payments(o: IfoodOrder): ExternalPayment[] {
  return (o.payments?.methods ?? [])
    .filter((m) => ifoodCents(m.value) > 0)
    .slice(0, 10)
    .map((m) => {
      const prepaid = m.prepaid ?? m.type?.toUpperCase() === 'ONLINE';
      const change = ifoodCents(m.cash?.changeFor);
      return {
        prepaid,
        method: METHOD[m.method?.toUpperCase() ?? ''] ?? 'other',
        amount: money(m.value),
        ...(cut(m.card?.brand, 40) ? { brand: cut(m.card?.brand, 40) } : {}),
        ...(change > 0 ? { changeFor: fromCents(change) } : {}),
      };
    });
}

function addMinutes(iso: string | undefined, min: number) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t + min * 60_000).toISOString() : undefined;
}

const validIso = (v?: string) => (v && Number.isFinite(Date.parse(v)) ? v : undefined);

/** Pedido do iFood (GET /orders/{id}) → pedido normalizado. */
export function ifoodToExternal(o: IfoodOrder): ExternalOrder {
  const type = o.orderType?.toUpperCase();
  const fulfillment =
    type === 'TAKEOUT'
      ? 'takeout'
      : type === 'DINE_IN' || type === 'INDOOR'
        ? 'dine_in'
        : 'delivery';
  const scheduled = o.orderTiming?.toUpperCase() === 'SCHEDULED';
  const createdAt = validIso(o.createdAt) ?? new Date().toISOString();
  const prepareFrom = validIso(o.preparationStartDateTime);
  const scheduledFor = scheduled
    ? validIso(
        o.schedule?.deliveryDateTimeStart ??
          o.takeout?.takeoutDateTime ??
          o.indoor?.deliveryDateTime ??
          o.delivery?.deliveryDateTime,
      )
    : undefined;
  const a = o.delivery?.deliveryAddress;
  const street = [a?.streetName, a?.streetNumber].filter(Boolean).join(', ');
  const addressText =
    cut(a?.formattedAddress, 400) ??
    cut([street, a?.neighborhood, a?.city].filter(Boolean).join(' - '), 400);
  const lat = Number(a?.coordinates?.latitude);
  const lng = Number(a?.coordinates?.longitude);
  const doc = o.customer?.documentNumber?.replace(/\D/g, '');
  const fees =
    o.total?.additionalFees !== undefined && o.total?.additionalFees !== null
      ? ifoodCents(o.total.additionalFees)
      : (o.additionalFees ?? []).reduce((n, f) => n + ifoodCents(f.value), 0);
  const notes = [o.extraInfo, o.delivery?.observations, o.indoor?.table && `Mesa ${o.indoor.table}`]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(' · ');
  return {
    channel: 'ifood',
    externalId: o.id,
    displayCode: cut(o.displayId, 40) ?? o.id.slice(0, 8),
    storeId: (o.merchant?.id ?? '').toLowerCase(),
    createdAt,
    fulfillment,
    timing: scheduled ? 'scheduled' : 'immediate',
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(prepareFrom ? { prepareFrom } : {}),
    // Retirada e consumo no local: quem entrega é o restaurante.
    deliveredBy:
      fulfillment === 'delivery' && o.delivery?.deliveredBy?.toUpperCase() !== 'MERCHANT'
        ? 'channel'
        : 'merchant',
    customer: {
      name: cut(o.customer?.name, 120) ?? '',
      ...(cut(o.customer?.phone?.number, 40) ? { phone: cut(o.customer?.phone?.number, 40) } : {}),
      ...(cut(o.customer?.phone?.localizer, 40)
        ? { phoneLocator: cut(o.customer?.phone?.localizer, 40) }
        : {}),
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
    items: (o.items ?? []).slice(0, 200).map(item),
    totals: {
      subtotal: money(o.total?.subTotal),
      deliveryFee: money(o.total?.deliveryFee),
      serviceFee: fromCents(Math.max(0, fees)),
      total: money(o.total?.orderAmount),
    },
    discounts: discounts(o),
    payments: payments(o),
    ...(notes ? { notes: notes.slice(0, 1000) } : {}),
    ...(cut(o.delivery?.pickupCode, 40) ? { pickupCode: cut(o.delivery?.pickupCode, 40) } : {}),
    deadlines: {
      confirmBy: addMinutes(
        scheduled ? (prepareFrom ?? createdAt) : createdAt,
        IFOOD_CONFIRM_MINUTES,
      ),
    },
  };
}
