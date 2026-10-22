import { toCents } from '@comandou/shared';
import { ArrowRightLeft, LayoutGrid, Plus, Receipt } from 'lucide-react';
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
import {
  minutesSince,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  STATUS_TONE,
} from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { DiningTable, Tab } from '../lib/types';

export function TablesPage() {
  const toast = useToast();
  const canOperate = useCan('tables:operate');
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, tb] = await Promise.all([
        api<DiningTable[]>('/tables'),
        api<Tab[]>('/tabs?status=open'),
      ]);
      setTables(t.filter((x) => x.active));
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

  const loose = tabs.filter((t) => !t.tableId);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Salão</h1>
          <p className="page-sub">Mesas livres e ocupadas, comandas e fechamento de conta.</p>
        </div>
        {canOperate && (
          <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setNewTab(true)}>
            Comanda avulsa
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {tables === null ? (
        <Spinner />
      ) : tables.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutGrid size={20} />}
            title="Nenhuma mesa cadastrada"
            description="Cadastre mesas em Ajustes."
          />
        </Card>
      ) : (
        <div className="table-grid">
          {tables.map((t) => (
            <button
              key={t.id}
              className="table-tile"
              data-busy={!!t.tabId || undefined}
              onClick={() => (t.tabId ? setTabId(t.tabId) : canOperate && openTab(t.id))}
              aria-label={`Mesa ${t.label} ${t.tabId ? 'ocupada' : 'livre'}`}
            >
              <span className="table-tile__label">{t.label}</span>
              {t.tabId ? (
                <>
                  <strong>{brl(t.tabTotal)}</strong>
                  <span className="cm-hint">
                    {t.openedAt ? `${minutesSince(t.openedAt)} min` : ''}
                  </span>
                </>
              ) : (
                <span className="cm-hint">Livre · {t.seats} lugares</span>
              )}
            </button>
          ))}
        </div>
      )}
      {loose.length > 0 && (
        <Card title="Comandas avulsas" bodyless>
          <ul className="plain-list" style={{ padding: 16 }}>
            {loose.map((t) => (
              <li key={t.id}>
                <button className="link-btn" onClick={() => setTabId(t.id)}>
                  Comanda {t.number} {t.customerName && `· ${t.customerName}`}
                </button>
                <strong>{brl(t.total)}</strong>
              </li>
            ))}
          </ul>
        </Card>
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
    </>
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
