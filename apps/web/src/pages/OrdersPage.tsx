import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
} from '@comandou/shared';
import { ChevronDown, ChevronUp, ChevronsUpDown, ClipboardList, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, EmptyState, Skeleton } from '../design-system';
import {
  CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
  dateTime,
} from '../features/format';
import {
  dateBounds,
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../features/list-view';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order } from '../lib/types';
import './orders.css';

const LIMIT = 500;

const ACTIVE: OrderStatus[] = ORDER_STATUSES.filter((s) => s !== 'completed' && s !== 'cancelled');

const who = (o: Order) =>
  o.tableLabel
    ? `Mesa ${o.tableLabel}`
    : o.tabNumber
      ? `Comanda ${o.tabNumber}`
      : (o.customerName ?? '');

/** Nome e telefone do cliente embaixo da mesa/comanda (ou só o telefone). */
function subline(o: Order) {
  const name = o.customerName && o.customerName !== who(o) ? o.customerName : null;
  return [name, o.customerPhone].filter(Boolean).join(' · ');
}

function itemsSummary(o: Order) {
  return o.items.map((i) => `${Number(i.quantity)}× ${i.name}`).join(', ');
}

const digits = (s: string) => s.replace(/\D/g, '');
const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

const FIELDS: ListField<Order>[] = [
  {
    key: 'date',
    label: 'Data',
    kind: 'date',
    date: (o) => o.createdAt,
    pinned: true,
    server: true,
  },
  {
    key: 'status',
    label: 'Status op.',
    value: (o) => o.status,
    options: opts(ORDER_STATUSES, ORDER_STATUS_LABELS),
    pinned: true,
  },
  {
    key: 'channel',
    label: 'Tipo',
    value: (o) => o.channel,
    options: opts(ORDER_CHANNELS, CHANNEL_LABELS),
    pinned: true,
  },
  {
    key: 'payment',
    label: 'Status fin.',
    value: (o) => o.paymentStatus,
    options: opts(PAYMENT_STATUSES, PAYMENT_STATUS_LABEL),
  },
  {
    key: 'source',
    label: 'Origem',
    value: (o) => o.source ?? 'staff',
    options: [
      { value: 'staff', label: 'Equipe' },
      { value: 'online', label: 'Cardápio online' },
    ],
  },
  {
    key: 'paymentHint',
    label: 'Forma de pagamento',
    value: (o) => [
      ...new Set([
        ...(o.payments ?? []).map((p) => p.method),
        ...(o.paymentHint ? [o.paymentHint] : []),
      ]),
    ],
    options: opts(PAYMENT_METHODS, PAYMENT_METHOD_LABELS),
  },
  {
    key: 'table',
    label: 'Mesa',
    value: (o) => (o.tableLabel ? `Mesa ${o.tableLabel}` : null),
  },
];

const TABS: ListTab[] = [
  { id: 'hoje', label: 'Hoje', filters: { date: ['today'] } },
  { id: 'andamento', label: 'Em andamento', filters: { date: ['today'], status: ACTIVE } },
  {
    id: 'receber',
    label: 'A receber',
    filters: { date: ['today'], payment: ['unpaid', 'partial'] },
  },
  { id: 'semana', label: 'Últimos 7 dias', filters: { date: ['7d'] } },
];

const SORTS: ListSort<Order>[] = [
  { key: 'createdAt', label: 'Data', get: (o) => o.createdAt },
  { key: 'number', label: 'Número', get: (o) => o.number },
  { key: 'customer', label: 'Cliente / mesa', get: (o) => fold(who(o)), asc: true },
  { key: 'status', label: 'Status op.', get: (o) => ORDER_STATUSES.indexOf(o.status), asc: true },
  {
    key: 'payment',
    label: 'Status fin.',
    get: (o) => PAYMENT_STATUSES.indexOf(o.paymentStatus),
    asc: true,
  },
  { key: 'total', label: 'Valor', get: (o) => Number(o.total) },
];

const searchText = (o: Order) =>
  `#${o.number} ${who(o)} ${o.customerName ?? ''} ${digits(o.customerPhone ?? '')} ${itemsSummary(o)}`;

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useLinkParam('abrir', setOpenId);
  const lv = useListView({
    id: 'pedidos',
    rows: orders,
    fields: FIELDS,
    tabs: TABS,
    search: searchText,
    sorts: SORTS,
  });
  const period = lv.filters.date?.[0];

  const load = useCallback(async () => {
    const p = new URLSearchParams({ limit: String(LIMIT) });
    const b = dateBounds(period);
    if (b) {
      const a = new Date(`${b[0]}T00:00:00`);
      const z = new Date(new Date(`${b[1]}T00:00:00`).getTime() + 86_400_000);
      p.set('from', a.toISOString());
      p.set('to', z.toISOString());
    }
    setLoading(true);
    try {
      setOrders(await api<Order[]>(`/orders?${p}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed') reload();
  }, load);

  const rows = lv.visible;
  const total =
    rows?.reduce((s, o) => (o.status === 'cancelled' ? s : s + Number(o.total)), 0) ?? 0;

  const th = (key: string, label: string, className?: string) => {
    const on = lv.sort.key === key;
    const Icon = !on ? ChevronsUpDown : lv.sort.desc ? ChevronDown : ChevronUp;
    return (
      <th
        className={className}
        aria-sort={on ? (lv.sort.desc ? 'descending' : 'ascending') : undefined}
      >
        <button
          type="button"
          className="ord-sort"
          data-on={on || undefined}
          onClick={() =>
            lv.setSort(
              on
                ? { key, desc: !lv.sort.desc }
                : { key, desc: !SORTS.find((x) => x.key === key)?.asc },
            )
          }
        >
          {label}
          <Icon size={13} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <>
      <section className="cm-card ord-board">
        <header className="ord-head">
          <h1 className="ord-title">Pedidos</h1>
        </header>
        <ListToolbar
          lv={lv}
          searchLabel="Buscar pedido"
          placeholder="Buscar: nº, cliente, telefone, mesa ou item"
          actions={
            <button
              type="button"
              className="ord-icon-btn"
              onClick={() => void load()}
              aria-label="Atualizar"
              title="Atualizar"
              data-spin={loading || undefined}
            >
              <RotateCw size={15} aria-hidden />
            </button>
          }
          summary={
            rows === null
              ? '…'
              : `${rows.length} ${rows.length === 1 ? 'pedido' : 'pedidos'}${rows.length ? ` · ${brl(total.toFixed(2))}` : ''}`
          }
        />

        {error && (
          <div className="ord-alert">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {rows === null ? (
          <div style={{ padding: 16 }}>
            <Skeleton height={160} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title="Nenhum pedido para os filtros selecionados"
            action={
              lv.active || lv.query ? (
                <button type="button" className="ord-clear" onClick={lv.clear}>
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          <ListTable>
            <table className="cm-table cm-table--click lv-table ord-table">
              <thead>
                <tr>
                  {th('number', 'Nº')}
                  {th('createdAt', 'Data')}
                  <th>Tipo</th>
                  {th('customer', 'Cliente / mesa')}
                  <th className="ord-col-items">Itens</th>
                  {th('status', 'Status op.')}
                  {th('payment', 'Status fin.')}
                  {th('total', 'Valor', 'cm-num')}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setOpenId(o.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenId(o.id)}
                  >
                    <td>
                      <strong>{o.number}</strong>
                    </td>
                    <td className="ord-nowrap">{dateTime(o.createdAt)}</td>
                    <td className="ord-nowrap">
                      <span>
                        {CHANNEL_LABELS[o.channel]}
                        {o.source === 'online' && <span className="ord-tag">online</span>}
                      </span>
                    </td>
                    <td>
                      <span>
                        {who(o) || '—'}
                        {subline(o) && <span className="ord-sub">{subline(o)}</span>}
                      </span>
                    </td>
                    <td className="ord-col-items">
                      <span className="ord-items" title={itemsSummary(o)}>
                        {itemsSummary(o) || '—'}
                      </span>
                    </td>
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
          </ListTable>
        )}
        {orders?.length === LIMIT && (
          <p className="lv-foot">
            Mostrando os {LIMIT} pedidos mais recentes do período. Escolha um período menor para ver
            os demais.
          </p>
        )}
      </section>
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
