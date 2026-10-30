import { CHANNEL_LABELS, type OrderChannel, type OrderStatus } from '@comandou/shared';
import {
  ArrowRight,
  Bike,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  ListFilter,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Utensils,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Segmented, useToast } from '../design-system';
import { useAuth, useCan } from '../app/auth';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { minutesSince, PAYMENT_STATUS_LABEL, qty, time } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import { playSound, useArrivalSound, useRepeatingSoundForNew } from '../lib/sounds';
import { SupportButton, useSupportUnread } from '../features/store-chat/SupportInbox';
import type { Order, StoreSettings } from '../lib/types';
import '../app/home.css';

type Filter = 'all' | OrderChannel;
type Density = 'compact' | 'full';

/** Colunas do quadro, na ordem em que o pedido anda. */
const COLUMNS: { key: string; statuses: OrderStatus[]; label: string; tone: string }[] = [
  { key: 'new', statuses: ['awaiting'], label: 'Em análise', tone: 'var(--cm-info)' },
  {
    key: 'production',
    statuses: ['new', 'in_production'],
    label: 'Em produção',
    tone: 'var(--cm-warning)',
  },
  { key: 'ready', statuses: ['ready'], label: 'Prontos', tone: 'var(--cm-success)' },
  { key: 'out', statuses: ['dispatched'], label: 'Saiu para entrega', tone: 'var(--cm-gray-500)' },
];

const CHANNEL_ICON: Record<OrderChannel, ReactNode> = {
  delivery: <Bike size={16} />,
  pickup: <ShoppingBag size={16} />,
  counter: <Store size={16} />,
  table: <Utensils size={16} />,
};

/** "agora", "12 min", "3 h", "2 d": cabe no canto do cartão. */
function ago(mins: number) {
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} d`;
}

/** Próximo passo do pedido, mostrado como um botão pequeno no canto do cartão. */
function nextAction(o: Order): { label: string; to?: OrderStatus; icon: ReactNode } | null {
  if (o.status === 'awaiting') return { label: 'Aceitar', to: 'new', icon: <Check size={16} /> };
  if (o.status === 'new' || o.status === 'in_production')
    return { label: 'Avançar pedido', to: 'ready', icon: <ArrowRight size={16} /> };
  if (o.status === 'ready' && o.channel === 'delivery')
    return { label: 'Despachar', icon: <Bike size={16} /> };
  if (o.status === 'ready')
    return { label: 'Finalizar', to: 'completed', icon: <Check size={16} /> };
  if (o.status === 'dispatched')
    return { label: 'Entregue', to: 'completed', icon: <Check size={16} /> };
  return null;
}

function OrderCard({
  order,
  now,
  density,
  busy,
  onOpen,
  onMove,
}: {
  order: Order;
  now: number;
  density: Density;
  busy: boolean;
  onOpen(step?: 'dispatch' | 'reject'): void;
  onMove(to: OrderStatus): void;
}) {
  const mins = minutesSince(order.createdAt, now);
  const who = order.tableLabel ? `Mesa ${order.tableLabel}` : order.customerName;
  const items = order.items.filter((i) => i.status !== 'cancelled');
  const action = nextAction(order);
  return (
    <article
      className="hcard"
      data-status={order.status}
      data-late={mins >= 30 && order.status !== 'dispatched' ? '' : undefined}
    >
      <span className="hcard__channel" title={CHANNEL_LABELS[order.channel]}>
        {CHANNEL_ICON[order.channel]}
      </span>
      <button
        className="hcard__main"
        onClick={() => onOpen()}
        aria-label={`Abrir pedido ${order.number}`}
      >
        <span className="hcard__head">
          <strong>#{order.number}</strong>
          {order.source === 'online' && <span className="hcard__tag">Online</span>}
        </span>
        <span className="hcard__pills">
          <span className="hcard__pill">{brl(order.total)}</span>
          {who && <span className="hcard__pill hcard__pill--soft">{who}</span>}
        </span>
        {density === 'full' && (
          <>
            {order.channel === 'delivery' && order.deliveryAddress && (
              <span className="hcard__line">{order.deliveryAddress}</span>
            )}
            <span className="hcard__line">
              {items
                .slice(0, 4)
                .map((i) => `${qty(i.quantity)}× ${i.name}`)
                .join(' · ')}
              {items.length > 4 && ` · +${items.length - 4}`}
            </span>
            <span className={`hcard__pay hcard__pay--${order.paymentStatus}`}>
              {PAYMENT_STATUS_LABEL[order.paymentStatus]}
            </span>
          </>
        )}
      </button>
      <span className="hcard__time" title={`Feito às ${time(order.createdAt)}`}>
        {ago(mins)}
      </span>
      {action && (
        <span className="hcard__actions">
          {order.status === 'awaiting' && (
            <button
              className="hcard__act hcard__act--ghost"
              aria-label="Recusar"
              title="Recusar"
              disabled={busy}
              onClick={() => onOpen('reject')}
            >
              <X size={16} />
            </button>
          )}
          <button
            className="hcard__act"
            aria-label={action.label}
            title={action.label}
            disabled={busy}
            onClick={() => (action.to ? onMove(action.to) : onOpen('dispatch'))}
          >
            {action.icon}
          </button>
        </span>
      )}
    </article>
  );
}

/**
 * Tela inicial do PDV, no formato do PedidoJá: o salão (mesas e comandas) em cima e o quadro de
 * pedidos embaixo, em colunas que seguem o andamento (em análise → produção → pronto → saiu), com os
 * totais do dia no rodapé. "Nova venda" (F2) abre o lançamento em tela cheia.
 */
export function PdvPage() {
  const { me } = useAuth();
  const toast = useToast();
  const canSell = useCan('orders:write');
  const canManage = useCan('orders:manage');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<'dispatch' | 'reject' | undefined>();
  const [filter, setFilter] = useState<Filter>('all');
  const [density, setDensity] = useState<Density>('compact');
  /** Celular: uma coluna por vez (abas), sem arrastar a tela para o lado. */
  const [mobileCol, setMobileCol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const known = useRef<Set<string> | null>(null);
  /** Pedidos concluídos e cancelados hoje (00:00–23:59), para o rodapé. */
  const [today, setToday] = useState<{ done: number; cancelled: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>('/orders?active=true&limit=300');
      // Pedido online que acabou de chegar: som + aviso (não na primeira carga). Vale também para o
      // que o aceite automático já mandou para a produção, senão ele entra sem ninguém perceber.
      const online = list.filter((o) => o.source === 'online');
      if (known.current) {
        const fresh = online.filter((o) => !known.current!.has(o.id));
        const first = fresh.find((o) => o.status === 'awaiting') ?? fresh[0];
        if (first) {
          playSound('order');
          toast(
            first.status === 'awaiting'
              ? `Novo pedido online #${first.number}: aceite ou recuse`
              : `Novo pedido online #${first.number} (aceito automaticamente)`,
            'neutral',
          );
        }
      }
      known.current = new Set(online.map((o) => o.id));
      setOrders(list);
      setError(null);
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 86_400_000);
      const day = (status: string) =>
        api<Order[]>(
          `/orders?${new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
            status,
            limit: '500',
          })}`,
        ).then((d) => d.length);
      Promise.all([day('completed'), day('cancelled')])
        .then(([done, cancelled]) => setToday({ done, cancelled }))
        .catch(() => setToday(null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [toast]);
  const loadStore = useCallback(() => {
    api<StoreSettings>('/store/settings')
      .then(setStore)
      .catch(() => setStore(null));
  }, []);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
    loadStore();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [load, loadStore]);
  useRealtime(
    (e) => {
      if (
        e.type === 'order.changed' ||
        e.type === 'kitchen.changed' ||
        e.type === 'delivery.changed'
      )
        reload();
      if (e.type === 'store.changed') loadStore();
    },
    () => {
      void load();
      loadStore();
    },
  );

  // Quantos aguardam aceite aparece no título da aba.
  const awaiting = orders?.filter((o) => o.status === 'awaiting').length ?? 0;
  useEffect(() => {
    const base = 'Comandou';
    document.title = awaiting ? `(${awaiting}) PDV · ${base}` : `PDV · ${base}`;
    return () => {
      document.title = base;
    };
  }, [awaiting]);

  // Sons: pedido que a cozinha terminou, pronto para entrega e pedido de cancelamento do cliente.
  const ids = (f: (o: Order) => boolean) => orders?.filter(f).map((o) => o.id) ?? null;
  const seenReady = useArrivalSound(
    'ready',
    ids((o) => o.status === 'ready' && o.channel !== 'delivery'),
  );
  const seenDelivery = useArrivalSound(
    'delivery',
    ids((o) => o.status === 'ready' && o.channel === 'delivery'),
  );
  useArrivalSound(
    'cancel',
    ids((o) => o.status === 'cancel_requested'),
  );
  // Fica apitando enquanto houver pedido esperando aceite ou pedido de cancelamento sem resposta.
  // Só pelo que chegou depois de abrir a tela: o que já estava esperando não faz o sino tocar ao abrir.
  useRepeatingSoundForNew(
    'order',
    ids((o) => o.status === 'awaiting'),
  );
  useRepeatingSoundForNew(
    'cancel',
    ids((o) => o.status === 'cancel_requested'),
  );
  // Cliente esperando resposta pelo cardápio: avisa até alguém abrir a conversa (só pelo que
  // chegou depois de abrir a tela, como os pedidos).
  const support = useSupportUnread();
  useRepeatingSoundForNew(
    'message',
    support.loaded ? support.latest.map((l) => `${l.id}@${l.at}`) : null,
  );

  // F2 abre a nova venda (atalho de caixa).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && canSell) {
        e.preventDefault();
        setSelling(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSell]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (orders ?? []).filter(
      (o) =>
        (filter === 'all' || o.channel === filter) &&
        (!s ||
          String(o.number).includes(s) ||
          (o.customerName ?? '').toLowerCase().includes(s) ||
          (o.customerPhone ?? '').includes(s) ||
          (o.tableLabel ?? '').toLowerCase() === s),
    );
  }, [orders, filter, search]);
  const colList = (key: string) => {
    const statuses = COLUMNS.find((c) => c.key === key)!.statuses;
    return visible
      .filter((o) => statuses.includes(o.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  const activeCol =
    mobileCol ?? COLUMNS.find((c) => colList(c.key).length > 0)?.key ?? COLUMNS[1].key;
  /** Pedidos com cancelamento pedido pelo cliente: precisam de resposta da loja. */
  const requests = (orders ?? []).filter((o) => o.status === 'cancel_requested');
  const activeCount = (orders ?? []).filter((o) => o.status !== 'cancel_requested').length;

  async function move(o: Order, to: OrderStatus) {
    setBusyId(o.id);
    // Quem avançou o pedido não precisa ouvir o aviso de "pronto".
    if (to === 'ready') (o.channel === 'delivery' ? seenDelivery : seenReady)(o.id);
    try {
      await api(`/orders/${o.id}/status`, {
        method: 'POST',
        json: { to, expectedVersion: o.version },
      });
      if (to === 'new') toast(`Pedido #${o.number} aceito e enviado para a cozinha`, 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchStore(patch: Partial<StoreSettings>) {
    try {
      setStore(await api<StoreSettings>('/store/settings', { method: 'PATCH', json: patch }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const storeLink = `${window.location.origin}/pedir`;

  return (
    <div className="pdv">
      <div className="pdv__bar">
        <label className="pdv__search">
          <Search size={16} aria-hidden />
          <input
            placeholder="Buscar pedido, cliente ou mesa…"
            aria-label="Buscar pedido"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="pdv__spacer" />
        <SupportButton className="pdv__chat" label="Mensagens" />
        {store && (
          <label className="switch pdv__store" data-open={store.isOpen}>
            <input
              type="checkbox"
              checked={store.isOpen}
              disabled={!canManage}
              onChange={(e) => patchStore({ isOpen: e.target.checked })}
            />
            <span className="switch__track" aria-hidden />
            {store.isOpen ? 'Loja aberta' : 'Loja fechada'}
          </label>
        )}
        <button
          className="pdv__icon"
          aria-label="Abrir o cardápio online"
          title="Abrir o cardápio online"
          onClick={() => window.open('/pedir', '_blank', 'noopener')}
        >
          <ExternalLink size={17} />
        </button>
        <button
          className="pdv__icon"
          aria-label="Copiar o link do cardápio online"
          title="Copiar o link do cardápio online"
          onClick={() =>
            navigator.clipboard
              ?.writeText(storeLink)
              .then(() => toast('Link do cardápio copiado', 'success'))
              .catch(() => toast(storeLink, 'neutral'))
          }
        >
          <Link2 size={17} />
        </button>
        {canSell && (
          <button
            className="hbtn hbtn--primary pdv__new"
            onClick={() => setSelling(true)}
            title="Atalho: F2"
          >
            <Plus size={17} /> Nova venda <kbd className="kbd">F2</kbd>
          </button>
        )}
      </div>

      {error && <Alert tone="danger">Não foi possível carregar os pedidos: {error}</Alert>}

      <section className="pdv-box pdv-orders" aria-label="Pedidos">
        <header className="pdv-box__head">
          <h2>Pedidos</h2>
          <span className="pdv-pill">{activeCount} ativos</span>
          {store && (
            <label className="switch pdv-chip pdv-chip--switch">
              <input
                type="checkbox"
                checked={store.autoAccept}
                disabled={!canManage}
                onChange={(e) => patchStore({ autoAccept: e.target.checked })}
              />
              <span className="switch__track" aria-hidden />
              Aceite automático
            </label>
          )}
          <Segmented<Density>
            label="Detalhe dos cartões"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact', label: 'Compacto' },
              { value: 'full', label: 'Completo' },
            ]}
          />
          <label className="pdv-chip pdv-select">
            <ListFilter size={14} aria-hidden />
            <select
              aria-label="Tipo de pedido"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              <option value="all">Todos os tipos</option>
              {(Object.keys(CHANNEL_ICON) as OrderChannel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </label>
          <div className="pdv__spacer" />
          <Link className="pdv-chip pdv-orders__all" to="/pedidos">
            Ver todos <ChevronRight size={14} />
          </Link>
        </header>

        <Segmented
          className="board__switch"
          label="Coluna do quadro"
          block
          value={activeCol}
          onChange={setMobileCol}
          options={COLUMNS.map((c) => ({
            value: c.key,
            label:
              c.key === 'out'
                ? 'Saiu'
                : c.key === 'production'
                  ? 'Produção'
                  : c.key === 'new'
                    ? 'Análise'
                    : c.label,
            count: colList(c.key).length,
          }))}
        />
        <div className="board">
          {COLUMNS.map((c) => {
            const list = colList(c.key);
            return (
              <section
                key={c.key}
                className="board__col"
                data-col={c.key}
                data-on={activeCol === c.key}
                style={{ ['--tone' as string]: c.tone }}
              >
                <header className="board__head">
                  <h2>{c.label}</h2>
                  <span className="board__count">{list.length}</span>
                </header>
                <div className="board__list">
                  {orders === null ? (
                    <div className="board__skeleton" />
                  ) : list.length === 0 ? (
                    <p className="board__empty">
                      {c.key === 'new' && store?.autoAccept
                        ? 'Aceite automático ligado'
                        : 'Nenhum pedido'}
                    </p>
                  ) : (
                    list.map((o) => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        now={now}
                        density={density}
                        busy={busyId === o.id}
                        onOpen={(step) => {
                          setOpenStep(step);
                          setOpenId(o.id);
                        }}
                        onMove={(to) => move(o, to)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="pdv-foot">
          <Link className="pdv-foot__item" to="/pedidos">
            Concluídos hoje <b>{today?.done ?? 0}</b>
          </Link>
          <Link className="pdv-foot__item" to="/pedidos">
            Cancelados hoje <b>{today?.cancelled ?? 0}</b>
          </Link>
          <button
            className="pdv-foot__item"
            data-alert={requests.length > 0 || undefined}
            onClick={() => {
              if (requests[0]) {
                setOpenStep(undefined);
                setOpenId(requests[0].id);
              } else toast('Nenhum cancelamento solicitado agora', 'neutral');
            }}
          >
            Cancelamento solicitado <b>{requests.length}</b>
          </button>
        </div>
      </section>

      <p className="home__hint cm-hint">
        Olá, {me?.user.name.split(' ')[0]}. Pedidos do {me?.tenant.name} em tempo real.
      </p>

      <NewSaleModal
        open={selling}
        onClose={() => setSelling(false)}
        onCreated={() => {
          setSelling(false);
          void load();
        }}
      />
      <OrderDetailModal
        variant="panel"
        orderId={openId}
        startWith={openStep}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
