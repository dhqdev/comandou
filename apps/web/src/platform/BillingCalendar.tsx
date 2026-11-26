import {
  fromCents,
  INVOICE_KIND_LABELS,
  spDate,
  toCents,
  type InvoiceKind,
} from '@comandou/shared';
import { Check, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Modal, Select, TextField, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import { Dot, Level, Section } from './ui';

type CalStatus = 'paid' | 'pending' | 'overdue' | 'forecast';

interface CalItem {
  date: string;
  tenantId: string;
  tenantName: string;
  amount: string;
  status: CalStatus;
  kind: InvoiceKind;
  auto: boolean;
  billingType: string | null;
  invoiceId: string | null;
  planName: string | null;
  description: string;
  /** Previsão no último dia liberado (o "pago até" da aba Assinatura). */
  periodEnd?: boolean;
  dueDate: string;
  paidAt: string | null;
  createdAt: string | null;
  netAmount: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  sent: boolean;
  lastError: string | null;
  environment: string | null;
}

interface Calendar {
  month: string;
  from: string;
  to: string;
  today: string;
  /** Baixa sozinha: cobrança ligada e o aviso (webhook) do Asaas cadastrado. */
  live: boolean;
  checkedAt: string;
  totals: Record<CalStatus, string>;
  items: CalItem[];
}

const STATUS: Record<CalStatus, { label: string; level: Level }> = {
  paid: { label: 'Recebido', level: 'ok' },
  pending: { label: 'Fatura enviada', level: 'info' },
  overdue: { label: 'Vencida', level: 'bad' },
  forecast: { label: 'Previsto', level: 'off' },
};

const PAY: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'cartão',
  UNDEFINED: 'Pix ou boleto',
};

/** De quanto em quanto tempo o calendário confere sozinho se alguém pagou. */
const POLL_MS = 20_000;

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const monthName = (month: string) => {
  const t = new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const dayName = (date: string) => {
  const t = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** Valor curto para caber no quadradinho do dia (R$ 1,2 mil). */
const short = (cents: number) =>
  cents >= 100_000
    ? `${(cents / 100_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
    : `${Math.round(cents / 100).toLocaleString('pt-BR')}`;
const br = (date: string) => date.split('-').reverse().join('/');
const brTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Ordem de "pior primeiro": a cor do dia segue a situação que mais pede atenção. */
const WORST: CalStatus[] = ['overdue', 'pending', 'forecast', 'paid'];
const keyOf = (i: CalItem) => `${i.tenantId}${i.invoiceId ?? i.date}`;
const totalOf = (items: CalItem[]) => items.reduce((t, i) => t + toCents(i.amount), 0);

/** Semanas do mês a partir do domingo antes do dia 1 (dias do mês vizinho ficam apagados). */
function gridDays(from: string) {
  const first = new Date(`${from}T12:00:00Z`);
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  // Só as semanas que o mês ocupa (5 ou 6, às vezes 4).
  const [y, m] = from.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + days) / 7);
  return Array.from({ length: weeks * 7 }, (_, k) =>
    new Date(start.getTime() + k * 86_400_000).toISOString().slice(0, 10),
  );
}

function payLabel(i: CalItem) {
  if (i.billingType === 'MANUAL') return 'Marcado à mão';
  if (i.billingType && PAY[i.billingType]) {
    const p = PAY[i.billingType]!;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }
  if (i.status === 'forecast') return i.auto ? 'Fatura sai sozinha' : 'Cobrança manual';
  return '—';
}

/**
 * Calendário de recebimentos: em que dia cada cliente paga e quanto. Junta o que já entrou, as
 * faturas em aberto e a previsão das próximas mensalidades (fim do período de cada cliente).
 * Grade do mês à esquerda e, ao lado, as cobranças do dia escolhido; clicar numa cobrança abre
 * os dados dela.
 */
export function CalendarSection() {
  const [month, setMonth] = useState(() => spDate().slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<CalStatus | 'all'>('all');
  const { data, error, reload } = useLoad<Calendar>(`/platform/billing/calendar?month=${month}`);
  const cal = data?.month === month ? data : null;
  const toast = useToast();
  const [open, setOpen] = useState<CalItem | null>(null);
  const [marking, setMarking] = useState<CalItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Quem acabou de pagar pelo Asaas enquanto a tela estava aberta (fica destacado). */
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const seen = useRef<{ month: string; status: Map<string, CalStatus> } | null>(null);
  const side = useRef<HTMLElement>(null);

  // Confere sozinho de tempos em tempos (e ao voltar para a aba): o pagamento que o Asaas
  // avisa pelo webhook aparece aqui sem precisar recarregar a página.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && reload();
    const t = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [month]);

  useEffect(() => {
    if (!cal) return;
    const now = new Map(
      cal.items.filter((i) => i.invoiceId).map((i) => [i.invoiceId!, i.status] as const),
    );
    const before = seen.current?.month === cal.month ? seen.current.status : null;
    seen.current = { month: cal.month, status: now };
    if (!before) return;
    const paid = cal.items.filter(
      (i) =>
        i.status === 'paid' &&
        i.invoiceId &&
        i.billingType !== 'MANUAL' &&
        before.get(i.invoiceId) !== 'paid',
    );
    if (!paid.length) return;
    for (const i of paid) toast(`${i.tenantName} pagou ${brl(i.amount)} pelo Asaas`, 'success');
    setFresh((f) => new Set([...f, ...paid.map((i) => i.invoiceId!)]));
  }, [cal]);

  async function markPaid(i: CalItem, paidOn: string) {
    setBusy('mark');
    try {
      if (i.invoiceId)
        await api(`/platform/billing/invoices/${i.invoiceId}/paid`, {
          method: 'POST',
          json: { paidOn },
        });
      else
        await api(`/platform/billing/tenants/${i.tenantId}/paid`, {
          method: 'POST',
          json: { due: i.date, paidOn },
        });
      toast(`${i.tenantName}: pagamento registrado, mais 30 dias liberados`, 'success');
      setMarking(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function undo(i: CalItem) {
    if (!confirm(`Desfazer o pagamento marcado à mão de ${i.tenantName}? Os 30 dias saem.`)) return;
    setBusy(`u${i.invoiceId}`);
    try {
      await api(`/platform/billing/invoices/${i.invoiceId}/unpaid`, { method: 'POST' });
      toast('Pagamento desfeito', 'success');
      setOpen(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const i of cal?.items ?? [])
      if (filter === 'all' || i.status === filter) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  }, [cal, filter]);

  const go = (by: number) => {
    setMonth((m) => shiftMonth(m, by));
    setPicked(null);
  };

  // Dia aberto ao lado: o escolhido; senão hoje (no mês atual) ou o primeiro dia com cobrança.
  const day =
    picked ??
    (cal
      ? cal.today.startsWith(month)
        ? cal.today
        : ([...byDay.keys()].sort()[0] ?? cal.from)
      : null);
  const dayItems = day ? (byDay.get(day) ?? []) : [];
  const sumOf = (st: CalStatus) => totalOf(dayItems.filter((i) => i.status === st));

  // Item aberto na janela segue a lista mais nova (pagou enquanto estava aberta).
  const current = open && cal ? (cal.items.find((i) => keyOf(i) === keyOf(open)) ?? open) : open;

  return (
    <Section title="Calendário de recebimentos" sub="em que dia cada cliente paga e quanto">
      <div className="adm-cal__bar">
        <div className="adm-cal__nav">
          <button
            type="button"
            className="adm-icon-btn"
            onClick={() => go(-1)}
            aria-label="Mês anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="adm-cal__month">{monthName(month)}</span>
          <button
            type="button"
            className="adm-icon-btn"
            onClick={() => go(1)}
            aria-label="Próximo mês"
          >
            <ChevronRight size={16} />
          </button>
          {month !== spDate().slice(0, 7) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMonth(spDate().slice(0, 7));
                setPicked(null);
              }}
            >
              Hoje
            </Button>
          )}
        </div>
        <Select
          className="adm-cal__select"
          aria-label="Situação"
          sheetTitle="Situação"
          value={filter}
          onChange={(e) => setFilter(e.target.value as CalStatus | 'all')}
        >
          <option value="all">Todas as situações</option>
          {(Object.keys(STATUS) as CalStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
        {cal && (
          <span className={`adm-cal__live${cal.live ? ' is-on' : ''}`}>
            {cal.live ? 'Baixa sozinha pelo Asaas' : 'Baixa sozinha desligada'} ·{' '}
            {new Date(cal.checkedAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            <button
              type="button"
              className="adm-icon-btn"
              onClick={reload}
              aria-label="Conferir agora"
            >
              <RefreshCw size={14} />
            </button>
          </span>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!cal && !error && <Skeleton variant="table" />}
      {cal && !cal.live && (
        <p className="adm-cal__note">
          Sem baixa sozinha: cadastre o aviso (webhook) do Asaas em{' '}
          <Link to="/credenciais#cred-asaas">Credenciais › Asaas</Link>. Até lá, abra a cobrança e
          use Marcar como pago.
        </p>
      )}
      {cal && (
        <>
          <p className="adm-cal__sums">
            {(Object.keys(STATUS) as CalStatus[]).map((s) => (
              <span key={s}>
                <Dot level={STATUS[s].level} /> {STATUS[s].label}{' '}
                <strong>{brl(cal.totals[s])}</strong>
              </span>
            ))}
          </p>
          <div className="adm-cal__wrap">
            <div className="adm-cal__board">
              <div
                className="adm-cal"
                role="grid"
                aria-label={`Recebimentos de ${monthName(month)}`}
              >
                {WEEK.map((w) => (
                  <div key={w} className="adm-cal__wd" role="columnheader">
                    {w}
                  </div>
                ))}
                {gridDays(cal.from).map((date) => {
                  const inMonth = date.startsWith(month);
                  const items = inMonth ? (byDay.get(date) ?? []) : [];
                  const worst = items.length
                    ? WORST.find((s) => items.some((i) => i.status === s))!
                    : null;
                  const cls = [
                    'adm-cal__day',
                    !inMonth && 'is-out',
                    date === cal.today && 'is-today',
                    date === day && inMonth && 'is-picked',
                    worst && `is-${worst}`,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const n = Number(date.slice(8));
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      className={cls}
                      disabled={!inMonth}
                      aria-pressed={inMonth && date === day}
                      aria-label={
                        items.length
                          ? `Dia ${n}: ${items.length} ${items.length === 1 ? 'cobrança' : 'cobranças'}, ${brl(fromCents(totalOf(items)))}`
                          : `Dia ${n}: nada`
                      }
                      onClick={() => {
                        setPicked(date);
                        // Tela estreita: o painel do dia fica embaixo da grade; rola até ele.
                        if (items.length && window.matchMedia('(max-width: 1100px)').matches)
                          requestAnimationFrame(() =>
                            side.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                          );
                      }}
                    >
                      <span className="adm-cal__n">{n}</span>
                      {items.length > 0 && (
                        <>
                          <span className="adm-cal__sum">
                            <span className="adm-cal__cur">R$ </span>
                            {short(totalOf(items))}
                          </span>
                          <span className="adm-cal__dots" aria-hidden>
                            {items.slice(0, 5).map((i) => (
                              <Dot key={keyOf(i)} level={STATUS[i.status].level} />
                            ))}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <aside ref={side} className="adm-cal__side" aria-live="polite">
              {day && (
                <header className="adm-cal__side-head">
                  <strong>{dayName(day)}</strong>
                  <span>
                    {dayItems.length === 0
                      ? 'Nada neste dia'
                      : WORST.filter((s) => sumOf(s) > 0)
                          .map(
                            (s) => `${brl(fromCents(sumOf(s)))} ${STATUS[s].label.toLowerCase()}`,
                          )
                          .join(' · ')}
                  </span>
                </header>
              )}
              <div className="adm-cal__cards">
                {dayItems.map((i) => (
                  <button
                    key={keyOf(i)}
                    type="button"
                    className={`adm-cal__card${
                      i.invoiceId && fresh.has(i.invoiceId) ? ' is-fresh' : ''
                    }`}
                    onClick={() => setOpen(i)}
                  >
                    <span className="adm-cal__card-top">
                      <span className="adm-cal__card-name">{i.tenantName}</span>
                      <span className="adm-cal__card-amount">{brl(i.amount)}</span>
                    </span>
                    <span className="adm-cal__card-meta">
                      <Dot level={STATUS[i.status].level} />
                      {i.invoiceId && fresh.has(i.invoiceId)
                        ? 'Acabou de pagar'
                        : STATUS[i.status].label}
                      {' · '}
                      {INVOICE_KIND_LABELS[i.kind]}
                      {i.planName ? ` · ${i.planName}` : ''}
                    </span>
                    <span className="adm-cal__card-meta">
                      {i.periodEnd ? `Pago até ${br(i.dueDate)} · ` : ''}
                      Vence {br(i.dueDate)}
                      {i.paidAt ? ` · pago ${br(spDate(new Date(i.paidAt)))}` : ''}
                      {' · '}
                      {payLabel(i)}
                    </span>
                  </button>
                ))}
                {day && dayItems.length === 0 && (
                  <div className="adm-empty">Nenhuma cobrança neste dia.</div>
                )}
              </div>
            </aside>
          </div>
          <p className="adm-cal__note">
            Previsto: a mensalidade vence no último dia liberado do cliente e cada pagamento libera
            mais 30 dias. Valores brutos, antes da taxa do Asaas; clientes suspensos e planos grátis
            ficam de fora.
          </p>
        </>
      )}
      <ChargeModal
        item={current}
        busy={busy}
        onClose={() => setOpen(null)}
        onMark={(i) => {
          setOpen(null);
          setMarking(i);
        }}
        onUndo={undo}
      />
      <MarkPaidModal
        item={marking}
        today={cal?.today ?? spDate()}
        busy={busy === 'mark'}
        onClose={() => setMarking(null)}
        onConfirm={markPaid}
      />
    </Section>
  );
}

/** Dados da cobrança: abre ao clicar numa cobrança do dia. */
function ChargeModal({
  item,
  busy,
  onClose,
  onMark,
  onUndo,
}: {
  item: CalItem | null;
  busy: string | null;
  onClose: () => void;
  onMark: (i: CalItem) => void;
  onUndo: (i: CalItem) => void;
}) {
  const rows: [string, ReactNode][] = item
    ? [
        [
          'Situação',
          <>
            <Dot level={STATUS[item.status].level} /> {STATUS[item.status].label}
          </>,
        ],
        ['Valor', brl(item.amount)],
        ...(item.netAmount
          ? ([['Líquido (depois da taxa)', brl(item.netAmount)]] as [string, string][])
          : []),
        ['Descrição', item.description],
        ['Tipo', INVOICE_KIND_LABELS[item.kind]],
        ...(item.planName ? ([['Plano', item.planName]] as [string, string][]) : []),
        ['Forma', payLabel(item)],
        ['Vencimento', br(item.dueDate)],
        ...(item.paidAt ? ([['Pago em', brTime(item.paidAt)]] as [string, string][]) : []),
        ...(item.createdAt ? ([['Emitida em', brTime(item.createdAt)]] as [string, string][]) : []),
        [
          'Asaas',
          item.status === 'forecast'
            ? 'Ainda sem fatura'
            : item.billingType === 'MANUAL' && !item.sent
              ? 'Não enviada (cobrança à mão)'
              : item.sent
                ? `Enviada${item.environment === 'sandbox' ? ' (ambiente de teste)' : ''}`
                : 'Ainda não enviada',
        ],
      ]
    : [];
  return (
    <Modal
      open={!!item}
      title={item ? item.tenantName : 'Cobrança'}
      onClose={onClose}
      footer={
        item && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            {item.status === 'paid' && item.billingType === 'MANUAL' && item.invoiceId && (
              <Button
                variant="secondary"
                icon={<Undo2 size={16} />}
                loading={busy === `u${item.invoiceId}`}
                onClick={() => onUndo(item)}
              >
                Desfazer pagamento
              </Button>
            )}
            {item.status !== 'paid' && (
              <Button icon={<Check size={16} />} onClick={() => onMark(item)}>
                Marcar como pago
              </Button>
            )}
          </>
        )
      }
    >
      {item && (
        <div className="adm-charge">
          {item.lastError && <Alert tone="warning">{item.lastError}</Alert>}
          <dl className="adm-charge__facts">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="adm-charge__links">
            <Link to={`/restaurantes/${item.tenantId}`} onClick={onClose}>
              Abrir o restaurante
            </Link>
            {item.invoiceUrl && (
              <a href={item.invoiceUrl} target="_blank" rel="noreferrer">
                Fatura no Asaas <ExternalLink size={13} aria-hidden />
              </a>
            )}
            {item.bankSlipUrl && (
              <a href={item.bankSlipUrl} target="_blank" rel="noreferrer">
                Boleto <ExternalLink size={13} aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Confirma o "Marcar como pago": em que dia o dinheiro entrou. */
function MarkPaidModal({
  item,
  today,
  busy,
  onClose,
  onConfirm,
}: {
  item: CalItem | null;
  today: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (i: CalItem, paidOn: string) => void;
}) {
  const [paidOn, setPaidOn] = useState(today);
  useEffect(() => {
    if (item) setPaidOn(today);
  }, [item, today]);
  return (
    <Modal
      open={!!item}
      title="Marcar como pago"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            loading={busy}
            disabled={!paidOn || paidOn > today}
            icon={<Check size={16} />}
            onClick={() => item && onConfirm(item, paidOn)}
          >
            Confirmar pagamento
          </Button>
        </>
      }
    >
      {item && (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0 }}>
            <strong>{item.tenantName}</strong> · {brl(item.amount)}
            <br />
            <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
              {item.kind === 'monthly'
                ? `Mensalidade com vencimento em ${dayName(item.date).toLowerCase()}. Libera mais 30 dias de acesso.`
                : INVOICE_KIND_LABELS[item.kind]}
              {item.invoiceId && item.billingType !== 'MANUAL'
                ? ' A cobrança também é baixada no Asaas, para o cliente não pagar duas vezes.'
                : ''}
            </span>
          </p>
          <TextField
            label="Pago em"
            type="date"
            value={paidOn}
            max={today}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </div>
      )}
    </Modal>
  );
}
