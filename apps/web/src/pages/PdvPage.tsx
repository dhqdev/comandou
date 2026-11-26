import { CHANNEL_LABELS, type OrderChannel, type OrderStatus, qtyLabel } from '@comandou/shared';
import {
  ArrowRight,
  Bike,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  GripHorizontal,
  ExternalLink,
  Globe,
  HandPlatter,
  Link2,
  MapPin,
  MessageSquareText,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Store,
  UserRound,
  Utensils,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { Alert, Segmented, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { PixReceiptChip, PixReceiptModal } from '../features/PixReceipt';
import {
  minutesSince,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABEL,
  time,
} from '../features/format';
import { ReceiptPreview } from '../features/ReceiptPreview';
import { SalonTabCard, type SalonCardAction } from '../features/salon/SalonTabCard';
import { TabModal, type TabIntent } from '../features/salon/TabModal';
import { sortTables, tableState, type TableState } from '../features/table-state';
import { api } from '../lib/api';
import { maskPhone } from '../lib/br-format';
import { brl, changeToBring } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import {
  playSound,
  setSoundSettings,
  useArrivalSound,
  useRepeatingSoundForNew,
  useSoundSettings,
} from '../lib/sounds';
import { useSupportUnread } from '../features/store-chat/SupportInbox';
import type { DiningTable, Order, StoreSettings, Tab } from '../lib/types';
import '../app/home.css';
import { AppDriverTag, appDriverTakes } from '../features/channels/AppDriver';
import { AcceptDeadline } from '../features/channels/AcceptDeadline';
import { ChannelBadge } from '../features/channels/ChannelBadge';
import { AppStoreChips } from '../features/channels/StoreState';

type Density = 'compact' | 'full';
type SalonView = 'tables' | 'tabs';
const DENSITY_KEY = 'cm.pdv.density';

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

/** Vão entre as linhas de mesas (igual ao `home.css`; a altura da linha vem de `--pdv-row`). */
const SALON_GAP = 8;
const SALON_MAX_ROWS = 6;
const SALON_ROWS_KEY = 'cm.pdv.salonRows';
function readSalonRows(): number | null {
  try {
    const n = Number(localStorage.getItem(SALON_ROWS_KEY));
    return n >= 1 && n <= SALON_MAX_ROWS ? n : null;
  } catch {
    return null;
  }
}

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
  // Quem leva é o entregador do aplicativo: o pedido sai sozinho quando ele coleta.
  if (o.status === 'ready' && o.channel === 'delivery' && appDriverTakes(o)) return null;
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

/** Etiquetas do número do pedido: Online, aplicativo, prazo para aceitar/responder, entregador. */
function OrderTags({ order }: { order: Order }) {
  return (
    <>
      {order.source === 'online' && <span className="hcard__tag">Online</span>}
      {order.appChannel && (
        <ChannelBadge channel={order.appChannel} code={order.externalCode} size="sm" />
      )}
      {order.status === 'awaiting' && order.appConfirmBy && (
        <AcceptDeadline until={order.appConfirmBy} compact />
      )}
      {order.appDisputeUntil && (
        <AcceptDeadline until={order.appDisputeUntil} kind="answer" compact />
      )}
      {order.appChannel &&
        order.channel === 'delivery' &&
        (appDriverTakes(order) || order.appDriverStatus === 'request_failed') &&
        !['completed', 'cancelled'].includes(order.status) && (
          <AppDriverTag channel={order.appChannel} status={order.appDriverStatus} />
        )}
    </>
  );
}

type CardProps = {
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
};

/** Recusar (em análise) e o próximo passo do pedido, como botões pequenos. */
function CardActions({
  order,
  busy,
  onOpen,
  onMove,
  onServe,
  className,
}: Pick<CardProps, 'order' | 'busy' | 'onOpen' | 'onMove' | 'onServe'> & { className: string }) {
  const action = nextAction(order);
  if (!action) return null;
  return (
    <span className={className}>
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
  );
}

/** Telefone para ler: tira o 55 do começo e põe a máscara (11) 98765-4321. */
function phoneText(raw: string | null) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length >= 10 ? maskPhone(d) : raw;
}

/** Quantos itens o cartão Completo mostra antes do "+ N itens". */
const FULL_ITEMS = 6;

function OrderCard(props: CardProps) {
  if (props.density === 'full') return <FullOrderCard {...props} />;
  const { order, now, busy, onOpen, onMove, onServe, onPix } = props;
  const mins = minutesSince(order.createdAt, now);
  const who = order.tableLabel ? `Mesa ${order.tableLabel}` : order.customerName;
  const change = changeToBring(order.changeFor, order.balance);
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
          <OrderTags order={order} />
        </span>
        <span className="hcard__pills">
          <span className="hcard__pill">{brl(order.total)}</span>
          {who && <span className="hcard__pill hcard__pill--soft">{who}</span>}
          {/* Pago em dinheiro com "troco para": quanto separar de troco, já no cartão. */}
          {change && (
            <span
              className="hcard__pill hcard__pill--change"
              title={`Troco para ${brl(order.changeFor!)}`}
            >
              Troco {brl(change)}
            </span>
          )}
        </span>
      </button>
      {order.pixStatus && (
        <span className="hcard__pix">
          <PixReceiptChip order={order} onOpen={onPix} />
        </span>
      )}
      <span className="hcard__time" title={`Feito às ${time(order.createdAt)}`}>
        {ago(mins)}
      </span>
      <CardActions
        className="hcard__actions"
        order={order}
        busy={busy}
        onOpen={onOpen}
        onMove={onMove}
        onServe={onServe}
      />
    </article>
  );
}

/**
 * Cartão "Completo": tudo o que se precisa para montar e despachar o pedido sem abri-lo. Topo
 * com o tipo, o número e há quanto tempo; quem é (mesa ou cliente e telefone) e o endereço;
 * os itens um por linha, com complementos e observação embaixo do nome e o valor alinhado à
 * direita; e o rodapé com o pagamento, o total e o próximo passo.
 */
function FullOrderCard({ order, now, busy, onOpen, onMove, onServe, onPix }: CardProps) {
  const mins = minutesSince(order.createdAt, now);
  const items = order.items.filter((i) => i.status !== 'cancelled');
  const shown = items.length > FULL_ITEMS + 1 ? items.slice(0, FULL_ITEMS) : items;
  const hidden = items.length - shown.length;
  const change = changeToBring(order.changeFor, order.balance);
  const phone = order.tableLabel ? null : phoneText(order.customerPhone);
  const where = order.tableLabel ? `Mesa ${order.tableLabel}` : CHANNEL_LABELS[order.channel];
  const who = order.customerName;
  const method =
    order.paymentHint && order.paymentStatus !== 'paid'
      ? PAYMENT_METHOD_LABELS[order.paymentHint]
      : null;
  const fee = Number(order.deliveryFee);
  return (
    <article
      className="ocard"
      data-status={order.status}
      data-late={mins >= 30 && order.status !== 'dispatched' ? '' : undefined}
    >
      <button
        className="ocard__open"
        onClick={() => onOpen()}
        aria-label={`Abrir pedido ${order.number}`}
      />
      <header className="ocard__head">
        <span className="ocard__ch" data-ch={order.channel} aria-hidden>
          {CHANNEL_ICON[order.channel]}
        </span>
        <span className="ocard__id">
          <span className="ocard__title">
            <strong>#{order.number}</strong>
            <OrderTags order={order} />
          </span>
          <span className="ocard__sub">
            <span>{where}</span>
            <span>{time(order.createdAt)}</span>
            {order.scheduledFor && (
              <span className="ocard__sched">
                <CalendarClock size={12} aria-hidden /> para {time(order.scheduledFor)}
              </span>
            )}
          </span>
        </span>
        <span className="ocard__time" title={`Feito às ${time(order.createdAt)}`}>
          <Clock3 size={12} aria-hidden />
          {ago(mins)}
        </span>
      </header>

      {(who || order.deliveryAddress) && (
        <div className="ocard__facts">
          {who && (
            <p className="ocard__fact">
              <UserRound size={14} aria-hidden />
              <span className="ocard__who">
                <strong>{who}</strong>
                {phone && <span className="ocard__phone">{phone}</span>}
              </span>
            </p>
          )}
          {order.channel === 'delivery' && order.deliveryAddress && (
            <p className="ocard__fact ocard__fact--addr" title={order.deliveryAddress}>
              <MapPin size={14} aria-hidden />
              <span>{order.deliveryAddress}</span>
            </p>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="ocard__items" aria-label="Itens">
          {shown.map((i) => (
            <li key={i.id} className="ocard__item" data-item={i.status}>
              <span className="ocard__qty">{qtyLabel(i.quantity, i.unit)}</span>
              <span className="ocard__name">
                <span className="ocard__nm">{i.name}</span>
                {i.options.length > 0 && (
                  <span className="ocard__opts">{i.options.map((o) => o.name).join(' · ')}</span>
                )}
                {i.notes && (
                  <span className="ocard__inote">
                    <Pencil size={11} aria-hidden />
                    {i.notes}
                  </span>
                )}
              </span>
              <span className="ocard__price">{brl(i.total)}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="ocard__more">
              + {hidden} {hidden === 1 ? 'item' : 'itens'}
            </li>
          )}
        </ul>
      )}

      {order.notes && (
        <p className="ocard__note">
          <MessageSquareText size={14} aria-hidden />
          <span>{order.notes}</span>
        </p>
      )}

      <footer className="ocard__foot">
        <span className="ocard__money">
          <span className="ocard__total">{brl(order.total)}</span>
          <span className="ocard__pay" data-pay={order.paymentStatus}>
            <i aria-hidden />
            <span>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</span>
            {order.paymentStatus === 'partial' && <span>falta {brl(order.balance)}</span>}
            {method && <span>{method}</span>}
          </span>
          {(change || (order.channel === 'delivery' && fee > 0)) && (
            <span className="ocard__extra">
              {order.channel === 'delivery' && fee > 0 && (
                <span>Entrega {brl(order.deliveryFee)}</span>
              )}
              {change && (
                <span className="ocard__change" title={`Troco para ${brl(order.changeFor!)}`}>
                  Troco {brl(change)}
                </span>
              )}
            </span>
          )}
        </span>
        <CardActions
          className="ocard__actions"
          order={order}
          busy={busy}
          onOpen={onOpen}
          onMove={onMove}
          onServe={onServe}
        />
      </footer>
      {order.pixStatus && (
        <span className="ocard__pix">
          <PixReceiptChip order={order} onOpen={onPix} />
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
export function PdvPage() {
  const toast = useToast();
  const canSell = useCan('orders:write');
  const canManage = useCan('orders:manage');
  const canTables = useCan('tables:operate');
  const canPay = useCan('payments:create');
  /** Ação do menu do cartão que a comanda já faz ao abrir (transferir, fechar conta). */
  const [tabIntent, setTabIntent] = useState<TabIntent | null>(null);
  /** Comanda com a conta na tela para imprimir (botão da impressora no cartão). */
  const [printTab, setPrintTab] = useState<string | null>(null);
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
  /** Compacto ou Completo: lembrado no aparelho. */
  const [density, setDensityState] = useState<Density>(() => {
    try {
      return localStorage.getItem(DENSITY_KEY) === 'full' ? 'full' : 'compact';
    } catch {
      return 'compact';
    }
  });
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, []);
  const [salonView, setSalonView] = useState<SalonView>('tables');
  const [salonOpen, setSalonOpen] = useState(true);
  /** Linhas de mesas à vista, escolhidas pelas setas entre o Salão e os Pedidos (null = padrão). */
  const [salonRows, setSalonRows] = useState<number | null>(readSalonRows);
  const salonGrid = useRef<HTMLDivElement>(null);
  /** Altura do salão enquanto a alça está sendo arrastada (px); ao soltar vira linhas inteiras. */
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; row: number; id: number } | null>(null);
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
  // "Cancelamento solicitado" de pedido de aplicativo foi o restaurante que pediu: não apita.
  useArrivalSound(
    'cancel',
    ids((o) => o.status === 'cancel_requested' && o.source !== 'app'),
  );
  // Fica apitando enquanto houver pedido esperando aceite ou pedido de cancelamento sem resposta.
  // Só pelo que chegou depois de abrir a tela: o que já estava esperando não faz o sino tocar ao abrir.
  // Pedido de aplicativo tem som próprio (e prazo: o aplicativo cancela se ninguém aceitar).
  useRepeatingSoundForNew(
    'order',
    ids((o) => o.status === 'awaiting' && o.source !== 'app'),
  );
  useRepeatingSoundForNew(
    'app_order',
    ids((o) => o.status === 'awaiting' && o.source === 'app'),
  );
  // Negociação do cliente do aplicativo (cancelar, reembolso...) apita até alguém responder.
  useRepeatingSoundForNew(
    'cancel',
    orders
      ? [
          ...ids((o) => o.status === 'cancel_requested' && o.source !== 'app')!,
          ...orders.filter((o) => o.appDisputeUntil).map((o) => `${o.id}@${o.appDisputeUntil}`),
        ]
      : null,
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
    const s = search.trim().toLowerCase().replace(/^#/, '');
    return (orders ?? []).filter(
      (o) =>
        // Pedido de mesa que já chegou na mesa sai do quadro (a conta fica na comanda).
        !(o.channel === 'table' && o.status === 'ready' && o.servedAt) &&
        (!s ||
          String(o.number).includes(s) ||
          (o.customerName ?? '').toLowerCase().includes(s) ||
          (o.customerPhone ?? '').includes(s) ||
          (o.tableLabel ?? '').toLowerCase() === s ||
          (!!o.tableLabel && `mesa ${o.tableLabel}`.toLowerCase() === s)),
    );
  }, [orders, search]);
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
  // Salão: mesas (com o estado) ou comandas abertas. A busca do PDV vale para a tela toda:
  // pedidos, mesas e comandas (a do topo, Ctrl K, busca o sistema inteiro).
  const salonQ = search.trim().toLowerCase().replace(/^#/, '');
  const shownTables = (tables ?? []).filter(
    (t) =>
      !salonQ ||
      t.label.toLowerCase().includes(salonQ) ||
      `mesa ${t.label}`.toLowerCase().includes(salonQ) ||
      String(t.tabNumber ?? '').includes(salonQ) ||
      (t.tabCustomer ?? '').toLowerCase().includes(salonQ),
  );
  const shownTabs = tabs.filter(
    (t) =>
      !salonQ ||
      String(t.number).includes(salonQ) ||
      (t.tableLabel ?? '').toLowerCase().includes(salonQ) ||
      `mesa ${t.tableLabel ?? ''}`.toLowerCase().includes(salonQ) ||
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

  /** Altura de uma linha de mesas agora (o celular usa linhas mais baixas). */
  function salonRowPx() {
    const g = salonGrid.current;
    return (g && parseFloat(getComputedStyle(g).getPropertyValue('--pdv-row'))) || 76;
  }
  const rowsFor = (h: number, row: number) =>
    Math.min(SALON_MAX_ROWS, Math.max(0, Math.round((h + SALON_GAP) / (row + SALON_GAP))));

  /** Grava o tamanho do salão em linhas inteiras (0 recolhe); fica guardado no aparelho. */
  function setSalonSize(next: number) {
    if (next <= 0) {
      setSalonOpen(false);
      return;
    }
    setSalonOpen(true);
    next = Math.min(SALON_MAX_ROWS, next);
    setSalonRows(next);
    try {
      localStorage.setItem(SALON_ROWS_KEY, String(next));
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }

  /** Linhas à vista agora (no padrão, conta pela altura que a grade tem na tela). */
  function currentRows() {
    if (!salonOpen) return 0;
    if (salonRows !== null) return salonRows;
    return Math.max(1, rowsFor(salonGrid.current?.clientHeight ?? 0, salonRowPx()));
  }

  /**
   * Alça entre o Salão e os Pedidos: segurar e arrastar para baixo aumenta o salão, para cima
   * diminui (até recolher). Enquanto arrasta acompanha o dedo; ao soltar, para numa linha inteira.
   */
  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = salonOpen ? (salonGrid.current?.clientHeight ?? 0) : 0;
    drag.current = { y: e.clientY, h, row: salonRowPx(), id: e.pointerId };
    if (!salonOpen) setSalonOpen(true);
    setDragH(h);
  }
  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const max = d.row * SALON_MAX_ROWS + SALON_GAP * (SALON_MAX_ROWS - 1) + 4;
    setDragH(Math.round(Math.min(max, Math.max(0, d.h + e.clientY - d.y))));
  }
  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const h = Math.min(
      d.row * SALON_MAX_ROWS + SALON_GAP * (SALON_MAX_ROWS - 1) + 4,
      Math.max(0, d.h + e.clientY - d.y),
    );
    setDragH(null);
    // Um toque sem arrastar não muda nada.
    if (Math.abs(e.clientY - d.y) < 4) {
      if (d.h === 0) setSalonOpen(false);
      return;
    }
    setSalonSize(rowsFor(h, d.row));
  }

  /** Ações do cartão de comanda: abrir, imprimir, transferir e fechar conta. */
  function tabAction(id: string, a: SalonCardAction) {
    if (a === 'print') return setPrintTab(id);
    setTabIntent(a === 'open' ? null : a);
    setTabId(id);
  }

  const storeLink = `${window.location.origin}/pedir`;

  return (
    <div className="pdv">
      <div className="pdv__bar">
        <div className="pdv__find">
          <label className="pdv__search">
            <Search size={18} aria-hidden />
            <input
              placeholder="Pesquisar"
              aria-label="Buscar pedido"
              title="Busca pedido, mesa, comanda ou cliente só nesta tela. Para o sistema todo, use a busca do topo (Ctrl K)."
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && search && setSearch('')}
            />
            {search && (
              <button
                type="button"
                className="pdv-find__clear"
                aria-label="Limpar a busca"
                onClick={(e) => {
                  e.preventDefault();
                  setSearch('');
                }}
              >
                <X size={16} />
              </button>
            )}
          </label>
        </div>
        <div className="pdv__spacer" />
        {/* Silenciar: desliga todos os avisos sonoros deste aparelho (o mesmo liga/desliga de
            Conta › Sons de aviso, onde ficam o volume e cada som). */}
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
        <AppStoreChips />
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
            <Plus size={20} strokeWidth={2.4} /> Nova venda <kbd className="kbd">F2</kbd>
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
            <div
              ref={salonGrid}
              className="pdv-salon__grid"
              data-rows={salonRows ?? undefined}
              data-dragging={dragH !== null || undefined}
              style={
                dragH !== null
                  ? { maxHeight: dragH, height: dragH }
                  : salonRows
                    ? ({ '--pdv-rows': salonRows } as CSSProperties)
                    : undefined
              }
            >
              {salonView === 'tables' ? (
                shownTables.length ? (
                  shownTables.map((t) => {
                    const st = tableState(t);
                    if (t.tabId)
                      return (
                        <SalonTabCard
                          key={t.id}
                          tab={{
                            id: t.tabId,
                            number: t.tabNumber,
                            tableLabel: t.label,
                            customerName: t.tabCustomer,
                          }}
                          state={st}
                          label={`Mesa ${t.label} ${STATE_TEXT[st]}${
                            t.pixReceiptAt ? ', mandou o comprovante do Pix' : ''
                          }`}
                          title={`Mesa ${t.label}`}
                          pix={!!t.pixReceiptAt}
                          canOperate={canTables}
                          canPay={canPay}
                          onAction={(a) => tabAction(t.tabId!, a)}
                          onRename={loadSalon}
                        >
                          <span className="pdv-table__info">{brl(t.tabTotal)}</span>
                          {t.pixReceiptAt ? (
                            <span className="pdv-table__pix">
                              <ReceiptText size={13} aria-hidden />
                              Pix para conferir
                            </span>
                          ) : (
                            <span className="pdv-table__sub">
                              {[
                                t.tabNumber && `#${t.tabNumber}`,
                                t.tabCustomer,
                                t.openedAt && ago(minutesSince(t.openedAt, now)),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </SalonTabCard>
                      );
                    return (
                      <button
                        key={t.id}
                        className="pdv-table"
                        data-state={st}
                        aria-label={`Mesa ${t.label} ${STATE_TEXT[st]}`}
                        onClick={() => openTable(t)}
                      >
                        <strong>Mesa {t.label}</strong>
                        <span className="pdv-table__info pdv-table__info--muted">Livre</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="pdv-empty">Nenhuma mesa encontrada.</p>
                )
              ) : shownTabs.length ? (
                shownTabs.map((t) => (
                  <SalonTabCard
                    key={t.id}
                    tab={t}
                    state={t.billRequestedAt ? 'paying' : 'busy'}
                    pix={!!t.pixReceiptAt}
                    label={`Comanda ${t.number}${
                      t.pixReceiptAt ? ', mandou o comprovante do Pix' : ''
                    }`}
                    title={`#${t.number}`}
                    canOperate={canTables}
                    canPay={canPay}
                    onAction={(a) => tabAction(t.id, a)}
                    onRename={loadSalon}
                  >
                    <span className="pdv-table__info">{brl(t.total)}</span>
                    {t.pixReceiptAt && (
                      <span className="pdv-table__pix">
                        <ReceiptText size={13} aria-hidden />
                        Pix para conferir
                      </span>
                    )}
                    <span className="pdv-table__sub" hidden={!!t.pixReceiptAt}>
                      {[
                        t.tableLabel ? `Mesa ${t.tableLabel}` : 'Sem mesa',
                        t.customerName,
                        ago(minutesSince(t.openedAt, now)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </SalonTabCard>
                ))
              ) : (
                <p className="pdv-empty">Nenhuma comanda aberta.</p>
              )}
            </div>
          )}
        </section>
      )}

      {canTables && tables && tables.length + tabs.length > 0 && (
        <div
          className="pdv-split"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Tamanho do salão: segure e arraste para cima ou para baixo"
          aria-valuemin={0}
          aria-valuemax={SALON_MAX_ROWS}
          aria-valuenow={salonOpen ? (salonRows ?? undefined) : 0}
          tabIndex={0}
          title="Segure e arraste para mudar o tamanho do salão"
          data-dragging={dragH !== null || undefined}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            setSalonSize(currentRows() + (e.key === 'ArrowDown' ? 1 : -1));
          }}
        >
          <span className="pdv-split__grip" aria-hidden>
            <GripHorizontal size={16} />
          </span>
        </div>
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

      <NewSaleModal
        open={selling}
        onClose={() => setSelling(false)}
        onCreated={() => {
          setSelling(false);
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
        intent={tabIntent}
        onClose={() => {
          setTabId(null);
          setTabIntent(null);
        }}
        onChanged={loadSalon}
        onBillRequested={() => undefined}
      />
      <ReceiptPreview
        target={printTab ? { kind: 'tab', id: printTab } : null}
        onClose={() => setPrintTab(null)}
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
