import {
  DEFAULT_KITCHEN_DISPLAY,
  KITCHEN_COLORS,
  type KitchenDisplay,
  type OrderChannel,
  qtyLabel,
} from '@comandou/shared';
import {
  Bike,
  Check,
  ChefHat,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Flame,
  LayoutGrid,
  LayoutList,
  LogOut,
  MapPin,
  Maximize,
  Minimize,
  Monitor,
  Moon,
  Palette,
  Play,
  Printer,
  RotateCcw,
  Settings,
  ShoppingBag,
  Store,
  Sun,
  Timer,
  UtensilsCrossed,
  Volume2,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  brandTokens,
  Button,
  clickPoint,
  EmptyState,
  ItemThumb,
  Modal,
  Sheet,
  switchTheme,
  useTheme,
  useToast,
  Skeleton,
} from '../design-system';
import { useCan } from '../app/auth';
import { SoundControl } from '../features/SoundControl';
import { CHANNEL_LABELS, qty } from '../features/format';
import {
  REFRESH_OPTIONS,
  setKdsPrefs,
  useKdsPrefs,
  waitLabel,
  type KdsPrefs,
} from '../kitchen/kds-prefs';
import { printTicket } from '../kitchen/print-ticket';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { useDebounced, useRealtime } from '../lib/realtime';
import {
  playSound,
  setSoundSettings,
  useArrivalSound,
  useRepeatingSoundForNew,
  useSoundSettings,
} from '../lib/sounds';
import type { OrderItem } from '../lib/types';
import '../kitchen/kds.css';
import { fullscreenSupported, useFullscreen } from '../features/FullscreenTab';
import { ChannelBadge } from '../features/channels/ChannelBadge';

interface BoardOrder {
  id: string;
  number: number;
  channel: OrderChannel;
  status: string;
  notes: string | null;
  createdAt: string;
  tableLabel: string | null;
  tabNumber: number | null;
  customerName: string | null;
  appChannel?: string | null;
  externalCode?: string | null;
  items: (Omit<OrderItem, 'options'> & { options: string[] })[];
}
interface Board {
  warnAfterMin: number;
  lateAfterMin: number;
  serverTime: string;
  orders: BoardOrder[];
}
interface Kitchen {
  id: string;
  name: string;
  channels: OrderChannel[];
  color: string | null;
}
interface KitchenConfig {
  kitchens: Kitchen[];
  display: KitchenDisplay;
  hasPrinter: boolean;
}

type ColKey = 'todo' | 'doing' | 'done';
type Level = 'ok' | 'warn' | 'late';

const CHANNEL_ICON: Record<OrderChannel, ReactNode> = {
  delivery: <Bike size={15} />,
  table: <UtensilsCrossed size={15} />,
  counter: <Store size={15} />,
  pickup: <ShoppingBag size={15} />,
};
const CHANNEL_ORDER: OrderChannel[] = ['delivery', 'table', 'counter', 'pickup'];

const isOpen = (o: BoardOrder) =>
  o.items.some((i) => i.status === 'pending' || i.status === 'preparing');
const colOf = (o: BoardOrder): ColKey =>
  !isOpen(o) ? 'done' : o.items.some((i) => i.status !== 'pending') ? 'doing' : 'todo';
type ItemStatus = BoardOrder['items'][number]['status'];

/**
 * Aplica na tela, na hora, o que o toque da cozinha vai fazer no servidor (atualização otimista):
 * o cartão já muda de coluna sem esperar a resposta nem a recarga do quadro.
 */
function applyLocal(
  b: Board,
  orderId: string,
  change: (s: ItemStatus) => ItemStatus,
  itemId?: string,
): Board {
  return {
    ...b,
    orders: b.orders.map((o) => {
      if (o.id !== orderId) return o;
      const items = o.items.map((i) =>
        itemId && i.id !== itemId ? i : { ...i, status: change(i.status) },
      );
      const allReady = items.every((i) => i.status === 'ready');
      const started = items.some((i) => i.status !== 'pending');
      const status = allReady
        ? 'ready'
        : o.status === 'ready' || (started && o.status === 'new')
          ? 'in_production'
          : o.status;
      return { ...o, items, status };
    }),
  };
}

const whereOf = (o: BoardOrder) =>
  [
    o.tableLabel ? `Mesa ${o.tableLabel}` : o.tabNumber ? `Comanda ${o.tabNumber}` : null,
    o.customerName,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Tela da cozinha (KDS). Cada aparelho escolhe qual cozinha mostra (Bar, Chapa...) e guarda a
 * escolha; os pedidos chegam separados por tipo (Delivery, Mesa, Balcão, Retirada) e andam em
 * três colunas: a fazer, preparando e pronto. O que aparece no cartão o Super Admin decide.
 * `standalone`: app da cozinha em tela cheia (login da cozinha), com escolha obrigatória.
 */
export function KitchenPage({
  standalone = false,
  title,
  onLogout,
  status,
}: {
  standalone?: boolean;
  /** Nome do restaurante (barra de cima do app da cozinha). */
  title?: string;
  onLogout?: () => void;
  /** Situação da conexão (app da cozinha). */
  status?: ReactNode;
}) {
  const toast = useToast();
  const canReopen = useCan('kitchen:reopen');
  const canOperate = useCan('kitchen:operate');
  const prefs = useKdsPrefs();
  const [theme] = useTheme();
  const [config, setConfig] = useState<KitchenConfig | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [channel, setChannel] = useState<OrderChannel | 'all'>('all');
  const [choosing, setChoosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const display = config?.display ?? DEFAULT_KITCHEN_DISPLAY;
  const kitchens = useMemo(() => config?.kitchens ?? [], [config]);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api<KitchenConfig>('/kitchen/config'));
    } catch {
      setConfig({ kitchens: [], display: DEFAULT_KITCHEN_DISPLAY, hasPrinter: false });
    }
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // A escolha salva vale se a cozinha ainda existe (e "todas" se ainda for permitido).
  const chosen = prefs.kitchen;
  const valid =
    chosen === null
      ? false
      : chosen === ''
        ? display.allowAll || kitchens.length === 0
        : chosen === 'none' || kitchens.some((k) => k.id === chosen);
  const mustChoose =
    !!config && kitchens.length > 0 && !valid && (standalone ? display.askKitchen : false);
  const fallback = display.allowAll || !kitchens[0] ? '' : kitchens[0].id;
  const sectorId = valid ? (chosen as string) : mustChoose ? null : fallback;
  const kitchen = kitchens.find((k) => k.id === sectorId) ?? null;
  const kitchenName =
    sectorId === 'none' ? 'Sem cozinha' : (kitchen?.name ?? (kitchens.length ? 'Todas' : null));

  // Muda a cada toque otimista: uma recarga que começou antes dele traria o quadro velho e o
  // cartão "voltaria" de coluna por um instante, então a resposta dela é descartada.
  const epoch = useRef(0);
  const load = useCallback(async () => {
    if (sectorId === null) return;
    const started = epoch.current;
    try {
      const b = await api<Board>(`/kitchen${sectorId ? `?sectorId=${sectorId}` : ''}`);
      if (epoch.current !== started) return;
      // Tempo de espera calculado com o relógio do servidor (tablets com hora errada não distorcem).
      setSkew(new Date(b.serverTime).getTime() - Date.now());
      setBoard(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sectorId]);
  const reload = useDebounced(load);
  useEffect(() => {
    if (config) void load();
  }, [load, config]);
  useEffect(() => {
    const t = setInterval(() => void load(), prefs.refresh * 1000);
    return () => clearInterval(t);
  }, [load, prefs.refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), display.timer ? 1000 : 15_000);
    return () => clearInterval(t);
  }, [display.timer]);
  useRealtime((e) => {
    if (e.type === 'order.changed' || e.type === 'kitchen.changed') reload();
    if (e.type === 'kitchen.settings') void loadConfig();
  }, load);

  // Som de cozinha quando entra pedido novo na fila; som de alerta no pedido de cancelamento.
  const orders = board?.orders;
  const seenTicket = useArrivalSound(
    'kitchen',
    orders?.filter(isOpen).map((o) => o.id),
  );
  const cancelIds = orders?.filter((o) => o.status === 'cancel_requested').map((o) => o.id);
  useArrivalSound('cancel', cancelIds);
  useRepeatingSoundForNew('cancel', cancelIds);

  /**
   * Toque da cozinha: o quadro muda na hora (otimista) e o servidor confirma por trás. Se der
   * erro, avisa e recarrega o quadro do servidor, desfazendo a mudança local.
   */
  async function act(
    orderId: string,
    url: string,
    body: object,
    change: (s: ItemStatus) => ItemStatus,
    itemId?: string,
  ) {
    epoch.current++;
    setBoard((b) => (b ? applyLocal(b, orderId, change, itemId) : b));
    setBusy(orderId);
    try {
      await api(url, { method: 'POST', json: body });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy((cur) => (cur === orderId ? null : cur));
    }
    void load();
  }

  // Tipos de pedido que esta cozinha recebe, com a contagem do que está aberto em cada um.
  const channels = useMemo(() => {
    const own = kitchen ? kitchen.channels : CHANNEL_ORDER;
    return CHANNEL_ORDER.filter((c) => own.includes(c));
  }, [kitchen]);
  const counts = useMemo(() => {
    const m = new Map<OrderChannel | 'all', number>();
    for (const o of orders ?? []) {
      if (!isOpen(o)) continue;
      m.set('all', (m.get('all') ?? 0) + 1);
      m.set(o.channel, (m.get(o.channel) ?? 0) + 1);
    }
    return m;
  }, [orders]);
  const activeChannel =
    display.channelTabs && channels.includes(channel as OrderChannel) ? channel : 'all';
  const visible = useMemo(
    () => (orders ?? []).filter((o) => activeChannel === 'all' || o.channel === activeChannel),
    [orders, activeChannel],
  );

  const clock = now + skew;
  const levelOf = (o: BoardOrder): Level => {
    if (!board || colOf(o) === 'done') return 'ok';
    const mins = (clock - new Date(o.createdAt).getTime()) / 60_000;
    return mins >= board.lateAfterMin ? 'late' : mins >= board.warnAfterMin ? 'warn' : 'ok';
  };
  const open = visible.filter(isOpen);
  const late = open.filter((o) => levelOf(o) === 'late').length;
  const avgMin = open.length
    ? Math.round(
        open.reduce((n, o) => n + (clock - new Date(o.createdAt).getTime()), 0) /
          open.length /
          60_000,
      )
    : 0;

  // Resumo do que ainda falta produzir (soma por item).
  const allDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of visible)
      for (const i of o.items)
        if (i.status === 'pending' || i.status === 'preparing')
          m.set(i.name, (m.get(i.name) ?? 0) + (i.unit === 'kg' ? 1 : Number(i.quantity)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [visible]);

  const accent = prefs.accent ?? kitchen?.color ?? null;
  const accentVars = useMemo(() => {
    if (!accent) return undefined;
    const t = brandTokens(accent);
    return { ...(theme === 'dark' ? t.dark : t.light), '--kds-kitchen': accent } as Record<
      string,
      string
    >;
  }, [accent, theme]);

  function pick(id: string) {
    // Leitura do setor anterior ainda em andamento não volta a aparecer no quadro novo.
    epoch.current++;
    setKdsPrefs({ kitchen: id });
    setChannel('all');
    setChoosing(false);
    setBoard(null);
  }

  async function print(o: BoardOrder) {
    const usePrinter =
      prefs.printVia === 'printer' || (prefs.printVia === 'auto' && config?.hasPrinter);
    if (usePrinter) {
      try {
        await api(`/kitchen/orders/${o.id}/print`, {
          method: 'POST',
          json: sectorId ? { sectorId } : {},
        });
        toast(`Pedido #${o.number} enviado para a impressora`, 'success');
        return;
      } catch (e) {
        if (prefs.printVia === 'printer') return toast((e as Error).message, 'danger');
      }
    }
    printTicket({
      kitchen: kitchenName && kitchenName !== 'Todas' ? kitchenName : 'Cozinha',
      number: o.number,
      where: [CHANNEL_LABELS[o.channel], whereOf(o)].filter(Boolean).join(' · '),
      time: new Date(o.createdAt).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      items: o.items.filter((i) => i.status !== 'cancelled'),
      notes: o.notes,
    });
  }

  const chooser = (
    <KitchenChooser
      kitchens={kitchens}
      allowAll={display.allowAll}
      current={valid ? chosen : null}
      onPick={pick}
    />
  );

  if (!config) return <Skeleton variant="board" />;
  if (mustChoose)
    return (
      <div className="kds-root kds-root--choose" data-standalone>
        <div className="kds-choose__top">
          <FullscreenButton />
          {onLogout && (
            <Button variant="ghost" icon={<LogOut size={16} />} onClick={onLogout}>
              Sair
            </Button>
          )}
        </div>
        {chooser}
      </div>
    );

  const columns: { key: ColKey; label: string; icon: ReactNode; list: BoardOrder[] }[] =
    prefs.layout === 'lista'
      ? [
          {
            key: 'todo',
            label: 'Pedidos',
            icon: <Timer size={16} />,
            list: visible.filter((o) => colOf(o) !== 'done'),
          },
        ]
      : [
          {
            key: 'todo',
            label: 'A fazer',
            icon: <Timer size={16} />,
            list: visible.filter((o) => colOf(o) === 'todo'),
          },
          {
            key: 'doing',
            label: 'Preparando',
            icon: <Flame size={16} />,
            list: visible.filter((o) => colOf(o) === 'doing'),
          },
          ...(display.doneColumn
            ? [
                {
                  key: 'done' as const,
                  label: 'Pronto',
                  icon: <CircleCheckBig size={16} />,
                  list: visible.filter((o) => colOf(o) === 'done').reverse(),
                },
              ]
            : []),
        ];

  return (
    <div
      className="kds-root"
      data-standalone={standalone || undefined}
      data-size={prefs.size}
      data-layout={prefs.layout}
      style={accentVars}
    >
      <header className="kds-bar">
        <div className="kds-bar__id">
          <span className="kds-bar__logo" aria-hidden>
            <ChefHat size={20} />
          </span>
          <div className="kds-bar__names">
            <h1 className="kds-bar__title">
              Cozinha
              {kitchenName && kitchens.length > 0 && <span> · {kitchenName}</span>}
            </h1>
            {title && <span className="kds-bar__sub">{title}</span>}
          </div>
          {kitchens.length > 0 && (display.askKitchen || !standalone) && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronDown size={16} />}
              aria-label="Trocar cozinha"
              title="Trocar cozinha"
              onClick={() => setChoosing(true)}
            />
          )}
        </div>
        {display.channelTabs && channels.length > 1 && (
          <nav className="kds-tabs" aria-label="Tipo de pedido">
            <TabButton
              active={activeChannel === 'all'}
              onClick={() => setChannel('all')}
              icon={<LayoutGrid size={15} />}
              label="Todos"
              count={counts.get('all') ?? 0}
            />
            {channels.map((c) => (
              <TabButton
                key={c}
                active={activeChannel === c}
                onClick={() => setChannel(c)}
                icon={CHANNEL_ICON[c]}
                label={CHANNEL_LABELS[c]}
                count={counts.get(c) ?? 0}
              />
            ))}
          </nav>
        )}
        <div className="kds-bar__stats">
          <span className="kds-stat">
            <Timer size={15} aria-hidden /> Tempo médio <strong>{avgMin} min</strong>
          </span>
          <span className="kds-stat" data-tone={late ? 'late' : 'ok'}>
            {late ? (
              <>
                <span className="kds-stat__dot" aria-hidden /> <strong>{late}</strong>{' '}
                {late === 1 ? 'atrasado' : 'atrasados'}
              </>
            ) : (
              <>
                <Check size={15} aria-hidden /> Em dia
              </>
            )}
          </span>
        </div>
        <div className="kds-bar__tools">
          {status}
          <Clock now={clock} />
          <SoundControl only={['kitchen', 'cancel']} />
          <button
            type="button"
            className="cm-theme-toggle"
            aria-label="Configurações da tela"
            title="Configurações"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
          <FullscreenButton compact />
          {onLogout && (
            <button
              type="button"
              className="cm-theme-toggle"
              aria-label="Sair"
              title="Sair"
              onClick={onLogout}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      {error && <Alert tone="danger">{error}</Alert>}
      {!board ? (
        <Skeleton variant="board" />
      ) : (
        <div className="kds" data-cols={columns.length}>
          {columns.map((c) => (
            <section key={c.key} className="kds__col" data-col={c.key} aria-label={c.label}>
              <h2 className="kds__head">
                <span className="kds__head-icon" aria-hidden>
                  {c.icon}
                </span>
                <span className="kds__head-label">{c.label}</span>
                <span className="kds__count" aria-label={`${c.list.length} pedidos`}>
                  {c.list.length}
                </span>
              </h2>
              <div className="kds__list">
                {c.list.length === 0 && (
                  <EmptyState
                    icon={<ChefHat size={20} />}
                    title={c.key === 'done' ? 'Nada pronto ainda' : 'Nenhum pedido aqui'}
                  />
                )}
                {c.list.map((o) => (
                  <OrderCard
                    key={o.id}
                    o={o}
                    col={colOf(o)}
                    level={levelOf(o)}
                    waitMs={clock - new Date(o.createdAt).getTime()}
                    display={display}
                    canOperate={canOperate}
                    canReopen={canReopen}
                    busy={busy === o.id}
                    onItem={(i) =>
                      i.status === 'pending'
                        ? act(o.id, `/kitchen/items/${i.id}/start`, {}, () => 'preparing', i.id)
                        : act(o.id, `/kitchen/items/${i.id}/ready`, {}, () => 'ready', i.id)
                    }
                    onReopen={(i) => {
                      const reason = window.prompt('Motivo para reabrir o item');
                      if (reason && reason.trim().length >= 3) {
                        seenTicket(o.id);
                        void act(
                          o.id,
                          `/kitchen/items/${i.id}/reopen`,
                          { reason: reason.trim() },
                          () => 'preparing',
                          i.id,
                        );
                      }
                    }}
                    onBump={(to) =>
                      act(
                        o.id,
                        `/kitchen/orders/${o.id}/bump`,
                        { to, sectorId: sectorId || undefined },
                        to === 'preparing'
                          ? (s) => (s === 'pending' ? 'preparing' : s)
                          : (s) => (s === 'pending' || s === 'preparing' ? 'ready' : s),
                      )
                    }
                    onPrint={() => void print(o)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {display.allDay && board && (
        <footer className="kds-allday" aria-label="A produzir">
          <span className="kds-allday__label">A produzir</span>
          {allDay.length === 0 ? (
            <span className="kds-allday__empty">Nada na fila</span>
          ) : (
            <ul>
              {allDay.map(([name, n]) => (
                <li key={name}>
                  <strong>{qty(String(n))}</strong> {name}
                </li>
              ))}
            </ul>
          )}
        </footer>
      )}

      <Modal open={choosing} title="Trocar cozinha" onClose={() => setChoosing(false)}>
        {chooser}
      </Modal>
      <KdsSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        kitchen={kitchen}
        kitchenName={kitchenName}
        canSwitch={kitchens.length > 0}
        onSwitch={() => {
          setSettingsOpen(false);
          setChoosing(true);
        }}
        showPrint={display.print}
        hasPrinter={!!config.hasPrinter}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick(): void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button type="button" className="kds-tab" aria-pressed={active} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="kds-tab__count">{count}</span>
    </button>
  );
}

function OrderCard({
  o,
  col,
  level,
  waitMs,
  display,
  canOperate,
  canReopen,
  busy,
  onItem,
  onReopen,
  onBump,
  onPrint,
}: {
  o: BoardOrder;
  col: ColKey;
  level: Level;
  waitMs: number;
  display: KitchenDisplay;
  canOperate: boolean;
  canReopen: boolean;
  busy: boolean;
  onItem(i: BoardOrder['items'][number]): void;
  onReopen(i: BoardOrder['items'][number]): void;
  onBump(to: 'preparing' | 'ready'): void;
  onPrint(): void;
}) {
  const cancel = o.status === 'cancel_requested';
  const where = whereOf(o);
  const allPending = o.items.every((i) => i.status === 'pending');
  return (
    <article
      className="kds-card"
      data-level={level}
      data-col={col}
      data-cancel={cancel || undefined}
    >
      <header className="kds-card__head">
        <strong className="kds-card__num">#{o.number}</strong>
        {o.appChannel && <ChannelBadge channel={o.appChannel} code={o.externalCode} size="sm" />}
        <span className="kds-chip" data-channel={o.channel}>
          {CHANNEL_ICON[o.channel]}
          {CHANNEL_LABELS[o.channel]}
        </span>
        {level === 'late' && <span className="kds-flag">Atrasado</span>}
        <span className="kds-card__spacer" />
        {display.print && (
          <button
            type="button"
            className="kds-card__print"
            aria-label={`Imprimir pedido ${o.number}`}
            title="Imprimir comanda"
            onClick={onPrint}
          >
            <Printer size={16} />
          </button>
        )}
        {display.timer && col !== 'done' && (
          <span className="kds-card__timer" aria-label={`${Math.floor(waitMs / 60_000)} minutos`}>
            {waitLabel(waitMs)}
          </span>
        )}
      </header>
      {display.customer && where && (
        <div className="kds-card__who">
          <MapPin size={14} aria-hidden />
          <span>{where}</span>
        </div>
      )}
      {cancel && <div className="kds-card__alert">Cancelamento solicitado. Não produzir.</div>}
      <ul className="kds-card__items">
        {o.items.map((i) => (
          <li key={i.id} data-status={i.status}>
            <button
              className="kds-item"
              disabled={!canOperate || i.status === 'ready' || busy || cancel}
              onClick={() => onItem(i)}
              aria-label={`${i.name}: ${i.status === 'pending' ? 'iniciar' : 'pronto'}`}
            >
              {display.photos && <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={40} />}
              <span className="kds-item__qty">{qtyLabel(i.quantity, i.unit)}</span>
              <span className="kds-item__text">
                <span className="kds-item__name">{i.name}</span>
                {display.options && i.options.length > 0 && (
                  <span className="kds-item__opts">{i.options.join(' · ')}</span>
                )}
                {display.notes && i.notes && (
                  <span className="kds-item__note">Obs.: {i.notes}</span>
                )}
              </span>
              <span className="kds-item__icon" aria-hidden>
                {i.status === 'pending' ? <Play size={16} /> : <Check size={16} />}
              </span>
            </button>
            {i.status === 'ready' && canReopen && (
              <Button
                variant="ghost"
                aria-label={`Reabrir ${i.name}`}
                icon={<RotateCcw size={14} />}
                onClick={() => onReopen(i)}
              />
            )}
          </li>
        ))}
      </ul>
      {display.notes && o.notes && <p className="kds-card__note">Pedido: {o.notes}</p>}
      {canOperate && col !== 'done' && !cancel && (
        <div className="kds-card__actions">
          {allPending ? (
            <Button
              block
              icon={<Play size={16} />}
              disabled={busy}
              onClick={() => onBump('preparing')}
            >
              Iniciar preparo
            </Button>
          ) : null}
          <Button
            block
            variant={allPending ? 'secondary' : 'primary'}
            icon={<Check size={16} />}
            disabled={busy}
            onClick={() => onBump('ready')}
          >
            Tudo pronto
          </Button>
        </div>
      )}
    </article>
  );
}

function KitchenChooser({
  kitchens,
  allowAll,
  current,
  onPick,
}: {
  kitchens: Kitchen[];
  allowAll: boolean;
  current: string | null;
  onPick(id: string): void;
}) {
  const row = (id: string, name: string, sub: string, color: string | null) => (
    <li key={id || 'all'}>
      <button
        type="button"
        className="kds-choose__row"
        aria-current={current === id || undefined}
        onClick={() => onPick(id)}
      >
        <span
          className="kds-choose__icon"
          style={
            color
              ? { color, background: `color-mix(in oklab, ${color} 12%, transparent)` }
              : undefined
          }
          aria-hidden
        >
          <Monitor size={18} />
        </span>
        <span className="kds-choose__text">
          <strong>{name}</strong>
          <small>{sub}</small>
        </span>
        {current === id ? <Check size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
      </button>
    </li>
  );
  return (
    <div className="kds-choose">
      <span className="kds-choose__logo" aria-hidden>
        <ChefHat size={26} />
      </span>
      <h1 className="kds-choose__title">Selecione a cozinha</h1>
      <p className="kds-choose__sub">Escolha qual tela este aparelho vai exibir.</p>
      <ul className="kds-choose__list">
        {kitchens.map((k) =>
          row(k.id, k.name, k.channels.map((c) => CHANNEL_LABELS[c]).join(' · '), k.color),
        )}
        {allowAll && row('', 'Todas as cozinhas', 'Todos os pedidos numa tela só', null)}
      </ul>
    </div>
  );
}

function KdsSettings({
  open,
  onClose,
  prefs,
  kitchen,
  kitchenName,
  canSwitch,
  onSwitch,
  showPrint,
  hasPrinter,
}: {
  open: boolean;
  onClose(): void;
  prefs: KdsPrefs;
  kitchen: Kitchen | null;
  kitchenName: string | null;
  canSwitch: boolean;
  onSwitch(): void;
  showPrint: boolean;
  hasPrinter: boolean;
}) {
  const [theme] = useTheme();
  const sound = useSoundSettings();
  const custom = !!prefs.accent && !(KITCHEN_COLORS as readonly string[]).includes(prefs.accent);
  return (
    <Sheet
      open={open}
      title="Configurações da tela"
      onClose={onClose}
      footer={
        <Button block onClick={onClose}>
          Pronto
        </Button>
      }
    >
      <div className="kds-set">
        <section className="kds-set__group">
          <h3>
            <Monitor size={15} aria-hidden /> Cozinha
          </h3>
          <div className="kds-set__row">
            <span>
              <strong>{kitchenName ?? 'Todos os pedidos'}</strong>
              <small>Fica salva neste aparelho.</small>
            </span>
            {canSwitch && (
              <Button variant="secondary" onClick={onSwitch}>
                Trocar
              </Button>
            )}
          </div>
        </section>

        <section className="kds-set__group">
          <h3>
            <Sun size={15} aria-hidden /> Tema
          </h3>
          <Seg
            label="Tema"
            value={theme}
            onChange={(v, e) => switchTheme(v, e)}
            items={[
              ['light', 'Claro', <Sun key="l" size={16} />],
              ['dark', 'Escuro', <Moon key="d" size={16} />],
            ]}
          />
        </section>

        <section className="kds-set__group">
          <h3>
            <Palette size={15} aria-hidden /> Cor de destaque
          </h3>
          <div className="kds-swatches" role="radiogroup" aria-label="Cor de destaque">
            <button
              type="button"
              role="radio"
              aria-checked={!prefs.accent}
              className="kds-swatch kds-swatch--auto"
              style={kitchen?.color ? { background: kitchen.color } : undefined}
              onClick={() => setKdsPrefs({ accent: null })}
              title={kitchen?.color ? 'Cor da cozinha' : 'Cor do restaurante'}
            >
              <span>Auto</span>
            </button>
            {KITCHEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={prefs.accent === c}
                aria-label={c}
                className="kds-swatch"
                style={{ background: c }}
                onClick={() => setKdsPrefs({ accent: c })}
              />
            ))}
            <label
              className="kds-swatch kds-swatch--custom"
              aria-checked={custom}
              title="Outra cor"
              style={custom ? { background: prefs.accent! } : undefined}
            >
              <Palette size={16} aria-hidden />
              <input
                type="color"
                aria-label="Outra cor"
                value={prefs.accent ?? kitchen?.color ?? '#e23a00'}
                onChange={(e) => setKdsPrefs({ accent: e.target.value })}
              />
            </label>
          </div>
          <small className="kds-set__hint">
            Pinta botões, abas e destaques desta tela. Auto usa a cor da cozinha.
          </small>
        </section>

        <section className="kds-set__group">
          <h3>
            <LayoutGrid size={15} aria-hidden /> Layout
          </h3>
          <Seg
            label="Layout"
            value={prefs.layout}
            onChange={(v) => setKdsPrefs({ layout: v })}
            items={[
              ['kanban', 'Colunas', <LayoutGrid key="k" size={16} />],
              ['lista', 'Lista', <LayoutList key="l" size={16} />],
            ]}
          />
          <Seg
            label="Tamanho do texto"
            value={prefs.size}
            onChange={(v) => setKdsPrefs({ size: v })}
            items={[
              ['normal', 'Normal'],
              ['grande', 'Grande'],
              ['enorme', 'Enorme'],
            ]}
          />
        </section>

        <section className="kds-set__group">
          <h3>
            <Volume2 size={15} aria-hidden /> Som
          </h3>
          <label className="kds-set__row switch">
            <span>
              <strong>Avisos sonoros</strong>
              <small>Toca quando entra pedido e no pedido de cancelamento.</small>
            </span>
            <input
              type="checkbox"
              checked={sound.enabled}
              onChange={(e) => setSoundSettings({ enabled: e.target.checked })}
            />
            <span className="switch__track" aria-hidden />
          </label>
          <div className="kds-set__volume">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Volume"
              value={Math.round(sound.volume * 100)}
              disabled={!sound.enabled}
              onChange={(e) => setSoundSettings({ volume: Number(e.target.value) / 100 })}
            />
            <span>{Math.round(sound.volume * 100)}%</span>
            <Button
              variant="secondary"
              icon={<Play size={14} />}
              onClick={() => playSound('kitchen', true)}
            >
              Testar
            </Button>
          </div>
        </section>

        {showPrint && (
          <section className="kds-set__group">
            <h3>
              <Printer size={15} aria-hidden /> Impressão
            </h3>
            <Seg
              label="Onde imprimir"
              value={prefs.printVia}
              onChange={(v) => setKdsPrefs({ printVia: v })}
              items={[
                ['auto', 'Automático'],
                ['browser', 'Neste aparelho'],
                ['printer', 'Impressora da loja'],
              ]}
            />
            <small className="kds-set__hint">
              {hasPrinter
                ? 'A loja tem impressora ligada: no automático, a comanda vai para ela.'
                : 'Sem impressora da loja ligada: a comanda sai pela impressora deste aparelho.'}
            </small>
          </section>
        )}

        <section className="kds-set__group">
          <h3>
            <RotateCcw size={15} aria-hidden /> Conferir a fila a cada
          </h3>
          <Seg
            label="Conferir a fila a cada"
            value={String(prefs.refresh)}
            onChange={(v) => setKdsPrefs({ refresh: Number(v) })}
            items={REFRESH_OPTIONS.map(
              (s) => [String(s), s < 60 ? `${s}s` : '1min'] as [string, string],
            )}
          />
          <small className="kds-set__hint">
            Pedido novo aparece na hora; esta conferência é a garantia se a internet oscilar.
          </small>
        </section>
      </div>
    </Sheet>
  );
}

function Seg<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange(v: T, from?: { x: number; y: number }): void;
  items: [T, string, ReactNode?][];
}) {
  return (
    <div className="kds-seg" role="group" aria-label={label}>
      {items.map(([v, text, icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={(e) => value !== v && onChange(v, clickPoint(e, e.currentTarget))}
        >
          {icon}
          {text}
        </button>
      ))}
    </div>
  );
}

function Clock({ now }: { now: number }) {
  return (
    <span className="kds-clock" aria-hidden>
      {new Date(now).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  );
}

/** Tela cheia (a TV ou o tablet da cozinha fica só com a fila). Some onde o navegador não deixa. */
function FullscreenButton({ compact }: { compact?: boolean }) {
  const { full, toggle } = useFullscreen();
  if (!fullscreenSupported()) return null;
  const label = full ? 'Sair da tela cheia' : 'Tela cheia';
  if (compact)
    return (
      <button
        type="button"
        className="cm-theme-toggle kds-fs"
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        {full ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
    );
  return (
    <Button
      variant="secondary"
      icon={full ? <Minimize size={16} /> : <Maximize size={16} />}
      onClick={toggle}
    >
      {label}
    </Button>
  );
}
