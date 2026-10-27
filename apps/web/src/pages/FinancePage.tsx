import { fromCents, PAYMENT_METHODS, toCents, type PaymentMethod } from '@comandou/shared';
import { Plus, Receipt } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { PAYMENT_METHOD_LABELS } from '../features/format';
import { fmtDate, SelectField, Tabs, todayIso } from '../features/forms';
import {
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../features/list-view';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl, parseBrlInput } from '../lib/money';
import type { CashFlowDay, FinanceEntry, FinanceSummary, Reconciliation } from '../lib/types';

const SETTLE_METHODS: [string, string][] = [
  ...PAYMENT_METHODS.map((m) => [m, PAYMENT_METHOD_LABELS[m]] as [string, string]),
  ['transfer', 'Transferência'],
  ['boleto', 'Boleto'],
];
const methodLabel = (m: string) => SETTLE_METHODS.find(([k]) => k === m)?.[1] ?? m;

/** Financeiro: contas a pagar e a receber, fluxo de caixa e conciliação diária. */
export function FinancePage() {
  const [tab, setTab] = useState<'entries' | 'flow' | 'reconcile'>('entries');
  useLinkParam('aba', (v) => {
    if (v === 'entries' || v === 'flow' || v === 'reconcile') setTab(v);
  });
  return (
    <>
      <div>
        <h1 className="page-title">Financeiro</h1>
        <p className="page-sub">
          Contas a pagar e a receber, fluxo de caixa e conferência do que entrou por forma de
          pagamento.
        </p>
      </div>
      <Tabs<typeof tab>
        value={tab}
        onChange={setTab}
        items={[
          ['entries', 'Contas'],
          ['flow', 'Fluxo de caixa'],
          ['reconcile', 'Conciliação'],
        ]}
      />
      {tab === 'entries' ? <EntriesTab /> : tab === 'flow' ? <FlowTab /> : <ReconcileTab />}
    </>
  );
}

const entryStatus = (e: FinanceEntry) => (e.status === 'open' && e.overdue ? 'overdue' : e.status);

const ENTRY_FIELDS: ListField<FinanceEntry>[] = [
  {
    key: 'kind',
    label: 'Tipo',
    value: (e) => e.kind,
    options: [
      { value: 'payable', label: 'A pagar' },
      { value: 'receivable', label: 'A receber' },
    ],
    pinned: true,
  },
  {
    key: 'status',
    label: 'Situação',
    value: entryStatus,
    options: [
      { value: 'open', label: 'Em aberto' },
      { value: 'overdue', label: 'Vencido' },
      { value: 'paid', label: 'Pago/recebido' },
      { value: 'cancelled', label: 'Cancelado' },
    ],
    pinned: true,
  },
  { key: 'due', label: 'Vencimento', kind: 'date', date: (e) => e.dueDate, pinned: true },
  { key: 'category', label: 'Categoria', value: (e) => e.category ?? 'Sem categoria' },
  {
    key: 'counterparty',
    label: 'Fornecedor / cliente',
    value: (e) => e.counterparty ?? 'Não informado',
  },
  { key: 'paidAt', label: 'Data do pagamento', kind: 'date', date: (e) => e.paidAt },
  {
    key: 'method',
    label: 'Forma de pagamento',
    value: (e) => e.paidMethod,
    options: SETTLE_METHODS.map(([value, label]) => ({ value, label })),
  },
];

const ENTRY_TABS: ListTab[] = [
  { id: 'abertos', label: 'Em aberto', filters: { status: ['open', 'overdue'] } },
  { id: 'vencidos', label: 'Vencidos', filters: { status: ['overdue'] } },
  { id: 'pagar', label: 'A pagar', filters: { kind: ['payable'], status: ['open', 'overdue'] } },
  {
    id: 'receber',
    label: 'A receber',
    filters: { kind: ['receivable'], status: ['open', 'overdue'] },
  },
  { id: 'pagos', label: 'Pagos', filters: { status: ['paid'] } },
  { id: 'todos', label: 'Todos', filters: {} },
];

const ENTRY_SORTS: ListSort<FinanceEntry>[] = [
  { key: 'due', label: 'Vencimento', get: (e) => e.dueDate, asc: true },
  { key: 'amount', label: 'Valor', get: (e) => Number(e.amount) },
  { key: 'description', label: 'Descrição', get: (e) => fold(e.description), asc: true },
];

function EntriesTab() {
  const canWrite = useCan('finance:write');
  const [all, setAll] = useState<FinanceEntry[] | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<FinanceEntry | null>(null);
  const [cancelling, setCancelling] = useState<FinanceEntry | null>(null);
  const lv = useListView({
    id: 'financeiro-contas',
    rows: all,
    fields: ENTRY_FIELDS,
    tabs: ENTRY_TABS,
    search: (e) => `${e.description} ${e.counterparty ?? ''} ${e.category ?? ''}`,
    sorts: ENTRY_SORTS,
  });
  // Conta aberta pela busca: mostra todas para ela aparecer (e ser destacada) mesmo se paga.
  useLinkParam('conta', () => lv.selectTab(ENTRY_TABS[ENTRY_TABS.length - 1]!));
  useLinkParam('acao', (a) => a === 'conta' && canWrite && setCreating(true));

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api<FinanceEntry[]>('/finance/entries'),
        api<FinanceSummary>('/finance/summary'),
      ]);
      setAll(r);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const rows = lv.visible;
  const total = rows?.reduce((s, e) => s + toCents(e.amount), 0) ?? 0;

  const done = () => {
    setCreating(false);
    setSettling(null);
    setCancelling(null);
    void load();
  };

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {summary && (
        <div className="stat-grid">
          <Stat label="A pagar (em aberto)" value={brl(summary.payableOpen)} />
          <Stat
            label="A pagar vencido"
            value={brl(summary.payableOverdue)}
            danger={toCents(summary.payableOverdue) > 0}
          />
          <Stat label="A pagar em 7 dias" value={brl(summary.payableNext7)} />
          <Stat label="A receber (em aberto)" value={brl(summary.receivableOpen)} />
          <Stat
            label="A receber vencido"
            value={brl(summary.receivableOverdue)}
            danger={toCents(summary.receivableOverdue) > 0}
          />
        </div>
      )}
      <Card
        title="Contas"
        actions={
          canWrite && (
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Novo lançamento
            </Button>
          )
        }
        bodyless
      >
        <ListToolbar
          lv={lv}
          searchLabel="Buscar lançamento"
          placeholder="Buscar: descrição, fornecedor/cliente ou categoria"
          summary={
            rows &&
            `${rows.length} ${rows.length === 1 ? 'lançamento' : 'lançamentos'} · ${brl(fromCents(total))}`
          }
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt size={20} />} title="Nenhum lançamento" />
        ) : (
          <ListTable>
            <table className="cm-table lv-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th className="cm-num">Valor</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-search-id={`conta-${e.id}`}>
                    <td>{fmtDate(e.dueDate)}</td>
                    <td>
                      <Badge tone={e.kind === 'payable' ? 'warning' : 'info'}>
                        {e.kind === 'payable' ? 'Pagar' : 'Receber'}
                      </Badge>{' '}
                      <strong>{e.description}</strong>
                      <div className="cm-hint">
                        {[e.counterparty, e.category].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="cm-num">{brl(e.amount)}</td>
                    <td>
                      {e.status === 'paid' ? (
                        <Badge tone="success">
                          {e.kind === 'payable' ? 'Pago' : 'Recebido'} {fmtDate(e.paidAt!)} ·{' '}
                          {methodLabel(e.paidMethod!)}
                        </Badge>
                      ) : e.status === 'cancelled' ? (
                        <Badge>Cancelado: {e.cancelReason}</Badge>
                      ) : e.overdue ? (
                        <Badge tone="danger">Vencido</Badge>
                      ) : (
                        <Badge tone="neutral">Em aberto</Badge>
                      )}
                    </td>
                    <td className="cm-num">
                      {canWrite && e.status === 'open' && (
                        <div className="actions-row" style={{ justifyContent: 'end' }}>
                          <Button variant="secondary" onClick={() => setSettling(e)}>
                            {e.kind === 'payable' ? 'Pagar' : 'Receber'}
                          </Button>
                          <Button variant="ghost" onClick={() => setCancelling(e)}>
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
      {creating && <NewEntryModal onClose={() => setCreating(false)} onDone={done} />}
      {settling && <SettleModal entry={settling} onClose={() => setSettling(null)} onDone={done} />}
      {cancelling && (
        <CancelModal entry={cancelling} onClose={() => setCancelling(null)} onDone={done} />
      )}
    </>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div
        className="stat__value"
        style={danger ? { color: 'var(--cm-danger-700, #b42318)' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function NewEntryModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [kind, setKind] = useState<'payable' | 'receivable'>('payable');
  const [description, setDescription] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [category, setCategory] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseBrlInput(amountText);
  const valid = description.trim() && amount && toCents(amount) > 0 && dueDate;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/finance/entries', {
        method: 'POST',
        json: {
          kind,
          description,
          amount,
          dueDate,
          counterparty: counterparty || undefined,
          category: category || undefined,
        },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Novo lançamento"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <SelectField
        label="Tipo"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        <option value="payable">Conta a pagar</option>
        <option value="receivable">Conta a receber</option>
      </SelectField>
      <TextField
        label="Descrição"
        value={description}
        maxLength={200}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextField
        label={kind === 'payable' ? 'Fornecedor' : 'Cliente'}
        value={counterparty}
        maxLength={120}
        onChange={(e) => setCounterparty(e.target.value)}
      />
      <TextField
        label="Categoria"
        placeholder="Ex.: Energia, Aluguel"
        value={category}
        maxLength={60}
        onChange={(e) => setCategory(e.target.value)}
      />
      <TextField
        label="Valor (R$)"
        inputMode="decimal"
        value={amountText}
        onChange={(e) => setAmountText(e.target.value)}
        error={amountText && !amount ? 'Valor inválido' : undefined}
      />
      <TextField
        label="Vencimento"
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />
    </Modal>
  );
}

function SettleModal({
  entry,
  onClose,
  onDone,
}: {
  entry: FinanceEntry;
  onClose(): void;
  onDone(): void;
}) {
  // Uma chave por intenção: reenvios (rede instável, clique duplo) não baixam duas vezes.
  const idemKey = useMemo(() => newIdempotencyKey(), []);
  const [method, setMethod] = useState('pix');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/finance/entries/${entry.id}/settle`, {
        method: 'POST',
        json: { method, paidAt },
        headers: { 'Idempotency-Key': idemKey },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`${entry.kind === 'payable' ? 'Pagar' : 'Receber'} · ${entry.description}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={busy} onClick={save}>
            Confirmar {brl(entry.amount)}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <SelectField label="Forma" value={method} onChange={(e) => setMethod(e.target.value)}>
        {SETTLE_METHODS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Data"
        type="date"
        value={paidAt}
        onChange={(e) => setPaidAt(e.target.value)}
      />
      <p className="cm-hint">
        Depois de confirmado, o lançamento não pode ser apagado nem cancelado.
      </p>
    </Modal>
  );
}

function CancelModal({
  entry,
  onClose,
  onDone,
}: {
  entry: FinanceEntry;
  onClose(): void;
  onDone(): void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await api(`/finance/entries/${entry.id}/cancel`, { method: 'POST', json: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`Cancelar · ${entry.description}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={save}
          >
            Cancelar lançamento
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Motivo"
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

function FlowTab() {
  const [from, setFrom] = useState(todayIso(-6));
  const [to, setTo] = useState(todayIso(7));
  const [data, setData] = useState<{
    days: CashFlowDay[];
    totals: Omit<CashFlowDay, 'day'>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!from || !to) return;
    api<typeof data>(`/finance/cash-flow?from=${from}&to=${to}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  return (
    <Card title="Fluxo de caixa" bodyless>
      <div className="cm-card__body filters">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && (
        <div className="cm-card__body">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th className="cm-num">Vendas recebidas</th>
                <th className="cm-num">Contas recebidas</th>
                <th className="cm-num">Estornos</th>
                <th className="cm-num">Contas pagas</th>
                <th className="cm-num">Saldo do dia</th>
                <th className="cm-num">Previsto (+/−)</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day}>
                  <td>{fmtDate(d.day)}</td>
                  <td className="cm-num">{brl(d.sales)}</td>
                  <td className="cm-num">{brl(d.received)}</td>
                  <td className="cm-num">{brl(d.refunds)}</td>
                  <td className="cm-num">{brl(d.paid)}</td>
                  <td className="cm-num">
                    <strong>{brl(d.net)}</strong>
                  </td>
                  <td className="cm-num cm-hint">
                    {toCents(d.expectedIn) || toCents(d.expectedOut)
                      ? `+${brl(d.expectedIn)} / −${brl(d.expectedOut)}`
                      : '—'}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="cm-num">{brl(data.totals.sales)}</td>
                <td className="cm-num">{brl(data.totals.received)}</td>
                <td className="cm-num">{brl(data.totals.refunds)}</td>
                <td className="cm-num">{brl(data.totals.paid)}</td>
                <td className="cm-num">
                  <strong>{brl(data.totals.net)}</strong>
                </td>
                <td className="cm-num cm-hint">
                  +{brl(data.totals.expectedIn)} / −{brl(data.totals.expectedOut)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ReconcileTab() {
  const canWrite = useCan('finance:write');
  const toast = useToast();
  const [day, setDay] = useState(todayIso(-1));
  const [data, setData] = useState<Reconciliation | null>(null);
  const [inputs, setInputs] = useState<Record<string, { amount: string; note: string }>>({});
  const load = useCallback(() => {
    if (!day) return;
    api<Reconciliation>(`/finance/reconciliation?day=${day}`)
      .then(setData)
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [day, toast]);
  useEffect(load, [load]);

  async function save(method: PaymentMethod, systemAmount: string) {
    const v = inputs[method] ?? { amount: '', note: '' };
    const informed = parseBrlInput(v.amount);
    if (!informed) return toast('Informe o valor conferido', 'danger');
    try {
      await api('/finance/reconciliation', {
        method: 'POST',
        json: { day, method, informedAmount: informed, note: v.note.trim() || undefined },
      });
      toast(
        toCents(informed) === toCents(systemAmount)
          ? 'Conferido sem diferença'
          : 'Conferido com diferença registrada',
        'success',
      );
      load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <Card title="Conciliação diária" bodyless>
      <div className="cm-card__body">
        <div className="filters">
          <TextField label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <p className="cm-hint">
          Compare o que o sistema registrou com o extrato da maquininha, do banco (PIX) e a gaveta.
          Diferenças exigem explicação e o registro não pode ser alterado depois.
        </p>
      </div>
      {!data ? (
        <div className="cm-card__body">
          <Spinner />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Forma</th>
                <th className="cm-num">Sistema</th>
                <th>Conferido</th>
              </tr>
            </thead>
            <tbody>
              {data.methods.map((m) => {
                const v = inputs[m.method] ?? { amount: '', note: '' };
                const informed = parseBrlInput(v.amount);
                const diff = informed ? toCents(informed) - toCents(m.systemAmount) : 0;
                return (
                  <tr key={m.method}>
                    <td>{PAYMENT_METHOD_LABELS[m.method]}</td>
                    <td className="cm-num">{brl(m.systemAmount)}</td>
                    <td>
                      {m.reconciliation ? (
                        <>
                          <Badge
                            tone={
                              toCents(m.reconciliation.difference) === 0 ? 'success' : 'warning'
                            }
                          >
                            {brl(m.reconciliation.informedAmount)}
                            {toCents(m.reconciliation.difference) !== 0 &&
                              ` (diferença ${brl(m.reconciliation.difference)})`}
                          </Badge>
                          {m.reconciliation.note && (
                            <div className="cm-hint">{m.reconciliation.note}</div>
                          )}
                        </>
                      ) : canWrite ? (
                        <div className="actions-row" style={{ alignItems: 'end' }}>
                          <input
                            className="cm-input"
                            style={{ maxWidth: 140 }}
                            aria-label={`Valor conferido em ${PAYMENT_METHOD_LABELS[m.method]}`}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={v.amount}
                            onChange={(e) =>
                              setInputs((s) => ({
                                ...s,
                                [m.method]: { ...v, amount: e.target.value },
                              }))
                            }
                          />
                          {informed && diff !== 0 && (
                            <input
                              className="cm-input"
                              style={{ maxWidth: 240 }}
                              aria-label={`Motivo da diferença em ${PAYMENT_METHOD_LABELS[m.method]}`}
                              placeholder="Explique a diferença"
                              value={v.note}
                              onChange={(e) =>
                                setInputs((s) => ({
                                  ...s,
                                  [m.method]: { ...v, note: e.target.value },
                                }))
                              }
                            />
                          )}
                          <Button
                            variant="secondary"
                            disabled={!informed || (diff !== 0 && v.note.trim().length < 3)}
                            onClick={() => save(m.method, m.systemAmount)}
                          >
                            Conferir
                          </Button>
                        </div>
                      ) : (
                        <span className="cm-hint">pendente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
