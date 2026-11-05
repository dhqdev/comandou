import {
  fromCents,
  INVOICE_KIND_LABELS,
  spDate,
  toCents,
  type InvoiceKind,
} from '@comandou/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Spinner } from '../design-system';
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
  const { data, error } = useLoad<Calendar>(`/platform/billing/calendar?month=${month}`);
  const cal = data?.month === month ? data : null;

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
  const days = cal ? [...byDay.keys()].filter((d) => !picked || d === picked) : [];

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
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!cal && !error && <Spinner />}
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
                      <Link
                        key={`${i.tenantId}${i.invoiceId ?? d}`}
                        to={`/restaurantes/${i.tenantId}`}
                        className="adm-row"
                      >
                        <Dot level={STATUS[i.status].level} />
                        <span className="adm-row__main">
                          <span className="adm-row__title">{i.tenantName}</span>
                          <span className="adm-row__meta">{detail(i)}</span>
                        </span>
                        <span className="adm-row__side">{brl(i.amount)}</span>
                      </Link>
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
            dia em que o pagamento caiu; clientes suspensos e planos grátis ficam de fora.
          </p>
        </>
      )}
    </Section>
  );
}
