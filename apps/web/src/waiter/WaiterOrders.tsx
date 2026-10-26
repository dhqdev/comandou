import { CHANNEL_LABELS, fromCents, toCents } from '@comandou/shared';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Badge, EmptyState, Spinner } from '../design-system';
import { SlideTabs } from '../features/SlideTabs';
import { ORDER_STATUS_LABELS, qty, STATUS_TONE, time } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order } from '../lib/types';
import { WaiterHead } from './common';

type Filter = 'all' | 'open' | 'ready';
const OPEN = new Set(['awaiting', 'new', 'in_production', 'cancel_requested']);

/** Meus pedidos: o que o garçom lançou hoje, com o andamento na cozinha. */
export function WaiterOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    try {
      setOrders(
        await api<Order[]>(
          `/orders?mine=true&limit=300&from=${encodeURIComponent(from.toISOString())}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed') reload();
  }, load);

  const all = orders ?? [];
  const valid = all.filter((o) => o.status !== 'cancelled');
  const sold = valid.reduce((s, o) => s + toCents(o.total), 0);
  const open = all.filter((o) => OPEN.has(o.status));
  const ready = all.filter((o) => o.status === 'ready');
  const shown = filter === 'open' ? open : filter === 'ready' ? ready : all;

  return (
    <div className="wt-page">
      <WaiterHead title="Meus pedidos" sub="Lançados por você hoje" back="/garcom/mesas" />
      <div className="wt-kpis">
        <div>
          <span>Pedidos</span>
          <strong>{valid.length}</strong>
        </div>
        <div>
          <span>Vendido</span>
          <strong>{brl(fromCents(sold))}</strong>
        </div>
        <div>
          <span>Prontos</span>
          <strong>{ready.length}</strong>
        </div>
      </div>
      <SlideTabs<Filter>
        label="Filtrar pedidos"
        value={filter}
        onChange={setFilter}
        className="wt-switch"
        tabs={[
          { value: 'all', label: 'Todos', count: all.length },
          { value: 'open', label: 'Em andamento', count: open.length },
          { value: 'ready', label: 'Prontos', count: ready.length },
        ]}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {orders === null ? (
        !error && <Spinner />
      ) : shown.length === 0 ? (
        <EmptyState
          mascot="joy"
          title={all.length ? 'Nada por aqui' : 'Nenhum pedido hoje ainda'}
          description="Os pedidos que você lançar aparecem aqui com o andamento da cozinha."
        />
      ) : (
        <div className="wt-list">
          {shown.map((o) => {
            const where = o.tableLabel
              ? `Mesa ${o.tableLabel}`
              : o.tabNumber
                ? `Comanda ${o.tabNumber}`
                : CHANNEL_LABELS[o.channel];
            const expanded = openId === o.id;
            return (
              <article key={o.id} className="wt-ticket" data-status={o.status}>
                <button
                  type="button"
                  className="wt-ticket__head wt-ticket__head--btn"
                  aria-expanded={expanded}
                  onClick={() =>
                    o.tabId
                      ? navigate(`/garcom/comanda/${o.tabId}`)
                      : setOpenId(expanded ? null : o.id)
                  }
                >
                  <strong>#{o.number}</strong>
                  <span className="wt-ticket__where">
                    {where}
                    {o.customerName && !o.tableLabel ? ` · ${o.customerName}` : ''}
                    <span className="cm-hint"> · {time(o.createdAt)}</span>
                  </span>
                  <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  <strong className="wt-ticket__total">{brl(o.total)}</strong>
                  {o.tabId && <ChevronRight size={16} aria-hidden />}
                </button>
                {(expanded || !o.tabId) && (
                  <p className="wt-ticket__summary">
                    {o.items.map((i) => `${qty(i.quantity)}× ${i.name}`).join(' · ')}
                  </p>
                )}
                {expanded && o.deliveryAddress && (
                  <p className="wt-ticket__note">Entrega: {o.deliveryAddress}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
