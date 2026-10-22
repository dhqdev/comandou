import { PAYMENT_METHODS, toCents, type PaymentMethod } from '@pedemais/shared';
import { Plus, Receipt } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { api } from '../lib/api';
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

function EntriesTab() {
  const canWrite = useCan('finance:write');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<FinanceEntry[] | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<FinanceEntry | null>(null);
  const [cancelling, setCancelling] = useState<FinanceEntry | null>(null);

  // Só a resposta da consulta mais recente vale (troca de filtro durante um carregamento).
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const qs = new URLSearchParams();
      if (kind) qs.set('kind', kind);
      if (status) qs.set('status', status);
      const [r, s] = await Promise.all([
        api<FinanceEntry[]>(`/finance/entries?${qs}`),
        api<FinanceSummary>('/finance/summary'),
      ]);
      if (mine !== seq.current) return;
      setRows(r);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind, status]);
  useEffect(() => {
    void load();
  }, [load]);

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
        <div className="pm-card__body filters">
          <SelectField label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos</option>
            <option value="payable">A pagar</option>
            <option value="receivable">A receber</option>
          </SelectField>
          <SelectField label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Em aberto</option>
            <option value="overdue">Vencidos</option>
            <option value="paid">Pagos/recebidos</option>
            <option value="cancelled">Cancelados</option>
            <option value="">Todos</option>
          </SelectField>
        </div>
        {rows === null ? (
          <div className="pm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt size={20} />} title="Nenhum lançamento" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th className="pm-num">Valor</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.dueDate)}</td>
                    <td>
                      <Badge tone={e.kind === 'payable' ? 'warning' : 'info'}>
                        {e.kind === 'payable' ? 'Pagar' : 'Receber'}
                      </Badge>{' '}
                      <strong>{e.description}</strong>
                      <div className="pm-hint">
                        {[e.counterparty, e.category].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="pm-num">{brl(e.amount)}</td>
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
                    <td className="pm-num">
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
          </div>
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
        style={danger ? { color: 'var(--pm-danger-700, #b42318)' } : undefined}
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
      <p className="pm-hint">
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
      <div className="pm-card__body filters">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && (
        <div className="pm-card__body">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table className="pm-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th className="pm-num">Vendas recebidas</th>
                <th className="pm-num">Contas recebidas</th>
                <th className="pm-num">Estornos</th>
                <th className="pm-num">Contas pagas</th>
                <th className="pm-num">Saldo do dia</th>
                <th className="pm-num">Previsto (+/−)</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day}>
                  <td>{fmtDate(d.day)}</td>
                  <td className="pm-num">{brl(d.sales)}</td>
                  <td className="pm-num">{brl(d.received)}</td>
                  <td className="pm-num">{brl(d.refunds)}</td>
                  <td className="pm-num">{brl(d.paid)}</td>
                  <td className="pm-num">
                    <strong>{brl(d.net)}</strong>
                  </td>
                  <td className="pm-num pm-hint">
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
                <td className="pm-num">{brl(data.totals.sales)}</td>
                <td className="pm-num">{brl(data.totals.received)}</td>
                <td className="pm-num">{brl(data.totals.refunds)}</td>
                <td className="pm-num">{brl(data.totals.paid)}</td>
                <td className="pm-num">
                  <strong>{brl(data.totals.net)}</strong>
                </td>
                <td className="pm-num pm-hint">
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
      <div className="pm-card__body">
        <div className="filters">
          <TextField label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <p className="pm-hint">
          Compare o que o sistema registrou com o extrato da maquininha, do banco (PIX) e a gaveta.
          Diferenças exigem explicação e o registro não pode ser alterado depois.
        </p>
      </div>
      {!data ? (
        <div className="pm-card__body">
          <Spinner />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="pm-table">
            <thead>
              <tr>
                <th>Forma</th>
                <th className="pm-num">Sistema</th>
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
                    <td className="pm-num">{brl(m.systemAmount)}</td>
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
                            <div className="pm-hint">{m.reconciliation.note}</div>
                          )}
                        </>
                      ) : canWrite ? (
                        <div className="actions-row" style={{ alignItems: 'end' }}>
                          <input
                            className="pm-input"
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
                              className="pm-input"
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
                        <span className="pm-hint">pendente</span>
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
