import { CHANNEL_LABELS, type OrderChannel, type OrderStatus } from '@comandou/shared';
import {
  ArrowRight,
  Bike,
  Check,
  ChefHat,
  ClipboardList,
  Clock,
  ExternalLink,
  LayoutGrid,
  Link2,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Utensils,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Mascot, Segmented, useToast } from '../design-system';
import { useAuth, useCan } from '../app/auth';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { SlideTabs } from '../features/SlideTabs';
import { minutesSince, PAYMENT_STATUS_LABEL, qty, time } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order, StoreSettings } from '../lib/types';
import '../app/home.css';

type Filter = 'all' | OrderChannel;

const COLUMNS: {
  key: string;
  statuses: OrderStatus[];
  label: string;
  tone: string;
  empty: string;
}[] = [
  {
    key: 'analysis',
    statuses: ['awaiting', 'cancel_requested'],
    label: 'Em análise',
    tone: 'var(--home-analysis)',
    empty: 'Pedidos do cardápio online chegam aqui para você aceitar.',
  },
  {
    key: 'production',
    statuses: ['new', 'in_production'],
    label: 'Em produção',
    tone: 'var(--home-production)',
    empty: 'Nenhum pedido sendo preparado.',
  },
  {
    key: 'ready',
    statuses: ['ready', 'dispatched'],
    label: 'Prontos para entrega',
    tone: 'var(--home-ready)',
    empty: 'Pedidos prontos e em rota aparecem aqui.',
  },
];

const CHANNEL_ICON: Record<OrderChannel, ReactNode> = {
  delivery: <Bike size={16} />,
  pickup: <ShoppingBag size={16} />,
  counter: <Store size={16} />,
  table: <Utensils size={16} />,
};

/** Bipe curto quando chega pedido novo do cardápio online (sem arquivo de áudio). */
function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    /* navegador sem áudio liberado: segue só com o aviso visual */
  }
}

function HomeCard({
  order,
  now,
  onOpen,
  onMove,
  busy,
}: {
  order: Order;
  now: number;
  onOpen(step?: 'dispatch' | 'reject'): void;
  onMove(to: OrderStatus): void;
  busy: boolean;
}) {
  const mins = minutesSince(order.createdAt, now);
  const who = order.tableLabel
    ? `Mesa ${order.tableLabel}`
    : (order.customerName ?? 'Cliente não identificado');
  const items = order.items.filter((i) => i.status !== 'cancelled');
  let action: { label: string; to?: OrderStatus; icon?: ReactNode } | null = null;
  if (order.status === 'awaiting')
    action = { label: 'Aceitar', to: 'new', icon: <Check size={16} /> };
  else if (order.status === 'new' || order.status === 'in_production')
    action = { label: 'Avançar pedido', to: 'ready', icon: <ArrowRight size={16} /> };
  else if (order.status === 'ready' && order.channel === 'delivery')
    action = { label: 'Despachar', icon: <Bike size={16} /> };
  else if (order.status === 'ready')
    action = { label: 'Finalizar', to: 'completed', icon: <Check size={16} /> };
  else if (order.status === 'dispatched')
    action = { label: 'Entregue', to: 'completed', icon: <Check size={16} /> };
  else if (order.status === 'cancel_requested') action = { label: 'Ver cancelamento' };

  return (
    <article
      className="hcard"
      data-status={order.status}
      data-late={mins >= 30 && order.status !== 'dispatched' ? '' : undefined}
    >
      <button
        className="hcard__main"
        onClick={() => onOpen()}
        aria-label={`Abrir pedido ${order.number}`}
      >
        <span className="hcard__head">
          <span className="hcard__channel" title={CHANNEL_LABELS[order.channel]}>
            {CHANNEL_ICON[order.channel]}
          </span>
          <strong>Pedido #{order.number}</strong>
          {order.source === 'online' && <span className="hcard__tag">Online</span>}
          <span className="hcard__time" title={`Feito às ${time(order.createdAt)}`}>
            <Clock size={13} /> {mins < 1 ? 'agora' : `${mins} min`}
          </span>
        </span>
        <span className="hcard__who">{who}</span>
        {order.status === 'dispatched' && <span className="hcard__note">Saiu para entrega</span>}
        {order.status === 'cancel_requested' && (
          <span className="hcard__note hcard__note--danger">Cancelamento solicitado</span>
        )}
        {order.channel === 'delivery' && order.deliveryAddress && (
          <span className="hcard__addr">{order.deliveryAddress}</span>
        )}
        <span className="hcard__items">
          {items
            .slice(0, 3)
            .map((i) => `${qty(i.quantity)}× ${i.name}`)
            .join(' · ')}
          {items.length > 3 && ` · +${items.length - 3}`}
        </span>
        <span className="hcard__foot">
          <span className={`hcard__pay hcard__pay--${order.paymentStatus}`}>
            {PAYMENT_STATUS_LABEL[order.paymentStatus]}
          </span>
          <strong>{brl(order.total)}</strong>
        </span>
      </button>
      {action && (
        <div className="hcard__actions">
          {order.status === 'awaiting' && (
            <button className="hbtn hbtn--ghost" onClick={() => onOpen('reject')} disabled={busy}>
              <X size={16} /> Recusar
            </button>
          )}
          <button
            className={`hbtn ${order.status === 'awaiting' ? 'hbtn--primary' : ''}`}
            disabled={busy}
            onClick={() =>
              action!.to
                ? onMove(action!.to)
                : onOpen(order.status === 'ready' ? 'dispatch' : undefined)
            }
          >
            {action.label} {action.icon}
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Tela inicial: quadro de pedidos em 3 colunas (em análise → em produção → prontos). "Novo
 * pedido" e o detalhe do pedido abrem num painel que desliza da direita, sem perder o quadro.
 */
export function PdvPage() {
  const { me } = useAuth();
  const toast = useToast();
  const canSell = useCan('orders:write');
  const canSettings = useCan('settings:manage');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<'dispatch' | 'reject' | undefined>();
  const [filter, setFilter] = useState<Filter>('all');
  /** Celular: uma coluna por vez (abas), sem arrastar a tela para o lado. */
  const [mobileCol, setMobileCol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>('/orders?active=true&limit=300');
      // Pedido novo em análise: bipe + aviso (não na primeira carga).
      const waiting = list.filter((o) => o.status === 'awaiting');
      if (known.current) {
        const fresh = waiting.filter((o) => !known.current!.has(o.id));
        if (fresh.length) {
          beep();
          toast(`Novo pedido online #${fresh[0]!.number}`, 'neutral');
        }
      }
      known.current = new Set(waiting.map((o) => o.id));
      setOrders(list);
      setError(null);
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
    document.title = awaiting ? `(${awaiting}) Pedidos · ${base}` : `Pedidos · ${base}`;
    return () => {
      document.title = base;
    };
  }, [awaiting]);

  // F2 abre novo pedido (atalho de caixa).
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
  const countBy = (c: Filter) =>
    (orders ?? []).filter((o) => c === 'all' || o.channel === c).length;
  const colCount = (key: string) =>
    visible.filter((o) => COLUMNS.find((c) => c.key === key)!.statuses.includes(o.status)).length;
  const activeCol = mobileCol ?? COLUMNS.find((c) => colCount(c.key) > 0)?.key ?? COLUMNS[1].key;

  async function move(o: Order, to: OrderStatus) {
    setBusyId(o.id);
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

  async function finishReady() {
    const ready = visible.filter((o) => o.status === 'ready' && o.channel !== 'delivery');
    if (!ready.length || !window.confirm(`Finalizar ${ready.length} pedido(s) pronto(s)?`)) return;
    for (const o of ready) await move(o, 'completed');
  }

  const storeLink = `${window.location.origin}/pedir`;

  return (
    <div className="home">
      <div className="home__bar">
        <SlideTabs<Filter>
          label="Filtrar por canal"
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'Todos', count: countBy('all') },
            {
              value: 'delivery',
              label: (
                <>
                  <Bike size={15} /> <span className="tab-text">Delivery</span>
                </>
              ),
              count: countBy('delivery'),
              title: 'Delivery',
            },
            {
              value: 'pickup',
              label: (
                <>
                  <ShoppingBag size={15} /> <span className="tab-text">Retirada</span>
                </>
              ),
              count: countBy('pickup'),
              title: 'Retirada',
            },
            {
              value: 'counter',
              label: (
                <>
                  <Store size={15} /> <span className="tab-text">Balcão</span>
                </>
              ),
              count: countBy('counter'),
              title: 'Balcão',
            },
            {
              value: 'table',
              label: (
                <>
                  <Utensils size={15} /> <span className="tab-text">Mesa</span>
                </>
              ),
              count: countBy('table'),
              title: 'Mesa',
            },
          ]}
        />
        <label className="home__search">
          <Search size={16} aria-hidden />
          <input
            placeholder="Cliente, telefone ou nº do pedido"
            aria-label="Buscar pedido"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="home__spacer" />
        {store && (
          <button
            className={`store-toggle ${store.isOpen ? 'is-open' : ''}`}
            onClick={() => patchStore({ isOpen: !store.isOpen })}
            disabled={!canSell}
            title={store.isOpen ? 'Fechar a loja online' : 'Abrir a loja online'}
          >
            <span className="store-toggle__dot" />
            {store.isOpen ? 'Loja aberta' : 'Loja fechada'}
          </button>
        )}
        {canSell && (
          <button
            className="hbtn hbtn--primary hbtn--lg"
            onClick={() => setSelling(true)}
            title="Atalho: F2"
          >
            <Plus size={18} /> Novo pedido <kbd className="kbd">F2</kbd>
          </button>
        )}
      </div>

      {error && <Alert tone="danger">Não foi possível carregar os pedidos: {error}</Alert>}

      <div className="home__body">
        <Segmented
          className="board__switch"
          label="Coluna do quadro"
          block
          value={activeCol}
          onChange={setMobileCol}
          options={COLUMNS.map((c) => ({
            value: c.key,
            label: c.key === 'ready' ? 'Prontos' : c.label,
            count: colCount(c.key),
          }))}
        />
        <div className="board">
          {COLUMNS.map((c) => {
            const list = visible
              .filter((o) => c.statuses.includes(o.status))
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const readyToFinish =
              c.key === 'ready' &&
              list.some((o) => o.status === 'ready' && o.channel !== 'delivery');
            return (
              <section
                key={c.key}
                className="board__col"
                data-on={activeCol === c.key}
                style={{ ['--tone' as string]: c.tone }}
              >
                <header className="board__head">
                  <h2>{c.label}</h2>
                  {readyToFinish && (
                    <button className="board__finish" onClick={finishReady}>
                      Finalizar
                    </button>
                  )}
                  <span className="board__count">{list.length}</span>
                </header>
                <div className="board__list">
                  {c.key === 'analysis' && store && (
                    <div className="board__info">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={store.autoAccept}
                          disabled={!canSell}
                          onChange={(e) => patchStore({ autoAccept: e.target.checked })}
                        />
                        <span className="switch__track" aria-hidden />
                        Aceitar pedidos automaticamente
                      </label>
                      <span className="cm-hint">
                        Entrega {store.etaMin}–{store.etaMax} min ·{' '}
                        {Number(store.deliveryFee)
                          ? `taxa ${brl(store.deliveryFee)}`
                          : 'taxa grátis'}
                        {canSettings && (
                          <>
                            {' '}
                            · <Link to="/configuracoes">editar</Link>
                          </>
                        )}
                      </span>
                    </div>
                  )}
                  {orders === null ? (
                    <div className="board__skeleton" />
                  ) : list.length === 0 ? (
                    <p className="board__empty">
                      <Mascot
                        size={52}
                        mood={
                          c.key === 'production' ? 'cook' : c.key === 'ready' ? 'happy' : 'sleep'
                        }
                      />
                      {c.key === 'analysis' && store?.autoAccept
                        ? 'Todos os pedidos são aceitos automaticamente.'
                        : c.empty}
                    </p>
                  ) : (
                    list.map((o) => (
                      <HomeCard
                        key={o.id}
                        order={o}
                        now={now}
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

        <nav className="rail" aria-label="Atalhos">
          <Link to="/mesas" className="rail__item" title="Salão e mesas">
            <LayoutGrid size={20} />
            <span>Salão</span>
            <b>{(orders ?? []).filter((o) => o.channel === 'table').length}</b>
          </Link>
          <Link to="/cozinha" className="rail__item" title="Cozinha (KDS)">
            <ChefHat size={20} />
            <span>Cozinha</span>
            <b>
              {
                (orders ?? []).filter((o) => o.status === 'new' || o.status === 'in_production')
                  .length
              }
            </b>
          </Link>
          <Link to="/entregas" className="rail__item" title="Entregas">
            <Bike size={20} />
            <span>Entregas</span>
            <b>{(orders ?? []).filter((o) => o.status === 'dispatched').length}</b>
          </Link>
          <Link to="/pedidos" className="rail__item" title="Histórico de pedidos">
            <ClipboardList size={20} />
            <span>Histórico</span>
          </Link>
          <a
            href="/pedir"
            target="_blank"
            rel="noreferrer"
            className="rail__item"
            title="Abrir o cardápio online"
          >
            <ExternalLink size={20} />
            <span>Cardápio online</span>
          </a>
          <button
            className="rail__item"
            title="Copiar o link do cardápio online"
            onClick={() =>
              navigator.clipboard
                ?.writeText(storeLink)
                .then(() => toast('Link do cardápio copiado', 'success'))
                .catch(() => toast(storeLink, 'neutral'))
            }
          >
            <Link2 size={20} />
            <span>Copiar link</span>
          </button>
        </nav>
      </div>

      <p className="home__hint cm-hint">
        Olá, {me?.user.name.split(' ')[0]}. Pedidos do {me?.tenant.name} em tempo real.
      </p>

      <NewSaleModal
        variant="panel"
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
