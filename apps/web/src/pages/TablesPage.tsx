import { toCents, qtyLabel } from '@comandou/shared';
import {
  sortTables,
  STATE_LABEL,
  tableFromQr,
  tableState,
  type TableState,
} from '../features/table-state';
import {
  ArrowRightLeft,
  BellRing,
  Bike,
  CircleCheck,
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
  Wallet,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ItemThumbStrip,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { mediaUrl } from '../lib/media';
import { useCan } from '../app/auth';
import { WaitersModal } from '../waiter/WaitersModal';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { PaymentModal } from '../features/PaymentModal';
import { ReceiptPreview } from '../features/ReceiptPreview';
import { QrScanner } from '../features/QrScanner';
import { SlideTabs } from '../features/SlideTabs';
import { TableEditor } from '../features/TableEditor';
import { TableGlyph } from '../features/salon/TableGlyph';
import { MAX_DRAWN_CHAIRS } from '../features/salon/table-layout';
import {
  TakeoutBoard,
  takeoutFilterOf,
  type TakeoutChannel,
  type TakeoutFilter,
} from '../features/salon/TakeoutBoard';
import './salon.css';
import {
  elapsed,
  minutesSince,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
} from '../features/format';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { DiningTable, Order, Tab } from '../lib/types';

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
    if (e.type === 'tab.changed' || e.type === 'order.changed' || e.type === 'menu.changed')
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
        <div>
          <h1 className="page-title">Salão</h1>
          <p className="page-sub">
            {counts.busy + counts.paying} de {tables?.length ?? 0} mesas ocupadas · {tabs.length}{' '}
            comanda(s) · {takeouts.length} para entregar ou levar
          </p>
        </div>
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
        <Spinner />
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
      onClick={onOpen}
      aria-label={`Mesa ${t.label} ${STATE_LABEL[st].toLowerCase()}`}
    >
      <span className="tbl__art">
        <TableGlyph shape={t.shape} seats={t.seats} />
        <span className="tbl__label">{t.label}</span>
        {t.tabId && (
          <span className="tbl__time" data-long={mins >= 90 || undefined}>
            {st === 'paying' ? <Receipt size={11} aria-hidden /> : null}
            {st === 'paying' ? 'conta' : elapsed(mins)}
          </span>
        )}
      </span>
      <span className="tbl__info">
        {t.tabId ? (
          <>
            <strong>{brl(t.tabTotal)}</strong>
            {t.tabCustomer && <span className="tbl__who">{t.tabCustomer}</span>}
          </>
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
        {t.billRequestedAt && (
          <span className="ticket__flag" title="Pediu a conta">
            <BellRing size={12} aria-hidden />
            <span>conta</span>
          </span>
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

/** Folha para imprimir: um QR por mesa. Cliente que lê abre o cardápio; a equipe abre a mesa. */
function TableQrModal({
  open,
  onClose,
  tables,
}: {
  open: boolean;
  onClose(): void;
  tables: DiningTable[];
}) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const QRCode = (await import('qrcode')).default;
      const out: Record<string, string> = {};
      for (const t of tables)
        out[t.id] = await QRCode.toDataURL(tableLink(t.id), { margin: 1, width: 360 });
      if (alive) setCodes(out);
    })();
    return () => {
      alive = false;
    };
  }, [open, tables]);
  return (
    <Modal open={open} onClose={onClose} title="QR Code das mesas" size="xl">
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Imprima e cole um em cada mesa. O garçom escaneia pelo app e abre a comanda; o cliente que
        aponta a câmera vê o cardápio.
      </p>
      <div className="qr-sheet">
        {tables.map((t) => (
          <figure key={t.id} className="qr-card">
            {codes[t.id] ? (
              <img src={codes[t.id]} alt={`QR Code da mesa ${t.label}`} />
            ) : (
              <Spinner />
            )}
            <figcaption>Mesa {t.label}</figcaption>
          </figure>
        ))}
      </div>
      <div className="actions-row">
        <Button icon={<Printer size={16} />} onClick={() => printQrSheet()}>
          Imprimir
        </Button>
      </div>
    </Modal>
  );
}

export const tableLink = (id: string) => `${window.location.origin}/mesa/${id}`;

/** Imprime só a folha de QR (abre uma janela limpa, sem o restante do sistema). */
function printQrSheet() {
  const sheet = document.querySelector('.qr-sheet');
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!sheet || !w) return;
  w.document
    .write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR das mesas</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}.qr-sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.qr-card{border:1px dashed #999;border-radius:12px;padding:12px;text-align:center;break-inside:avoid;margin:0}
.qr-card img{width:100%;max-width:220px}figcaption{font-size:22px;font-weight:700;margin-top:6px}</style></head>
<body>${sheet.outerHTML}</body></html>`);
  w.document.close();
  // Espera as imagens carregarem; imprime uma vez só.
  let printed = false;
  const print = () => {
    if (printed) return;
    printed = true;
    w.print();
  };
  w.onload = print;
  setTimeout(print, 600);
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

const pct = (v: string) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

function TabModal({
  tabId,
  tables,
  onClose,
  onChanged,
  onBillRequested,
}: {
  tabId: string | null;
  tables: DiningTable[];
  onClose(): void;
  onChanged(): void;
  /** Quem marcou "pediu a conta" aqui não ouve o próprio aviso. */
  onBillRequested(tabId: string): void;
}) {
  const toast = useToast();
  const canPay = useCan('payments:create');
  const canOperate = useCan('tables:operate');
  const canManage = useCan('orders:manage');
  const [tab, setTab] = useState<Tab | null>(null);
  /** Taxa de serviço padrão do salão (Configurações), para religar numa comanda sem taxa. */
  const [defaultFee, setDefaultFee] = useState<string>('0.00');
  useEffect(() => {
    if (!tabId) return;
    api<{ serviceFeePercent: string }>('/salon/settings')
      .then((r) => setDefaultFee(r.serviceFeePercent))
      .catch(() => undefined);
  }, [tabId]);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Comprovante de fechamento na tela (antes ou logo depois de fechar a conta). */
  const [receipt, setReceipt] = useState<{ afterClose: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!tabId) return;
    try {
      setTab(await api<Tab>(`/tabs/${tabId}`));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [tabId, toast]);
  useEffect(() => {
    setTab(null);
    setTransfer(false);
    void load();
  }, [load]);
  useRealtime((e) => {
    if (
      (e.type === 'tab.changed' && e.tabId === tabId) ||
      (e.type === 'order.changed' && tab?.orders?.some((o) => o.id === e.orderId))
    )
      void load();
  }, load);

  async function close() {
    if (!tab) return;
    setBusy(true);
    try {
      await api(`/tabs/${tab.id}/close`, { method: 'POST' });
      toast(`Conta da comanda ${tab.number} fechada`, 'success');
      onChanged();
      setReceipt({ afterClose: true });
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function billRequest(requested: boolean) {
    if (!tab) return;
    if (requested) onBillRequested(tab.id);
    try {
      setTab(
        await api<Tab>(`/tabs/${tab.id}/bill-request`, { method: 'POST', json: { requested } }),
      );
      onChanged();
      toast(
        requested ? 'Caixa avisado: mesa pediu a conta' : 'Pedido de conta desfeito',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function setFee(percent: string | null) {
    if (!tab) return;
    try {
      setTab(await api<Tab>(`/tabs/${tab.id}/service-fee`, { method: 'POST', json: { percent } }));
      onChanged();
      toast(percent ? 'Taxa de serviço cobrada' : 'Taxa de serviço retirada', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function moveTo(tableId: string) {
    if (!tab) return;
    try {
      setTab(await api<Tab>(`/tabs/${tab.id}/transfer`, { method: 'POST', json: { tableId } }));
      setTransfer(false);
      onChanged();
      toast('Mesa transferida', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const title = tab
    ? tab.tableLabel
      ? `Mesa ${tab.tableLabel} · comanda ${tab.number}`
      : `Comanda ${tab.number}`
    : 'Comanda';
  const label = tab?.tableLabel ? `Mesa ${tab.tableLabel}` : `Comanda ${tab?.number ?? ''}`;
  const open = tab?.status === 'open';
  const owes = !!tab && toCents(tab.balance) > 0;
  // Rodapé fixo (padrão das folhas): a ação principal fica sempre à vista, grande, embaixo.
  const footer =
    !tab || !open ? undefined : transfer ? (
      <Button variant="secondary" size="lg" onClick={() => setTransfer(false)}>
        Voltar
      </Button>
    ) : (
      <>
        {canOperate && (
          <Button
            variant={canPay ? 'secondary' : 'primary'}
            size="lg"
            icon={<Plus size={18} />}
            onClick={() => setAdding(true)}
          >
            Adicionar pedido
          </Button>
        )}
        <Button
          variant="secondary"
          size="lg"
          icon={<ReceiptText size={18} />}
          onClick={() => setReceipt({ afterClose: false })}
        >
          Comprovante
        </Button>
        {canPay &&
          (owes ? (
            <Button size="lg" icon={<Wallet size={18} />} onClick={() => setPaying(true)}>
              Receber {brl(tab.balance)}
            </Button>
          ) : (
            <Button
              variant="success"
              size="lg"
              loading={busy}
              icon={<CircleCheck size={18} />}
              onClick={close}
            >
              Fechar conta
            </Button>
          ))}
      </>
    );
  return (
    <Modal open={!!tabId} onClose={onClose} title={title} size="lg" footer={footer}>
      {!tab ? (
        <Spinner />
      ) : (
        <div className="order-detail">
          {tab.billRequestedAt && (
            <Alert tone="warning">
              Mesa pediu a conta às{' '}
              {new Date(tab.billRequestedAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {tab.billSplitParts
                ? `, dividida em ${tab.billSplitParts}. Ao receber, já vem uma parte por pessoa.`
                : '.'}
            </Alert>
          )}
          <div className="tab-summary">
            <div>
              <span>Total</span>
              <strong>{brl(tab.total)}</strong>
            </div>
            <div>
              <span>Pago</span>
              <strong>{brl(tab.paid)}</strong>
            </div>
            <div data-owes={owes || undefined}>
              <span>Saldo</span>
              <strong>{brl(tab.balance)}</strong>
            </div>
          </div>
          {open && (tab.serviceFeePercent || Number(defaultFee) > 0) && (
            <div className="tab-fee">
              {tab.serviceFeePercent ? (
                <span>
                  Taxa de serviço {pct(tab.serviceFeePercent)} ·{' '}
                  <strong>{brl(tab.serviceFee ?? '0')}</strong>
                </span>
              ) : (
                <span>Sem taxa de serviço nesta comanda</span>
              )}
              {canManage &&
                (tab.serviceFeePercent ? (
                  <Button variant="ghost" size="sm" onClick={() => void setFee(null)}>
                    Tirar taxa
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void setFee(defaultFee)}>
                    Cobrar {pct(defaultFee)}
                  </Button>
                ))}
            </div>
          )}
          {(tab.orders ?? []).length === 0 ? (
            <EmptyState title="Nenhum pedido nesta comanda" />
          ) : (
            <table className="cm-table cm-table--click">
              <tbody>
                {tab.orders!.map((o) => (
                  <tr key={o.id} onClick={() => setOrderId(o.id)}>
                    <td>
                      <strong>#{o.number}</strong>
                      <ItemThumbStrip
                        items={o.items.map((i) => ({
                          key: i.id,
                          src: mediaUrl(i.imageId),
                          name: i.name,
                        }))}
                        size={24}
                      />
                      <div className="cm-hint">
                        {o.items.map((i) => `${qtyLabel(i.quantity, i.unit)} ${i.name}`).join(', ')}
                      </div>
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
          )}
          {transfer && (
            <div className="inline-form">
              <strong>Transferir para</strong>
              <div className="chips">
                {tables
                  .filter((t) => !t.tabId)
                  .map((t) => (
                    <button key={t.id} className="chip" onClick={() => moveTo(t.id)}>
                      Mesa {t.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {open && !transfer && (
            <div className="tab-actions">
              {canPay && owes && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<Receipt size={18} />}
                  onClick={() => setPaying(true)}
                >
                  Receber / dividir
                </Button>
              )}
              {canOperate && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<BellRing size={18} />}
                  aria-pressed={!!tab.billRequestedAt}
                  onClick={() => billRequest(!tab.billRequestedAt)}
                >
                  {tab.billRequestedAt ? 'Desfazer pedido de conta' : 'Pediu a conta'}
                </Button>
              )}
              {canOperate && tab.tableId && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<ArrowRightLeft size={18} />}
                  onClick={() => setTransfer(true)}
                >
                  Transferir mesa
                </Button>
              )}
              {canPay && owes && (
                <p className="cm-hint tab-actions__hint">
                  Para fechar a conta, receba o saldo de {brl(tab.balance)}.
                </p>
              )}
            </div>
          )}
          <NewSaleModal
            open={adding}
            onClose={() => setAdding(false)}
            preset={{ channel: 'table', tabId: tab.id, label }}
            onCreated={() => {
              setAdding(false);
              void load();
              onChanged();
            }}
          />
          <PaymentModal
            open={paying}
            onClose={() => setPaying(false)}
            onPaid={() => {
              setPaying(false);
              void load();
              onChanged();
            }}
            target={{
              kind: 'tab',
              id: tab.id,
              number: tab.number,
              balance: tab.balance,
              splitParts: tab.billSplitParts,
            }}
          />
          <OrderDetailModal
            orderId={orderId}
            onClose={() => {
              setOrderId(null);
              void load();
            }}
          />
          <ReceiptPreview
            target={receipt ? { kind: 'tab', id: tab.id } : null}
            onClose={() => {
              const after = receipt?.afterClose;
              setReceipt(null);
              if (after) onClose();
            }}
          />
        </div>
      )}
    </Modal>
  );
}
