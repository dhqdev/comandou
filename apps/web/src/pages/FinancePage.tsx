import {
  dreGroupOf,
  DRE_GROUP_LABELS,
  FINANCE_CATEGORIES,
  financeMonth,
  financeMonthName,
  financeMonthRange,
  fromCents,
  PAYMENT_METHODS,
  toCents,
  type FinanceMonth,
  type PaymentMethod,
} from '@comandou/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Percent, Plus, Receipt } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  TextField,
  useToast,
  Skeleton,
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
import { useLiveData } from '../lib/realtime';
import type {
  CashFlowDay,
  FinanceEntry,
  FinanceSettings,
  FinanceSummary,
  Reconciliation,
} from '../lib/types';
import { BankTab } from './finance/BankTab';
import { ClosingsTab, SignedBrl } from './finance/ClosingsTab';
import {
  avgDailySales,
  cumulative,
  Delta,
  FlowChart,
  flowPoints,
  KpiStrip,
  Legend,
  Progress,
} from './finance/charts';
import { AppsTab } from './finance/AppsTab';
import { DreTab } from './finance/DreTab';
import { change, money } from './finance/insights';
import { OverviewTab } from './finance/OverviewTab';
import { TermsModal } from './finance/TermsModal';
import './finance/finance.css';

const SETTLE_METHODS: [string, string][] = [
  ...PAYMENT_METHODS.map((m) => [m, PAYMENT_METHOD_LABELS[m]] as [string, string]),
  ['transfer', 'Transferência'],
  ['boleto', 'Boleto'],
];
const methodLabel = (m: string) => SETTLE_METHODS.find(([k]) => k === m)?.[1] ?? m;

const TABS = ['overview', 'entries', 'closings', 'apps', 'reconcile', 'flow', 'dre'] as const;
type FinanceTab = (typeof TABS)[number];

/**
 * Financeiro: visão geral com gráficos e leituras do mês, contas a pagar e a receber, fechamentos de caixa (o dia vai sozinho para o
 * financeiro ao fechar o caixa), conciliação bancária com o extrato, fluxo de caixa e DRE.
 * O mês financeiro começa no dia que o gerente escolhe (ex.: dia 5, quando o dinheiro entra):
 * os totais do mês, a aba "Do mês" das contas, os fechamentos, o fluxo e o DRE seguem esse período.
 */
export function FinancePage() {
  const [tab, setTab] = useState<FinanceTab>('overview');
  useLinkParam('aba', (v) => {
    if ((TABS as readonly string[]).includes(v)) setTab(v as FinanceTab);
  });
  const toast = useToast();
  const canWrite = useCan('finance:write');
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [terms, setTerms] = useState(false);
  const [checkDay, setCheckDay] = useState<string | null>(null);
  useLinkParam('acao', (a) => a === 'taxas' && canWrite && setTerms(true));
  useEffect(() => {
    api<FinanceSettings>('/finance/settings')
      .then(setSettings)
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [toast]);
  const period = useMemo(
    () => (settings ? financeMonth(settings.today, settings.monthStartDay, offset) : null),
    [settings, offset],
  );
  const previous = useMemo(
    () => (settings ? financeMonth(settings.today, settings.monthStartDay, offset - 1) : null),
    [settings, offset],
  );
  return (
    <>
      <h1 className="page-title cm-sr-only">Financeiro</h1>
      {settings && period && (
        <MonthBar
          period={period}
          startDay={settings.monthStartDay}
          current={offset === 0}
          onShift={(n) => setOffset((o) => (n === 0 ? 0 : o + n))}
          onEdit={() => setEditing(true)}
          onTerms={() => setTerms(true)}
        />
      )}
      <Tabs<FinanceTab>
        value={tab}
        onChange={setTab}
        items={[
          ['overview', 'Visão geral'],
          ['entries', 'Contas'],
          ['closings', 'Fechamentos'],
          ['apps', 'Aplicativos'],
          ['reconcile', 'Conciliação'],
          ['flow', 'Fluxo de caixa'],
          ['dre', 'DRE'],
        ]}
      />
      {tab === 'overview' ? (
        <OverviewTab
          period={period}
          previous={previous}
          today={settings?.today ?? todayIso()}
          onTab={(t) => {
            setTab(t);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : tab === 'entries' ? (
        <EntriesTab period={period} />
      ) : tab === 'closings' ? (
        <ClosingsTab period={period} onDailyCheck={setCheckDay} />
      ) : tab === 'apps' ? (
        <AppsTab period={period} />
      ) : tab === 'reconcile' ? (
        <BankTab />
      ) : tab === 'flow' ? (
        <FlowTab period={period} previous={previous} today={settings?.today ?? todayIso()} />
      ) : (
        <DreTab period={period} previous={previous} />
      )}
      {checkDay && (
        <Modal
          open
          size="lg"
          title={`Conferir ${fmtDate(checkDay)} com os extratos`}
          onClose={() => setCheckDay(null)}
        >
          <DailyCheck day={checkDay} />
        </Modal>
      )}
      {terms && settings && (
        <TermsModal
          terms={settings.paymentTerms}
          onClose={() => setTerms(false)}
          onSaved={(s) => {
            setSettings(s);
            setTerms(false);
            toast('Taxas salvas: valem para os próximos fechamentos de caixa', 'success');
          }}
        />
      )}
      {editing && settings && (
        <MonthStartModal
          current={settings.monthStartDay}
          onClose={() => setEditing(false)}
          onSaved={(s) => {
            setSettings(s);
            setOffset(0);
            setEditing(false);
            toast(
              s.monthStartDay === 1
                ? 'O mês financeiro agora segue o calendário'
                : `O mês financeiro agora começa todo dia ${s.monthStartDay}`,
              'success',
            );
          }}
        />
      )}
    </>
  );
}

/** Mês financeiro em uso, com setas para ver os meses anteriores e o dia de início. */
function MonthBar({
  period,
  startDay,
  current,
  onShift,
  onEdit,
  onTerms,
}: {
  period: FinanceMonth;
  startDay: number;
  current: boolean;
  onShift(n: number): void;
  onEdit(): void;
  onTerms(): void;
}) {
  const canWrite = useCan('finance:write');
  return (
    <div className="finance-month" aria-label="Mês financeiro">
      <div className="finance-month__nav">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Mês anterior"
          icon={<ChevronLeft size={16} />}
          onClick={() => onShift(-1)}
        />
        <div className="finance-month__label">
          <strong>Mês de {financeMonthName(period)}</strong>
          <span className="cm-hint">
            {financeMonthRange(period)}
            {startDay === 1 ? ' · mês do calendário' : ` · começa todo dia ${startDay}`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Próximo mês"
          icon={<ChevronRight size={16} />}
          onClick={() => onShift(1)}
        />
      </div>
      <div className="actions-row">
        {!current && (
          <Button variant="secondary" size="sm" onClick={() => onShift(0)}>
            Mês atual
          </Button>
        )}
        {canWrite && (
          <Button variant="secondary" size="sm" icon={<Percent size={16} />} onClick={onTerms}>
            Taxas e prazos
          </Button>
        )}
        {canWrite && (
          <Button variant="secondary" size="sm" icon={<CalendarDays size={16} />} onClick={onEdit}>
            Dia de início do mês
          </Button>
        )}
      </div>
    </div>
  );
}

const START_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function MonthStartModal({
  current,
  onClose,
  onSaved,
}: {
  current: number;
  onClose(): void;
  onSaved(s: FinanceSettings): void;
}) {
  const [day, setDay] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Exemplo com o mês de hoje, para a pessoa ver como fica antes de salvar.
  const example = financeMonth(todayIso(), day);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<FinanceSettings>('/finance/settings', {
          method: 'PUT',
          json: { monthStartDay: day },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Dia de início do mês"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={day === current} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="cm-hint">
        Escolha o dia em que o seu mês começa, por exemplo o dia em que você recebe. Os totais do
        mês, as contas do mês e o fluxo de caixa passam a usar esse período.
      </p>
      <SelectField
        label="O mês começa no dia"
        value={String(day)}
        onChange={(e) => setDay(Number(e.target.value))}
      >
        {START_DAYS.map((d) => (
          <option key={d} value={d}>
            {d === 1 ? '1 (mês do calendário)' : d}
          </option>
        ))}
      </SelectField>
      <Alert tone="info">
        Mês de {financeMonthName(example)}: de {fmtDate(example.from)} até {fmtDate(example.to)}.
        {day > 28 && ' Nos meses mais curtos, o mês começa no último dia.'}
      </Alert>
    </Modal>
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

const monthTab = (p: FinanceMonth): ListTab => ({
  id: 'mes',
  label: 'Do mês',
  filters: { due: [`range:${p.from}:${p.to}`] },
});

function EntriesTab({ period }: { period: FinanceMonth | null }) {
  const canWrite = useCan('finance:write');
  const [all, setAll] = useState<FinanceEntry[] | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<FinanceEntry | null>(null);
  const [cancelling, setCancelling] = useState<FinanceEntry | null>(null);
  // "Do mês": contas que vencem no mês financeiro escolhido em cima.
  const tabs = useMemo(
    () => (period ? [ENTRY_TABS[0]!, monthTab(period), ...ENTRY_TABS.slice(1)] : ENTRY_TABS),
    [period],
  );
  const lv = useListView({
    id: 'financeiro-contas',
    rows: all,
    fields: ENTRY_FIELDS,
    tabs,
    search: (e) => `${e.description} ${e.counterparty ?? ''} ${e.category ?? ''}`,
    sorts: ENTRY_SORTS,
  });
  // Conta aberta pela busca: mostra todas para ela aparecer (e ser destacada) mesmo se paga.
  useLinkParam('conta', () => lv.selectTab(ENTRY_TABS[ENTRY_TABS.length - 1]!));
  useLinkParam('acao', (a) => a === 'conta' && canWrite && setCreating(true));

  // Trocou o mês com a aba "Do mês" aberta: a aba acompanha o novo período.
  const { tab: currentTab, selectTab } = lv;
  useEffect(() => {
    if (period && currentTab?.id === 'mes') selectTab(monthTab(period));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.from, period?.to]);

  const range = period ? `?from=${period.from}&to=${period.to}` : '';
  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api<FinanceEntry[]>('/finance/entries'),
        api<FinanceSummary>(`/finance/summary${range}`),
      ]);
      setAll(r);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);
  // Conta lançada em outro aparelho, caixa fechado ou venda paga: a lista e o resumo se atualizam.
  useLiveData(
    ['finance'],
    () => void load(),
    ['cash.changed', 'channels.finance', 'order.changed'],
    1500,
  );
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
      {summary && <EntriesSummary summary={summary} />}
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
          searchHint="descrição, fornecedor/cliente ou categoria"
          summary={
            rows &&
            `${rows.length} ${rows.length === 1 ? 'lançamento' : 'lançamentos'} · ${brl(fromCents(total))}`
          }
        />
        {rows === null ? (
          <div className="cm-card__body">
            <Skeleton variant="table" />
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

function NewEntryModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [kind, setKind] = useState<'payable' | 'receivable'>('payable');
  const [description, setDescription] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [category, setCategory] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseBrlInput(amountText);
  const valid = description.trim() && amount && toCents(amount) > 0 && dueDate;
  const group = dreGroupOf(category, kind);

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
          repeatMonths: repeat > 1 ? repeat : undefined,
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
        placeholder={kind === 'payable' ? 'Ex.: Energia, Aluguel, Insumos' : 'Ex.: Eventos'}
        list="fin-cats"
        value={category}
        maxLength={60}
        hint={`Entra no DRE em: ${DRE_GROUP_LABELS[group]}`}
        onChange={(e) => setCategory(e.target.value)}
      />
      <datalist id="fin-cats">
        {FINANCE_CATEGORIES.filter((c) => c.kind === kind).map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
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
      <SelectField
        label="Repetir"
        value={String(repeat)}
        onChange={(e) => setRepeat(Number(e.target.value))}
      >
        <option value="1">Não repetir</option>
        {[2, 3, 6, 12, 24, 36].map((n) => (
          <option key={n} value={n}>
            Todo mês, por {n} meses
          </option>
        ))}
      </SelectField>
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

/** Resumo das contas: o que está em aberto, o que vence logo e quanto das contas do mês já foi pago. */
function EntriesSummary({ summary }: { summary: FinanceSummary }) {
  const m = summary.month;
  const due = toCents(m.payableDue);
  const left = toCents(m.payableLeft);
  const recDue = toCents(m.receivableDue);
  const recLeft = toCents(m.receivableLeft);
  const late = (v: string) =>
    toCents(v) > 0 ? <span className="fin-neg">{brl(v)} vencido</span> : 'nada vencido';
  return (
    <KpiStrip
      items={[
        {
          key: 'payable',
          label: 'A pagar em aberto',
          value: brl(summary.payableOpen),
          sub: late(summary.payableOverdue),
        },
        {
          key: 'next7',
          label: 'Vence nos próximos 7 dias',
          value: brl(summary.payableNext7),
          sub:
            toCents(summary.receivableNext7) > 0
              ? `e ${brl(summary.receivableNext7)} a receber`
              : 'contas a pagar',
        },
        {
          key: 'receivable',
          label: 'A receber em aberto',
          value: brl(summary.receivableOpen),
          sub: late(summary.receivableOverdue),
        },
        {
          key: 'month',
          label: 'Contas do mês pagas',
          value: due > 0 ? `${Math.round(((due - left) / due) * 100)}%` : '—',
          sub: (
            <span className="fin-kpi__stack">
              <Progress value={due - left} max={due} label="Contas do mês já pagas" />
              <span>
                {due > 0
                  ? `${brl(fromCents(due - left))} de ${brl(m.payableDue)}`
                  : 'nenhuma conta no mês'}
                {recDue > 0 &&
                  ` · recebido ${brl(fromCents(recDue - recLeft))} de ${brl(m.receivableDue)}`}
              </span>
            </span>
          ),
        },
      ]}
    />
  );
}

function FlowTab({
  period,
  previous,
  today,
}: {
  period: FinanceMonth | null;
  previous: FinanceMonth | null;
  today: string;
}) {
  // Começa no mês financeiro escolhido em cima; as datas ainda podem ser trocadas à mão.
  const [from, setFrom] = useState(period?.from ?? todayIso(-6));
  const [to, setTo] = useState(period?.to ?? todayIso(7));
  const [mode, setMode] = useState<'balance' | 'daily'>('balance');
  const [hideEmpty, setHideEmpty] = useState(true);
  useEffect(() => {
    if (!period) return;
    setFrom(period.from);
    setTo(period.to);
  }, [period]);
  const [data, setData] = useState<{
    days: CashFlowDay[];
    totals: Omit<CashFlowDay, 'day'>;
  } | null>(null);
  const [prev, setPrev] = useState<CashFlowDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // O mês anterior só entra no gráfico quando o período é o mês financeiro inteiro.
  const wholeMonth = Boolean(period && previous && from === period.from && to === period.to);
  useEffect(() => {
    if (!from || !to) return;
    api<typeof data>(`/finance/cash-flow?from=${from}&to=${to}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, to]);
  useEffect(() => {
    if (!wholeMonth || !previous) return setPrev(null);
    api<{ days: CashFlowDay[] }>(`/finance/cash-flow?from=${previous.from}&to=${previous.to}`)
      .then((d) => setPrev(d.days))
      .catch(() => setPrev(null));
  }, [wholeMonth, previous]);

  const t = data?.totals;
  const inflow = t ? toCents(t.sales) + toCents(t.received) : 0;
  const outflow = t ? toCents(t.refunds) + toCents(t.fees) + toCents(t.paid) : 0;
  const prevName = previous ? financeMonthName(previous).split(' de ')[0]! : '';
  // Mês correndo: compara com os mesmos dias do mês anterior, não com ele inteiro.
  const elapsed = data ? data.days.filter((d) => d.day <= today).length : 0;
  const sameDays = Boolean(data && elapsed < data.days.length);
  const prevCut = prev ? (sameDays ? prev.slice(0, elapsed) : prev) : null;
  const prevIn = prevCut?.reduce((s, d) => s + toCents(d.sales) + toCents(d.received), 0) ?? 0;
  const prevOut =
    prevCut?.reduce((s, d) => s + toCents(d.refunds) + toCents(d.fees) + toCents(d.paid), 0) ?? 0;
  const vsLabel = sameDays ? `vs mesmos dias de ${prevName}` : `vs ${prevName}`;
  const perDay = data ? avgDailySales(data.days, today) : 0;
  const cum = data ? cumulative(flowPoints(data.days, today), perDay) : null;
  const running = Boolean(data && data.days.some((d) => d.day > today));
  const rows = data
    ? hideEmpty
      ? data.days.filter(
          (d) =>
            toCents(d.sales) ||
            toCents(d.received) ||
            toCents(d.paid) ||
            toCents(d.fees) ||
            toCents(d.refunds) ||
            toCents(d.expectedIn) ||
            toCents(d.expectedOut),
        )
      : data.days
    : [];

  return (
    <>
      <div className="fin-toolbar">
        <div className="filters">
          <TextField
            label="De"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Segmented
          label="Ver o gráfico como"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'balance', label: 'Saldo acumulado' },
            { value: 'daily', label: 'Entradas e saídas' },
          ]}
        />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {data && t && (
        <>
          <KpiStrip
            items={[
              {
                key: 'in',
                label: 'Entradas',
                value: money(inflow),
                sub: wholeMonth && prev && (
                  <Delta value={change(inflow, prevIn)} against={vsLabel} />
                ),
              },
              {
                key: 'out',
                label: 'Saídas',
                value: money(outflow),
                sub: wholeMonth && prev && (
                  <Delta value={change(outflow, prevOut)} against={vsLabel} invert />
                ),
              },
              {
                key: 'net',
                label: 'Saldo do período',
                value: brl(t.net),
                danger: toCents(t.net) < 0,
                sub: `${brl(t.fees)} em taxas · ${brl(t.refunds)} em estornos`,
              },
              {
                key: 'forecast',
                label: running ? 'Previsão no fim do período' : 'Ainda em aberto',
                value: running && cum ? money(cum.end) : `+${brl(t.expectedIn)}`,
                danger: running && cum ? cum.end < 0 : false,
                sub: running
                  ? `+${brl(t.expectedIn)} a receber · −${brl(t.expectedOut)} a pagar`
                  : `e −${brl(t.expectedOut)} a pagar`,
              },
            ]}
          />
          <Card
            title={mode === 'balance' ? 'Saldo acumulado' : 'Entradas e saídas por dia'}
            actions={
              <Legend
                items={
                  mode === 'balance'
                    ? [
                        { swatch: 'cur', label: 'Realizado' },
                        ...(running ? [{ swatch: 'proj', label: 'Previsão' }] : []),
                        ...(prev ? [{ swatch: 'prev', label: prevName }] : []),
                      ]
                    : [
                        { swatch: 'in', label: 'Entrou' },
                        { swatch: 'out', label: 'Saiu' },
                        ...(running ? [{ swatch: 'in-soft', label: 'Previsto' }] : []),
                      ]
                }
              />
            }
          >
            <FlowChart
              days={data.days}
              prev={prev}
              today={today}
              mode={mode}
              salesPerDay={perDay}
              height={260}
            />
            {running && mode === 'balance' && (
              <p className="cm-hint" style={{ margin: 'var(--cm-space-2) 0 0' }}>
                A previsão soma as contas a vencer de cada dia e a venda líquida média de{' '}
                {money(perDay)} por dia (média dos dias que já passaram).
              </p>
            )}
          </Card>
        </>
      )}
      <Card
        title="Dia a dia"
        actions={
          <label className="fin-check">
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
            />
            Esconder dias sem movimento
          </label>
        }
        bodyless
      >
        {data && t && (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table fin-flow">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th className="cm-num">Vendas recebidas</th>
                  <th className="cm-num">Contas recebidas</th>
                  <th className="cm-num">Estornos</th>
                  <th className="cm-num">Taxas</th>
                  <th className="cm-num">Contas pagas</th>
                  <th className="cm-num">Saldo do dia</th>
                  <th className="cm-num">Previsto (+/−)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.day} data-future={d.day > today || undefined}>
                    <td>{fmtDate(d.day)}</td>
                    <td className="cm-num">{brl(d.sales)}</td>
                    <td className="cm-num">{brl(d.received)}</td>
                    <td className="cm-num">{brl(d.refunds)}</td>
                    <td className="cm-num">{brl(d.fees)}</td>
                    <td className="cm-num">{brl(d.paid)}</td>
                    <td className="cm-num">
                      <strong>
                        <SignedBrl value={d.net} />
                      </strong>
                    </td>
                    <td className="cm-num cm-hint">
                      {toCents(d.expectedIn) || toCents(d.expectedOut)
                        ? `+${brl(d.expectedIn)} / −${brl(d.expectedOut)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
                <tr data-total>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="cm-num">{brl(t.sales)}</td>
                  <td className="cm-num">{brl(t.received)}</td>
                  <td className="cm-num">{brl(t.refunds)}</td>
                  <td className="cm-num">{brl(t.fees)}</td>
                  <td className="cm-num">{brl(t.paid)}</td>
                  <td className="cm-num">
                    <strong>
                      <SignedBrl value={t.net} />
                    </strong>
                  </td>
                  <td className="cm-num cm-hint">
                    +{brl(t.expectedIn)} / −{brl(t.expectedOut)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/**
 * Conferência de um dia por forma de pagamento: o que o sistema registrou × o que o extrato da
 * maquininha, do banco (PIX) e a gaveta mostram. Abre pelo dia, na aba Fechamentos.
 */
function DailyCheck({ day: initialDay }: { day: string }) {
  const canWrite = useCan('finance:write');
  const toast = useToast();
  const [day, setDay] = useState(initialDay);
  const [data, setData] = useState<Reconciliation | null>(null);
  const [inputs, setInputs] = useState<Record<string, { amount: string; note: string }>>({});
  const load = useCallback(() => {
    if (!day) return;
    api<Reconciliation>(`/finance/reconciliation?day=${day}`)
      .then(setData)
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [day, toast]);
  useEffect(load, [load]);
  useLiveData(['finance'], load, ['cash.changed', 'channels.finance', 'order.changed'], 1500);

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
    <div className="fin-modal">
      <div className="filters">
        <TextField label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <p className="cm-hint" style={{ margin: 0 }}>
        Compare o que o sistema registrou com o extrato da maquininha, do banco (PIX) e a gaveta.
        Diferenças exigem explicação e o registro não pode ser alterado depois.
      </p>
      {!data ? (
        <Skeleton variant="detail" />
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
    </div>
  );
}
