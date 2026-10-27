import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderChannel,
  type OrderStatus,
  type PaymentStatus,
} from '@comandou/shared';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ClipboardList,
  RotateCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, EmptyState, Skeleton, Select, DateInput } from '../design-system';
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
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order } from '../lib/types';
import './orders.css';

const LIMIT = 500;

/** Dia local no formato do <input type="date">. */
function isoDay(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type SortKey = 'number' | 'createdAt' | 'customer' | 'status' | 'payment' | 'total';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const who = (o: Order) =>
  o.tableLabel
    ? `Mesa ${o.tableLabel}`
    : o.tabNumber
      ? `Comanda ${o.tabNumber}`
      : (o.customerName ?? '');

const sortValue: Record<SortKey, (o: Order) => string | number> = {
  number: (o) => o.number,
  createdAt: (o) => o.createdAt,
  customer: (o) => who(o).toLocaleLowerCase('pt-BR'),
  status: (o) => ORDER_STATUSES.indexOf(o.status),
  payment: (o) => PAYMENT_STATUSES.indexOf(o.paymentStatus),
  total: (o) => Number(o.total),
};

/** Nome e telefone do cliente embaixo da mesa/comanda (ou só o telefone). */
function subline(o: Order) {
  const name = o.customerName && o.customerName !== who(o) ? o.customerName : null;
  return [name, o.customerPhone].filter(Boolean).join(' · ');
}

function itemsSummary(o: Order) {
  return o.items.map((i) => `${Number(i.quantity)}× ${i.name}`).join(', ');
}

const digits = (s: string) => s.replace(/\D/g, '');

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => isoDay());
  const [to, setTo] = useState(() => isoDay());
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [payment, setPayment] = useState<PaymentStatus | ''>('');
  const [channel, setChannel] = useState<OrderChannel | ''>('');
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [more, setMore] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'createdAt', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);
  useLinkParam('abrir', setOpenId);

  // Período sempre em ordem: se "até" ficar antes de "de", usa o mesmo dia nos dois.
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;

  const load = useCallback(async () => {
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(new Date(`${end}T00:00:00`).getTime() + 86_400_000);
    const p = new URLSearchParams({
      from: a.toISOString(),
      to: b.toISOString(),
      limit: String(LIMIT),
    });
    if (status) p.set('status', status);
    if (channel) p.set('channel', channel);
    if (onlyActive) p.set('active', 'true');
    setLoading(true);
    try {
      setOrders(await api<Order[]>(`/orders?${p}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [start, end, status, channel, onlyActive]);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed') reload();
  }, load);

  const rows = useMemo(() => {
    if (!orders) return null;
    const q = query.trim().toLocaleLowerCase('pt-BR');
    const qd = digits(q);
    const list = orders.filter((o) => {
      if (payment && o.paymentStatus !== payment) return false;
      if (onlyOnline && o.source !== 'online') return false;
      if (!q) return true;
      if (
        qd &&
        (String(o.number) === qd || (qd.length >= 3 && digits(o.customerPhone ?? '').includes(qd)))
      )
        return true;
      return `${who(o)} ${o.customerName ?? ''}`.toLocaleLowerCase('pt-BR').includes(q);
    });
    const get = sortValue[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.createdAt < b.createdAt ? 1 : -1);
    });
  }, [orders, query, payment, onlyOnline, sort]);

  const today = isoDay();
  const dirty =
    from !== today ||
    to !== today ||
    !!status ||
    !!payment ||
    !!channel ||
    !!query ||
    onlyActive ||
    onlyOnline;
  const activeCount = [
    from !== today || to !== today,
    status,
    payment,
    channel,
    onlyActive,
    onlyOnline,
  ].filter(Boolean).length;
  const clear = () => {
    setFrom(today);
    setTo(today);
    setStatus('');
    setPayment('');
    setChannel('');
    setQuery('');
    setOnlyActive(false);
    setOnlyOnline(false);
  };
  const total =
    rows?.reduce((s, o) => (o.status === 'cancelled' ? s : s + Number(o.total)), 0) ?? 0;

  const th = (key: SortKey, label: string, className?: string) => {
    const on = sort.key === key;
    const Icon = !on ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <th
        className={className}
        aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          className="ord-sort"
          data-on={on || undefined}
          onClick={() =>
            setSort(
              on
                ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: key === 'customer' ? 'asc' : 'desc' },
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
          {dirty && (
            <button type="button" className="ord-clear" onClick={clear}>
              <X size={13} aria-hidden />
              Limpar<span className="ord-wide"> filtros</span>
            </button>
          )}
          <span className="ord-count">
            {rows === null
              ? '…'
              : `${rows.length} ${rows.length === 1 ? 'pedido' : 'pedidos'}${rows.length ? ` · ${brl(total.toFixed(2))}` : ''}`}
          </span>
        </header>

        <div className="ord-filters" role="search" data-open={more || undefined}>
          <label className="ord-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              className="cm-input"
              placeholder="Nº, cliente ou telefone"
              aria-label="Buscar pedido"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {/* Celular: período, selects e opções ficam atrás deste botão. */}
          <button
            type="button"
            className="ord-more"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            <SlidersHorizontal size={15} aria-hidden />
            Filtros
            {activeCount > 0 && <span className="ord-more__n">{activeCount}</span>}
          </button>
          <div className="ord-range">
            <DateInput
              aria-label="De"
              sheetTitle="Pedidos a partir de"
              value={from}
              max={today}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
            <span aria-hidden>até</span>
            <DateInput
              aria-label="Até"
              sheetTitle="Pedidos até"
              value={to}
              max={today}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </div>
          <Select
            className="cm-input"
            aria-label="Status operacional"
            data-set={status || undefined}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
          >
            <option value="">Status op.</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            className="cm-input"
            aria-label="Status financeiro"
            data-set={payment || undefined}
            value={payment}
            onChange={(e) => setPayment(e.target.value as PaymentStatus | '')}
          >
            <option value="">Status fin.</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            className="cm-input"
            aria-label="Tipo"
            data-set={channel || undefined}
            value={channel}
            onChange={(e) => setChannel(e.target.value as OrderChannel | '')}
          >
            <option value="">Tipo</option>
            {ORDER_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
          <div className="ord-toggles">
            <label className="ord-check">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              Só em andamento
            </label>
            <label className="ord-check">
              <input
                type="checkbox"
                checked={onlyOnline}
                onChange={(e) => setOnlyOnline(e.target.checked)}
              />
              Só cardápio online
            </label>
            <label className="ord-check">
              <input
                type="checkbox"
                checked={status === 'cancel_requested'}
                onChange={(e) => setStatus(e.target.checked ? 'cancel_requested' : '')}
              />
              Só cancelamento solicitado
            </label>
          </div>
        </div>

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
              dirty ? (
                <button type="button" className="ord-clear" onClick={clear}>
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="ord-scroll">
            <table className="cm-table cm-table--click ord-table">
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
          </div>
        )}
        {orders?.length === LIMIT && (
          <p className="ord-foot">
            Mostrando os {LIMIT} pedidos mais recentes do período. Diminua o período para ver os
            demais.
          </p>
        )}
      </section>
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
