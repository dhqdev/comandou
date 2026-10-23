import { toCents } from '@comandou/shared';
import {
  ArrowRightLeft,
  BellRing,
  LayoutGrid,
  Plus,
  Printer,
  Receipt,
  ScanLine,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { useCan } from '../app/auth';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { PaymentModal } from '../features/PaymentModal';
import { QrScanner } from '../features/QrScanner';
import { SlideTabs } from '../features/SlideTabs';
import './salon.css';
import {
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
import type { DiningTable, Tab } from '../lib/types';

type View = 'tables' | 'tabs';
type TableState = 'free' | 'busy' | 'paying';

/** Mesa "em pagamento": pediu a conta ou já pagou uma parte. */
function tableState(t: DiningTable): TableState {
  if (!t.tabId) return 'free';
  if (t.billRequestedAt || toCents(t.tabPaid ?? '0') > 0) return 'paying';
  return 'busy';
}
const STATE_LABEL: Record<TableState, string> = {
  free: 'Livre',
  busy: 'Ocupada',
  paying: 'Em pagamento',
};

/** Lê o QR da mesa: aceita o link /mesa/<id>, o id puro ou o número da mesa. */
export function tableFromQr(text: string, tables: DiningTable[]): DiningTable | undefined {
  const raw = text.trim();
  const m = raw.match(/\/mesa\/([0-9a-f-]{36})/i);
  const id = m?.[1] ?? raw;
  return (
    tables.find((t) => t.id === id) ??
    tables.find((t) => t.label.toLowerCase() === raw.replace(/^mesa\s*/i, '').toLowerCase())
  );
}

/**
 * Salão: mapa de mesas e comandas. No celular é a tela do garçom: escaneia o QR da mesa (ou
 * toca nela), abre a comanda, lança pedidos e marca quando a mesa pede a conta.
 */
export function TablesPage() {
  const toast = useToast();
  const canOperate = useCan('tables:operate');
  const canSell = useCan('orders:write');
  const canSetup = useCan('settings:manage');
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState(false);
  const [view, setView] = useState<View>('tables');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState(false);
  const [takeout, setTakeout] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [freeTable, setFreeTable] = useState<DiningTable | null>(null);
  useLinkParam('comanda', setTabId);
  useLinkParam('acao', (a) => a === 'comanda' && canOperate && setNewTab(true));

  const load = useCallback(async () => {
    try {
      const [t, tb] = await Promise.all([
        api<DiningTable[]>('/tables'),
        api<Tab[]>('/tabs?status=open'),
      ]);
      // Ordem do cadastro e, no empate, número natural (2 antes de 10).
      setTables(
        t
          .filter((x) => x.active)
          .sort(
            (a, b) =>
              (a.position ?? 0) - (b.position ?? 0) ||
              a.label.localeCompare(b.label, 'pt-BR', { numeric: true }),
          ),
      );
      setTabs(tb);
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
    if (e.type === 'tab.changed' || e.type === 'order.changed') reload();
  }, load);

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
  const shownTables = (tables ?? []).filter(
    (t) =>
      !q ||
      t.label.toLowerCase().includes(q) ||
      (t.tabCustomer ?? '').toLowerCase().includes(q) ||
      String(t.tabNumber ?? '').includes(q),
  );
  const shownTabs = tabs.filter(
    (t) =>
      !q ||
      String(t.number).includes(q) ||
      (t.tableLabel ?? '').toLowerCase().includes(q) ||
      (t.customerName ?? '').toLowerCase().includes(q),
  );
  const counts = { free: 0, busy: 0, paying: 0 };
  for (const t of tables ?? []) counts[tableState(t)] += 1;

  return (
    <div className="salon">
      <div className="page-head">
        <div>
          <h1 className="page-title">Salão</h1>
          <p className="page-sub">Mapa de mesas e comandas: toque na mesa ou escaneie o QR.</p>
        </div>
        <div className="actions-row">
          {canSetup && (
            <Button variant="ghost" icon={<Printer size={16} />} onClick={() => setQrOpen(true)}>
              QR das mesas
            </Button>
          )}
          {canOperate && (
            <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setNewTab(true)}>
              Comanda avulsa
            </Button>
          )}
          <Button icon={<ScanLine size={16} />} onClick={() => setScan(true)}>
            Escanear mesa
          </Button>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="salon__bar">
        <SlideTabs<View>
          label="Mesas ou comandas"
          value={view}
          onChange={setView}
          tabs={[
            { value: 'tables', label: 'Mesas', count: tables?.length ?? 0 },
            { value: 'tabs', label: 'Comandas', count: tabs.length },
          ]}
        />
        <label className="home__search salon__search">
          <Search size={16} aria-hidden />
          <input
            placeholder={
              view === 'tables' ? 'Buscar mesa ou cliente' : 'Nº da comanda, mesa ou cliente'
            }
            aria-label="Buscar mesa ou comanda"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {view === 'tables' && (
        <div className="salon__legend" aria-label="Legenda">
          <span data-state="free">Livres {counts.free}</span>
          <span data-state="busy">Ocupadas {counts.busy}</span>
          <span data-state="paying">Em pagamento {counts.paying}</span>
        </div>
      )}
      {tables === null ? (
        <Spinner />
      ) : view === 'tables' ? (
        tables.length === 0 ? (
          <Card>
            <EmptyState
              icon={<LayoutGrid size={20} />}
              title="Nenhuma mesa cadastrada"
              description="Cadastre as mesas em Ajustes → Salão."
            />
          </Card>
        ) : shownTables.length === 0 ? (
          <EmptyState title="Nenhuma mesa encontrada" />
        ) : (
          <div className="table-grid">
            {shownTables.map((t) => {
              const st = tableState(t);
              return (
                <button
                  key={t.id}
                  data-search-id={`mesa-${t.id}`}
                  className="table-tile"
                  data-state={st}
                  data-busy={!!t.tabId || undefined}
                  onClick={() => goTable(t)}
                  aria-label={`Mesa ${t.label} ${STATE_LABEL[st].toLowerCase()}`}
                >
                  <span className="table-tile__label">{t.label}</span>
                  {t.tabId ? (
                    <>
                      <strong>{brl(t.tabTotal)}</strong>
                      <span className="cm-hint table-tile__meta">
                        {st === 'paying' ? (
                          <>
                            <Receipt size={12} /> conta
                          </>
                        ) : (
                          `${t.openedAt ? minutesSince(t.openedAt) : 0} min`
                        )}
                        {t.tabCustomer ? ` · ${t.tabCustomer}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="cm-hint">Livre · {t.seats} lug.</span>
                  )}
                </button>
              );
            })}
          </div>
        )
      ) : shownTabs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt size={20} />}
            title={tabs.length ? 'Nenhuma comanda encontrada' : 'Nenhuma comanda aberta'}
            description="Comandas abertas em mesas e avulsas aparecem aqui."
          />
        </Card>
      ) : (
        <div className="tab-list">
          {shownTabs.map((t) => (
            <button
              key={t.id}
              className="tab-row"
              data-search-id={`comanda-${t.id}`}
              data-paying={!!t.billRequestedAt || undefined}
              onClick={() => setTabId(t.id)}
            >
              <span className="tab-row__num">{t.number}</span>
              <span className="tab-row__who">
                <strong>{t.tableLabel ? `Mesa ${t.tableLabel}` : 'Avulsa'}</strong>
                <span className="cm-hint">
                  {t.customerName ?? `${t.orderCount} pedido(s)`} · {minutesSince(t.openedAt)} min
                </span>
              </span>
              <span className="tab-row__total">
                <strong>{brl(t.balance)}</strong>
                {t.billRequestedAt && <Badge tone="warning">pediu a conta</Badge>}
              </span>
            </button>
          ))}
        </div>
      )}
      {canSell && (
        <div className="salon__dock">
          <Button
            variant="secondary"
            block
            size="lg"
            icon={<ShoppingBag size={18} />}
            onClick={() => setTakeout(true)}
          >
            Delivery / Para levar
          </Button>
        </div>
      )}
      <TabModal
        tabId={tabId}
        tables={tables ?? []}
        onClose={() => setTabId(null)}
        onChanged={load}
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
        open={takeout}
        onClose={() => setTakeout(false)}
        preset={{ channel: 'pickup' }}
        onCreated={() => {
          setTakeout(false);
          toast('Pedido enviado', 'success');
        }}
      />
      {canSetup && (
        <TableQrModal open={qrOpen} onClose={() => setQrOpen(false)} tables={tables ?? []} />
      )}
    </div>
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
    <Modal open={open} onClose={onClose} title="Comanda avulsa">
      <div style={{ display: 'grid', gap: 16 }}>
        <TextField
          label="Nome do cliente (opcional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button loading={busy} onClick={save}>
          Abrir comanda
        </Button>
      </div>
    </Modal>
  );
}

function TabModal({
  tabId,
  tables,
  onClose,
  onChanged,
}: {
  tabId: string | null;
  tables: DiningTable[];
  onClose(): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const canPay = useCan('payments:create');
  const canOperate = useCan('tables:operate');
  const [tab, setTab] = useState<Tab | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      onClose();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function billRequest(requested: boolean) {
    if (!tab) return;
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
  return (
    <Modal open={!!tabId} onClose={onClose} title={title} size="lg">
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
              .
            </Alert>
          )}
          <div className="tab-summary">
            <div>
              <span className="cm-hint">Total</span>
              <strong>{brl(tab.total)}</strong>
            </div>
            <div>
              <span className="cm-hint">Pago</span>
              <strong>{brl(tab.paid)}</strong>
            </div>
            <div>
              <span className="cm-hint">Saldo</span>
              <strong>{brl(tab.balance)}</strong>
            </div>
          </div>
          {(tab.orders ?? []).length === 0 ? (
            <EmptyState title="Nenhum pedido nesta comanda" />
          ) : (
            <table className="cm-table cm-table--click">
              <tbody>
                {tab.orders!.map((o) => (
                  <tr key={o.id} onClick={() => setOrderId(o.id)}>
                    <td>
                      <strong>#{o.number}</strong>
                      <div className="cm-hint">
                        {o.items.map((i) => `${Number(i.quantity)}× ${i.name}`).join(', ')}
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
              <Button variant="secondary" onClick={() => setTransfer(false)}>
                Voltar
              </Button>
            </div>
          )}
          {tab.status === 'open' && !transfer && (
            <div className="actions-row">
              {canOperate && (
                <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>
                  Adicionar pedido
                </Button>
              )}
              {canPay && toCents(tab.balance) > 0 && (
                <Button
                  variant="secondary"
                  icon={<Receipt size={16} />}
                  onClick={() => setPaying(true)}
                >
                  Receber / dividir
                </Button>
              )}
              {canOperate && (
                <Button
                  variant={tab.billRequestedAt ? 'ghost' : 'secondary'}
                  icon={<BellRing size={16} />}
                  onClick={() => billRequest(!tab.billRequestedAt)}
                >
                  {tab.billRequestedAt ? 'Desfazer pedido de conta' : 'Pediu a conta'}
                </Button>
              )}
              {canOperate && tab.tableId && (
                <Button
                  variant="ghost"
                  icon={<ArrowRightLeft size={16} />}
                  onClick={() => setTransfer(true)}
                >
                  Transferir mesa
                </Button>
              )}
              {canPay && (
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={toCents(tab.balance) > 0}
                  onClick={close}
                  title={toCents(tab.balance) > 0 ? 'Receba o saldo antes de fechar' : undefined}
                >
                  Fechar conta
                </Button>
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
            target={{ kind: 'tab', id: tab.id, number: tab.number, balance: tab.balance }}
          />
          <OrderDetailModal
            orderId={orderId}
            onClose={() => {
              setOrderId(null);
              void load();
            }}
          />
        </div>
      )}
    </Modal>
  );
}
