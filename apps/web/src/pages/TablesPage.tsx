import { toCents } from '@comandou/shared';
import {
  sortTables,
  STATE_LABEL,
  tableFromQr,
  tableState,
  type TableState,
} from '../features/table-state';
import {
  BellRing,
  Bike,
  CalendarClock,
  LayoutGrid,
  PencilRuler,
  Plus,
  Printer,
  Receipt,
  ReceiptText,
  ScanLine,
  Search,
  ShoppingBag,
  Smartphone,
  Utensils,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, EmptyState, Modal, TextField, useToast, Skeleton } from '../design-system';
import { useCan } from '../app/auth';
import { WaitersModal } from '../waiter/WaitersModal';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { QrScanner } from '../features/QrScanner';
import { SlideTabs } from '../features/SlideTabs';
import { TableEditor } from '../features/TableEditor';
import { TableGlyph } from '../features/salon/TableGlyph';
import { TabModal } from '../features/salon/TabModal';
import { MAX_DRAWN_CHAIRS } from '../features/salon/table-layout';
import {
  TakeoutBoard,
  takeoutFilterOf,
  type TakeoutChannel,
  type TakeoutFilter,
} from '../features/salon/TakeoutBoard';
import './salon.css';
import { elapsed, minutesSince } from '../features/format';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { DiningTable, Order, Tab } from '../lib/types';
import { TourButton } from '../features/tour/PageTour';
import { TableQrModal } from '../features/table-qr/TableQrModal';

export { tableLink } from '../features/table-qr/TableQrModal';

type View = 'tables' | 'tabs' | 'delivery' | 'pickup';
type TableFilter = 'all' | TableState;
type TabFilter = 'all' | 'bill' | 'table' | 'loose';
const VIEWS: View[] = ['tables', 'tabs', 'delivery', 'pickup'];
export { tableFromQr };

const needsLook = (o: Order) => o.status === 'awaiting' || o.status === 'cancel_requested';

/** Lembra a última aba aberta neste aparelho (o garçom costuma voltar para a mesma). */
const VIEW_KEY = 'cm.salon.view';
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY) as View | null;
    return v && VIEWS.includes(v) ? v : 'tables';
  } catch {
    return 'tables';
  }
}

/** Fileira de filtros em pílulas (com contagem), logo abaixo das abas. */
function FilterPills<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange(v: T): void;
  options: { value: T; label: string; count?: number; state?: string }[];
}) {
  return (
    <div className="salon-pills" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="salon-pill"
          data-state={o.state}
          onClick={() => onChange(o.value)}
        >
          {o.state && <i className="salon-pill__dot" aria-hidden />}
          {o.label}
          {o.count !== undefined && <span className="salon-pill__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const tabIcon = (icon: ReactNode, text: string) => (
  <span className="salon-tab">
    {icon}
    {text}
  </span>
);

/**
 * Salão: mesas, comandas, delivery e para levar, cada um numa aba no topo. No celular é a
 * tela do garçom: escaneia o QR da mesa (ou toca nela), abre a comanda e lança pedidos.
 */
export function TablesPage() {
  const toast = useToast();
  const canOperate = useCan('tables:operate');
  const canSell = useCan('orders:write');
  const canSetup = useCan('settings:manage');
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  /** Pedidos de delivery e para levar ainda em andamento. */
  const [takeouts, setTakeouts] = useState<Order[]>([]);
  /** Pedidos de mesa que a cozinha terminou (para o garçom levar): só para o som de aviso. */
  const [readyIds, setReadyIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState(false);
  const [view, setViewState] = useState<View>(savedView);
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [tabFilter, setTabFilter] = useState<TabFilter>('all');
  const [takeoutFilter, setTakeoutFilter] = useState<TakeoutFilter>('all');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [takeout, setTakeout] = useState<TakeoutChannel | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [freeTable, setFreeTable] = useState<DiningTable | null>(null);
  const [editor, setEditor] = useState(false);

  function setView(v: View) {
    setViewState(v);
    setTakeoutFilter('all');
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sem armazenamento: só não lembra a aba */
    }
  }

  useLinkParam('comanda', setTabId);
  useLinkParam('editar', () => canSetup && setEditor(true));
  useLinkParam('acao', (a) => {
    if (a === 'comanda' && canOperate) {
      setView('tabs');
      setNewTab(true);
    }
  });
  useLinkParam('aba', (a) => {
    const map: Record<string, View> = {
      mesas: 'tables',
      comandas: 'tabs',
      delivery: 'delivery',
      levar: 'pickup',
    };
    if (map[a]) setView(map[a]);
  });

  const load = useCallback(async () => {
    try {
      const [t, tb, rd, tk] = await Promise.all([
        api<DiningTable[]>('/tables'),
        api<Tab[]>('/tabs?status=open'),
        api<Order[]>('/orders?status=ready&channel=table').catch(() => null),
        api<Order[]>('/orders?active=true&limit=300').catch(() => null),
      ]);
      setReadyIds(rd ? rd.map((o) => o.id) : null);
      setTables(sortTables(t));
      setTabs(tb);
      setTakeouts(
        (tk ?? [])
          .filter((o) => o.channel === 'delivery' || o.channel === 'pickup')
          // Os que pedem atenção (aceite ou cancelamento) primeiro; depois, o mais antigo.
          .sort(
            (a, b) =>
              Number(needsLook(b)) - Number(needsLook(a)) || a.createdAt.localeCompare(b.createdAt),
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
    if (
      e.type === 'tab.changed' ||
      e.type === 'order.changed' ||
      e.type === 'menu.changed' ||
      e.type === 'reservation.changed'
    )
      reload();
  }, load);

  // Sons do salão: mesa pediu a conta e pedido de mesa pronto na cozinha.
  const seenBill = useArrivalSound(
    'bill',
    tables === null ? null : tabs.filter((t) => t.billRequestedAt).map((t) => t.id),
  );
  useArrivalSound('ready', readyIds);

  async function openTab(tableId: string) {
    try {
      const t = await api<Tab>('/tabs', { method: 'POST', json: { tableId } });
      setTabId(t.id);
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  /**
   * Toque na mesa ou QR lido: ocupada abre a comanda; livre já abre o pedido (a comanda nasce
   * com o primeiro pedido, então um toque sem querer não deixa comanda vazia aberta).
   */
  function goTable(t: DiningTable) {
    if (!t.tabId && !reservedOk(t)) return;
    if (t.tabId) setTabId(t.tabId);
    else if (canOperate && canSell) setFreeTable(t);
    else if (canOperate) void openTab(t.id);
    else toast(`Mesa ${t.label} está livre`);
  }
  // QR da mesa lido pela câmera do celular (fora do app) chega como /mesas?mesa=<id>.
  useLinkParam(
    'mesa',
    (id) => {
      const t = tables?.find((x) => x.id === id);
      if (t) goTable(t);
      else toast('Mesa não encontrada', 'danger');
    },
    tables !== null,
  );

  const q = search.trim().toLowerCase();
  const counts = { free: 0, busy: 0, paying: 0 };
  for (const t of tables ?? []) counts[tableState(t)] += 1;
  const shownTables = (tables ?? []).filter(
    (t) =>
      (tableFilter === 'all' || tableState(t) === tableFilter) &&
      (!q ||
        t.label.toLowerCase().includes(q) ||
        (t.area ?? '').toLowerCase().includes(q) ||
        (t.tabCustomer ?? '').toLowerCase().includes(q) ||
        String(t.tabNumber ?? '').includes(q)),
  );
  const tabCounts = {
    bill: tabs.filter((t) => t.billRequestedAt).length,
    table: tabs.filter((t) => t.tableId).length,
    loose: tabs.filter((t) => !t.tableId).length,
  };
  const shownTabs = tabs.filter(
    (t) =>
      (tabFilter === 'all' ||
        (tabFilter === 'bill' && !!t.billRequestedAt) ||
        (tabFilter === 'table' && !!t.tableId) ||
        (tabFilter === 'loose' && !t.tableId)) &&
      (!q ||
        String(t.number).includes(q) ||
        (t.tableLabel ?? '').toLowerCase().includes(q) ||
        (t.customerName ?? '').toLowerCase().includes(q)),
  );
  const byChannel = (c: TakeoutChannel) => takeouts.filter((o) => o.channel === c);
  const channelOrders = view === 'delivery' || view === 'pickup' ? byChannel(view) : [];
  const takeoutCounts = { kitchen: 0, ready: 0, route: 0 };
  for (const o of channelOrders) takeoutCounts[takeoutFilterOf(o)] += 1;
  const shownTakeouts = channelOrders.filter(
    (o) =>
      (takeoutFilter === 'all' || takeoutFilterOf(o) === takeoutFilter) &&
      (!q ||
        String(o.number).includes(q) ||
        (o.customerName ?? '').toLowerCase().includes(q) ||
        (o.customerPhone ?? '').includes(q) ||
        (o.deliveryAddress ?? '').toLowerCase().includes(q)),
  );
  // Mapa por área (Varanda, Mezanino...); sem área cadastrada, uma grade só, sem título.
  const areas = useMemo(() => {
    const m = new Map<string, DiningTable[]>();
    for (const t of shownTables) {
      const k = t.area?.trim() || '';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [shownTables]);

  const placeholder: Record<View, string> = {
    tables: 'Buscar mesa, área ou cliente',
    tabs: 'Nº da comanda, mesa ou cliente',
    delivery: 'Nº do pedido, cliente ou endereço',
    pickup: 'Nº do pedido ou cliente',
  };

  // Ação principal de cada aba (fica por último: no celular sobe para a linha de cima).
  const primary: Record<View, ReactNode> = {
    tables: (
      <Button icon={<ScanLine size={16} />} onClick={() => setScan(true)}>
        Escanear mesa
      </Button>
    ),
    tabs: canOperate ? (
      <Button icon={<Plus size={16} />} onClick={() => setNewTab(true)}>
        Comanda avulsa
      </Button>
    ) : null,
    delivery: canSell ? (
      <Button icon={<Bike size={16} />} onClick={() => setTakeout('delivery')}>
        Novo delivery
      </Button>
    ) : null,
    pickup: canSell ? (
      <Button icon={<ShoppingBag size={16} />} onClick={() => setTakeout('pickup')}>
        Novo para levar
      </Button>
    ) : null,
  };

  return (
    <div className="salon" data-view={view}>
      <div className="page-head">
        <h1 className="page-title cm-sr-only">Salão</h1>
        <SlideTabs<View>
          label="Salão"
          className="salon__tabs"
          value={view}
          onChange={setView}
          tabs={[
            {
              value: 'tables',
              label: tabIcon(<LayoutGrid size={16} aria-hidden />, 'Mesas'),
              count: counts.busy + counts.paying,
              title: 'Mesas ocupadas',
            },
            {
              value: 'tabs',
              label: tabIcon(<Receipt size={16} aria-hidden />, 'Comandas'),
              count: tabs.length,
            },
            {
              value: 'delivery',
              label: tabIcon(<Bike size={16} aria-hidden />, 'Delivery'),
              count: byChannel('delivery').length,
            },
            {
              value: 'pickup',
              label: tabIcon(<ShoppingBag size={16} aria-hidden />, 'Para levar'),
              count: byChannel('pickup').length,
            },
          ]}
        />
        <TourButton tour="salao" />
        <div className="actions-row" data-count={view === 'tables' && canSetup ? 4 : 1}>
          {view === 'tables' && canSetup && (
            <>
              <Button
                variant="ghost"
                icon={<PencilRuler size={16} />}
                onClick={() => setEditor(true)}
              >
                Personalizar mesas
              </Button>
              <Button variant="ghost" icon={<Printer size={16} />} onClick={() => setQrOpen(true)}>
                QR das mesas
              </Button>
              <Button
                variant="ghost"
                icon={<Smartphone size={16} />}
                onClick={() => setWaiterOpen(true)}
              >
                Garçons
              </Button>
            </>
          )}
          {primary[view]}
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="salon__bar">
        {view === 'tables' && (
          <FilterPills<TableFilter>
            label="Filtrar mesas"
            value={tableFilter}
            onChange={setTableFilter}
            options={[
              { value: 'all', label: 'Todas', count: tables?.length ?? 0 },
              { value: 'free', label: 'Livres', count: counts.free, state: 'free' },
              { value: 'busy', label: 'Ocupadas', count: counts.busy, state: 'busy' },
              { value: 'paying', label: 'Em pagamento', count: counts.paying, state: 'paying' },
            ]}
          />
        )}
        {view === 'tabs' && (
          <FilterPills<TabFilter>
            label="Filtrar comandas"
            value={tabFilter}
            onChange={setTabFilter}
            options={[
              { value: 'all', label: 'Todas', count: tabs.length },
              { value: 'bill', label: 'Pediram a conta', count: tabCounts.bill, state: 'paying' },
              { value: 'table', label: 'De mesa', count: tabCounts.table },
              { value: 'loose', label: 'Avulsas', count: tabCounts.loose },
            ]}
          />
        )}
        {(view === 'delivery' || view === 'pickup') && (
          <FilterPills<TakeoutFilter>
            label="Filtrar pedidos"
            value={takeoutFilter}
            onChange={setTakeoutFilter}
            options={[
              { value: 'all', label: 'Todos', count: channelOrders.length },
              { value: 'kitchen', label: 'Na cozinha', count: takeoutCounts.kitchen },
              { value: 'ready', label: 'Prontos', count: takeoutCounts.ready, state: 'free' },
              ...(view === 'delivery'
                ? [{ value: 'route' as const, label: 'Em rota', count: takeoutCounts.route }]
                : []),
            ]}
          />
        )}
        <label className="cm-search salon__search">
          <Search size={16} aria-hidden />
          <input
            placeholder={placeholder[view]}
            aria-label="Buscar no salão"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {tables === null ? (
        <Skeleton variant="grid" />
      ) : view === 'tables' ? (
        tables.length === 0 ? (
          <div className="salon-empty">
            <EmptyState
              icon={<LayoutGrid size={20} />}
              title="Nenhuma mesa cadastrada"
              description={
                canSetup
                  ? 'Diga quantas mesas o salão tem e crie todas de uma vez.'
                  : 'Peça ao gerente para cadastrar as mesas do salão.'
              }
              action={
                canSetup && (
                  <Button icon={<Plus size={16} />} onClick={() => setEditor(true)}>
                    Criar mesas
                  </Button>
                )
              }
            />
          </div>
        ) : shownTables.length === 0 ? (
          <div className="salon-empty">
            <EmptyState title="Nenhuma mesa aqui" description="Troque o filtro ou a busca." />
          </div>
        ) : (
          areas.map(([area, list]) => (
            <section key={area || '-'} className="salon__area">
              {(areas.length > 1 || area) && (
                <h2 className="salon__area-title">
                  {area || 'Salão principal'} <span>{list.length}</span>
                </h2>
              )}
              <div className="floor">
                {list.map((t) => (
                  <TableTile key={t.id} table={t} onOpen={() => goTable(t)} />
                ))}
              </div>
            </section>
          ))
        )
      ) : view === 'tabs' ? (
        shownTabs.length === 0 ? (
          <div className="salon-empty">
            <EmptyState
              icon={<Receipt size={20} />}
              title={tabs.length ? 'Nenhuma comanda aqui' : 'Nenhuma comanda aberta'}
              description="Comandas abertas em mesas e avulsas aparecem aqui."
            />
          </div>
        ) : (
          <div className="tickets">
            {shownTabs.map((t) => (
              <TabTicket key={t.id} tab={t} onOpen={() => setTabId(t.id)} />
            ))}
          </div>
        )
      ) : (
        <TakeoutBoard
          channel={view}
          orders={shownTakeouts}
          onOpen={setOrderId}
          emptyHint={
            channelOrders.length
              ? 'Troque o filtro ou a busca.'
              : view === 'delivery'
                ? 'Pedidos de entrega (do balcão, telefone ou cardápio online) aparecem aqui até serem entregues.'
                : 'Pedidos para retirada aparecem aqui até o cliente buscar.'
          }
        />
      )}

      <TabModal
        tabId={tabId}
        tables={tables ?? []}
        onClose={() => setTabId(null)}
        onChanged={load}
        onBillRequested={seenBill}
      />
      <OrderDetailModal
        orderId={orderId}
        onClose={() => {
          setOrderId(null);
          void load();
        }}
      />
      <LooseTabModal
        open={newTab}
        onClose={() => setNewTab(false)}
        onOpened={(id) => {
          setNewTab(false);
          setTabId(id);
          void load();
        }}
      />
      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Escanear mesa"
        hint="Aponte para o QR Code colado na mesa."
        onResult={(text) => {
          setScan(false);
          const t = tableFromQr(text, tables ?? []);
          if (t) goTable(t);
          else toast('Este QR Code não é de uma mesa deste restaurante', 'danger');
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
          toast('Pedido enviado para a cozinha', 'success');
          void load();
        }}
      />
      <NewSaleModal
        open={!!takeout}
        onClose={() => setTakeout(null)}
        preset={{ channel: takeout ?? 'pickup' }}
        onCreated={() => {
          setTakeout(null);
          toast('Pedido enviado', 'success');
          void load();
        }}
      />
      {canSetup && <TableEditor open={editor} onClose={() => setEditor(false)} onChanged={load} />}
      {canSetup && (
        <TableQrModal open={qrOpen} onClose={() => setQrOpen(false)} tables={tables ?? []} />
      )}
      {canSetup && <WaitersModal open={waiterOpen} onClose={() => setWaiterOpen(false)} />}
    </div>
  );
}

/** Mesa no mapa: o desenho (tampo + cadeiras) e, embaixo, o que importa agora. */
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Reserva marcada nesta mesa que ainda não chegou e começa em até 1 hora (ou já começou). */
function reservedSoon(t: DiningTable) {
  return (
    !!t.reservationAt &&
    t.reservationStatus !== 'seated' &&
    Date.parse(t.reservationAt) - Date.now() <= 60 * 60_000
  );
}

/**
 * Mesa livre, mas com reserva chegando: confirma antes de sentar outro cliente ali (a reserva
 * continua marcada; troque a mesa dela em Reservas se precisar).
 */
function reservedOk(t: DiningTable) {
  if (!reservedSoon(t)) return true;
  return window.confirm(
    `A mesa ${t.label} está reservada para ${t.reservationName} às ${hhmm(t.reservationAt!)}` +
      `${t.reservationParty ? ` (${t.reservationParty} pessoas)` : ''}.\n\n` +
      'Sentar outro cliente nesta mesa mesmo assim?',
  );
}

function TableTile({ table: t, onOpen }: { table: DiningTable; onOpen(): void }) {
  const st = tableState(t);
  const mins = t.openedAt ? minutesSince(t.openedAt) : 0;
  const extra = t.seats - MAX_DRAWN_CHAIRS;
  return (
    <button
      data-search-id={`mesa-${t.id}`}
      className="tbl"
      data-state={st}
      data-shape={t.shape}
      data-pix={(t.tabId && t.pixReceiptAt && true) || undefined}
      onClick={onOpen}
      aria-label={`Mesa ${t.label} ${STATE_LABEL[st].toLowerCase()}${
        t.tabId && t.pixReceiptAt ? ', mandou o comprovante do Pix' : ''
      }${
        !t.tabId && t.reservationAt && t.reservationStatus !== 'seated'
          ? `, reservada às ${hhmm(t.reservationAt)}`
          : ''
      }`}
    >
      <span className="tbl__art">
        <TableGlyph shape={t.shape} seats={t.seats} />
        <span className="tbl__label">{t.label}</span>
        {t.tabId && t.pixReceiptAt ? (
          <span className="tbl__time tbl__pix" title="Mandou o comprovante do Pix: confira">
            <ReceiptText size={11} aria-hidden />
            Pix
          </span>
        ) : (
          t.tabId && (
            <span className="tbl__time" data-long={mins >= 90 || undefined}>
              {st === 'paying' ? <Receipt size={11} aria-hidden /> : null}
              {st === 'paying' ? 'conta' : elapsed(mins)}
            </span>
          )
        )}
      </span>
      <span className="tbl__info">
        {t.tabId ? (
          <>
            <strong>{brl(t.tabTotal)}</strong>
            {t.tabCustomer && <span className="tbl__who">{t.tabCustomer}</span>}
          </>
        ) : t.reservationAt && t.reservationStatus !== 'seated' ? (
          <span className="tbl__resv" data-soon={reservedSoon(t) || undefined}>
            <CalendarClock size={12} aria-hidden />
            <span>
              {hhmm(t.reservationAt)} · {t.reservationName}
            </span>
          </span>
        ) : (
          <span className="tbl__who">
            {t.seats} lugares{extra > 0 ? ` (+${extra})` : ''}
          </span>
        )}
      </span>
    </button>
  );
}

/** Comanda como um cupom: número grande, onde está, quanto já foi pago e o saldo. */
function TabTicket({ tab: t, onOpen }: { tab: Tab; onOpen(): void }) {
  const total = toCents(t.total);
  const paidPct = total > 0 ? Math.min(100, Math.round((toCents(t.paid) / total) * 100)) : 0;
  const mins = minutesSince(t.openedAt);
  return (
    <button
      className="ticket"
      data-search-id={`comanda-${t.id}`}
      data-paying={!!t.billRequestedAt || undefined}
      onClick={onOpen}
    >
      <span className="ticket__top">
        <span className="ticket__num">
          <small>Nº</small>
          {t.number}
        </span>
        {t.pixReceiptAt ? (
          <span className="ticket__flag ticket__flag--pix" title="Mandou o comprovante do Pix">
            <ReceiptText size={12} aria-hidden />
            <span>Pix</span>
          </span>
        ) : (
          t.billRequestedAt && (
            <span className="ticket__flag" title="Pediu a conta">
              <BellRing size={12} aria-hidden />
              <span>conta</span>
            </span>
          )
        )}
      </span>
      <span className="ticket__meta">
        <span className="ticket__where">
          {t.tableLabel ? <Utensils size={13} aria-hidden /> : <Receipt size={13} aria-hidden />}
          {t.tableLabel ? `Mesa ${t.tableLabel}` : 'Avulsa'}
        </span>
        <span className="ticket__who">
          {t.customerName ?? `${t.orderCount} ${t.orderCount === 1 ? 'pedido' : 'pedidos'}`}
        </span>
        <span className="ticket__age" data-long={mins >= 180 || undefined}>
          {elapsed(mins)}
        </span>
      </span>
      <span className="ticket__cut" aria-hidden />
      <span className="ticket__foot">
        <span className="ticket__bar" title={`${paidPct}% pago`}>
          <i style={{ width: `${paidPct}%` }} />
        </span>
        <strong>{brl(t.balance)}</strong>
      </span>
    </button>
  );
}

function LooseTabModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose(): void;
  onOpened(id: string): void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      const t = await api<Tab>('/tabs', {
        method: 'POST',
        json: { customerName: name || undefined },
      });
      setName('');
      onOpened(t.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Comanda avulsa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save}>
            Abrir comanda
          </Button>
        </>
      }
    >
      <TextField
        label="Nome do cliente (opcional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
      />
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
