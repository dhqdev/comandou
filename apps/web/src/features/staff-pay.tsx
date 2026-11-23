import {
  periodDays,
  describeStaffPay,
  STAFF_PAY_METHOD_LABELS,
  STAFF_PAY_METHODS,
  toCents,
  type Role,
  type StaffPayMethod,
  type StaffPayRule,
} from '@comandou/shared';
import {
  Bike,
  BriefcaseBusiness,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Crown,
  HandCoins,
  HandPlatter,
  Store,
  Wallet,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Modal,
  Segmented,
  Skeleton,
  TextField,
} from '../design-system';
import { api } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import { useLiveData } from '../lib/realtime';
import { SelectField } from './forms';
import { SidePanel } from './SidePanel';
import './staff-pay.css';

/* ------------------------------------------------------------------ Função de cada pessoa */

/** Ícone do serviço que a pessoa presta (cartões da Equipe e pagamentos). */
export const ROLE_ICON: Record<Role, (size: number) => ReactNode> = {
  owner: (s) => <Crown size={s} aria-hidden />,
  manager: (s) => <BriefcaseBusiness size={s} aria-hidden />,
  cashier: (s) => <Wallet size={s} aria-hidden />,
  attendant: (s) => <Store size={s} aria-hidden />,
  waiter: (s) => <HandPlatter size={s} aria-hidden />,
  kitchen: (s) => <ChefHat size={s} aria-hidden />,
  driver: (s) => <Bike size={s} aria-hidden />,
};

/** Cor de cada função (a mesma paleta dos entregadores), para reconhecer de longe. */
export const ROLE_COLOR: Record<Role, string> = {
  owner: '#f08c00',
  manager: '#ae3ec9',
  cashier: '#2f9e44',
  attendant: '#1c7ed6',
  waiter: '#e8590c',
  kitchen: '#e03131',
  driver: '#0c8599',
};

/** Bolinha cheia na cor da função, com o ícone do serviço em branco. */
export function RoleAvatar({ role, size = 42 }: { role: Role; size?: number }) {
  return (
    <span
      className="role-avatar"
      style={{ '--role': ROLE_COLOR[role] ?? '#495057', width: size, height: size } as never}
      aria-hidden
    >
      {(ROLE_ICON[role] ?? ROLE_ICON.attendant)(Math.round(size * 0.48))}
    </span>
  );
}

/* ------------------------------------------------------------------ Dados */

export interface StaffDraft {
  userId: string;
  name: string;
  role: Role;
  roleLabel: string;
  pixKey: string | null;
  rule: StaffPayRule;
  ruleText: string;
  hasRule: boolean;
  from: string;
  to: string;
  paidUntil: string | null;
  workdays: number;
  days: number;
  orders: number;
  sales: string;
  service: string;
  salary: string;
  daily: string;
  commission: string;
  serviceShare: string;
  adjustments: string;
  gross: string;
}

export interface StaffPerson {
  userId: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  status: string;
  courier: boolean;
  ruleText: string;
  hasRule: boolean;
  pending: string;
  monthEarned: string;
  draft: StaffDraft | null;
  monthPaid: string;
  scheduled: string;
  totalPaid: string;
  payouts: number;
  lastPaidAt: string | null;
  monthDays: number;
  monthOrders: number;
  monthSales: string;
}

export interface StaffPayout {
  id: string;
  userId: string;
  name: string;
  role: Role;
  from: string;
  to: string;
  days: number;
  orders: number;
  salary: string;
  daily: string;
  commission: string;
  serviceShare: string;
  adjustments: string;
  gross: string;
  method: StaffPayMethod;
  notes: string | null;
  createdAt: string;
  status: 'paid' | 'open' | 'cancelled';
  dueDate: string;
  paidAt: string | null;
}

export interface StaffOverview {
  month: string;
  totals: {
    pending: string;
    monthPaid: string;
    scheduled: string;
    totalPaid: string;
    people: number;
  };
  people: StaffPerson[];
  recent: StaffPayout[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const thisMonth = () => isoOf(new Date()).slice(0, 7);
const shiftMonth = (m: string, n: number) =>
  isoOf(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).slice(0, 7);
const monthName = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
  });
/** "Novembro de 2026" (só a primeira letra maiúscula). */
const monthLabel = (m: string) => {
  const name = monthName(m);
  return `${name[0]!.toUpperCase()}${name.slice(1)} de ${m.slice(0, 4)}`;
};
/** "05/11" (ou "05/11/2025" fora do ano corrente). */
export const dayLabel = (iso: string) =>
  iso.slice(0, 4) === String(new Date().getFullYear())
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nonZero = (v: string) => toCents(v) !== 0;

/** Pagamentos do mês (Equipe). Recarrega quando a equipe ou o Financeiro muda. */
export function useStaffPay(month: string, enabled: boolean) {
  const [data, setData] = useState<StaffOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await api<StaffOverview>(`/staff-pay?month=${month}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveData(['team', 'finance'], () => void load());
  return { data, error, reload: load };
}

/* ------------------------------------------------------------------ Conta do pagamento */

/** A conta linha a linha (no pagamento, no histórico e no perfil do garçom). */
export function PayBreakdown({
  d,
  total = 'Total',
}: {
  d: Pick<
    StaffDraft,
    | 'salary'
    | 'daily'
    | 'commission'
    | 'serviceShare'
    | 'adjustments'
    | 'gross'
    | 'days'
    | 'orders'
    | 'sales'
    | 'service'
  > & { from?: string; to?: string };
  total?: string;
}) {
  const adj = toCents(d.adjustments);
  const row = (label: string, v: string, sign = '') =>
    nonZero(v) && (
      <div>
        <dt>{label}</dt>
        <dd>
          {sign}
          {brl(v.replace('-', ''))}
        </dd>
      </div>
    );
  const salaryLabel = d.from && d.to ? `Salário (${periodDays(d.from, d.to)} dias)` : 'Salário';
  return (
    <dl className="sp-breakdown">
      {row(salaryLabel, d.salary)}
      {row(`Diárias (${d.days} ${d.days === 1 ? 'dia' : 'dias'})`, d.daily)}
      {row(`Comissão (vendas de ${brl(d.sales)})`, d.commission)}
      {row(`Taxa de serviço (de ${brl(d.service)})`, d.serviceShare)}
      {adj !== 0 &&
        row(adj > 0 ? 'Bônus' : 'Vale / desconto', d.adjustments, adj > 0 ? '+ ' : '− ')}
      <div className="sp-breakdown__total">
        <dt>{total}</dt>
        <dd>{brl(toCents(d.gross) > 0 ? d.gross : '0')}</dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------------ Painel de pagamentos */

/**
 * Equipe › Pagamentos: quanto cada pessoa tem a receber agora, o que já recebeu no mês e no
 * total, e o botão de pagar (que sempre lança no Financeiro › Salários).
 */
export function StaffPayPanel({
  open,
  onClose,
  canPay,
}: {
  open: boolean;
  onClose(): void;
  canPay: boolean;
}) {
  const [month, setMonth] = useState(thisMonth);
  const { data, error, reload } = useStaffPay(month, open);
  const [paying, setPaying] = useState<StaffPerson | null>(null);
  const [ruleFor, setRuleFor] = useState<StaffPerson | null>(null);
  const [historyOf, setHistoryOf] = useState<StaffPerson | null>(null);
  const people = data?.people.filter((p) => p.status === 'active' || p.payouts > 0) ?? [];

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        size="xl"
        className="sp-panel"
        title={
          <span className="sp-head">
            <span>Pagamentos da equipe</span>
            <span className="sp-head__sub">
              Quanto cada um tem a receber e quanto já recebeu. Tudo vai para o Financeiro.
            </span>
          </span>
        }
      >
        <div className="sp-month">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Mês anterior"
            icon={<ChevronLeft size={16} />}
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          />
          <strong>{monthLabel(month)}</strong>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Próximo mês"
            icon={<ChevronRight size={16} />}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          />
          {month !== thisMonth() && (
            <Button size="sm" variant="secondary" onClick={() => setMonth(thisMonth())}>
              Este mês
            </Button>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {!data || data.month !== month ? (
          <Skeleton variant="cards" />
        ) : (
          <>
            <dl className="sp-totals">
              <div>
                <dt>A pagar agora</dt>
                <dd>{brl(data.totals.pending)}</dd>
              </div>
              <div>
                <dt>Pago em {monthName(month)}</dt>
                <dd>{brl(data.totals.monthPaid)}</dd>
              </div>
              <div>
                <dt>Agendado no Financeiro</dt>
                <dd>{brl(data.totals.scheduled)}</dd>
              </div>
              <div>
                <dt>Total já pago</dt>
                <dd>{brl(data.totals.totalPaid)}</dd>
              </div>
            </dl>
            {people.length === 0 ? (
              <EmptyState title="Ninguém na equipe ainda" />
            ) : (
              <ul className="sp-people" aria-label="Pagamento de cada pessoa">
                {people.map((p) => (
                  <li
                    key={p.userId}
                    className="sp-person"
                    data-off={p.status !== 'active' || undefined}
                  >
                    <div className="sp-person__who">
                      <RoleAvatar role={p.role} size={40} />
                      <div>
                        <strong>{p.name}</strong>
                        <span className="sp-person__role">
                          {p.roleLabel} · {p.ruleText}
                        </span>
                      </div>
                    </div>
                    <dl className="sp-person__nums">
                      <div>
                        <dt>A receber</dt>
                        <dd data-strong>{brl(p.pending)}</dd>
                      </div>
                      <div>
                        <dt>No mês</dt>
                        <dd>
                          {brl(p.monthEarned)}
                          <small>
                            {p.monthDays} {p.monthDays === 1 ? 'dia' : 'dias'}
                            {p.monthOrders ? ` · ${p.monthOrders} pedidos` : ''}
                          </small>
                        </dd>
                      </div>
                      <div>
                        <dt>Já recebeu</dt>
                        <dd>{brl(p.totalPaid)}</dd>
                      </div>
                    </dl>
                    <div className="sp-person__actions">
                      {p.courier ? (
                        <Link
                          className="cm-btn cm-btn--secondary cm-btn--sm"
                          to="/entregas?aba=acerto"
                        >
                          Abrir Acerto
                        </Link>
                      ) : (
                        <>
                          {canPay && (
                            <Button
                              size="sm"
                              variant={p.hasRule ? 'ghost' : 'secondary'}
                              onClick={() => setRuleFor(p)}
                              aria-label={`Como ${p.name} ganha`}
                            >
                              {p.hasRule ? 'Como ganha' : 'Definir ganho'}
                            </Button>
                          )}
                          {p.payouts > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setHistoryOf(p)}
                              aria-label={`Histórico de ${p.name}`}
                            >
                              Histórico
                            </Button>
                          )}
                          {canPay && p.status === 'active' && p.hasRule && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<HandCoins size={15} />}
                              onClick={() => setPaying(p)}
                              aria-label={`Pagar ${p.name}`}
                            >
                              Pagar
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.recent.length > 0 && (
              <section className="sp-recent">
                <h3>Últimos pagamentos</h3>
                <PayoutList items={data.recent} withName />
              </section>
            )}
            <p className="cm-hint">
              Diárias contam os dias em que a pessoa entrou no sistema (dá para corrigir ao pagar).
              Comissão e taxa de serviço vêm dos pedidos que ela lançou. Entregadores são pagos em
              Entregas › Acerto.
            </p>
          </>
        )}
      </SidePanel>
      {paying && (
        <PayModal
          person={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            void reload();
          }}
        />
      )}
      {ruleFor && (
        <RuleModal
          person={ruleFor}
          onClose={() => setRuleFor(null)}
          onDone={() => {
            setRuleFor(null);
            void reload();
          }}
        />
      )}
      {historyOf && <HistoryModal person={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  );
}

const STATUS: Record<
  StaffPayout['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' }
> = {
  paid: { label: 'Pago', tone: 'success' },
  open: { label: 'Agendado', tone: 'warning' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
};

/** Lista de pagamentos (painel, histórico da pessoa e perfil do garçom). */
export function PayoutList({ items, withName }: { items: StaffPayout[]; withName?: boolean }) {
  return (
    <ul className="sp-payouts">
      {items.map((p) => {
        const s = STATUS[p.status];
        return (
          <li key={p.id} data-cancelled={p.status === 'cancelled' || undefined}>
            <div>
              <strong>{withName ? p.name : `${dayLabel(p.from)} a ${dayLabel(p.to)}`}</strong>
              <span className="cm-hint">
                {withName && `${dayLabel(p.from)} a ${dayLabel(p.to)} · `}
                {STAFF_PAY_METHOD_LABELS[p.method] ?? p.method}
                {p.status === 'open'
                  ? ` · para ${dayLabel(p.dueDate)}`
                  : p.paidAt
                    ? ` · em ${dayLabel(p.paidAt)}`
                    : ''}
              </span>
            </div>
            <span className="sp-payouts__value">
              {brl(p.gross)}
              <Badge tone={s.tone}>{s.label}</Badge>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryModal({ person, onClose }: { person: StaffPerson; onClose(): void }) {
  const [items, setItems] = useState<StaffPayout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<StaffPayout[]>(`/staff-pay/${person.userId}/payouts`).then(setItems, (e: Error) =>
      setError(e.message),
    );
  }, [person.userId]);
  return (
    <Modal open title={`Pagamentos de ${person.name}`} onClose={onClose}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!items ? <Skeleton /> : <PayoutList items={items} />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Pagar */

/**
 * Pagar uma pessoa: período (do dia seguinte ao último pago até hoje), dias trabalhados (os que
 * o sistema viu, corrigíveis), bônus ou vale, forma e quando. Sempre entra no Financeiro.
 */
export function PayModal({
  person,
  onClose,
  onDone,
}: {
  person: Pick<StaffPerson, 'userId' | 'name' | 'draft'>;
  onClose(): void;
  onDone(): void;
}) {
  const base = person.draft;
  const [from, setFrom] = useState(base?.from ?? isoOf(new Date()));
  const [to, setTo] = useState(base?.to ?? isoOf(new Date()));
  const [days, setDays] = useState<string>('');
  const [kind, setKind] = useState<'bonus' | 'discount'>('bonus');
  const [adj, setAdj] = useState('');
  const [method, setMethod] = useState<StaffPayMethod>('pix');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [due, setDue] = useState(isoOf(new Date()));
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<StaffDraft | null>(base);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = adj.trim() ? parseBrlInput(adj) : '0';
  const adjustments = amount && kind === 'discount' && amount !== '0' ? `-${amount}` : amount;
  const daysN = days.trim() === '' ? undefined : Number(days);
  const daysBad = daysN !== undefined && (!Number.isInteger(daysN) || daysN < 0);

  useEffect(() => {
    if (!adjustments || !from || !to || daysBad) return;
    let stop = false;
    const id = window.setTimeout(() => {
      api<StaffDraft>(`/staff-pay/${person.userId}/preview`, {
        method: 'POST',
        json: { from, to, adjustments, ...(daysN !== undefined ? { days: daysN } : {}) },
      })
        .then((d) => !stop && (setDraft(d), setError(null)))
        .catch((e) => !stop && (setDraft(null), setError((e as Error).message)));
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(id);
    };
  }, [person.userId, from, to, adjustments, daysN, daysBad]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!adjustments) return setError('Valor do ajuste inválido');
    setBusy(true);
    try {
      await api(`/staff-pay/${person.userId}/payouts`, {
        method: 'POST',
        json: {
          from,
          to,
          adjustments,
          method,
          notes: notes.trim() || null,
          paidNow: when === 'now',
          ...(when === 'later' ? { dueDate: due } : {}),
          ...(daysN !== undefined ? { days: daysN } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const gross = draft ? toCents(draft.gross) : 0;
  return (
    <Modal
      open
      size="lg"
      title={`Pagar ${person.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sp-pay" loading={busy} disabled={!draft || gross <= 0}>
            {draft && gross > 0
              ? `${when === 'now' ? 'Pagar' : 'Agendar'} ${brl(draft.gross)}`
              : 'Pagar'}
          </Button>
        </>
      }
    >
      <form id="sp-pay" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        {draft && !draft.hasRule && (
          <Alert tone="warning">
            {person.name} ainda não tem como ganha cadastrado: só entra o bônus que você lançar.
          </Alert>
        )}
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <TextField
          label="Dias trabalhados"
          inputMode="numeric"
          placeholder={draft ? String(draft.workdays) : ''}
          value={days}
          error={daysBad ? 'Número de dias inválido' : undefined}
          hint={
            draft
              ? `O sistema viu ${draft.workdays} ${draft.workdays === 1 ? 'dia' : 'dias'} no período. Deixe vazio para usar esse número.`
              : undefined
          }
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
        />
        <SelectField
          label="Forma de pagamento"
          value={method}
          onChange={(e) => setMethod(e.target.value as StaffPayMethod)}
        >
          {STAFF_PAY_METHODS.map((m) => (
            <option key={m} value={m}>
              {STAFF_PAY_METHOD_LABELS[m]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Ajuste"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'bonus' | 'discount')}
        >
          <option value="bonus">Bônus / gorjeta (+)</option>
          <option value="discount">Vale / desconto (−)</option>
        </SelectField>
        <TextField
          label="Valor do ajuste (R$)"
          inputMode="decimal"
          placeholder="0,00"
          value={adj}
          error={adj.trim() && !amount ? 'Valor inválido' : undefined}
          onChange={(e) => setAdj(e.target.value)}
        />
        <div className="cm-form__wide sp-when">
          <span className="cm-label">Quando</span>
          <Segmented
            label="Quando paga"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'now', label: 'Pago agora' },
              { value: 'later', label: 'Agendar' },
            ]}
          />
        </div>
        {when === 'later' && (
          <TextField
            label="Dia do pagamento"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        )}
        <TextField
          label="Observação"
          maxLength={300}
          wrapClass="cm-form__wide"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {draft && <PayBreakdown d={draft} />}
        <p className="cm-hint cm-form__block">
          {when === 'now'
            ? 'Entra no Financeiro › Salários como conta paga hoje.'
            : 'Entra no Financeiro › Salários como conta a pagar no dia escolhido. Cancelada lá, o período volta a ficar em aberto.'}
          {draft?.pixKey && (
            <>
              {' '}
              Chave Pix: <strong>{draft.pixKey}</strong>
            </>
          )}
        </p>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Como ganha */

const pctOf = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === ''
    ? 0
    : Number.isFinite(n) && n >= 0 && n <= 100
      ? Math.round(n * 100) / 100
      : null;
};
const moneyIn = (v: string) => (v.trim() === '' ? '0' : parseBrlInput(v));
const showMoney = (v: string) => (toCents(v) ? v.replace('.', ',') : '');
const showPct = (n: number) => (n ? String(n).replace('.', ',') : '');

/** Como a pessoa ganha: salário do mês, diária, % das vendas e da taxa de serviço, e o Pix. */
export function RuleModal({
  person,
  onClose,
  onDone,
}: {
  person: Pick<StaffPerson, 'userId' | 'name' | 'roleLabel' | 'draft'>;
  onClose(): void;
  onDone(): void;
}) {
  const r = person.draft?.rule;
  const [monthly, setMonthly] = useState(r ? showMoney(r.monthly) : '');
  const [daily, setDaily] = useState(r ? showMoney(r.dailyRate) : '');
  const [sales, setSales] = useState(r ? showPct(r.salesPercent) : '');
  const [service, setService] = useState(r ? showPct(r.servicePercent) : '');
  const [pix, setPix] = useState(person.draft?.pixKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = moneyIn(monthly);
  const d = moneyIn(daily);
  const s = pctOf(sales);
  const sv = pctOf(service);
  const rule: StaffPayRule | null =
    m && d && s !== null && sv !== null
      ? { monthly: m, dailyRate: d, salesPercent: s, servicePercent: sv }
      : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rule) return;
    setBusy(true);
    try {
      await api(`/staff-pay/${person.userId}/rule`, {
        method: 'PUT',
        json: { rule, pixKey: pix.trim() || null },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Como ${person.name} ganha`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sp-rule" loading={busy} disabled={!rule}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="sp-rule" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="cm-hint cm-form__block">
          {person.roleLabel}. Use só o que vale para esta pessoa: o resto fica em branco.
        </p>
        <TextField
          label="Salário fixo por mês (R$)"
          inputMode="decimal"
          placeholder="0,00"
          value={monthly}
          error={monthly.trim() && !m ? 'Valor inválido' : undefined}
          onChange={(e) => setMonthly(e.target.value)}
        />
        <TextField
          label="Diária (R$ por dia trabalhado)"
          inputMode="decimal"
          placeholder="0,00"
          value={daily}
          error={daily.trim() && !d ? 'Valor inválido' : undefined}
          onChange={(e) => setDaily(e.target.value)}
        />
        <TextField
          label="Comissão sobre as vendas (%)"
          inputMode="decimal"
          placeholder="0"
          value={sales}
          error={s === null ? 'De 0 a 100' : undefined}
          hint="Dos pedidos que a pessoa lançou (itens, já com desconto)."
          onChange={(e) => setSales(e.target.value)}
        />
        <TextField
          label="Parte da taxa de serviço (%)"
          inputMode="decimal"
          placeholder="0"
          value={service}
          error={sv === null ? 'De 0 a 100' : undefined}
          hint="100 = a taxa de serviço toda dos pedidos dela."
          onChange={(e) => setService(e.target.value)}
        />
        <TextField
          label="Chave Pix (opcional)"
          maxLength={140}
          wrapClass="cm-form__wide"
          value={pix}
          onChange={(e) => setPix(e.target.value)}
        />
        <p className="sp-example cm-form__block" aria-live="polite">
          {rule ? describeStaffPay(rule) : 'Confira os valores marcados.'}
        </p>
      </form>
    </Modal>
  );
}
