/**
 * Aplicativos de delivery (canais): iFood, Keeta, 99Food, Rappi, aiqfome e os que falam Open
 * Delivery. Aqui ficam o que API e telas dividem: nomes e cores dos canais, o que cada canal
 * oferece, os eventos normalizados e o PEDIDO NORMALIZADO, que é o mesmo para todos os canais
 * (ADR 0015). Dinheiro sempre em string decimal ("12.90"), nunca float.
 */
import { fromCents, toCents } from './money';
import { canTransition, type OrderChannel, type OrderStatus } from './orders';

export const KNOWN_CHANNELS = [
  'ifood',
  'keeta',
  '99food',
  'rappi',
  'aiqfome',
  'opendelivery',
] as const;
export type KnownChannel = (typeof KNOWN_CHANNELS)[number];

/** Id de canal: os conhecidos ou um aplicativo Open Delivery cadastrado (`od-<nome>`). */
export const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9_-]{1,30}$/;
export type ChannelId = KnownChannel | (string & {});

export interface ChannelInfo {
  label: string;
  /** Cor do selo (fundo) e do texto, iguais no claro e no escuro (são cores de marca). */
  color: string;
  ink: string;
}

export const CHANNEL_INFO: Record<KnownChannel, ChannelInfo> = {
  ifood: { label: 'iFood', color: '#EA1D2C', ink: '#FFFFFF' },
  keeta: { label: 'Keeta', color: '#FFD100', ink: '#1F1F1F' },
  '99food': { label: '99Food', color: '#FFDD00', ink: '#1F1F1F' },
  rappi: { label: 'Rappi', color: '#FF441F', ink: '#FFFFFF' },
  aiqfome: { label: 'aiqfome', color: '#7B1FA2', ink: '#FFFFFF' },
  opendelivery: { label: 'Open Delivery', color: '#2563EB', ink: '#FFFFFF' },
};

/** Nome e cores de qualquer canal (os desconhecidos usam o nome cadastrado e cinza). */
export function channelInfo(channel: string, name?: string): ChannelInfo {
  const known = (CHANNEL_INFO as Record<string, ChannelInfo>)[channel];
  if (known) return known;
  return { label: name || channel, color: '#475569', ink: '#FFFFFF' };
}

/** Aplicativos que se fala no feminino ("a Keeta", "a 99Food", "a Rappi"). */
const FEMININE = new Set(['Keeta', '99Food', 'Rappi']);
const ARTICLES = {
  o: ['o', 'a'],
  O: ['O', 'A'],
  do: ['do', 'da'],
  no: ['no', 'na'],
  pelo: ['pelo', 'pela'],
  ao: ['ao', 'à'],
} as const;

/** Nome do aplicativo com o artigo certo: "do iFood", "da Keeta", "na 99Food". */
export function withArticle(label: string, prep: keyof typeof ARTICLES): string {
  return `${ARTICLES[prep][FEMININE.has(label) ? 1 : 0]} ${label}`;
}

/** O que um canal pode oferecer. A tela mostra o que falta, sem esconder. */
export const CHANNEL_CAPABILITIES = [
  'orders',
  'polling',
  'webhook',
  'confirm',
  'reject',
  'startPreparation',
  'ready',
  'dispatch',
  'delivered',
  'cancel',
  'disputes',
  'tracking',
  'courier',
  'storeStatus',
  'pause',
  'openingHours',
  'menu',
  'availability',
  'reviews',
  'settlements',
] as const;
export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<ChannelCapability, string> = {
  orders: 'Receber pedidos',
  polling: 'Busca de pedidos (polling)',
  webhook: 'Aviso de pedidos (webhook)',
  confirm: 'Aceitar pedido',
  reject: 'Recusar pedido',
  startPreparation: 'Avisar início do preparo',
  ready: 'Avisar pedido pronto',
  dispatch: 'Avisar saída para entrega',
  delivered: 'Avisar entregue',
  cancel: 'Cancelar pelo Comandou',
  disputes: 'Pedido de cancelamento ou reembolso do cliente',
  tracking: 'Rastreio da entrega',
  courier: 'Chamar entregador do aplicativo',
  storeStatus: 'Loja aberta ou fechada',
  pause: 'Pausar a loja',
  openingHours: 'Horários',
  menu: 'Enviar cardápio',
  availability: 'Disponibilidade dos itens',
  reviews: 'Avaliações',
  settlements: 'Repasses',
};

/**
 * Evento normalizado. Cada adaptador traduz o código do canal (PLC, CREATED, NEW_ORDER…) para um
 * destes; o que não tem tradução vira `other` e é só registrado.
 */
export const CHANNEL_EVENT_KINDS = [
  'order.created',
  'order.confirmed',
  'order.preparing',
  'order.ready',
  'order.dispatched',
  'order.delivered',
  'order.concluded',
  'order.cancellation_requested',
  'order.cancellation_denied',
  'order.cancelled',
  'order.dispute',
  'order.dispute_settled',
  'delivery.update',
  'other',
] as const;
export type ChannelEventKind = (typeof CHANNEL_EVENT_KINDS)[number];

/** Estado do Comandou que um evento do canal leva (só para a frente; null = não muda). */
export function statusForEvent(kind: ChannelEventKind): OrderStatus | null {
  switch (kind) {
    case 'order.confirmed':
      return 'new';
    case 'order.preparing':
      return 'in_production';
    case 'order.ready':
      return 'ready';
    case 'order.dispatched':
      return 'dispatched';
    case 'order.delivered':
    case 'order.concluded':
      return 'completed';
    case 'order.cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

const RANK: Record<OrderStatus, number> = {
  awaiting: 0,
  new: 1,
  in_production: 2,
  ready: 3,
  dispatched: 4,
  completed: 5,
  cancel_requested: 1,
  cancelled: 9,
};

/**
 * O canal só empurra o pedido para a frente: evento atrasado (ex.: CONFIRMED chegando depois do
 * READY) não volta o estado, e pedido concluído ou cancelado não muda mais (ADR 0015, "quem
 * vence"). Cancelamento vindo do canal vale a partir de qualquer estado aberto.
 */
export function channelMovesForward(current: OrderStatus, next: OrderStatus): boolean {
  if (current === next) return false;
  if (current === 'completed' || current === 'cancelled') return false;
  if (next === 'cancelled') return true;
  if (current === 'cancel_requested') return RANK[next] >= 1;
  return RANK[next] > RANK[current];
}

const FORWARD: OrderStatus[] = [
  'awaiting',
  'new',
  'in_production',
  'ready',
  'dispatched',
  'completed',
];

/**
 * Passos para levar o pedido do estado atual ao que o canal informou, sem pular regras da máquina
 * de estados (ex.: novo → pronto → saiu → concluído quando o canal manda "saiu" com o pedido ainda
 * novo). [] = nada a fazer; null = não dá (ex.: cancelar um pedido que já saiu para entrega).
 * Pedido que não é de entrega não passa por "saiu para entrega": vira "pronto".
 */
export function channelPath(
  from: OrderStatus,
  to: OrderStatus,
  channel: OrderChannel,
): OrderStatus[] | null {
  if (to === 'dispatched' && channel !== 'delivery') to = 'ready';
  if (!channelMovesForward(from, to)) return [];
  if (canTransition(from, to, channel)) return [to];
  if (to === 'cancelled') return null;
  const steps: OrderStatus[] = [];
  let cur = from;
  const target = FORWARD.indexOf(to);
  while (cur !== to) {
    // O passo mais longo permitido a partir daqui, sem passar do destino.
    let next: OrderStatus | null = null;
    for (let i = target; i >= 0; i--) {
      const s = FORWARD[i]!;
      const ahead = cur === 'cancel_requested' || i > FORWARD.indexOf(cur);
      if (ahead && s !== cur && canTransition(cur, s, channel)) {
        next = s;
        break;
      }
    }
    if (!next) return null;
    steps.push(next);
    cur = next;
  }
  return steps;
}

/** Ação do Comandou que vai para o canal pela caixa de saída. */
export const CHANNEL_ACTIONS = [
  'confirm',
  'reject',
  'start_preparation',
  'ready',
  'dispatch',
  'delivered',
  'picked_up',
  'request_cancellation',
  'dispute_accept',
  'dispute_reject',
  'dispute_alternative',
] as const;
export type ChannelAction = (typeof CHANNEL_ACTIONS)[number];

export const CHANNEL_ACTION_LABELS: Record<ChannelAction, string> = {
  confirm: 'Aceitar',
  reject: 'Recusar',
  start_preparation: 'Início do preparo',
  ready: 'Pronto',
  dispatch: 'Saiu para entrega',
  delivered: 'Entregue',
  picked_up: 'Retirado pelo cliente',
  request_cancellation: 'Pedido de cancelamento',
  dispute_accept: 'Aceite do pedido do cliente',
  dispute_reject: 'Recusa do pedido do cliente',
  dispute_alternative: 'Proposta ao cliente',
};

export const CHANNEL_ACTION_CAPABILITY: Record<ChannelAction, ChannelCapability> = {
  confirm: 'confirm',
  reject: 'reject',
  start_preparation: 'startPreparation',
  ready: 'ready',
  dispatch: 'dispatch',
  delivered: 'delivered',
  // Retirada no balcão: vai junto com "avisar entregue" (só a 99Food pede esse aviso).
  picked_up: 'delivered',
  request_cancellation: 'cancel',
  dispute_accept: 'disputes',
  dispute_reject: 'disputes',
  dispute_alternative: 'disputes',
};

/**
 * Mudança de estado no Comandou → ação no canal. null = o canal não precisa saber.
 * `dispatch` só vale para entrega feita pelo restaurante.
 */
export function actionForTransition(
  from: OrderStatus,
  to: OrderStatus,
  deliveredBy: 'merchant' | 'channel' | null,
): ChannelAction | null {
  if (from === 'awaiting' && to === 'new') return 'confirm';
  if (from === 'awaiting' && to === 'cancelled') return 'reject';
  if (to === 'in_production') return 'start_preparation';
  if (to === 'ready' && from !== 'dispatched') return 'ready';
  if (to === 'dispatched') return deliveredBy === 'merchant' ? 'dispatch' : null;
  if (to === 'completed' && from === 'dispatched' && deliveredBy === 'merchant') return 'delivered';
  // Concluído sem sair para entrega: o cliente retirou no balcão.
  if (to === 'completed' && from === 'ready' && deliveredBy === 'merchant') return 'picked_up';
  if (to === 'cancel_requested') return 'request_cancellation';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Negociação: o cliente pede algo depois do pedido (cancelar, reembolso...) e o restaurante responde

export const DISPUTE_KIND_LABELS: Record<string, string> = {
  CANCELLATION: 'O cliente pede para cancelar o pedido',
  PARTIAL_CANCELLATION: 'O cliente pede para cancelar parte do pedido',
  PROPOSED_AMOUNT_REFUND: 'O cliente pede reembolso de parte do valor',
  PROPOSED_ADDITIONAL_TIME: 'O aplicativo pede mais tempo para a entrega',
  REFUND_REQUEST: 'O cliente pede reembolso do pedido',
};

export function disputeKindLabel(kind: string): string {
  return DISPUTE_KIND_LABELS[kind] ?? 'O cliente pediu algo sobre o pedido';
}

/** O que o canal faz se o restaurante não responder no prazo. */
export function disputeTimeoutLabel(action: string | null | undefined): string | null {
  if (!action) return null;
  if (/^ACCEPT/.test(action)) return 'Sem resposta, o aplicativo aceita sozinho';
  if (/^REJECT/.test(action)) return 'Sem resposta, o aplicativo recusa sozinho';
  return null;
}

export type DisputeAlternativeType = 'REFUND' | 'BENEFIT' | 'ADDITIONAL_TIME' | (string & {});

export interface DisputeAlternative {
  id: string;
  type: DisputeAlternativeType;
  /** REFUND/BENEFIT: até quanto pode propor (string decimal). */
  maxAmount?: string;
  /** ADDITIONAL_TIME: minutos que o canal aceita. */
  minutes?: number[];
  /** ADDITIONAL_TIME: motivos que o canal aceita. */
  reasons?: string[];
}

export const DISPUTE_ALTERNATIVE_LABELS: Record<string, string> = {
  REFUND: 'Propor reembolso parcial',
  BENEFIT: 'Propor cupom para o cliente',
  ADDITIONAL_TIME: 'Pedir mais tempo',
};

export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Esperando sua resposta',
  accepted: 'Você aceitou',
  rejected: 'Você recusou',
  alternative: 'Você fez uma proposta',
  settled: 'Resolvido no aplicativo',
};

/** Motivo de cancelamento que o canal aceita (iFood: lista por pedido). */
export interface ChannelCancelReason {
  code: string;
  label: string;
}

// ---------------------------------------------------------------------------------------------
// Entregador do aplicativo (Fase 5)

export const DRIVER_STATUSES = [
  'requested',
  'request_failed',
  'assigned',
  'to_store',
  'at_store',
  'collected',
  'at_customer',
  'cancelled',
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  requested: 'Procurando entregador',
  request_failed: 'Não achou entregador',
  assigned: 'Entregador a caminho',
  to_store: 'Entregador a caminho',
  at_store: 'Entregador chegou na loja',
  collected: 'Pedido com o entregador',
  at_customer: 'Entregador chegou no cliente',
  cancelled: 'Entregador cancelado',
};

/** Ordem do caminho do entregador: evento atrasado não volta a situação. */
const DRIVER_RANK: Record<DriverStatus, number> = {
  requested: 1,
  request_failed: 1,
  cancelled: 1,
  assigned: 2,
  to_store: 3,
  at_store: 4,
  collected: 5,
  at_customer: 6,
};

/** Vale trocar a situação do entregador de `from` para `to`? (falha e cancelamento sempre valem) */
export function driverMovesForward(from: DriverStatus | null, to: DriverStatus): boolean {
  if (!from || to === 'request_failed' || to === 'cancelled') return true;
  if (from === 'request_failed' || from === 'cancelled') return true;
  return DRIVER_RANK[to] > DRIVER_RANK[from];
}

/** Entregador em andamento (o restaurante não despacha com entregador próprio). */
export const DRIVER_ACTIVE: readonly DriverStatus[] = [
  'requested',
  'assigned',
  'to_store',
  'at_store',
  'collected',
  'at_customer',
];

// ---------------------------------------------------------------------------------------------
// Loja no aplicativo: aberta, fechada ou pausada (Fase 4)

export const CHANNEL_STORE_STATES = [
  'open',
  'closed',
  'paused',
  'warning',
  'error',
  'unknown',
] as const;
export type ChannelStoreState = (typeof CHANNEL_STORE_STATES)[number];

export const CHANNEL_STORE_STATE_LABELS: Record<ChannelStoreState, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paused: 'Pausada',
  warning: 'Aberta, com aviso',
  error: 'Com problema',
  unknown: 'Sem informação',
};

/** Turno de funcionamento no aplicativo (só para mostrar). day: 0 = domingo. */
export interface ChannelShift {
  day: number;
  start: string;
  minutes: number;
}

/** Durações de pausa oferecidas na tela, em minutos (null = até reabrir, no máximo do canal). */
export const CHANNEL_PAUSE_OPTIONS: { minutes: number | null; label: string }[] = [
  { minutes: 15, label: '15 minutos' },
  { minutes: 30, label: '30 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 120, label: '2 horas' },
  { minutes: null, label: 'Até eu reabrir' },
];

const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Seg 10:00–22:00 · Ter 10:00–22:00…" (dias sem turno ficam de fora). */
export function shiftsLabel(shifts: readonly ChannelShift[]): string {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return [...shifts]
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    .map((s) => {
      const [h, m] = s.start.split(':').map(Number);
      const from = (h ?? 0) * 60 + (m ?? 0);
      return `${DAY_SHORT[s.day] ?? '?'} ${fmt(from)}–${fmt(from + s.minutes)}`;
    })
    .join(' · ');
}

export const OUTBOX_STATUSES = ['pending', 'sending', 'sent', 'confirmed', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: 'Na fila',
  sending: 'Enviando…',
  sent: 'Enviado',
  confirmed: 'Confirmado pelo aplicativo',
  failed: 'Falhou',
};

// ---------------------------------------------------------------------------------------------
// Pedido normalizado

export type ExternalFulfillment = 'delivery' | 'takeout' | 'dine_in';
export type ExternalTiming = 'immediate' | 'scheduled';
export type DeliveredBy = 'merchant' | 'channel';
export type SponsorOf = 'channel' | 'merchant';

export interface ExternalOption {
  externalId?: string;
  externalCode?: string;
  name: string;
  quantity: number;
  /** Preço unitário cobrado pelo aplicativo (por unidade da opção). */
  unitPrice: string;
}

export interface ExternalItem {
  externalId?: string;
  /** Código do item no canal (o `externalCode` que o Comandou mandou no cardápio, quando houver). */
  externalCode?: string;
  name: string;
  quantity: number;
  unit?: 'un' | 'kg';
  /** Preço unitário cobrado pelo aplicativo, já com as opções que somam ao item. */
  unitPrice: string;
  /** Total da linha (quantidade × unitário), como o aplicativo cobrou. */
  total: string;
  notes?: string;
  options: ExternalOption[];
}

export interface ExternalDiscount {
  amount: string;
  /** Quem paga o desconto: o aplicativo (vira parte do repasse) ou o restaurante. */
  sponsor: SponsorOf;
  target: 'items' | 'delivery';
  description?: string;
}

export interface ExternalPayment {
  /** Pago no aplicativo (online) ou na entrega/retirada. */
  prepaid: boolean;
  method: 'cash' | 'credit' | 'debit' | 'pix' | 'voucher' | 'other';
  amount: string;
  brand?: string;
  /** Troco para (dinheiro na entrega). */
  changeFor?: string;
}

export interface ExternalOrder {
  channel: ChannelId;
  /** Id do pedido no canal. */
  externalId: string;
  /** Código curto para falar com o cliente (ex.: displayId do iFood). */
  displayCode: string;
  /** Loja no canal (id externo). */
  storeId: string;
  createdAt: string;
  fulfillment: ExternalFulfillment;
  timing: ExternalTiming;
  /** Agendado: para quando (entrega ou retirada). */
  scheduledFor?: string;
  /** Agendado: a partir de quando preparar. */
  prepareFrom?: string;
  deliveredBy: DeliveredBy;
  customer: {
    name: string;
    /** Como vier: mascarado, localizador ou cifrado. Nunca vai para log. */
    phone?: string;
    phoneLocator?: string;
    /** CPF/CNPJ para a nota, só se o cliente pediu. */
    taxDocument?: string;
  };
  address?: {
    text: string;
    complement?: string;
    reference?: string;
    lat?: number;
    lng?: number;
  };
  items: ExternalItem[];
  totals: {
    /** Soma dos itens como o aplicativo cobrou. */
    subtotal: string;
    deliveryFee: string;
    /** Outras taxas cobradas do cliente (serviço, embalagem). */
    serviceFee: string;
    /** Total que o cliente pagou. */
    total: string;
  };
  discounts: ExternalDiscount[];
  payments: ExternalPayment[];
  notes?: string;
  /** Código de retirada ou de entrega, se o canal tiver. */
  pickupCode?: string;
  /** Prazos que o canal exige. */
  deadlines?: {
    confirmBy?: string;
  };
}

/** Desconto que o restaurante paga (entra como desconto do pedido no Comandou), em centavos. */
export function merchantDiscountCents(o: Pick<ExternalOrder, 'discounts'>): number {
  return o.discounts
    .filter((d) => d.sponsor === 'merchant')
    .reduce((s, d) => s + toCents(d.amount), 0);
}

/** Desconto que o aplicativo paga (não reduz a receita: volta no repasse), em centavos. */
export function channelDiscountCents(o: Pick<ExternalOrder, 'discounts'>): number {
  return o.discounts
    .filter((d) => d.sponsor === 'channel')
    .reduce((s, d) => s + toCents(d.amount), 0);
}

/**
 * Valores do pedido no Comandou a partir do pedido do canal. O desconto pago pelo aplicativo NÃO
 * reduz o pedido (o restaurante recebe esse valor no repasse); o pago pelo restaurante reduz.
 * total = subtotal − desconto do restaurante + taxas + entrega.
 */
export function comandouTotals(o: ExternalOrder): {
  subtotal: string;
  discount: string;
  surcharge: string;
  deliveryFee: string;
  total: string;
  channelDiscount: string;
} {
  const subtotal = toCents(o.totals.subtotal);
  const discount = Math.min(merchantDiscountCents(o), subtotal);
  const surcharge = toCents(o.totals.serviceFee);
  const delivery = toCents(o.totals.deliveryFee);
  return {
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    surcharge: fromCents(surcharge),
    deliveryFee: fromCents(delivery),
    total: fromCents(subtotal - discount + surcharge + delivery),
    channelDiscount: fromCents(channelDiscountCents(o)),
  };
}

/** Pedido do canal → canal do Comandou (entrega, retirada ou balcão). */
export function orderChannelOf(f: ExternalFulfillment): 'delivery' | 'pickup' | 'counter' {
  return f === 'delivery' ? 'delivery' : f === 'takeout' ? 'pickup' : 'counter';
}

/** Segundos que faltam para o prazo de aceite (negativo = venceu). */
export function secondsToDeadline(
  deadline: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  return Number.isFinite(t) ? Math.floor((t - now) / 1000) : null;
}
