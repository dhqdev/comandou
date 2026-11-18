import { financeMonthName, toCents, type FinanceMonth } from '@comandou/shared';
import { ChevronRight, LineChart } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, EmptyState, Segmented, Spinner } from '../../design-system';
import { fmtDate } from '../../features/forms';
import { api } from '../../lib/api';
import type { CashFlowDay, FinanceEntry, FinanceSummary } from '../../lib/types';
import {
  avgDailySales,
  cumulative,
  Delta,
  FlowChart,
  flowPoints,
  HBars,
  KpiStrip,
  Legend,
  type HBar,
} from './charts';
import {
  buildInsights,
  change,
  methodTotals,
  money,
  pctText,
  periodProgress,
  weekdayAverages,
  weekdayName,
  type Insight,
} from './insights';
import type { ClosingDay, DreResponse } from './types';

export type FinanceTabId = 'overview' | 'entries' | 'closings' | 'reconcile' | 'flow' | 'dre';

interface Data {
  summary: FinanceSummary;
  prevSummary: FinanceSummary | null;
  flow: CashFlowDay[];
  prevFlow: CashFlowDay[] | null;
  closings: ClosingDay[];
  dre: DreResponse | null;
  entries: FinanceEntry[];
}

/** Grupos de despesa do DRE, na ordem em que o dono pensa neles. */
const EXPENSES: [string, string][] = [
  ['cmv', 'Insumos (CMV)'],
  ['payroll', 'Pessoal'],
  ['occupancy', 'Ocupação'],
  ['card_fees', 'Taxas das maquininhas'],
  ['selling', 'Aplicativos e marketing'],
  ['utilities', 'Energia, água, gás e internet'],
  ['taxes', 'Impostos'],
  ['admin', 'Administrativas'],
  ['financial', 'Tarifas e juros'],
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * Visão geral do mês financeiro: os números que importam com a comparação do mês anterior, o saldo
 * acumulado com a previsão até o fim do mês, as leituras automáticas e para onde vai o dinheiro.
 */
export function OverviewTab({
  period,
  previous,
  today,
  onTab,
}: {
  period: FinanceMonth | null;
  previous: FinanceMonth | null;
  today: string;
  onTab(tab: FinanceTabId): void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'balance' | 'daily'>('balance');
  const [compare, setCompare] = useState(true);
  const [allInsights, setAllInsights] = useState(false);

  useEffect(() => {
    if (!period) return;
    let alive = true;
    const range = (p: FinanceMonth) => `from=${p.from}&to=${p.to}`;
    const dreQs = new URLSearchParams({ from: period.from, to: period.to, basis: 'accrual' });
    if (previous) {
      dreQs.set('prevFrom', previous.from);
      dreQs.set('prevTo', previous.to);
    }
    setData(null);
    Promise.all([
      api<FinanceSummary>(`/finance/summary?${range(period)}`),
      previous
        ? api<FinanceSummary>(`/finance/summary?${range(previous)}`).catch(() => null)
        : null,
      api<{ days: CashFlowDay[] }>(`/finance/cash-flow?${range(period)}`),
      previous
        ? api<{ days: CashFlowDay[] }>(`/finance/cash-flow?${range(previous)}`).catch(() => null)
        : null,
      api<{ days: ClosingDay[] }>(`/finance/closings?${range(period)}`).catch(() => ({
        days: [] as ClosingDay[],
      })),
      api<DreResponse>(`/finance/dre?${dreQs}`).catch(() => null),
      api<FinanceEntry[]>('/finance/entries').catch(() => [] as FinanceEntry[]),
    ])
      .then(([summary, prevSummary, flow, prevFlow, closings, dre, entries]) => {
        if (!alive) return;
        setData({
          summary,
          prevSummary,
          flow: flow.days,
          prevFlow: prevFlow?.days ?? null,
          closings: closings.days,
          dre,
          entries,
        });
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [period, previous]);

  const prevName = previous ? financeMonthName(previous).split(' de ')[0]! : 'o mês anterior';
  const vs = `vs ${prevName}`;

  const view = useMemo(() => {
    if (!data || !period) return null;
    const m = data.summary.month;
    const pm = data.prevSummary?.month;
    const inflow = toCents(m.sales) + toCents(m.received);
    const outflow = toCents(m.paid) + toCents(m.fees) + toCents(m.refunds);
    const prog = periodProgress(period, today);
    // Mês correndo: compara com os mesmos dias do mês anterior (dia 1 ao dia de hoje), não com o
    // mês anterior inteiro, senão todo começo de mês parece queda.
    const prevSame = data.prevFlow && prog.running ? data.prevFlow.slice(0, prog.elapsed) : null;
    const sumPrev = (f: (d: CashFlowDay) => number) =>
      prevSame ? prevSame.reduce((s, d) => s + f(d), 0) : null;
    const pIn =
      sumPrev((d) => toCents(d.sales) + toCents(d.received)) ??
      (pm ? toCents(pm.sales) + toCents(pm.received) : 0);
    const pOut =
      sumPrev((d) => toCents(d.paid) + toCents(d.fees) + toCents(d.refunds)) ??
      (pm ? toCents(pm.paid) + toCents(pm.fees) + toCents(pm.refunds) : 0);
    const pNet = sumPrev((d) => toCents(d.net)) ?? (pm ? toCents(pm.net) : 0);
    const pts = flowPoints(data.flow, today);
    const perDay = avgDailySales(data.flow, today);
    const cum = cumulative(pts, perDay);
    const insights = buildInsights({
      period,
      previousName: prevName,
      today,
      summary: data.summary,
      prevSummary: data.prevSummary,
      flow: data.flow,
      closings: data.closings,
      dre: data.dre?.dre ?? null,
      prevDre: data.dre?.previous.dre ?? null,
    });
    const dre = data.dre?.dre;
    const prevDre = data.dre?.previous.dre;
    const line = (d: typeof dre, id: string) =>
      toCents(d?.lines.find((l) => l.id === id)?.value ?? '0');
    const netRev = toCents(dre?.totals.netRevenue ?? '0');
    const expenses: HBar[] = EXPENSES.map(([id, label]) => {
      const cur = -line(dre, id);
      const before = -line(prevDre, id);
      const d = change(cur, before);
      return {
        key: id,
        label,
        value: cur,
        sub: (
          <>
            {netRev > 0 && `${pctText((cur / netRev) * 100)} da receita`}
            {d !== null && cur !== before && !prog.running && (
              <>
                {netRev > 0 && ' · '}
                <Delta value={d} against={vs} invert />
              </>
            )}
          </>
        ),
      };
    })
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((e, i) => ({ ...e, strong: i === 0 }));
    const methods = methodTotals(data.closings);
    const grossAll = methods.reduce((s, x) => s + x.gross, 0);
    const methodBars: HBar[] = methods.map((x, i) => ({
      key: x.method,
      strong: i === 0,
      label: x.name,
      value: x.gross,
      sub: `${pctText((x.gross / grossAll) * 100)} das vendas${x.fee > 0 ? ` · taxa ${pctText(x.feePct, 2)} (${money(x.fee)})` : ''}`,
    }));
    const avgs = weekdayAverages(data.closings);
    const bestDow = avgs.reduce((a, b) => (b.avg > a.avg ? b : a));
    const weekBars: HBar[] = WEEK.map((dow) => avgs[dow]!)
      .filter((w) => w.days > 0)
      .map((w) => ({
        key: String(w.dow),
        label: weekdayName(w.dow),
        value: w.avg,
        strong: w.dow === bestDow.dow,
        sub: `média de ${w.days} ${w.days === 1 ? 'dia' : 'dias'}`,
      }));
    const upcoming = data.entries
      .filter((e) => e.status === 'open')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6);
    const netProfit = toCents(dre?.totals.netProfit ?? '0');
    const prevProfit = toCents(prevDre?.totals.netProfit ?? '0');
    const margin = dre?.indicators.find((i) => i.id === 'margin');
    const realLast = cum.real.reduce<number | null>((a, v) => (v !== null ? v : a), null);
    return {
      inflow,
      outflow,
      pIn,
      pOut,
      net: toCents(m.net),
      pNet,
      hasPrev: Boolean(pm),
      sameDays: Boolean(prevSame),
      pts,
      perDay,
      cum,
      prog,
      insights,
      expenses,
      methodBars,
      weekBars,
      upcoming,
      netProfit,
      prevProfit,
      margin,
      hasDre: Boolean(dre && netRev > 0),
      realLast,
      empty: inflow === 0 && outflow === 0 && upcoming.length === 0,
    };
  }, [data, period, today, prevName, vs]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!view || !data) return <Spinner />;

  if (view.empty)
    return (
      <Card>
        <EmptyState
          icon={<LineChart size={20} />}
          title="Ainda sem movimento neste mês"
          description="Feche um caixa ou lance uma conta e os gráficos e as leituras do mês aparecem aqui."
          action={
            <Button variant="secondary" onClick={() => onTab('entries')}>
              Lançar uma conta
            </Button>
          }
        />
      </Card>
    );

  // Mês correndo: a comparação é com os mesmos dias do mês anterior.
  const vsKpi = view.sameDays ? `vs mesmos dias de ${prevName}` : vs;
  const daily = (k: 'inflow' | 'outflow') => view.pts.filter((p) => !p.future).map((p) => p[k]);
  const runSpark = view.cum.real.filter((v): v is number => v !== null);
  const shown = allInsights ? view.insights : view.insights.slice(0, 4);

  return (
    <div className="fin-ov">
      <KpiStrip
        items={[
          {
            key: 'net',
            label: 'Saldo do mês',
            value: money(view.net),
            danger: view.net < 0,
            sub: view.hasPrev && <Delta value={change(view.net, view.pNet)} against={vsKpi} />,
            spark: runSpark,
          },
          {
            key: 'in',
            label: 'Entradas',
            value: money(view.inflow),
            sub: view.hasPrev && <Delta value={change(view.inflow, view.pIn)} against={vsKpi} />,
            spark: daily('inflow'),
          },
          {
            key: 'out',
            label: 'Saídas',
            value: money(view.outflow),
            sub: view.hasPrev && (
              <Delta value={change(view.outflow, view.pOut)} against={vsKpi} invert />
            ),
            spark: daily('outflow'),
          },
          {
            key: 'profit',
            label: 'Lucro líquido',
            value: view.hasDre ? money(view.netProfit) : '—',
            danger: view.hasDre && view.netProfit < 0,
            sub: view.hasDre ? (
              <>
                {view.margin?.value != null && (
                  <span className="fin-kpi__note">
                    margem {pctText(view.margin.value as number)}
                  </span>
                )}
                {/* Lucro do mês correndo contra o mês fechado não diz nada: só no mês que acabou. */}
                {view.prevProfit !== 0 && !view.prog.running && (
                  <Delta value={change(view.netProfit, view.prevProfit)} against={vs} />
                )}
              </>
            ) : (
              'sem vendas no DRE'
            ),
          },
        ]}
      />

      <div className="fin-ov__main">
        <Card
          title={view.prog.running ? 'Saldo do mês e previsão' : 'Saldo do mês'}
          actions={
            <Segmented
              label="Ver o gráfico como"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'balance', label: 'Acumulado' },
                { value: 'daily', label: 'Por dia' },
              ]}
            />
          }
        >
          <div className="fin-chart-head">
            {mode === 'balance' ? (
              <>
                <div className="fin-chart-head__figure">
                  {view.prog.running ? (
                    <>
                      <span className="cm-hint">Previsão para {fmtDate(period!.to)}</span>
                      <strong data-neg={view.cum.end < 0 || undefined}>
                        {money(view.cum.end)}
                      </strong>
                      <span className="cm-hint">
                        hoje {money(view.realLast ?? 0)} · vendas médias de {money(view.perDay)} por
                        dia + contas a vencer
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cm-hint">Saldo no fim do período</span>
                      <strong data-neg={(view.realLast ?? 0) < 0 || undefined}>
                        {money(view.realLast ?? 0)}
                      </strong>
                    </>
                  )}
                </div>
                <div className="fin-chart-head__side">
                  <Legend
                    items={[
                      { swatch: 'cur', label: 'Realizado' },
                      ...(view.prog.running ? [{ swatch: 'proj', label: 'Previsão' }] : []),
                      ...(compare && data.prevFlow ? [{ swatch: 'prev', label: prevName }] : []),
                    ]}
                  />
                  {data.prevFlow && (
                    <label className="fin-check">
                      <input
                        type="checkbox"
                        checked={compare}
                        onChange={(e) => setCompare(e.target.checked)}
                      />
                      Comparar com {prevName}
                    </label>
                  )}
                </div>
              </>
            ) : (
              <Legend
                items={[
                  { swatch: 'in', label: 'Entrou' },
                  { swatch: 'out', label: 'Saiu' },
                  ...(view.prog.running ? [{ swatch: 'in-soft', label: 'Previsto' }] : []),
                ]}
              />
            )}
          </div>
          <FlowChart
            days={data.flow}
            prev={compare ? data.prevFlow : null}
            today={today}
            mode={mode}
            salesPerDay={view.perDay}
          />
        </Card>

        <Card title="Leituras do mês">
          {view.insights.length === 0 ? (
            <p className="cm-hint">Nada fora do normal neste mês. Tudo em dia.</p>
          ) : (
            <ul className="fin-insights">
              {shown.map((i) => (
                <InsightRow key={i.id} insight={i} onTab={onTab} />
              ))}
            </ul>
          )}
          {view.insights.length > 4 && (
            <Button variant="ghost" size="sm" onClick={() => setAllInsights((v) => !v)}>
              {allInsights ? 'Mostrar menos' : `Ver mais ${view.insights.length - 4}`}
            </Button>
          )}
        </Card>
      </div>

      <div className="fin-ov__grid">
        <Card
          title="Para onde vai o dinheiro"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('dre')}>
              Ver DRE
            </Button>
          }
        >
          {view.expenses.length ? (
            <HBars rows={view.expenses} label="Despesas do mês por grupo" />
          ) : (
            <p className="cm-hint">
              Sem despesas lançadas no mês. Lance as contas com categoria para ver aqui.
            </p>
          )}
        </Card>
        <Card
          title="Como os clientes pagam"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('closings')}>
              Ver fechamentos
            </Button>
          }
        >
          {view.methodBars.length ? (
            <HBars rows={view.methodBars} label="Vendas por forma de pagamento" />
          ) : (
            <p className="cm-hint">Nenhum caixa fechado no mês.</p>
          )}
        </Card>
        <Card title="Vendas por dia da semana">
          {view.weekBars.length ? (
            <HBars rows={view.weekBars} label="Média de vendas por dia da semana" />
          ) : (
            <p className="cm-hint">Nenhum caixa fechado no mês.</p>
          )}
        </Card>
        <Card
          title="Próximos vencimentos"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('entries')}>
              Ver contas
            </Button>
          }
        >
          {view.upcoming.length ? (
            <ul className="fin-due">
              {view.upcoming.map((e) => (
                <li key={e.id}>
                  <span className="fin-due__date" data-late={e.overdue || undefined}>
                    {fmtDate(e.dueDate).slice(0, 5)}
                    {e.overdue && <em>vencida</em>}
                  </span>
                  <span className="fin-due__main">
                    <strong>{e.description}</strong>
                    <span className="cm-hint">
                      {[e.kind === 'payable' ? 'A pagar' : 'A receber', e.counterparty]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className={e.kind === 'payable' ? 'fin-due__amt' : 'fin-due__amt fin-pos'}>
                    {e.kind === 'payable' ? '−' : '+'}
                    {money(toCents(e.amount))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cm-hint">Nenhuma conta em aberto.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function InsightRow({ insight: i, onTab }: { insight: Insight; onTab(t: FinanceTabId): void }) {
  const body = (
    <>
      <span className="fin-dot" data-status={toneStatus(i.tone)} aria-hidden />
      <span className="fin-insights__text">
        <strong>{i.title}</strong>
        <span className="cm-hint">{i.text}</span>
      </span>
      {i.tab && <ChevronRight size={16} className="fin-insights__go" aria-hidden />}
    </>
  );
  return (
    <li>
      {i.tab ? (
        <button type="button" className="fin-insights__row" onClick={() => onTab(i.tab!)}>
          {body}
        </button>
      ) : (
        <div className="fin-insights__row">{body}</div>
      )}
    </li>
  );
}

const toneStatus = (t: Insight['tone']) =>
  t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : t === 'good' ? 'good' : 'info';
