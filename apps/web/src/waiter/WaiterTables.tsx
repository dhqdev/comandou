import { Bike, Plus, Receipt, ScanLine, Search, ShoppingBag } from 'lucide-react';
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
  const [readyIds, setReadyIds] = useState<string[] | null>(null);
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
        api<Order[]>('/orders?status=ready&channel=table').catch(() => null),
      ]);
      setTables(sortTables(t));
      setTabs(tb);
      setReadyIds(rd ? rd.map((o) => o.id) : null);
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
  useArrivalSound('ready', readyIds);

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
