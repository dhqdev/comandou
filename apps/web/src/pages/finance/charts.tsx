import { toCents } from '@comandou/shared';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { CashFlowDay } from '../../lib/types';
import { money } from './insights';

/*
 * Gráficos do Financeiro, feitos à mão em SVG/HTML (sem biblioteca): poucos traços, linhas de grade
 * discretas, laranja só para o que entrou e cinza para o que saiu, um eixo só e a dica (tooltip)
 * ao passar o dedo/mouse. Cores e fontes só pelos tokens (classes em finance.css).
 */

export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

/** Topo "redondo" do eixo: 1, 2, 2,5, 5 ou 10 × potência de 10. */
export function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/** "R$ 12,5 mil", "R$ 830": rótulo curto de eixo. */
export function shortMoney(cents: number) {
  const v = cents / 100;
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000)
    return `${sign}R$ ${(a / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1000)
    return `${sign}R$ ${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}R$ ${Math.round(a).toLocaleString('pt-BR')}`;
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });

/** Variação contra o período anterior: seta + % (verde quando é bom, vermelho quando é ruim). */
export function Delta({
  value,
  against,
  invert,
}: {
  value: number | null;
  /** "vs outubro" */
  against: string;
  /** Custo: subir é ruim. */
  invert?: boolean;
}) {
  if (value === null || !Number.isFinite(value))
    return <span className="fin-delta">sem comparação</span>;
  const up = value > 0;
  const good = value === 0 ? undefined : up !== Boolean(invert);
  return (
    <span className="fin-delta" data-good={good === undefined ? undefined : String(good)}>
      {value !== 0 &&
        (up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />)}
      {`${up ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
      <span className="fin-delta__vs">{against}</span>
    </span>
  );
}

/** Linha pequena de tendência, sem eixos (cartões do topo). */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 28;
  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => 2 + (1 - (v - min) / (max - min)) * (H - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
  return (
    <svg
      className="fin-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path className="fin-spark__area" d={`${d}L${W},${H}L0,${H}Z`} />
      <path className="fin-spark__line" d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  return (
    <div
      className="fin-tip"
      style={{ left: Math.min(Math.max(x, 96), Math.max(96, width - 96)) } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <div className="fin-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`fin-sw fin-sw--${i.swatch}`} aria-hidden /> {i.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ fluxo de caixa */

export interface FlowPoint {
  day: string;
  inflow: number;
  outflow: number;
  expectedIn: number;
  expectedOut: number;
  net: number;
  future: boolean;
}

export function flowPoints(days: CashFlowDay[], today: string): FlowPoint[] {
  return days.map((d) => ({
    day: d.day,
    inflow: toCents(d.sales) + toCents(d.received),
    outflow: toCents(d.refunds) + toCents(d.fees) + toCents(d.paid),
    expectedIn: toCents(d.expectedIn),
    expectedOut: toCents(d.expectedOut),
    net: toCents(d.net),
    future: d.day > today,
  }));
}

/**
 * Saldo acumulado do período. Até hoje: o que entrou menos o que saiu. Depois de hoje, a previsão:
 * as contas a vencer de cada dia mais a venda líquida média por dia (`salesPerDay`).
 */
export function cumulative(points: FlowPoint[], salesPerDay = 0) {
  let run = 0;
  const real: (number | null)[] = [];
  const proj: (number | null)[] = [];
  points.forEach((p, i) => {
    if (!p.future) {
      run += p.net;
      real.push(run);
      // A previsão começa no último dia real, para a linha continuar sem buraco.
      proj.push(points[i + 1]?.future ? run : null);
    } else {
      real.push(null);
      run += p.expectedIn - p.expectedOut + salesPerDay;
      proj.push(run);
    }
  });
  const hasFuture = points.some((p) => p.future);
  return { real, proj: hasFuture ? proj : proj.map(() => null), end: run };
}

/**
 * Venda líquida média por dia (vendas − estornos − taxas) dos dias que já passaram, usada na
 * previsão.
 */
export function avgDailySales(days: CashFlowDay[], today: string) {
  // Média por dia corrido: se o restaurante fecha às segundas, a previsão já conta com isso.
  const past = days.filter((d) => d.day <= today);
  if (!past.some((d) => toCents(d.sales) > 0)) return 0;
  const sum = past.reduce((s, d) => s + toCents(d.sales) - toCents(d.refunds) - toCents(d.fees), 0);
  return Math.round(sum / past.length);
}

export function FlowChart({
  days,
  prev,
  today,
  mode,
  salesPerDay,
  height = 240,
}: {
  days: CashFlowDay[];
  prev?: CashFlowDay[] | null;
  today: string;
  mode: 'balance' | 'daily';
  /** Venda líquida média por dia, somada à previsão (centavos). */
  salesPerDay?: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = flowPoints(days, today);
  const n = pts.length;
  if (!n) return null;
  const H = height;
  const pad = { l: 58, r: 8, t: 16, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - 58) / 64))));

  // Série acumulada (com a previsão das vendas médias nos dias que faltam).
  const base = cumulative(pts, salesPerDay);
  const proj = base.proj;
  const prevRun: number[] = [];
  if (prev) {
    let r = 0;
    for (const d of prev) {
      r += toCents(d.net);
      prevRun.push(r);
    }
  }

  let lo = 0;
  let hi = 1;
  if (mode === 'balance') {
    const all = [
      ...base.real.filter((v): v is number => v !== null),
      ...proj.filter((v): v is number => v !== null),
      ...prevRun.slice(0, n),
    ];
    lo = Math.min(0, ...all);
    hi = Math.max(1, ...all);
  } else {
    hi = Math.max(1, ...pts.map((p) => (p.future ? p.expectedIn : p.inflow)));
    lo = -Math.max(0, ...pts.map((p) => (p.future ? p.expectedOut : p.outflow)));
  }
  const top = niceMax(hi);
  const bottom = lo < 0 ? -niceMax(-lo) : 0;
  const y = (v: number) => pad.t + ((top - v) / (top - bottom)) * (H - pad.t - pad.b);
  // Linhas de grade: as pontas, o zero e o meio do lado maior (não amontoa perto do zero).
  const ticks =
    bottom < 0
      ? -bottom > top
        ? [top, 0, bottom / 2, bottom]
        : [top, top / 2, 0, bottom]
      : [top, top / 2, 0];

  const bandW = innerW / n;
  const xc = (i: number) =>
    mode === 'daily'
      ? pad.l + bandW * (i + 0.5)
      : pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xc(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - pad.l) / innerW;
    const i = mode === 'daily' ? Math.floor(rel * n) : Math.round(rel * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const lastReal = base.real.reduce<number>((a, v, i) => (v !== null ? i : a), -1);
  const realD = path(base.real);
  const area =
    lastReal >= 0 ? `${realD}L${xc(lastReal).toFixed(1)},${y(0)}L${xc(0).toFixed(1)},${y(0)}Z` : '';
  const endProj = proj[n - 1];
  const barW = Math.max(2, Math.min(18, bandW * 0.62));
  const h = hover !== null ? pts[hover]! : null;

  const aria =
    mode === 'balance'
      ? `Saldo acumulado: ${lastReal >= 0 ? money(base.real[lastReal]!) : 'sem movimento'} até hoje${endProj != null ? `, previsão de ${money(endProj)} no fim do período` : ''}`
      : 'Entradas e saídas por dia';

  return (
    <div className="fin-chart" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={aria}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'fin-zero' : 'fin-grid'}
              x1={pad.l}
              x2={width - pad.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text className="fin-axis" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {t === 0 ? 'R$ 0' : shortMoney(t)}
            </text>
          </g>
        ))}
        {mode === 'daily' ? (
          pts.map((p, i) => {
            const inV = p.future ? p.expectedIn : p.inflow;
            const outV = p.future ? p.expectedOut : p.outflow;
            const x0 = xc(i) - barW / 2;
            return (
              <g key={p.day} data-active={hover === i || undefined} className="fin-bar-g">
                {inV > 0 && (
                  <rect
                    className={p.future ? 'fin-bar fin-bar--in-soft' : 'fin-bar fin-bar--in'}
                    x={x0}
                    width={barW}
                    y={y(inV)}
                    height={Math.max(1, y(0) - y(inV) - 1)}
                    rx={Math.min(3, barW / 2)}
                  />
                )}
                {outV > 0 && (
                  <rect
                    className={p.future ? 'fin-bar fin-bar--out-soft' : 'fin-bar fin-bar--out'}
                    x={x0}
                    width={barW}
                    y={y(0) + 1}
                    height={Math.max(1, y(-outV) - y(0) - 1)}
                    rx={Math.min(3, barW / 2)}
                  />
                )}
              </g>
            );
          })
        ) : (
          <>
            {prevRun.length > 1 && (
              <path className="fin-line fin-line--prev" d={path(prevRun.slice(0, n))} />
            )}
            {area && <path className="fin-area" d={area} />}
            <path className="fin-line fin-line--proj" d={path(proj)} />
            <path className="fin-line fin-line--cur" d={realD} />
            {lastReal >= 0 && hover === null && (
              <circle
                className="fin-dot-cur"
                cx={xc(lastReal)}
                cy={y(base.real[lastReal]!)}
                r={4.5}
              />
            )}
            {endProj != null && hover === null && (
              <g>
                <circle className="fin-dot-proj" cx={xc(n - 1)} cy={y(endProj)} r={4} />
                <text
                  className="fin-axis fin-axis--strong"
                  x={xc(n - 1) - 6}
                  y={y(endProj) - 9}
                  textAnchor="end"
                >
                  {shortMoney(endProj)}
                </text>
              </g>
            )}
          </>
        )}
        {pts.map((p, i) =>
          (i % step === 0 && n - 1 - i >= step) || i === n - 1 ? (
            <text
              key={p.day}
              className="fin-axis"
              x={xc(i)}
              y={H - 8}
              textAnchor={
                mode === 'daily' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
              }
            >
              {dm(p.day)}
            </text>
          ) : null,
        )}
        {hover !== null && mode === 'balance' && (
          <g>
            <line className="fin-cross" x1={xc(hover)} x2={xc(hover)} y1={pad.t} y2={H - pad.b} />
            {prevRun[hover] !== undefined && (
              <circle className="fin-dot-prev" cx={xc(hover)} cy={y(prevRun[hover]!)} r={3.5} />
            )}
            {(base.real[hover] ?? proj[hover]) != null && (
              <circle
                className={base.real[hover] != null ? 'fin-dot-cur' : 'fin-dot-proj'}
                cx={xc(hover)}
                cy={y((base.real[hover] ?? proj[hover])!)}
                r={4.5}
              />
            )}
          </g>
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && hover !== null && (
        <Tip x={xc(hover)} width={width}>
          <strong>
            {longDay(h.day)}
            {h.future && ' · previsão'}
          </strong>
          {mode === 'balance' && (
            <span>
              <i className={`fin-sw fin-sw--${h.future ? 'proj' : 'cur'}`} /> Saldo{' '}
              {money((base.real[hover] ?? proj[hover] ?? 0) as number)}
            </span>
          )}
          {h.future ? (
            <>
              <span className="fin-tip__muted">
                A receber {money(h.expectedIn)} · a pagar {money(h.expectedOut)}
              </span>
            </>
          ) : (
            <>
              <span>
                <i className="fin-sw fin-sw--in" /> Entrou {money(h.inflow)}
              </span>
              <span>
                <i className="fin-sw fin-sw--out" /> Saiu {money(h.outflow)}
              </span>
            </>
          )}
          {mode === 'balance' && prevRun[hover] !== undefined && (
            <span className="fin-tip__muted">
              <i className="fin-sw fin-sw--prev" /> Mês anterior {money(prevRun[hover]!)}
            </span>
          )}
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ barras por dia */

export interface DayBar {
  day: string;
  value: number;
  /** Linhas extras da dica. */
  details?: { label: string; value: string }[];
}

/** Como escrever os números do gráfico (padrão: em reais). */
export interface BarFormat {
  /** Valor inteiro (dica e leitor de tela). */
  full: (n: number) => string;
  /** Valor curto do eixo e do melhor dia. */
  short: (n: number) => string;
}
const MONEY_FORMAT: BarFormat = { full: (n) => money(n), short: (n) => shortMoney(n) };

/** Uma barra por dia, com a linha da média e o melhor dia marcado. */
export function DayBars({
  items,
  label,
  height = 240,
  format = MONEY_FORMAT,
}: {
  items: DayBar[];
  label: string;
  height?: number;
  /** Outra unidade (ex.: tokens de IA); sem isso, reais. */
  format?: BarFormat;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = items.length;
  if (!n) return null;
  const H = height;
  const pad = { l: 58, r: 8, t: 18, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const max = Math.max(1, ...items.map((i) => i.value));
  const top = niceMax(max);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const band = innerW / n;
  const barW = Math.max(3, Math.min(28, band * 0.64));
  const xc = (i: number) => pad.l + band * (i + 0.5);
  const withValue = items.filter((i) => i.value > 0);
  const avg = withValue.length
    ? Math.round(withValue.reduce((s, i) => s + i.value, 0) / withValue.length)
    : 0;
  const best = items.reduce((b, it, i) => (it.value > items[b]!.value ? i : b), 0);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - 58) / 56))));
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left - pad.l) / innerW) * n);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const h = hover !== null ? items[hover]! : null;
  return (
    <div className="fin-chart" ref={ref}>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${label}: média de ${format.full(avg)} por dia, melhor dia ${dm(items[best]!.day)} com ${format.full(items[best]!.value)}`}
      >
        {[top, top / 2].map((t) => (
          <g key={t}>
            <line className="fin-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text className="fin-axis" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {format.short(t)}
            </text>
          </g>
        ))}
        <line className="fin-zero" x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />
        <text className="fin-axis" x={pad.l - 8} y={y(0) + 4} textAnchor="end">
          {format.short(0)}
        </text>
        {items.map((it, i) =>
          it.value > 0 ? (
            <rect
              key={it.day}
              className="fin-bar fin-bar--in"
              data-dim={(hover !== null && hover !== i) || undefined}
              x={xc(i) - barW / 2}
              width={barW}
              y={y(it.value)}
              height={Math.max(1, y(0) - y(it.value) - 1)}
              rx={Math.min(4, barW / 2)}
            />
          ) : null,
        )}
        {avg > 0 && (
          <g>
            <line className="fin-avg" x1={pad.l} x2={width - pad.r} y1={y(avg)} y2={y(avg)} />
            <text className="fin-axis" x={width - pad.r - 2} y={y(avg) - 4} textAnchor="end">
              média {format.short(avg)}
            </text>
          </g>
        )}
        {hover === null && items[best]!.value > 0 && (
          <text
            className="fin-axis fin-axis--strong"
            x={xc(best)}
            y={y(items[best]!.value) - 6}
            textAnchor={best < n * 0.12 ? 'start' : best > n * 0.88 ? 'end' : 'middle'}
          >
            {format.short(items[best]!.value)}
          </text>
        )}
        {items.map((it, i) =>
          (i % step === 0 && n - 1 - i >= step) || i === n - 1 ? (
            <text key={it.day} className="fin-axis" x={xc(i)} y={H - 8} textAnchor="middle">
              {dm(it.day)}
            </text>
          ) : null,
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && hover !== null && (
        <Tip x={xc(hover)} width={width}>
          <strong>{longDay(h.day)}</strong>
          <span>
            <i className="fin-sw fin-sw--in" /> {format.full(h.value)}
          </span>
          {h.details?.map((d) => (
            <span key={d.label} className="fin-tip__muted">
              {d.label} {d.value}
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ barras deitadas */

export interface HBar {
  key: string;
  label: ReactNode;
  value: number;
  /** Texto do valor (padrão: em reais). */
  display?: ReactNode;
  /** Linha cinza embaixo do nome. */
  sub?: ReactNode;
  /** Destaca a barra (maior, melhor dia…). */
  strong?: boolean;
}

/** Lista com barras deitadas: nome, barra proporcional ao maior e o valor. */
export function HBars({ rows, label }: { rows: HBar[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="fin-hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} data-strong={r.strong || undefined}>
          <div className="fin-hbars__text">
            <span className="fin-hbars__label">{r.label}</span>
            <span className="fin-hbars__value">{r.display ?? money(r.value)}</span>
          </div>
          <div className="fin-hbars__track" aria-hidden>
            <span
              className="fin-hbars__fill"
              style={{ width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%` }}
            />
          </div>
          {r.sub && <span className="fin-hbars__sub">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ cascata (DRE) */

export interface WaterStep {
  key: string;
  label: string;
  /** Centavos: positivo soma, negativo tira; num total, é o próprio valor. */
  value: number;
  total?: boolean;
}

/** Do faturamento ao lucro: cada degrau mostra quanto cada grupo de custo levou. */
export function Waterfall({ steps, label }: { steps: WaterStep[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) {
      run = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { ...s, from, to: run };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = hi - lo || 1;
  const pct = (v: number) => ((hi - v) / span) * 100;
  const first = bars[0]?.total ? Math.abs(bars[0].value) : 0;
  return (
    <div className="fin-wf" role="img" aria-label={label}>
      <div className="fin-wf__plot">
        <span className="fin-wf__zero" style={{ top: `${pct(0)}%` }} aria-hidden />
        {bars.map((b, i) => {
          const topV = Math.max(b.from, b.to);
          const botV = Math.min(b.from, b.to);
          const kind = b.total ? (b.value < 0 ? 'neg-total' : 'total') : b.value < 0 ? 'out' : 'in';
          return (
            <div
              key={b.key}
              className="fin-wf__col"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              data-dim={(hover !== null && hover !== i) || undefined}
            >
              <span
                className="fin-wf__val"
                style={{ top: `calc(${pct(topV)}% - 20px)` }}
                data-neg={(b.total && b.value < 0) || undefined}
              >
                {b.total
                  ? shortMoney(b.value)
                  : `${b.value < 0 ? '−' : '+'}${shortMoney(Math.abs(b.value)).replace('−', '')}`}
              </span>
              <span
                className="fin-wf__bar"
                data-kind={kind}
                style={{
                  top: `${pct(topV)}%`,
                  height: `max(2px, ${pct(botV) - pct(topV)}%)`,
                }}
              />
              {i < bars.length - 1 && (
                <span className="fin-wf__link" style={{ top: `${pct(b.to)}%` }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      <div className="fin-wf__labels">
        {bars.map((b) => (
          <span key={b.key}>
            {b.label}
            {first > 0 && !b.total && (
              <em>{`${Math.round((Math.abs(b.value) / first) * 1000) / 10}`.replace('.', ',')}%</em>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ números do topo */

export interface Kpi {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  spark?: number[];
  danger?: boolean;
}

/** Faixa de números num quadro só, separados por linha fina (sem cartão por número). */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="fin-kpi-strip" data-count={items.length}>
      {items.map((k) => (
        <div key={k.key} className="fin-kpi">
          <span className="fin-kpi__label">{k.label}</span>
          <strong className="fin-kpi__value" data-danger={k.danger || undefined}>
            {k.value}
          </strong>
          {k.sub && <span className="fin-kpi__sub">{k.sub}</span>}
          {k.spark && <Sparkline values={k.spark} label={`Tendência de ${k.label}`} />}
        </div>
      ))}
    </div>
  );
}

/** Barra de progresso fina (quanto das contas do mês já foi pago, por exemplo). */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const p = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="fin-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
    >
      <span style={{ width: `${p}%` }} />
    </div>
  );
}
