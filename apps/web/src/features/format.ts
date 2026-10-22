import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderStatus,
  type PaymentStatus,
} from '@comandou/shared';

export { CHANNEL_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS };

export const STATUS_TONE: Record<
  OrderStatus,
  'info' | 'warning' | 'success' | 'neutral' | 'danger' | 'brand'
> = {
  new: 'info',
  in_production: 'warning',
  ready: 'success',
  dispatched: 'brand',
  completed: 'neutral',
  cancel_requested: 'danger',
  cancelled: 'danger',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'A pagar',
  partial: 'Pago parcial',
  paid: 'Pago',
};
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, 'danger' | 'warning' | 'success'> = {
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
};

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Minutos desde `iso` usando o relógio do servidor como referência quando disponível. */
export function minutesSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export const qty = (q: string) =>
  Number.isInteger(Number(q)) ? String(Number(q)) : q.replace('.', ',');
