/**
 * Máquina de estados do pedido (status OPERACIONAL). O status FINANCEIRO (payment_status)
 * é independente: um pedido pode estar "completed" e "unpaid" (ex.: fiado/entrega a receber)
 * ou "paid" ainda em produção.
 */
export const ORDER_STATUSES = [
  'new',
  'in_production',
  'ready',
  'dispatched',
  'completed',
  'cancel_requested',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ['counter', 'table', 'delivery', 'pickup'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'credit', 'debit', 'pix', 'voucher', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ITEM_STATUSES = ['pending', 'preparing', 'ready', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

const T: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['in_production', 'ready', 'cancel_requested', 'cancelled'],
  in_production: ['ready', 'cancel_requested', 'cancelled'],
  ready: ['dispatched', 'completed', 'in_production', 'cancel_requested', 'cancelled'],
  dispatched: ['completed', 'ready'],
  completed: [],
  cancel_requested: ['cancelled', 'new', 'in_production', 'ready'],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, channel?: OrderChannel): boolean {
  if (!T[from]?.includes(to)) return false;
  // Só delivery passa por "saiu para entrega".
  if (to === 'dispatched' && channel && channel !== 'delivery') return false;
  return true;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Novo',
  in_production: 'Em produção',
  ready: 'Pronto',
  dispatched: 'Saiu para entrega',
  completed: 'Concluído',
  cancel_requested: 'Cancelamento solicitado',
  cancelled: 'Cancelado',
};

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  counter: 'Balcão',
  table: 'Mesa',
  delivery: 'Delivery',
  pickup: 'Retirada',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  pix: 'PIX',
  voucher: 'Vale-refeição',
  other: 'Outro',
};

export function paymentStatusFor(totalCents: number, paidCents: number): PaymentStatus {
  if (paidCents <= 0) return 'unpaid';
  if (paidCents < totalCents) return 'partial';
  return 'paid';
}

/**
 * Divide um valor em N partes inteiras de centavos; a diferença de arredondamento vai para
 * as primeiras partes (ex.: 100,00 / 3 = 33,34 + 33,33 + 33,33). A soma é sempre exata.
 */
export function splitCents(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1 || parts > 50)
    throw new Error('número de partes inválido');
  const base = Math.trunc(totalCents / parts);
  const rest = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}
