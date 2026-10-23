import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
} from '@comandou/shared';
import { ClipboardList } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, EmptyState, Skeleton, Select, DateInput } from '../design-system';
import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
  dateTime,
} from '../features/format';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order } from '../lib/types';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [channel, setChannel] = useState<OrderChannel | ''>('');
  const [day, setDay] = useState(() => startOfDay().toISOString().slice(0, 10));
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    const p = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: '500' });
    if (status) p.set('status', status);
    if (channel) p.set('channel', channel);
    try {
      setOrders(await api<Order[]>(`/orders?${p}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day, status, channel]);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed') reload();
  }, load);

  return (
    <>
      <div>
        <h1 className="page-title">Pedidos</h1>
        <p className="page-sub">Histórico do dia com status operacional e financeiro.</p>
      </div>
      <div className="filters">
        <label className="cm-field">
          <span className="cm-label">Dia</span>
          <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="cm-field">
          <span className="cm-label">Status</span>
          <Select
            className="cm-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
          >
            <option value="">Todos</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="cm-field">
          <span className="cm-label">Canal</span>
          <Select
            className="cm-input"
            value={channel}
            onChange={(e) => setChannel(e.target.value as OrderChannel | '')}
          >
            <option value="">Todos</option>
            {ORDER_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {orders === null ? (
          <div style={{ padding: 16 }}>
            <Skeleton height={160} />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState icon={<ClipboardList size={20} />} title="Nenhum pedido neste filtro" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table cm-table--click">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hora</th>
                  <th>Canal</th>
                  <th>Cliente / mesa</th>
                  <th>Status</th>
                  <th>Pagamento</th>
                  <th className="cm-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setOpenId(o.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenId(o.id)}
                  >
                    <td>
                      <strong>{o.number}</strong>
                    </td>
                    <td>{dateTime(o.createdAt)}</td>
                    <td>{CHANNEL_LABELS[o.channel]}</td>
                    <td>{o.tableLabel ? `Mesa ${o.tableLabel}` : (o.customerName ?? '—')}</td>
                    <td>
                      <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </td>
                    <td>
                      <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                        {PAYMENT_STATUS_LABEL[o.paymentStatus]}
                      </Badge>
                    </td>
                    <td className="cm-num">{brl(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
