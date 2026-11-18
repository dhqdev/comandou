import {
  CHANNEL_LABELS,
  fromCents,
  type OrderChannel,
  type OrderStatus,
  qtyLabel,
  toCents,
} from '@comandou/shared';
import {
  ArrowRight,
  Bike,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  HandCoins,
  HandPlatter,
  Link2,
  ListFilter,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Utensils,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Segmented, useToast } from '../design-system';
import { useAuth, useCan } from '../app/auth';
import { FiadoDialog } from '../features/FiadoDialog';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { PixReceiptChip, PixReceiptModal } from '../features/PixReceipt';
import { minutesSince, PAYMENT_STATUS_LABEL, time } from '../features/format';
import { TabModal } from '../features/salon/TabModal';
import { sortTables, tableState, type TableState } from '../features/table-state';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { isOfflineResult } from '../lib/offline';
import { useDebounced, useRealtime } from '../lib/realtime';
import {
  playSound,
  setSoundSettings,
  useArrivalSound,
  useRepeatingSoundForNew,
  useSoundSettings,
} from '../lib/sounds';
import { SupportButton, useSupportUnread } from '../features/store-chat/SupportInbox';
import type { DiningTable, Order, StoreSettings, Tab } from '../lib/types';
import '../app/home.css';

type Filter = 'all' | OrderChannel;
type Density = 'compact' | 'full';
type SalonView = 'tables' | 'tabs';

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

const STATE_TEXT: Record<TableState, string> = {
  free: 'livre',
  busy: 'ocupada',
  paying: 'em pagamento',
};

/** "agora", "12 min", "3 h", "2 d": cabe no canto do cartão. */
function ago(mins: number) {
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} d`;
}

/** Próximo passo do pedido, mostrado como um botão pequeno no canto do cartão. */
function nextAction(
  o: Order,
): { label: string; to?: OrderStatus; open?: boolean; serve?: boolean; icon: ReactNode } | null {
  if (o.status === 'awaiting') return { label: 'Aceitar', to: 'new', icon: <Check size={16} /> };
  if (o.status === 'new' || o.status === 'in_production')
    return { label: 'Avançar pedido', to: 'ready', icon: <ArrowRight size={16} /> };
  // Mesa: o pedido pronto vai para a mesa (a conta é paga na comanda, não no cartão do pedido).
  if (o.status === 'ready' && o.channel === 'table')
    return { label: 'Entregue na mesa', serve: true, icon: <HandPlatter size={16} /> };
  if (o.status === 'ready' && o.channel === 'delivery')
    return { label: 'Despachar', icon: <Bike size={16} /> };
  // Com saldo em aberto, finalizar abre o pedido para receber (não conclui sem pagamento).
  if (o.status === 'ready' && Number(o.balance) > 0)
    return { label: 'Receber e finalizar', open: true, icon: <Check size={16} /> };
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
  onServe,
  onPix,
}: {
  order: Order;
  now: number;
  density: Density;
  busy: boolean;
  onOpen(step?: 'dispatch' | 'reject'): void;
  onMove(to: OrderStatus): void;
  /** Pedido de mesa pronto: entregue na mesa. */
  onServe(): void;
  /** Comprovante do Pix: abre a prévia sem abrir o pedido. */
  onPix(): void;
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
                .map((i) => `${qtyLabel(i.quantity, i.unit)} ${i.name}`)
                .join(' · ')}
              {items.length > 4 && ` · +${items.length - 4}`}
            </span>
            <span className={`hcard__pay hcard__pay--${order.paymentStatus}`}>
              {PAYMENT_STATUS_LABEL[order.paymentStatus]}
            </span>
          </>
        )}
      </button>
      {order.pixStatus && (
        <span className="hcard__pix">
          <PixReceiptChip order={order} onOpen={onPix} />
        </span>
      )}
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
            onClick={() =>
              action.serve
                ? onServe()
                : action.to
                  ? onMove(action.to)
                  : action.open
                    ? onOpen()
                    : onOpen('dispatch')
            }
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
 * totais do dia no cabeçalho dos pedidos. "Nova venda" (F2) abre o lançamento em tela cheia.
 */
/** "18/11 10:00" (ou "hoje 10:00"). */
function fiadoWhen(iso: string) {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `hoje ${hm}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`;
}

export function PdvPage() {
  const { me } = useAuth();
  const toast = useToast();
  const canSell = useCan('orders:write');
  const canManage = useCan('orders:manage');
  const canTables = useCan('tables:operate');
  /** Dar fiado é o mesmo poder do "a receber" (gerente). */
  const canFiado = useCan('orders:cancel');
  const sound = useSoundSettings();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [freeTable, setFreeTable] = useState<DiningTable | null>(null);
  /** Comanda aberta no próprio PDV (toque numa mesa ocupada ou numa comanda). */
  const [tabId, setTabId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<'dispatch' | 'reject' | undefined>();
  /** Prévia do comprovante do Pix (pelo selo do cartão). */
  const [pixId, setPixId] = useState<string | null>(null);
  const seenPix = useRef<Set<string> | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [density, setDensity] = useState<Density>('compact');
  const [salonView, setSalonView] = useState<SalonView>('tables');
  const [salonOpen, setSalonOpen] = useState(true);
  const [salonSearch, setSalonSearch] = useState('');
  /** Celular: uma coluna por vez (abas), sem arrastar a tela para o lado. */
  const [mobileCol, setMobileCol] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const known = useRef<Set<string> | null>(null);
  /** Pedidos concluídos e cancelados hoje (00:00–23:59), para o rodapé. */
  const [today, setToday] = useState<{ done: number; cancelled: number } | null>(null);
  /** Cancelados com o comprovante do Pix sem conferir: o cliente pode já ter pago. */
  const [pixRefunds, setPixRefunds] = useState<Order[]>([]);
  /** Fiados em aberto (seção Fiado) e a venda fiado que acabou de ser lançada. */
  const [fiados, setFiados] = useState<Order[]>([]);
  const [sellingFiado, setSellingFiado] = useState(false);
  const [fiadoOrder, setFiadoOrder] = useState<Order | null>(null);

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
          // Pedido do cliente pelo QR Code da mesa: diz a mesa no aviso.
          const what = first.tableLabel
            ? `Novo pedido da Mesa ${first.tableLabel} pelo celular, #${first.number}`
            : `Novo pedido online #${first.number}`;
          toast(
            first.status === 'awaiting'
              ? `${what}: aceite ou recuse`
              : `${what} (aceito automaticamente)`,
            'neutral',
          );
        }
      }
      known.current = new Set(online.map((o) => o.id));
      // Comprovante do Pix que acabou de chegar: som e aviso para alguém conferir.
      const receipts = list.filter((o) => o.pixStatus === 'submitted' && o.pixReceipt);
      if (seenPix.current) {
        const fresh = receipts.find((o) => !seenPix.current!.has(o.pixReceipt!.id));
        if (fresh) {
          playSound('message');
          toast(
            `Comprovante do Pix chegou no pedido #${fresh.number}: confira e aprove`,
            'neutral',
          );
        }
      }
      seenPix.current = new Set(receipts.map((o) => o.pixReceipt!.id));
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
      api<Order[]>('/orders?pixRefund=true&limit=50')
        .then(setPixRefunds)
        .catch(() => setPixRefunds([]));
      api<Order[]>('/orders?fiado=true&limit=200')
        .then(setFiados)
        .catch(() => setFiados([]));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [toast]);
  const loadStore = useCallback(() => {
    api<StoreSettings>('/store/settings')
      .then(setStore)
      .catch(() => setStore(null));
  }, []);
  const loadSalon = useCallback(() => {
    if (!canTables) return;
    Promise.all([api<DiningTable[]>('/tables'), api<Tab[]>('/tabs?status=open')])
      .then(([t, tb]) => {
        setTables(sortTables(t));
        setTabs(tb);
      })
      .catch(() => setTables(null));
  }, [canTables]);
  const reload = useDebounced(load);
  const reloadSalon = useDebounced(loadSalon);
  useEffect(() => {
    void load();
    loadStore();
    loadSalon();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [load, loadStore, loadSalon]);
  useRealtime(
    (e) => {
      if (
        e.type === 'order.changed' ||
        e.type === 'kitchen.changed' ||
        e.type === 'delivery.changed'
      )
        reload();
      if (e.type === 'order.changed' || e.type === 'tab.changed') reloadSalon();
      if (e.type === 'store.changed') loadStore();
    },
    () => {
      void load();
      loadStore();
      loadSalon();
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
        // Pedido de mesa que já chegou na mesa sai do quadro (a conta fica na comanda).
        !(o.channel === 'table' && o.status === 'ready' && o.servedAt) &&
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

  async function serve(o: Order) {
    setBusyId(o.id);
    try {
      await api(`/orders/${o.id}/served`, { method: 'POST' });
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

  // Salão: mesas (com o estado) ou comandas abertas, filtradas pela busca do bloco.
  const salonQ = salonSearch.trim().toLowerCase();
  const shownTables = (tables ?? []).filter(
    (t) =>
      !salonQ ||
      t.label.toLowerCase().includes(salonQ) ||
      (t.tabCustomer ?? '').toLowerCase().includes(salonQ),
  );
  const shownTabs = tabs.filter(
    (t) =>
      !salonQ ||
      String(t.number).includes(salonQ) ||
      (t.tableLabel ?? '').toLowerCase().includes(salonQ) ||
      (t.customerName ?? '').toLowerCase().includes(salonQ),
  );
  const stateCount = (s: TableState) => (tables ?? []).filter((t) => tableState(t) === s).length;

  function openTable(t: DiningTable) {
    // Tudo abre aqui mesmo, sem levar para o Salão: ocupada abre a comanda; livre, a venda.
    if (t.tabId) setTabId(t.tabId);
    else if (canSell) setFreeTable(t);
    else
      // Sem permissão de venda: abre a comanda vazia da mesa, como no Salão.
      api<Tab>('/tabs', { method: 'POST', json: { tableId: t.id } })
        .then((tab) => {
          setTabId(tab.id);
          loadSalon();
        })
        .catch((e: Error) => toast(e.message, 'danger'));
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
        {/* Silenciar: desliga todos os avisos sonoros deste aparelho (o mesmo do botão de som do
            topo, onde ficam o volume e cada som). */}
        <button
          type="button"
          className="pdv__mute"
          data-muted={!sound.enabled || undefined}
          aria-pressed={!sound.enabled}
          aria-label="Silenciar os avisos sonoros"
          title={sound.enabled ? 'Silenciar os avisos sonoros' : 'Ligar os avisos sonoros'}
          onClick={() => {
            setSoundSettings({ enabled: !sound.enabled });
            toast(
              sound.enabled
                ? 'Avisos sonoros silenciados neste aparelho'
                : 'Avisos sonoros ligados',
              'neutral',
            );
          }}
        >
          {sound.enabled ? <Volume2 size={17} aria-hidden /> : <VolumeX size={17} aria-hidden />}
          <span className="pdv__mute-text">{sound.enabled ? 'Silenciar' : 'Silenciado'}</span>
        </button>
        {store && (
          <label className="switch pdv__store" data-open={store.isOpen}>
            <input
              type="checkbox"
              checked={store.isOpen}
              disabled={!canManage}
              onChange={(e) => patchStore({ isOpen: e.target.checked })}
            />
            <span className="switch__track" aria-hidden />
            <span className="pdv__store-long">{store.isOpen ? 'Loja aberta' : 'Loja fechada'}</span>
            <span className="pdv__store-short">{store.isOpen ? 'Aberta' : 'Fechada'}</span>
          </label>
        )}
        {/* Atalhos da loja num grupo só; o da página do restaurante só aparece se ela foi criada. */}
        <div className="pdv__links" role="group" aria-label="Atalhos da loja">
          {store?.hasSite && (
            <button
              className="pdv__icon"
              aria-label="Abrir a página do restaurante"
              title="Abrir a página do restaurante"
              onClick={() => window.open('/site', '_blank', 'noopener')}
            >
              <Globe size={17} />
            </button>
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
        </div>
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

      {pixRefunds.length > 0 && (
        <Alert tone="warning">
          <span>
            <strong>Pix a devolver:</strong>{' '}
            {pixRefunds.length === 1
              ? 'um pedido foi cancelado'
              : `${pixRefunds.length} pedidos foram cancelados`}{' '}
            depois de o cliente mandar o comprovante. Confira no banco e devolva.{' '}
            {pixRefunds.slice(0, 5).map((o) => (
              <button
                key={o.id}
                type="button"
                className="pdv-refund"
                onClick={() => {
                  setOpenStep(undefined);
                  setOpenId(o.id);
                }}
              >
                #{o.number}
                {o.pixReceipt ? ` · ${brl(o.pixReceipt.amount)}` : ''}
              </button>
            ))}
          </span>
        </Alert>
      )}

      {canTables && tables && tables.length + tabs.length > 0 && (
        <section className="pdv-box pdv-salon" aria-label="Salão">
          <header className="pdv-box__head">
            <h2>Salão</h2>
            <ul className="pdv-legend" aria-label="Mesas por estado">
              <li data-state="free">
                <b>{stateCount('free')}</b> Livres
              </li>
              <li data-state="busy">
                <b>{stateCount('busy')}</b> Ocupadas
              </li>
              <li data-state="paying">
                <b>{stateCount('paying')}</b> Em pagamento
              </li>
            </ul>
            <div className="pdv__spacer" />
            {salonOpen && (
              <label className="pdv-mini-search">
                <Search size={14} aria-hidden />
                <input
                  placeholder={salonView === 'tables' ? 'Buscar mesa' : 'Buscar comanda'}
                  aria-label="Buscar no salão"
                  value={salonSearch}
                  onChange={(e) => setSalonSearch(e.target.value)}
                />
              </label>
            )}
            <Segmented<SalonView>
              label="Ver no salão"
              value={salonView}
              onChange={(v) => {
                setSalonView(v);
                setSalonOpen(true);
              }}
              options={[
                { value: 'tables', label: 'Mesas', count: tables.length },
                { value: 'tabs', label: 'Comandas', count: tabs.length },
              ]}
            />
            <button
              className="pdv-chip"
              aria-label={salonOpen ? 'Recolher o salão' : 'Mostrar o salão'}
              aria-expanded={salonOpen}
              onClick={() => setSalonOpen((v) => !v)}
            >
              <span className="pdv-chip__text">{salonOpen ? 'Recolher' : 'Mostrar'}</span>
              <ChevronDown size={14} data-flip={salonOpen || undefined} />
            </button>
          </header>
          {salonOpen && (
            <div className="pdv-salon__grid">
              {salonView === 'tables' ? (
                shownTables.length ? (
                  shownTables.map((t) => {
                    const st = tableState(t);
                    return (
                      <button
                        key={t.id}
                        className="pdv-table"
                        data-state={st}
                        aria-label={`Mesa ${t.label} ${STATE_TEXT[st]}`}
                        onClick={() => openTable(t)}
                      >
                        <strong>Mesa {t.label}</strong>
                        {t.tabId ? (
                          <span className="pdv-table__info">
                            {brl(t.tabTotal)}
                            {t.openedAt && <em>{ago(minutesSince(t.openedAt, now))}</em>}
                          </span>
                        ) : (
                          <span className="pdv-table__info pdv-table__info--muted">Livre</span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="pdv-empty">Nenhuma mesa encontrada.</p>
                )
              ) : shownTabs.length ? (
                shownTabs.map((t) => (
                  <button
                    key={t.id}
                    className="pdv-table"
                    data-state={t.billRequestedAt ? 'paying' : 'busy'}
                    aria-label={`Comanda ${t.number}`}
                    onClick={() => setTabId(t.id)}
                  >
                    <strong>
                      Comanda {t.number}
                      {t.tableLabel && <small> · Mesa {t.tableLabel}</small>}
                    </strong>
                    <span className="pdv-table__info">
                      {brl(t.total)}
                      <em>{t.customerName ?? ago(minutesSince(t.openedAt, now))}</em>
                    </span>
                  </button>
                ))
              ) : (
                <p className="pdv-empty">Nenhuma comanda aberta.</p>
              )}
            </div>
          )}
        </section>
      )}

      {(canFiado || fiados.length > 0) && (
        <section className="pdv-box pdv-fiado" aria-label="Fiado">
          <header className="pdv-box__head">
            <h2>Fiado</h2>
            {fiados.length > 0 && (
              <span className="pdv-pill">
                {fiados.length} em aberto ·{' '}
                {brl(fromCents(fiados.reduce((t, o) => t + toCents(o.balance), 0)))}
              </span>
            )}
            <div className="pdv__spacer" />
            <Link className="pdv-chip" to="/agenda">
              <CalendarDays size={14} aria-hidden /> Agenda pessoal
            </Link>
            {canFiado && canSell && (
              <button className="pdv-chip pdv-fiado__new" onClick={() => setSellingFiado(true)}>
                <HandCoins size={14} aria-hidden /> Vender fiado
              </button>
            )}
          </header>
          <div className="pdv-salon__grid">
            {fiados.length ? (
              [...fiados]
                .sort((a, b) => (a.fiadoDueAt ?? '').localeCompare(b.fiadoDueAt ?? ''))
                .map((o) => {
                  const late = !!o.fiadoDueAt && new Date(o.fiadoDueAt).getTime() < now;
                  return (
                    <button
                      key={o.id}
                      className="pdv-table"
                      data-state={late ? 'busy' : 'paying'}
                      aria-label={`Fiado de ${o.fiadoName}, pedido ${o.number}`}
                      onClick={() => {
                        setOpenStep(undefined);
                        setOpenId(o.id);
                      }}
                    >
                      <strong>
                        {o.fiadoName}
                        <small> · #{o.number}</small>
                      </strong>
                      <span className="pdv-table__info">
                        {brl(o.balance)}
                        {o.fiadoDueAt && (
                          <em>
                            {late ? 'venceu ' : 'paga '}
                            {fiadoWhen(o.fiadoDueAt)}
                          </em>
                        )}
                      </span>
                    </button>
                  );
                })
            ) : (
              <p className="pdv-empty">
                Nenhum fiado em aberto. Em "Vender fiado", a venda vai para a sua Agenda pessoal e o
                WhatsApp do restaurante cobra o cliente no dia combinado.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="pdv-box pdv-orders" aria-label="Pedidos">
        <header className="pdv-box__head">
          <h2>Pedidos</h2>
          <span className="pdv-pill">{activeCount} ativos</span>
          {/* Totais do dia: ficavam num rodapé de botões grandes, agora tomam só uma linha aqui. */}
          <p className="pdv-today" aria-label="Pedidos de hoje">
            Hoje{' '}
            <Link to="/pedidos">
              <b>{today?.done ?? 0}</b> concluídos
            </Link>
            <Link to="/pedidos">
              <b>{today?.cancelled ?? 0}</b> cancelados
            </Link>
          </p>
          <div className="pdv__spacer" />
          {requests.length > 0 && (
            <button
              className="pdv-chip pdv-chip--alert"
              onClick={() => {
                setOpenStep(undefined);
                setOpenId(requests[0].id);
              }}
            >
              {requests.length === 1
                ? '1 pedido quer cancelar'
                : `${requests.length} pedidos querem cancelar`}
            </button>
          )}
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
                        onServe={() => serve(o)}
                        onPix={() => setPixId(o.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
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
      <NewSaleModal
        open={sellingFiado}
        title="Vender fiado"
        onClose={() => setSellingFiado(false)}
        onCreated={(o) => {
          setSellingFiado(false);
          void load();
          // Sem internet o pedido fica no aparelho: o fiado se marca depois, no próprio pedido.
          if (isOfflineResult(o))
            toast('Sem conexão: marque o fiado no pedido quando a internet voltar', 'neutral');
          else setFiadoOrder(o);
        }}
      />
      <FiadoDialog
        order={fiadoOrder}
        onClose={() => setFiadoOrder(null)}
        onDone={() => {
          setFiadoOrder(null);
          void load();
        }}
      />
      <NewSaleModal
        open={!!freeTable}
        onClose={() => setFreeTable(null)}
        preset={
          freeTable
            ? { channel: 'table', tableId: freeTable.id, label: `Mesa ${freeTable.label}` }
            : undefined
        }
        onCreated={() => {
          setFreeTable(null);
          void load();
          loadSalon();
        }}
      />
      <TabModal
        tabId={tabId}
        tables={tables ?? []}
        onClose={() => setTabId(null)}
        onChanged={loadSalon}
        onBillRequested={() => undefined}
      />
      <PixReceiptModal
        order={orders?.find((o) => o.id === pixId) ?? null}
        onClose={() => {
          setPixId(null);
          void load();
        }}
        onOpenOrder={(o) => {
          setPixId(null);
          setOpenStep(undefined);
          setOpenId(o.id);
        }}
      />
      <OrderDetailModal
        variant="panel"
        orderId={openId}
        startWith={openStep}
        onClose={() => {
          setOpenId(null);
          if (pixRefunds.length > 0) void load();
        }}
      />
    </div>
  );
}
