import {
  fromCents,
  INVOICE_KIND_LABELS,
  spDate,
  toCents,
  type InvoiceKind,
} from '@comandou/shared';
import { Check, ChevronLeft, ChevronRight, RefreshCw, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import { Dot, Level, Section, Tile } from './ui';

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

function detail(i: CalItem) {
  const parts: string[] = [STATUS[i.status].label];
  if (i.kind !== 'monthly') parts.push(INVOICE_KIND_LABELS[i.kind]);
  if (i.status === 'forecast') {
    if (i.planName) parts.push(`Plano ${i.planName}`);
    parts.push(
      i.billingType === 'CREDIT_CARD'
        ? 'cartão automático'
        : i.auto
          ? 'fatura sai sozinha'
          : 'cobrança manual',
    );
  } else if (i.billingType === 'MANUAL') {
    parts.push('marcado à mão');
  } else if (i.billingType && PAY[i.billingType]) {
    parts.push(i.status === 'paid' ? `por ${PAY[i.billingType]}` : PAY[i.billingType]!);
  }
  return parts.join(' · ');
}

/**
 * Calendário de recebimentos: em que dia cada cliente paga e quanto. Junta o que já entrou, as
 * faturas em aberto e a previsão das próximas mensalidades (fim do período de cada cliente).
 */
export function CalendarSection() {
  const [month, setMonth] = useState(() => spDate().slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const { data, error, reload } = useLoad<Calendar>(`/platform/billing/calendar?month=${month}`);
  const cal = data?.month === month ? data : null;
  const toast = useToast();
  const [marking, setMarking] = useState<CalItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Quem acabou de pagar pelo Asaas enquanto a tela estava aberta (fica destacado). */
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const seen = useRef<{ month: string; status: Map<string, CalStatus> } | null>(null);

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
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const i of cal?.items ?? []) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  }, [cal]);

  const go = (by: number) => {
    setMonth((m) => shiftMonth(m, by));
    setPicked(null);
  };

  const totalOf = (items: CalItem[]) => items.reduce((t, i) => t + toCents(i.amount), 0);
  const days = cal ? [...byDay.keys()].sort().filter((d) => !picked || d === picked) : [];

  return (
    <Section title="Calendário de recebimentos" sub="em que dia cada cliente paga e quanto">
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
        {cal && (
          <span className={`adm-cal__live${cal.live ? ' is-on' : ''}`}>
            {cal.live ? 'Baixa sozinha pelo Asaas' : 'Baixa sozinha desligada'} · conferido às{' '}
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
      {!cal && !error && <Spinner />}
      {cal && !cal.live && (
        <Alert tone="warning">
          O calendário só dá baixa sozinho quando o aviso (webhook) do Asaas está cadastrado e a
          cobrança automática ligada, em Configuração mais abaixo. Até lá, use Marcar como pago.
        </Alert>
      )}
      {cal && (
        <>
          <div className="adm-grid">
            <Tile label="Recebido" value={brl(cal.totals.paid)} level="ok" sub="já caiu na conta" />
            <Tile
              label="Fatura enviada"
              value={brl(cal.totals.pending)}
              sub="cliente já recebeu a cobrança"
            />
            <Tile
              label="Previsto"
              value={brl(cal.totals.forecast)}
              sub="próximas mensalidades, sem fatura ainda"
            />
            <Tile
              label="Vencido"
              value={brl(cal.totals.overdue)}
              level={toCents(cal.totals.overdue) ? 'bad' : 'off'}
              sub="venceu neste mês e não pagou"
            />
          </div>

          <div className="adm-cal" role="grid" aria-label={`Recebimentos de ${monthName(month)}`}>
            {WEEK.map((w) => (
              <div key={w} className="adm-cal__wd" role="columnheader">
                {w}
              </div>
            ))}
            {Array.from({ length: new Date(`${cal.from}T12:00:00`).getDay() }, (_, k) => (
              <div key={`b${k}`} className="adm-cal__blank" />
            ))}
            {Array.from({ length: Number(cal.to.slice(8)) }, (_, k) => {
              const date = `${month}-${String(k + 1).padStart(2, '0')}`;
              const items = byDay.get(date) ?? [];
              const worst: CalStatus | null = items.length
                ? (['overdue', 'pending', 'forecast', 'paid'] as const).find((s) =>
                    items.some((i) => i.status === s),
                  )!
                : null;
              const cls = [
                'adm-cal__day',
                date === cal.today && 'is-today',
                date < cal.today && 'is-past',
                date === picked && 'is-picked',
                worst && `is-${worst}`,
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  className={cls}
                  disabled={!items.length}
                  aria-pressed={date === picked}
                  aria-label={
                    items.length
                      ? `Dia ${k + 1}: ${items.length} cliente(s), ${brl(fromCents(totalOf(items)))}`
                      : `Dia ${k + 1}: nada`
                  }
                  onClick={() => setPicked((p) => (p === date ? null : date))}
                >
                  <span className="adm-cal__n">{k + 1}</span>
                  {items.length > 0 && (
                    <>
                      <span className="adm-cal__sum">{brl(fromCents(totalOf(items)))}</span>
                      <span className="adm-cal__short">{short(totalOf(items))}</span>
                      <span className="adm-cal__who">
                        {items.slice(0, 2).map((i) => (
                          <span key={`${i.tenantId}${i.invoiceId ?? ''}`}>
                            <Dot level={STATUS[i.status].level} /> {i.tenantName}
                          </span>
                        ))}
                        {items.length > 2 && <span>+{items.length - 2}</span>}
                      </span>
                      <span className="adm-cal__dots" aria-hidden>
                        {items.slice(0, 4).map((i) => (
                          <Dot
                            key={`${i.tenantId}${i.invoiceId ?? ''}`}
                            level={STATUS[i.status].level}
                          />
                        ))}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="adm-cal__legend">
            {(Object.keys(STATUS) as CalStatus[]).map((s) => (
              <span key={s}>
                <Dot level={STATUS[s].level} /> {STATUS[s].label}
              </span>
            ))}
          </p>

          <div className="adm-panel" style={{ marginTop: 12 }}>
            {picked && (
              <div className="adm-cal__filter">
                Mostrando só {dayName(picked)}.{' '}
                <button type="button" className="login__link" onClick={() => setPicked(null)}>
                  Ver o mês inteiro
                </button>
              </div>
            )}
            {days.map((d) => {
              const items = byDay.get(d)!;
              return (
                <div key={d}>
                  <div className="adm-cal__head">
                    <span>{dayName(d)}</span>
                    <span>{brl(fromCents(totalOf(items)))}</span>
                  </div>
                  <div className="adm-rows">
                    {items.map((i) => (
                      <div
                        key={`${i.tenantId}${i.invoiceId ?? d}`}
                        className={`adm-row adm-cal__row${
                          i.invoiceId && fresh.has(i.invoiceId) ? ' is-fresh' : ''
                        }`}
                      >
                        <Dot level={STATUS[i.status].level} />
                        <Link to={`/restaurantes/${i.tenantId}`} className="adm-row__main">
                          <span className="adm-row__title">{i.tenantName}</span>
                          <span className="adm-row__meta">
                            {i.invoiceId && fresh.has(i.invoiceId) ? 'Acabou de pagar · ' : ''}
                            {detail(i)}
                          </span>
                        </Link>
                        <span className="adm-row__side">{brl(i.amount)}</span>
                        {i.status !== 'paid' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Check size={14} />}
                            onClick={() => setMarking(i)}
                          >
                            Marcar como pago
                          </Button>
                        ) : i.status === 'paid' && i.billingType === 'MANUAL' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Undo2 size={14} />}
                            loading={busy === `u${i.invoiceId}`}
                            onClick={() => undo(i)}
                          >
                            Desfazer
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {days.length === 0 && <div className="adm-empty">Nenhum recebimento neste mês.</div>}
          </div>
          <p className="adm-sub" style={{ whiteSpace: 'normal', marginTop: 8 }}>
            Como a previsão é feita: a mensalidade vence no último dia liberado do cliente (fim do
            teste ou do período pago) e cada pagamento libera mais 30 dias, então o próximo
            vencimento é 30 dias depois. Valores brutos, antes da taxa do Asaas. Recebido aparece no
            dia em que o pagamento caiu; clientes suspensos e planos grátis ficam de fora. Quando o
            cliente paga pelo app (Pix, boleto ou cartão do Asaas), a baixa é sozinha e esta tela
            atualiza em alguns segundos. Recebeu por fora? Use Marcar como pago.
          </p>
        </>
      )}
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
