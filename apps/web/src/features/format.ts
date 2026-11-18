import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  channelInfo,
  recordedPaymentLabel,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@comandou/shared';

export { CHANNEL_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS };

export const STATUS_TONE: Record<
  OrderStatus,
  'info' | 'warning' | 'success' | 'neutral' | 'danger' | 'brand'
> = {
  awaiting: 'warning',
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

/**
 * Tempo decorrido curto para cartões: "12 min", "2 h 05", "3 d". Comanda esquecida aberta
 * há dias não vira "8808 min".
 */
export function elapsed(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }
  return `${Math.floor(min / (24 * 60))} d`;
}

export const qty = (q: string) =>
  Number.isInteger(Number(q)) ? String(Number(q)) : q.replace('.', ',');

/** Nome de um pagamento gravado; o pago no aplicativo diz qual e a forma ("Pago no iFood · PIX"). */
export function paymentLabel(p: {
  method: PaymentMethod | 'app';
  appChannel?: string | null;
  appMethod?: PaymentMethod | null;
}): string {
  return recordedPaymentLabel(p.method, {
    channelLabel: p.appChannel ? channelInfo(p.appChannel).label : null,
    method: p.appMethod ?? null,
  });
}
