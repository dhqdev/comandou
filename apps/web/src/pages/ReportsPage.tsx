import { formatBRL, toCents } from '@comandou/shared';
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DateInput, EmptyState, Segmented, Spinner } from '../design-system';
import { CHANNEL_LABELS, PAYMENT_METHOD_LABELS, qty } from '../features/format';
import { Link, useSearchParams } from 'react-router';
import { useCan } from '../app/auth';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { OrderChannel, PaymentMethod } from '@comandou/shared';
import { InsightsView } from './ReportsInsights';
import { ReportCatalog, ReportDocView } from './ReportDocView';
import './reports.css';

interface ProductLine {
  productId: string;
  name: string;
  quantity: string;
  revenue: string;
  cost: string;
  hasRecipe: boolean;
}

interface Sales {
  totals: {
    orders: number;
    cancelled: number;
    revenue: string;
    discounts: string;
    surcharges: string;
    deliveryFees: string;
    receivable: string;
    averageTicket: string;
    cost: string;
  };
  byChannel: { channel: OrderChannel; orders: number; revenue: string }[];
  received: { method: PaymentMethod; received: string; refunded: string; net: string }[];
  topProducts: ProductLine[];
}

/** Resumo do mês dos repasses aos entregadores (Entregas › Repasses). */
interface CourierMonth {
  delivered: number;
  costEstimate: string;
  pendingNet: string;
}

interface Calendar {
  month: string;
  today: string;
  days: {
    day: string;
    orders: number;
    cancelled: number;
    revenue: string;
    deliveryFees: string;
    cost: string;
  }[];
  reservations: { day: string; count: number; people: number }[];
  topProducts: ProductLine[];
  coverage: { items: string; withoutRecipe: string };
  byHour: { hour: number; orders: number; revenue: string }[];
  byChannel: { channel: OrderChannel; orders: number; revenue: string }[];
  expenses: { paid: string; count: number };
  previous: { orders: number; revenue: string };
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const compact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const money = (cents: number) => formatBRL(cents);
const short = (cents: number) =>
  Math.abs(cents) < 100_000
    ? formatBRL(Math.round(cents / 100) * 100).replace(/,00$/, '')
    : compact.format(cents / 100);
const pct = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '–';
/** Lucro bruto = faturamento − taxas de entrega − custo dos insumos. */
const profitOf = (d: { revenue: string; deliveryFees: string; cost: string }) =>
  toCents(d.revenue) - toCents(d.deliveryFees) - toCents(d.cost);

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftMonth = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  // Atalhos da busca (?foco=secao-...) apontam para seções do detalhe do dia.
  const [view, setView] = useState<'reports' | 'insights' | 'calendar' | 'day'>(() =>
    new URLSearchParams(window.location.search).has('foco') ? 'day' : 'reports',
  );
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
  // Relatório aberto fica no endereço (?relatorio=…): o "voltar" do navegador volta à lista.
  const open = view === 'reports' ? params.get('relatorio') : null;
  const openReport = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('relatorio', id);
    else next.delete('relatorio');
    setParams(next, { replace: !id });
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-sub">
            {view === 'reports'
              ? 'Escolha um relatório: cada um tem o seu painel e baixa em Excel.'
              : view === 'insights'
                ? 'O que mudou, o que vende, o que dá lucro e onde agir.'
                : view === 'calendar'
                  ? 'O mês dia a dia: quanto vendeu, quanto custou e quanto sobrou.'
                  : 'Faturamento (pedidos do dia) separado de recebimentos (caixa).'}
          </p>
        </div>
        <Segmented
          label="Visão"
          value={view}
          onChange={(v) => {
            setView(v);
            if (v !== 'reports' && open) openReport(null);
          }}
          options={[
            { value: 'reports', label: 'Relatórios' },
            { value: 'insights', label: 'Análise' },
            { value: 'calendar', label: 'Calendário' },
            { value: 'day', label: 'Dia' },
          ]}
        />
      </div>
      {view === 'reports' ? (
        open ? (
          <ReportDocView key={open} id={open} onBack={() => openReport(null)} />
        ) : (
          <ReportCatalog onOpen={openReport} />
        )
      ) : view === 'insights' ? (
        <InsightsView />
      ) : view === 'calendar' ? (
        <CalendarView
          month={month}
          onMonth={setMonth}
          onPickDay={(d) => {
            setDay(d);
            setView('day');
          }}
        />
      ) : (
        <DayView
          day={day}
          onDay={(d) => {
            setDay(d);
            setMonth(d.slice(0, 7));
          }}
        />
      )}
    </>
  );
}

function CalendarView({
  month,
  onMonth,
  onPickDay,
}: {
  month: string;
  onMonth(m: string): void;
  onPickDay(d: string): void;
}) {
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPay = useCan('finance:read');
  const [couriers, setCouriers] = useState<CourierMonth | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setCouriers(null);
    api<Calendar>(`/reports/calendar?month=${month}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError((e as Error).message));
    if (canPay)
      api<{ totals: CourierMonth }>(`/courier-pay/report?month=${month}`)
        .then((r) => alive && setCouriers(r.totals))
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [month, canPay]);

  const sum = useMemo(() => {
    if (!data) return null;
    const revenue = data.days.reduce((n, d) => n + toCents(d.revenue), 0);
    const fees = data.days.reduce((n, d) => n + toCents(d.deliveryFees), 0);
    const cost = data.days.reduce((n, d) => n + toCents(d.cost), 0);
    const orders = data.days.reduce((n, d) => n + d.orders, 0);
    const cancelled = data.days.reduce((n, d) => n + d.cancelled, 0);
    const profit = revenue - fees - cost;
    const expenses = toCents(data.expenses.paid);
    const best = [...data.days].sort((a, b) => toCents(b.revenue) - toCents(a.revenue))[0];
    const prev = toCents(data.previous.revenue);
    return {
      revenue,
      cost,
      orders,
      cancelled,
      profit,
      expenses,
      result: profit - expenses,
      ticket: orders ? Math.round(revenue / orders) : 0,
      best,
      growth: prev ? ((revenue - prev) / prev) * 100 : null,
      uncovered: toCents(data.coverage.withoutRecipe),
      items: toCents(data.coverage.items),
    };
  }, [data]);

  return (
    <div className="rp">
      <div className="rp-monthbar">
        <Button
          variant="ghost"
          aria-label="Mês anterior"
          icon={<ChevronLeft size={18} />}
          onClick={() => onMonth(shiftMonth(month, -1))}
        />
        <h2 className="rp-month">{monthLabel(month)}</h2>
        <Button
          variant="ghost"
          aria-label="Próximo mês"
          icon={<ChevronRight size={18} />}
          onClick={() => onMonth(shiftMonth(month, 1))}
        />
        {month !== isoDay(new Date()).slice(0, 7) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onMonth(isoDay(new Date()).slice(0, 7))}
          >
            Este mês
          </Button>
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !sum ? (
        !error && <Spinner />
      ) : (
        <>
          <div className="rp-kpis">
            <Kpi
              label="Faturamento"
              value={money(sum.revenue)}
              hint={
                sum.growth === null
                  ? `${sum.orders} pedidos`
                  : `${sum.growth >= 0 ? '+' : '−'}${Math.abs(sum.growth).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior`
              }
              tone={sum.growth === null ? undefined : sum.growth >= 0 ? 'up' : 'down'}
              main
            />
            <Kpi
              label="Lucro bruto"
              value={money(sum.profit)}
              hint={`Margem ${pct(sum.profit, sum.revenue)}`}
              tone={sum.profit >= 0 ? 'up' : 'down'}
            />
            <Kpi
              label="Custo dos insumos"
              value={money(sum.cost)}
              hint={`${pct(sum.cost, sum.revenue)} do faturamento (CMV)`}
            />
            <Kpi
              label="Despesas pagas"
              value={money(sum.expenses)}
              hint={`${data.expenses.count} contas no Financeiro`}
            />
            <Kpi
              label="Resultado do mês"
              value={money(sum.result)}
              hint="Lucro bruto − despesas pagas"
              tone={sum.result >= 0 ? 'up' : 'down'}
            />
            <Kpi
              label="Ticket médio"
              value={money(sum.ticket)}
              hint={`${sum.orders} pedidos · ${sum.cancelled} cancelados`}
            />
            {couriers && (
              <Link className="rp-kpi-link" to="/entregas?aba=repasses">
                <Kpi
                  label="Entregadores"
                  value={money(toCents(couriers.costEstimate))}
                  hint={`${couriers.delivered} entregas · a pagar ${brl(couriers.pendingNet)}`}
                />
              </Link>
            )}
          </div>

          {sum.uncovered > 0 && (
            <div className="rp-warn">
              <AlertTriangle size={18} aria-hidden />
              <span>
                {pct(sum.uncovered, sum.items)} das vendas são de produtos{' '}
                <strong>sem ficha técnica</strong>: o custo deles conta como zero e o lucro aparece
                maior que o real. Cadastre a ficha no Estoque para um lucro exato.
              </span>
            </div>
          )}

          <MonthGrid data={data} onPick={onPickDay} />

          <div className="two-cols">
            <Card title="Mais vendidos do mês" bodyless>
              <ProductsTable rows={data.topProducts} />
            </Card>
            <div className="rp-side">
              <Card title="Por dia da semana">
                <WeekdayBars data={data} />
              </Card>
              <Card title="Horários de pico">
                <HourBars rows={data.byHour} />
              </Card>
              <Card title="Por canal" bodyless>
                <ChannelTable rows={data.byChannel} />
              </Card>
            </div>
          </div>
          {sum.best && (
            <p className="cm-hint rp-foot">
              Melhor dia:{' '}
              <strong>
                {new Date(`${sum.best.day}T12:00:00`).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </strong>{' '}
              com {brl(sum.best.revenue)}. Lucro bruto = faturamento − taxas de entrega − custo dos
              insumos pela ficha técnica (custo médio atual do estoque).
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  main,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down';
  main?: boolean;
}) {
  return (
    <div className="cm-card rp-kpi" data-main={main || undefined}>
      <span className="rp-kpi__label">{label}</span>
      <strong className="rp-kpi__value">{value}</strong>
      {hint && (
        <span className="rp-kpi__hint" data-tone={tone}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** Grade do mês: cada dia com faturamento, lucro e pedidos; cor mais forte = vendeu mais. */
function MonthGrid({ data, onPick }: { data: Calendar; onPick(d: string): void }) {
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const res = new Map(data.reservations.map((r) => [r.day, r]));
  const max = Math.max(1, ...data.days.map((d) => toCents(d.revenue)));
  const y = Number(data.month.slice(0, 4));
  const m = Number(data.month.slice(5, 7)) - 1;
  const first = new Date(y, m, 1).getDay();
  const count = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: count }, (_, i) => `${data.month}-${String(i + 1).padStart(2, '0')}`),
  ];
  return (
    <div className="cm-card rp-cal">
      <div className="rp-cal__head" aria-hidden>
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="rp-cal__grid">
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} className="rp-day rp-day--blank" />;
          const s = byDay.get(d);
          const r = res.get(d);
          const rev = s ? toCents(s.revenue) : 0;
          const profit = s ? profitOf(s) : 0;
          const future = d > data.today;
          return (
            <button
              key={d}
              type="button"
              className="rp-day"
              data-today={d === data.today || undefined}
              data-future={future || undefined}
              data-empty={!s || undefined}
              style={{ '--heat': `${Math.round((rev / max) * 100)}%` } as CSSProperties}
              onClick={() => onPick(d)}
              aria-label={`Dia ${Number(d.slice(8))}: ${s ? brl(s.revenue) : 'sem vendas'}`}
            >
              <span className="rp-day__n">{Number(d.slice(8))}</span>
              {r && (
                <span className="rp-day__res" title={`${r.count} reservas, ${r.people} pessoas`}>
                  <CalendarCheck size={11} aria-hidden /> {r.count}
                </span>
              )}
              {s && s.orders > 0 && (
                <>
                  <span className="rp-day__rev">{short(rev)}</span>
                  <span className="rp-day__profit" data-neg={profit < 0 || undefined}>
                    {profit >= 0 ? '+' : ''}
                    {short(profit)}
                  </span>
                  <span className="rp-day__orders">{s.orders} ped.</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="rp-cal__legend">
        <span>
          <i className="rp-dot rp-dot--rev" /> faturamento
        </span>
        <span>
          <i className="rp-dot rp-dot--profit" /> lucro bruto
        </span>
        <span>
          <CalendarCheck size={12} aria-hidden /> reservas
        </span>
        <span>Toque num dia para ver o detalhe</span>
      </div>
    </div>
  );
}

function ProductsTable({ rows }: { rows: ProductLine[] }) {
  if (!rows.length) return <EmptyState title="Sem vendas" />;
  return (
    <div className="rp-scroll">
      <table className="cm-table rp-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="cm-num">Qtd.</th>
            <th className="cm-num">Vendas</th>
            <th className="cm-num">Custo</th>
            <th className="cm-num">Lucro</th>
            <th className="cm-num">Margem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const rev = toCents(p.revenue);
            const cost = toCents(p.cost);
            const margin = rev ? ((rev - cost) / rev) * 100 : 0;
            return (
              <tr key={p.productId + p.name}>
                <td>
                  {p.name}
                  {!p.hasRecipe && <span className="rp-tag">sem ficha</span>}
                </td>
                <td className="cm-num">{qty(p.quantity)}</td>
                <td className="cm-num">{brl(p.revenue)}</td>
                <td className="cm-num rp-muted">{p.hasRecipe ? brl(p.cost) : '–'}</td>
                <td className="cm-num">
                  <strong>{p.hasRecipe ? money(rev - cost) : '–'}</strong>
                </td>
                <td className="cm-num">
                  {p.hasRecipe ? (
                    <span
                      className="rp-margin"
                      data-level={margin >= 60 ? 'good' : margin >= 35 ? 'ok' : 'low'}
                    >
                      {margin.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekdayBars({ data }: { data: Calendar }) {
  // Média por dia da semana, só dos dias que já passaram (inclui os dias sem venda).
  const avg = WEEKDAYS.map((_, wd) => {
    const y = Number(data.month.slice(0, 4));
    const m = Number(data.month.slice(5, 7)) - 1;
    const count = new Date(y, m + 1, 0).getDate();
    let n = 0;
    let total = 0;
    for (let i = 1; i <= count; i++) {
      const d = `${data.month}-${String(i).padStart(2, '0')}`;
      if (d > data.today || new Date(y, m, i).getDay() !== wd) continue;
      n++;
      const s = data.days.find((x) => x.day === d);
      total += s ? toCents(s.revenue) : 0;
    }
    return n ? Math.round(total / n) : 0;
  });
  const max = Math.max(1, ...avg);
  if (avg.every((v) => v === 0)) return <p className="cm-hint">Sem vendas no período.</p>;
  return (
    <div className="rp-bars">
      {avg.map((v, i) => (
        <div key={i} className="rp-bar" data-top={v === max || undefined}>
          <span className="rp-bar__label">{WEEKDAYS[i]}</span>
          <span className="rp-bar__track">
            <span className="rp-bar__fill" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="rp-bar__value">{short(v)}</span>
        </div>
      ))}
      <p className="cm-hint">Faturamento médio por dia.</p>
    </div>
  );
}

function HourBars({ rows }: { rows: Calendar['byHour'] }) {
  if (!rows.length) return <p className="cm-hint">Sem pedidos no período.</p>;
  const from = Math.min(...rows.map((r) => r.hour));
  const to = Math.max(...rows.map((r) => r.hour));
  const max = Math.max(1, ...rows.map((r) => r.orders));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="rp-hours">
      <div className="rp-hours__cols">
        {hours.map((h) => {
          const r = rows.find((x) => x.hour === h);
          const v = r?.orders ?? 0;
          return (
            <span
              key={h}
              className="rp-hours__col"
              data-top={v === max || undefined}
              title={`${h}h: ${v} pedidos${r ? ` · ${brl(r.revenue)}` : ''}`}
            >
              <span style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
              <small>{h}h</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChannelTable({
  rows,
}: {
  rows: { channel: OrderChannel; orders: number; revenue: string }[];
}) {
  if (!rows.length) return <EmptyState title="Sem vendas" />;
  const total = rows.reduce((n, c) => n + toCents(c.revenue), 0);
  return (
    <table className="cm-table">
      <tbody>
        {rows.map((c) => (
          <tr key={c.channel}>
            <td>{CHANNEL_LABELS[c.channel]}</td>
            <td className="cm-num">{c.orders} pedidos</td>
            <td className="cm-num rp-muted">{pct(toCents(c.revenue), total)}</td>
            <td className="cm-num">
              <strong>{brl(c.revenue)}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayView({ day, onDay }: { day: string; onDay(d: string): void }) {
  const [data, setData] = useState<Sales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    try {
      setData(
        await api<Sales>(
          `/reports/sales?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day]);
  useEffect(() => {
    void load();
  }, [load]);
  const shift = (n: number) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + n);
    onDay(isoDay(d));
  };
  const t = data?.totals;
  const profit = t ? profitOf(t) : 0;

  return (
    <div className="rp">
      <div className="rp-monthbar">
        <Button
          variant="ghost"
          aria-label="Dia anterior"
          icon={<ChevronLeft size={18} />}
          onClick={() => shift(-1)}
        />
        <h2 className="rp-month">
          {new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
          })}
        </h2>
        <Button
          variant="ghost"
          aria-label="Próximo dia"
          icon={<ChevronRight size={18} />}
          onClick={() => shift(1)}
        />
        <label className="rp-datepick">
          <span className="cm-sr-only">Dia</span>
          <DateInput value={day} onChange={(e) => e.target.value && onDay(e.target.value)} />
        </label>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !t ? (
        <Spinner />
      ) : (
        <>
          <div className="rp-kpis">
            <Kpi
              label="Faturamento"
              value={brl(t.revenue)}
              hint={`${t.orders} pedidos · ${t.cancelled} cancelados`}
              main
            />
            <Kpi
              label="Lucro bruto"
              value={money(profit)}
              hint={`Margem ${pct(profit, toCents(t.revenue))}`}
              tone={profit >= 0 ? 'up' : 'down'}
            />
            <Kpi label="Custo dos insumos" value={brl(t.cost)} hint="Pela ficha técnica" />
            <Kpi label="Ticket médio" value={brl(t.averageTicket)} />
            <Kpi
              label="Descontos"
              value={brl(t.discounts)}
              hint={`Taxas de entrega ${brl(t.deliveryFees)}`}
            />
            <Kpi label="A receber" value={brl(t.receivable)} />
          </div>
          <div className="two-cols">
            <Card searchId="secao-recebimentos" title="Recebimentos por forma" bodyless>
              {data.received.length === 0 ? (
                <EmptyState title="Nenhum recebimento" />
              ) : (
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Forma</th>
                      <th className="cm-num">Recebido</th>
                      <th className="cm-num">Estornos</th>
                      <th className="cm-num">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.received.map((r) => (
                      <tr key={r.method}>
                        <td>{PAYMENT_METHOD_LABELS[r.method]}</td>
                        <td className="cm-num">{brl(r.received)}</td>
                        <td className="cm-num">{brl(r.refunded)}</td>
                        <td className="cm-num">
                          <strong>{brl(r.net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card searchId="secao-canais" title="Por canal" bodyless>
              <ChannelTable rows={data.byChannel} />
            </Card>
          </div>
          <Card searchId="secao-mais-vendidos" title="Mais vendidos" bodyless>
            <ProductsTable rows={data.topProducts} />
          </Card>
        </>
      )}
    </div>
  );
}
