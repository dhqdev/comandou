import { Badge } from '../design-system';
import { brl } from '../lib/money';
import type { Order } from '../lib/types';
import { CHANNEL_LABELS, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, qty, time } from './format';

export function OrderCard({ order, onOpen }: { order: Order; onOpen(o: Order): void }) {
  const where = order.tableLabel
    ? `Mesa ${order.tableLabel}`
    : (order.customerName ?? CHANNEL_LABELS[order.channel]);
  return (
    <button
      className="order-card"
      onClick={() => onOpen(order)}
      aria-label={`Pedido ${order.number}`}
    >
      <div className="order-card__top">
        <strong>#{order.number}</strong>
        <span className="order-card__time">{time(order.createdAt)}</span>
      </div>
      <div className="order-card__where">
        <Badge>{CHANNEL_LABELS[order.channel]}</Badge> {where}
      </div>
      <ul className="order-card__items">
        {order.items.slice(0, 4).map((i) => (
          <li key={i.id} data-cancelled={i.status === 'cancelled' || undefined}>
            {qty(i.quantity)}× {i.name}
          </li>
        ))}
        {order.items.length > 4 && <li className="pm-hint">+{order.items.length - 4} itens</li>}
      </ul>
      <div className="order-card__bottom">
        <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
          {PAYMENT_STATUS_LABEL[order.paymentStatus]}
        </Badge>
        <strong>{brl(order.total)}</strong>
      </div>
    </button>
  );
}
