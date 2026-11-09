import { qtyLabel } from '@comandou/shared';
import {
  Bike,
  Check,
  HandPlatter,
  Plus,
  Receipt,
  ScanLine,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, EmptyState, Modal, Spinner, TextField, useToast } from '../design-system';
import { useAuth } from '../app/auth';
import { QrScanner } from '../features/QrScanner';
import { SlideTabs } from '../features/SlideTabs';
import { minutesSince } from '../features/format';
import { sortTables, STATE_LABEL, tableFromQr, tableState } from '../features/table-state';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { DiningTable, Order, Tab } from '../lib/types';
import { WaiterHead } from './common';

type View = 'tables' | 'tabs';

/**
 * Mapa de mesas e comandas (tela inicial do garçom). Mesa livre abre direto o cardápio para o
 * primeiro pedido; ocupada abre a comanda. "Delivery / Para levar" abre o pedido rápido.
 */
export function WaiterTables() {
  const toast = useToast();
  const navigate = useNavigate();
  // Dono/gerente que abriu o app para conferir volta ao Salão do painel.
  const isWaiter = useAuth().me?.user.role === 'waiter';
  const [params, setParams] = useSearchParams();
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  // Pedidos de mesa prontos que ainda não chegaram na mesa (de qualquer garçom ou do QR Code).
  const [toServe, setToServe] = useState<Order[] | null>(null);
  const [serving, setServing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('tables');
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState(false);
  const [scan, setScan] = useState(false);
  const [loose, setLoose] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, tb, rd] = await Promise.all([
        api<DiningTable[]>('/tables'),
        api<Tab[]>('/tabs?status=open'),
        api<Order[]>('/orders?toServe=true&limit=60').catch(() => null),
      ]);
      setTables(sortTables(t));
      setTabs(tb);
      if (rd) setToServe(rd.slice().reverse());
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
  // Aviso sonoro quando a cozinha termina um pedido de mesa (para o garçom levar).
  useArrivalSound('ready', toServe ? toServe.map((o) => o.id) : null);

  // "Entreguei": sai da lista na hora; pago (Pix do cardápio), o pedido conclui e a mesa se libera.
  async function serve(o: Order) {
    setServing((s) => [...s, o.id]);
    try {
      const r = await api<Order>(`/orders/${o.id}/served`, { method: 'POST' });
      setToServe((l) => l?.filter((x) => x.id !== o.id) ?? l);
      navigator.vibrate?.(12);
      if (r.status === 'completed' && r.paymentStatus === 'paid')
        toast(`${placeOf(o)} entregue e já pago`, 'success');
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setServing((s) => s.filter((x) => x !== o.id));
    }
  }

  const goTable = useCallback(
    (t: DiningTable) => {
      if (t.tabId) navigate(`/garcom/comanda/${t.tabId}`);
      else navigate(`/garcom/pedido?mesa=${t.id}`);
    },
    [navigate],
  );

  // QR da mesa lido pela câmera do celular (fora do app) chega como ?mesa=<id>.
  const fromLink = params.get('mesa');
  useEffect(() => {
    if (!fromLink || tables === null) return;
    setParams({}, { replace: true });
    const t = tables.find((x) => x.id === fromLink);
    if (t) goTable(t);
    else toast('Mesa não encontrada', 'danger');
  }, [fromLink, tables, goTable, setParams, toast]);

  const q = search.trim().toLowerCase();
  const shownTables = (tables ?? []).filter(
    (t) =>
      !q ||
      t.label.toLowerCase().includes(q) ||
      `mesa ${t.label}`.toLowerCase().includes(q) ||
      (t.tabCustomer ?? '').toLowerCase().includes(q),
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
  const areas = useMemo(() => {
    const m = new Map<string, DiningTable[]>();
    for (const t of shownTables) {
      const k = t.area?.trim() || '';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [shownTables]);

  return (
    <div className="wt-page wt-page--dock">
      <WaiterHead title="Mesas e comandas" back={isWaiter ? undefined : '/mesas'}>
        <button
          type="button"
          className="wt-icon-btn"
          aria-label="Escanear QR da mesa"
          onClick={() => setScan(true)}
        >
          <ScanLine size={20} />
        </button>
      </WaiterHead>

      <div className="wt-toolbar">
        <SlideTabs<View>
          label="Mesas ou comandas"
          value={view}
          onChange={setView}
          className="wt-switch"
          tabs={[
            { value: 'tables', label: 'Mesas', count: tables?.length ?? 0 },
            { value: 'tabs', label: 'Comandas', count: tabs.length },
          ]}
        />
        <label className="wt-search">
          <Search size={18} aria-hidden />
          <input
            placeholder={view === 'tables' ? 'Buscar por nome da mesa' : 'Nº da comanda ou cliente'}
            aria-label="Buscar mesa ou comanda"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {view === 'tables' && (
          <div className="wt-legend" aria-label="Legenda">
            <span data-state="free">Livres {counts.free}</span>
            <span data-state="busy">Ocupadas {counts.busy}</span>
            <span data-state="paying">Em pagamento {counts.paying}</span>
          </div>
        )}
      </div>

      {!!toServe?.length && (
        <section className="wt-serve" aria-label="Prontos para levar">
          <h2 className="wt-serve__title">
            <HandPlatter size={16} aria-hidden /> Prontos para levar <span>{toServe.length}</span>
          </h2>
          <ul className="wt-serve__list">
            {toServe.map((o) => (
              <li
                key={o.id}
                className="wt-serve__row"
                data-busy={serving.includes(o.id) || undefined}
              >
                <button
                  type="button"
                  className="wt-serve__info"
                  onClick={() => o.tabId && navigate(`/garcom/comanda/${o.tabId}`)}
                >
                  <strong>{placeOf(o)}</strong>
                  <span>
                    #{o.number} · {itemsOf(o)}
                  </span>
                  <small>
                    pronto há {readyMinutes(o)} min
                    {o.source === 'online' ? ' · pelo QR Code' : ''}
                    {o.paymentStatus === 'paid' ? ' · pago' : ''}
                  </small>
                </button>
                <button
                  type="button"
                  className="wt-serve__done"
                  disabled={serving.includes(o.id)}
                  onClick={() => void serve(o)}
                >
                  <Check size={18} aria-hidden /> Entreguei
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {tables === null ? (
        <Spinner />
      ) : view === 'tables' ? (
        tables.length === 0 ? (
          <EmptyState
            mascot="sleep"
            title="Nenhuma mesa cadastrada"
            description="Peça ao gerente para cadastrar as mesas do salão. Enquanto isso, use comandas ou o pedido rápido."
          />
        ) : shownTables.length === 0 ? (
          <EmptyState title="Nenhuma mesa encontrada" />
        ) : (
          areas.map(([area, list]) => (
            <section key={area || '-'} className="wt-area">
              {(areas.length > 1 || area) && (
                <h2 className="wt-area__title">
                  {area || 'Salão principal'} <span>{list.length}</span>
                </h2>
              )}
              <div className="wt-grid">
                {list.map((t) => {
                  const st = tableState(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="wt-table"
                      data-state={st}
                      onClick={() => goTable(t)}
                      aria-label={`Mesa ${t.label} ${STATE_LABEL[st].toLowerCase()}`}
                    >
                      <span className="wt-table__name">Mesa {t.label}</span>
                      {t.tabId ? (
                        <>
                          <strong className="wt-table__total">{brl(t.tabTotal)}</strong>
                          <span className="wt-table__meta">
                            {st === 'paying' ? (
                              <>
                                <Receipt size={12} aria-hidden /> pediu a conta
                              </>
                            ) : (
                              `${t.openedAt ? minutesSince(t.openedAt) : 0} min`
                            )}
                            {t.tabCustomer ? ` · ${t.tabCustomer}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="wt-table__meta">Livre · {t.seats} lugares</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )
      ) : (
        <>
          <button type="button" className="wt-new-tab" onClick={() => setLoose(true)}>
            <Plus size={18} /> Abrir comanda avulsa
          </button>
          {shownTabs.length === 0 ? (
            <EmptyState
              title={tabs.length ? 'Nenhuma comanda encontrada' : 'Nenhuma comanda aberta'}
              description="Comandas abertas em mesas e avulsas aparecem aqui."
            />
          ) : (
            <div className="wt-list">
              {shownTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="wt-row"
                  data-paying={!!t.billRequestedAt || undefined}
                  onClick={() => navigate(`/garcom/comanda/${t.id}`)}
                >
                  <span className="wt-row__badge">{t.number}</span>
                  <span className="wt-row__text">
                    <strong>{t.tableLabel ? `Mesa ${t.tableLabel}` : 'Comanda avulsa'}</strong>
                    <span>
                      {t.customerName ?? `${t.orderCount} pedido(s)`} · {minutesSince(t.openedAt)}{' '}
                      min
                      {t.billRequestedAt ? ' · pediu a conta' : ''}
                    </span>
                  </span>
                  <strong className="wt-row__end">{brl(t.balance)}</strong>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="wt-dock">
        <Button
          variant="secondary"
          size="lg"
          block
          icon={<ShoppingBag size={18} />}
          onClick={() => setQuick(true)}
        >
          Delivery / Para levar
        </Button>
      </div>

      <Modal open={quick} onClose={() => setQuick(false)} title="Pedido rápido">
        <div className="wt-quick">
          <button
            type="button"
            className="wt-quick__opt"
            onClick={() => navigate('/garcom/pedido?tipo=delivery')}
          >
            <Bike size={22} />
            <span>
              <strong>Delivery</strong>
              <span>Entrega no endereço do cliente</span>
            </span>
          </button>
          <button
            type="button"
            className="wt-quick__opt"
            onClick={() => navigate('/garcom/pedido?tipo=retirada')}
          >
            <ShoppingBag size={22} />
            <span>
              <strong>Para levar</strong>
              <span>Cliente retira no balcão</span>
            </span>
          </button>
        </div>
      </Modal>

      <LooseTabModal
        open={loose}
        onClose={() => setLoose(false)}
        onOpened={(id) => navigate(`/garcom/pedido?comanda=${id}`)}
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
    </div>
  );
}

/** "Mesa 4" ou, na comanda avulsa, "Comanda 12". */
const placeOf = (o: Order) =>
  o.tableLabel ? `Mesa ${o.tableLabel}` : o.tabNumber ? `Comanda ${o.tabNumber}` : `#${o.number}`;

/** "2× X-Burger, 1× Coca" (sem os cancelados). */
const itemsOf = (o: Order) =>
  o.items
    .filter((i) => i.status !== 'cancelled')
    .map((i) => `${qtyLabel(i.quantity, i.unit)} ${i.name}`)
    .join(', ');

/** Há quanto tempo a cozinha deu pronto (o item mais recente). */
function readyMinutes(o: Order) {
  const at = o.items.reduce<string | null>(
    (m, i) => (i.readyAt && (!m || i.readyAt > m) ? i.readyAt : m),
    null,
  );
  return minutesSince(at ?? o.createdAt);
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
    setError(null);
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
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save}>
            Abrir e lançar pedido
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <TextField
          label="Nome do cliente (opcional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
