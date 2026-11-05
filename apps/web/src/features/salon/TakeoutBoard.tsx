import { Bike, MapPin, Phone, ShoppingBag } from 'lucide-react';
import { Badge, EmptyState } from '../../design-system';
import { brl } from '../../lib/money';
import type { Order } from '../../lib/types';
import { elapsed, minutesSince, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '../format';

export type TakeoutChannel = 'delivery' | 'pickup';
export type TakeoutFilter = 'all' | 'kitchen' | 'ready' | 'route';

const STEPS: Record<TakeoutChannel, string[]> = {
  delivery: ['Recebido', 'Preparo', 'Pronto', 'Em rota'],
  pickup: ['Recebido', 'Preparo', 'Pronto'],
};

/** Em que passo da linha do pedido ele está (0 = recebido). */
export function stepOf(o: Order): number {
  switch (o.status) {
    case 'in_production':
      return 1;
    case 'ready':
      return 2;
    case 'dispatched':
      return 3;
    default:
      return 0;
  }
}

export function takeoutFilterOf(o: Order): Exclude<TakeoutFilter, 'all'> {
  const s = stepOf(o);
  return s === 3 ? 'route' : s === 2 ? 'ready' : 'kitchen';
}

/**
 * Pedidos de delivery ou para levar ainda em andamento: um cartão por pedido com a linha do
 * tempo (recebido → preparo → pronto → em rota). Tocar abre o pedido completo.
 */
export function TakeoutBoard({
  channel,
  orders,
  onOpen,
  emptyHint,
}: {
  channel: TakeoutChannel;
  orders: Order[];
  onOpen(id: string): void;
  emptyHint: string;
}) {
  const steps = STEPS[channel];
  if (orders.length === 0)
    return (
      <div className="salon-empty">
        <EmptyState
          icon={channel === 'delivery' ? <Bike size={20} /> : <ShoppingBag size={20} />}
          title={channel === 'delivery' ? 'Nenhuma entrega em andamento' : 'Nada para levar agora'}
          description={emptyHint}
        />
      </div>
    );
  return (
    <div className="order-cards">
      {orders.map((o) => {
        const step = stepOf(o);
        const mins = minutesSince(o.createdAt);
        const alert = o.status === 'awaiting' || o.status === 'cancel_requested';
        return (
          <button
            key={o.id}
            className="order-card"
            data-step={step}
            data-alert={alert || undefined}
            onClick={() => onOpen(o.id)}
            aria-label={`Pedido ${o.number}${o.customerName ? ` de ${o.customerName}` : ''}, ${steps[Math.min(step, steps.length - 1)].toLowerCase()}`}
          >
            <span className="order-card__head">
              <span className="order-card__num">#{o.number}</span>
              <span className="order-card__time" data-late={mins >= 40 || undefined}>
                {elapsed(mins)}
              </span>
            </span>
            <span className="order-card__who">
              <strong>{o.customerName || (channel === 'delivery' ? 'Cliente' : 'Balcão')}</strong>
              {channel === 'delivery' && o.deliveryAddress ? (
                <span className="cm-hint">
                  <MapPin size={12} aria-hidden /> {o.deliveryAddress}
                </span>
              ) : o.customerPhone ? (
                <span className="cm-hint">
                  <Phone size={12} aria-hidden /> {o.customerPhone}
                </span>
              ) : (
                <span className="cm-hint">
                  {o.items.reduce((n, i) => n + Number(i.quantity), 0)} item(ns)
                </span>
              )}
            </span>
            {alert ? (
              <span className="order-card__flag">
                {o.status === 'awaiting' ? 'Aguardando aceite' : 'Pediu cancelamento'}
              </span>
            ) : (
              <span className="order-track" aria-hidden>
                {steps.map((s, i) => (
                  <span key={s} className="order-track__step" data-done={i <= step || undefined}>
                    <i />
                    <small>{s}</small>
                  </span>
                ))}
              </span>
            )}
            <span className="order-card__foot">
              <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                {PAYMENT_STATUS_LABEL[o.paymentStatus]}
              </Badge>
              <strong>{brl(o.total)}</strong>
            </span>
          </button>
        );
      })}
    </div>
  );
}
