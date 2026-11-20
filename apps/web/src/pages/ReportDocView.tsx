import {
  REPORT_GROUPS,
  type ReportChart,
  type ReportDoc,
  type ReportFmt,
  type ReportKpi,
  type ReportPoint,
  type ReportTable,
  type ReportValue,
} from '@comandou/shared';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Printer,
} from 'lucide-react';
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, DateInput, EmptyState, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { downloadFile } from '../lib/download';
import { type Preset, presetRange } from './reports-insights';
import './report-doc.css';

/* ---------- formatação ---------- */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function fmtValue(v: ReportValue | undefined, fmt: ReportFmt): string {
  if (v === null || v === undefined || v === '') return '–';
  if (fmt === 'text') return String(v);
  if (fmt === 'date' && typeof v === 'string')
    return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  if (fmt === 'datetime' && typeof v === 'string')
    return `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 16)}`;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (fmt) {
    case 'money':
      return BRL.format(n);
    case 'int':
      return Math.round(n).toLocaleString('pt-BR');
    case 'pct':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    case 'min':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
    default:
      return NUM.format(n);
  }
}

/** Valor curto para eixos e rótulos: R$ 12,3 mil. */
function shortValue(v: number, fmt: ReportFmt): string {
  if (fmt === 'money') {
    if (Math.abs(v) >= 1000)
      return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
  }
  return fmtValue(v, fmt);
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dmy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/* ---------- catálogo ---------- */

export function ReportCatalog({ onOpen }: { onOpen(id: string): void }) {
  return (
    <div className="rd-catalog">
      {REPORT_GROUPS.map((g) => (
        <section key={g.id} className="rd-group" aria-labelledby={`rd-g-${g.id}`}>
          <h2 id={`rd-g-${g.id}`} className="rd-group__title">
            {g.title}
          </h2>
          <div className="rd-cards" data-count={g.reports.length}>
            {g.reports.map((r) => (
              <button key={r.id} type="button" className="rd-card" onClick={() => onOpen(r.id)}>
                <span className="rd-card__title">
                  {r.title}
                  <ChevronRight size={16} aria-hidden />
                </span>
                <span className="rd-card__desc">{r.description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- relatório ---------- */

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
  { value: 'custom', label: 'Escolher datas' },
];

export function ReportDocView({ id, onBack }: { id: string; onBack(): void }) {
  const [preset, setPreset] = useState<Preset>('30d');
  const [range, setRange] = useState(() => presetRange('30d', today()));
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    api<ReportDoc>(`/reports/catalog/${id}?from=${range.from}&to=${range.to}`)
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [id, range.from, range.to]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, today()));
  };
  const info = REPORT_GROUPS.flatMap((g) => g.reports).find((r) => r.id === id);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const download = async (kind: 'pdf' | 'xlsx') => {
    setBusy(kind);
    try {
      await downloadFile(
        `/api/v1/reports/catalog/${id}/${kind}?from=${range.from}&to=${range.to}`,
        `relatorio-${id}.${kind}`,
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rp rp-print rd">
      <div className="rd-head">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={16} />}
          onClick={onBack}
          className="rp-noprint"
        >
          Relatórios
        </Button>
        <div className="rd-head__text">
          <h2 className="rd-title">{info?.title ?? 'Relatório'}</h2>
          {info && <p className="rd-desc">{info.description}</p>}
        </div>
        <div className="rd-head__actions rp-noprint">
          <Button
            variant="primary"
            size="sm"
            icon={<FileText size={15} />}
            onClick={() => download('pdf')}
            disabled={!doc || busy !== null}
          >
            {busy === 'pdf' ? 'Gerando PDF…' : 'Baixar PDF'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<FileSpreadsheet size={15} />}
            onClick={() => download('xlsx')}
            disabled={!doc || busy !== null}
          >
            {busy === 'xlsx' ? 'Gerando…' : 'Excel'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Printer size={15} />}
            onClick={() => window.print()}
            disabled={!doc}
          >
            Imprimir
          </Button>
        </div>
      </div>

      <div className="rp-filters rp-noprint">
        <div className="rp-chips" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className="rp-chip"
              aria-pressed={preset === p.value}
              onClick={() => pick(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="rp-range">
            <label>
              <span className="cm-label">De</span>
              <DateInput
                value={range.from}
                max={range.to}
                onChange={(e) =>
                  e.target.value && setRange((r) => ({ ...r, from: e.target.value }))
                }
              />
            </label>
            <label>
              <span className="cm-label">Até</span>
              <DateInput
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </label>
          </div>
        )}
      </div>
      {doc && (
        <p className="rp-period">
          {doc.restaurant} ·{' '}
          {doc.from === doc.to ? dmy(doc.from) : `${dmy(doc.from)} a ${dmy(doc.to)}`} · comparado
          com {dmy(doc.prevFrom)} a {dmy(doc.prevTo)}
        </p>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {!doc ? (
        !error && <Skeleton variant="detail" />
      ) : (
        <>
          <div className="rp-kpis rd-kpis">
            {doc.kpis.map((k) => (
              <KpiTile key={k.label} k={k} />
            ))}
          </div>
          {doc.charts.length > 0 && (
            <div className="rd-charts">
              {doc.charts.map((c) => (
                <div key={c.title} className="rd-chart" data-wide={c.wide || undefined}>
                  <Card title={c.title}>
                    <ChartView c={c} />
                  </Card>
                </div>
              ))}
            </div>
          )}
          {doc.tables.map((t) => (
            <TableCard key={t.id} t={t} />
          ))}
          {doc.notes.length > 0 && (
            <div className="rd-notes">
              {doc.notes.map((n) => (
                <p key={n} className="cm-hint">
                  {n}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiTile({ k }: { k: ReportKpi }) {
  const cur = typeof k.value === 'number' ? k.value : null;
  const prev = k.prev ?? null;
  let delta: number | null = null;
  if (cur !== null && prev !== null && prev !== 0) delta = ((cur - prev) / Math.abs(prev)) * 100;
  const good = delta === null ? null : delta >= 0 !== !!k.invert;
  const tone = k.tone === 'bad' ? 'down' : undefined;
  return (
    <div className="cm-card rp-kpi" data-main={k.main || undefined}>
      <span className="rp-kpi__label">{k.label}</span>
      <strong className="rp-kpi__value" data-tone={tone} title={fmtValue(k.value, k.fmt)}>
        {fmtValue(k.value, k.fmt)}
      </strong>
      {delta !== null && (
        <span
          className="rp-delta"
          data-tone={Math.abs(delta) < 0.5 ? undefined : good ? 'up' : 'down'}
          title={`Período anterior: ${fmtValue(prev, k.fmt)}`}
        >
          {delta >= 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
          {Math.abs(delta) >= 1000
            ? `${Math.round(1 + delta / 100).toLocaleString('pt-BR')}× maior`
            : `${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
          <span className="rp-delta__vs">vs. anterior</span>
        </span>
      )}
      {prev === 0 && cur !== null && cur !== 0 && (
        <span className="rp-delta">sem base anterior</span>
      )}
      {k.hint && <span className="rp-kpi__hint">{k.hint}</span>}
    </div>
  );
}

/* ---------- gráficos ---------- */

/** Cores das categorias, sempre na mesma ordem (a 1ª é a da marca). */
const CAT = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];

function ChartView({ c }: { c: ReportChart }) {
  const empty =
    c.kind === 'heat'
      ? c.values.every((r) => r.every((v) => !v))
      : c.kind === 'scatter'
        ? c.points.length === 0
        : c.points.length === 0 || c.points.every((p) => !p.value && !p.prev);
  if (empty) return <p className="cm-hint">Sem dados no período.</p>;
  switch (c.kind) {
    case 'line':
      return <LineChart c={c} />;
    case 'columns':
      return <Columns points={c.points} fmt={c.fmt} />;
    case 'bars':
      return <Bars points={c.points} fmt={c.fmt} />;
    case 'donut':
      return <Donut points={c.points} fmt={c.fmt} />;
    case 'heat':
      return <Heat c={c} />;
    case 'scatter':
      return <Scatter c={c} />;
  }
}

function LineChart({ c }: { c: Extract<ReportChart, { kind: 'line' }> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = c.points;
  const n = pts.length;
  const hasPrev = pts.some((p) => p.prev);
  const H = 220;
  const pad = { l: 8, r: 8, t: 14, b: 26 };
  const nice = niceMax(Math.max(0, ...pts.map((p) => Math.max(p.value, p.prev ?? 0))));
  const x = (i: number) =>
    pad.l + (n === 1 ? (width - pad.l - pad.r) / 2 : (i / (n - 1)) * (width - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const cur = pts.map((p) => p.value);
  const curPath = path(cur);
  const area = `${curPath}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 72))));
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - pad.l) / (r.width - pad.l - pad.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  return (
    <>
      <div className="rp-legend rd-legend">
        <span>
          <i className="rp-swatch rp-swatch--cur" /> {c.series[0]}
        </span>
        {hasPrev && (
          <span>
            <i className="rp-swatch rp-swatch--prev" /> {c.series[1] ?? 'Anterior'}
          </span>
        )}
      </div>
      <div className="rp-chart" ref={ref}>
        <svg width={width} height={H} role="img" aria-label={c.title}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                className="rp-grid"
                x1={pad.l}
                x2={width - pad.r}
                y1={y(f * nice)}
                y2={y(f * nice)}
              />
              {f > 0 && (
                <text className="rp-axis" x={pad.l + 2} y={y(f * nice) - 4}>
                  {shortValue(f * nice, c.fmt)}
                </text>
              )}
            </g>
          ))}
          {hasPrev && (
            <path className="rp-line rp-line--prev" d={path(pts.map((p) => p.prev ?? 0))} />
          )}
          <path className="rp-area" d={area} />
          <path className="rp-line rp-line--cur" d={curPath} />
          {pts.map((p, i) =>
            (i % step === 0 && n - 1 - i >= step * 0.6) || i === n - 1 ? (
              <text
                key={i}
                className="rp-axis"
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              >
                {p.label.replace(/^\S+ /, '')}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <g>
              <line className="rp-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
              {hasPrev && (
                <circle className="rp-dot-prev" cx={x(hover)} cy={y(pts[hover]!.prev ?? 0)} r={4} />
              )}
              <circle className="rp-dot-cur" cx={x(hover)} cy={y(cur[hover]!)} r={4.5} />
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
        {hover !== null && (
          <div
            className="rp-tip"
            style={{ left: Math.min(Math.max(x(hover), 90), width - 90) } as CSSProperties}
          >
            <strong>{pts[hover]!.label}</strong>
            <span>
              <i className="rp-swatch rp-swatch--cur" /> {fmtValue(cur[hover]!, c.fmt)}
            </span>
            {hasPrev && (
              <span className="rp-muted">
                <i className="rp-swatch rp-swatch--prev" /> {fmtValue(pts[hover]!.prev ?? 0, c.fmt)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Columns({ points, fmt }: { points: ReportPoint[]; fmt: ReportFmt }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = Math.max(1, Math.ceil(points.length / 16));
  return (
    <div
      className="rd-cols"
      role="img"
      aria-label={points.map((p) => `${p.label}: ${fmtValue(p.value, fmt)}`).join('; ')}
    >
      {points.map((p, i) => (
        <span
          key={p.label + i}
          className="rd-col"
          data-top={p.value === max || undefined}
          title={`${p.label}: ${fmtValue(p.value, fmt)}${p.hint ? ` · ${p.hint}` : ''}`}
        >
          <span
            className="rd-col__bar"
            style={{ height: `${Math.max(p.value ? 3 : 0, (p.value / max) * 100)}%` }}
          />
          <small>{i % step === 0 ? p.label : ''}</small>
        </span>
      ))}
    </div>
  );
}

function Bars({ points, fmt }: { points: ReportPoint[]; fmt: ReportFmt }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const list = all ? points : points.slice(0, 10);
  return (
    <>
      <ul className="rp-hbars">
        {list.map((p, i) => (
          <li key={p.label + i} data-top={i === 0 || undefined}>
            <div className="rp-hbars__head">
              <span className="rp-ellipsis">{p.label}</span>
              <span className="rp-hbars__right">
                <strong data-neg={p.value < 0 || undefined}>{fmtValue(p.value, fmt)}</strong>
                {p.hint && <small className="rp-muted"> · {p.hint}</small>}
              </span>
            </div>
            <span className="rp-bar__track">
              <span
                className="rp-bar__fill"
                data-neg={p.value < 0 || undefined}
                style={{ width: `${Math.max(p.value ? 1 : 0, (Math.abs(p.value) / max) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      {points.length > 10 && (
        <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
          {all ? 'Mostrar menos' : `Ver todos (${points.length})`}
        </Button>
      )}
    </>
  );
}

function Donut({ points, fmt }: { points: ReportPoint[]; fmt: ReportFmt }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = points.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const shown = hover === null ? null : points[hover]!;
  return (
    <div className="rd-donut">
      <svg
        viewBox="0 0 140 140"
        width={140}
        height={140}
        role="img"
        aria-label={points.map((p) => `${p.label}: ${fmtValue(p.value, fmt)}`).join('; ')}
      >
        <circle cx={70} cy={70} r={R} className="rd-donut__track" />
        {points.map((p, i) => {
          const len = (Math.max(0, p.value) / total) * C;
          const gap = points.length > 1 ? Math.min(2, len / 2) : 0;
          const el = (
            <circle
              key={p.label}
              cx={70}
              cy={70}
              r={R}
              className={`rd-donut__seg rd-${CAT[i % CAT.length]}`}
              strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
              strokeDashoffset={-acc}
              data-dim={hover !== null && hover !== i ? true : undefined}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          );
          acc += len;
          return el;
        })}
        <text x={70} y={66} textAnchor="middle" className="rd-donut__big">
          {shown
            ? `${((Math.max(0, shown.value) / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`
            : shortValue(total, fmt)}
        </text>
        <text x={70} y={84} textAnchor="middle" className="rd-donut__small">
          {shown ? shown.label.slice(0, 16) : 'total'}
        </text>
      </svg>
      <ul className="rd-legend-list">
        {points.map((p, i) => (
          <li
            key={p.label}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <i className={`rd-dot rd-${CAT[i % CAT.length]}`} />
            <span className="rp-ellipsis">{p.label}</span>
            <strong>{fmtValue(p.value, fmt)}</strong>
            <small className="rp-muted">
              {((Math.max(0, p.value) / total) * 100).toLocaleString('pt-BR', {
                maximumFractionDigits: 1,
              })}
              %
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heat({ c }: { c: Extract<ReportChart, { kind: 'heat' }> }) {
  const max = Math.max(1, ...c.values.flat());
  return (
    <div className="rp-heat-wrap">
      <table className="rp-heat" style={{ '--cols': c.cols.length } as CSSProperties}>
        <thead>
          <tr>
            <th />
            {c.cols.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r, i) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {c.cols.map((h, j) => {
                const v = c.values[i]?.[j] ?? 0;
                return (
                  <td
                    key={h}
                    style={{ '--heat': `${Math.round((v / max) * 100)}%` } as CSSProperties}
                    data-zero={v === 0 || undefined}
                    data-dark={v / max > 0.55 || undefined}
                    title={`${r} ${h}: ${fmtValue(v, c.fmt)}`}
                  >
                    {v > 0 ? v : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Scatter({ c }: { c: Extract<ReportChart, { kind: 'scatter' }> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 300;
  const pad = { l: 12, r: 12, t: 12, b: 28 };
  const mx = Math.max(1, ...c.points.map((p) => p.x), c.cut?.x ?? 0) * 1.08;
  const ys = c.points.map((p) => p.y);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(1, ...ys, c.cut?.y ?? 0) * 1.12;
  const x = (v: number) => pad.l + (v / mx) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const gi = new Map(c.groups.map((g, i) => [g.id, i]));
  const p = hover === null ? null : c.points[hover]!;
  return (
    <>
      <div className="rp-legend rd-legend">
        {c.groups.map((g, i) => (
          <span key={g.id}>
            <i className={`rd-dot rd-${CAT[i]}`} /> {g.label}
          </span>
        ))}
      </div>
      <div className="rp-chart" ref={ref}>
        <svg width={width} height={H} role="img" aria-label={c.title}>
          {c.cut && (
            <>
              <line className="rd-cut" x1={x(c.cut.x)} x2={x(c.cut.x)} y1={pad.t} y2={H - pad.b} />
              <line
                className="rd-cut"
                x1={pad.l}
                x2={width - pad.r}
                y1={y(c.cut.y)}
                y2={y(c.cut.y)}
              />
            </>
          )}
          <text className="rp-axis" x={width - pad.r} y={H - 8} textAnchor="end">
            {c.x.label} →
          </text>
          {c.cut && c.groups.length === 4 && (
            // Quadrantes na ordem: vende muito + lucra bem, vende muito + lucra pouco,
            // vende pouco + lucra bem, vende pouco + lucra pouco.
            <g className="rd-quad">
              <text x={width - pad.r - 4} y={pad.t + 12} textAnchor="end">
                {c.groups[0]!.label}
              </text>
              <text x={width - pad.r - 4} y={H - pad.b - 18} textAnchor="end">
                {c.groups[1]!.label}
              </text>
              <text x={x(c.cut.x) - 6} y={pad.t + 12} textAnchor="end">
                {c.groups[2]!.label}
              </text>
              <text x={x(c.cut.x) - 6} y={H - pad.b - 18} textAnchor="end">
                {c.groups[3]!.label}
              </text>
            </g>
          )}
          <text className="rp-axis" x={pad.l + 2} y={pad.t + 10}>
            ↑ {c.y.label}
          </text>
          {c.points.map((pt, i) => (
            <circle
              key={pt.label + i}
              cx={x(pt.x)}
              cy={y(pt.y)}
              r={hover === i ? 7 : 5.5}
              className={`rd-pt rd-${CAT[gi.get(pt.group) ?? 0]}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              <title>{`${pt.label}: ${fmtValue(pt.x, c.x.fmt)} · ${fmtValue(pt.y, c.y.fmt)}`}</title>
            </circle>
          ))}
        </svg>
        {p && (
          <div
            className="rp-tip"
            style={
              {
                left: Math.min(Math.max(x(p.x), 90), width - 90),
                top: Math.max(0, y(p.y) - 70),
              } as CSSProperties
            }
          >
            <strong>{p.label}</strong>
            <span>
              {c.x.label}: {fmtValue(p.x, c.x.fmt)}
            </span>
            <span>
              {c.y.label}: {fmtValue(p.y, c.y.fmt)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- tabelas ---------- */

const PAGE = 50;

function TableCard({ t }: { t: ReportTable }) {
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = sort
    ? [...t.rows].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
        return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR') * sort.dir;
      })
    : t.rows;
  const max = t.bar ? Math.max(1, ...t.rows.map((r) => Math.abs(Number(r[t.bar!] ?? 0)))) : 1;
  const numeric = (f: ReportFmt) => f !== 'text';
  return (
    <Card title={t.title} bodyless>
      {t.hint && <p className="cm-hint rd-table-hint">{t.hint}</p>}
      {t.rows.length === 0 ? (
        <EmptyState title="Nada no período" />
      ) : (
        <>
          <div className="rp-scroll">
            <table className="cm-table rd-table">
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <th
                      key={c.key}
                      className={numeric(c.fmt) ? 'cm-num' : undefined}
                      aria-sort={
                        sort?.key === c.key
                          ? sort.dir === 1
                            ? 'ascending'
                            : 'descending'
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        className="rd-sort"
                        onClick={() =>
                          setSort((s) =>
                            s?.key === c.key
                              ? s.dir === -1
                                ? { key: c.key, dir: 1 }
                                : null
                              : { key: c.key, dir: numeric(c.fmt) ? -1 : 1 },
                          )
                        }
                      >
                        {c.label}
                        {sort?.key === c.key && (sort.dir === 1 ? ' ↑' : ' ↓')}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => (
                  <tr key={i}>
                    {t.columns.map((c) => (
                      <td
                        key={c.key}
                        className={numeric(c.fmt) ? 'cm-num' : 'rd-text'}
                        data-neg={(c.fmt === 'money' && Number(r[c.key]) < 0) || undefined}
                        title={
                          c.fmt === 'text' && String(r[c.key] ?? '').length > 40
                            ? String(r[c.key])
                            : undefined
                        }
                      >
                        {c.key === t.bar ? (
                          <span className="rd-cellbar">
                            <span
                              className="rd-cellbar__fill"
                              style={{ width: `${(Math.abs(Number(r[c.key] ?? 0)) / max) * 100}%` }}
                            />
                            <span className="rd-cellbar__v">{fmtValue(r[c.key], c.fmt)}</span>
                          </span>
                        ) : (
                          fmtValue(r[c.key], c.fmt)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {t.total && (
                <tfoot>
                  <tr>
                    {t.columns.map((c, i) => (
                      <td key={c.key} className={numeric(c.fmt) ? 'cm-num' : undefined}>
                        {i === 0 && (t.total![c.key] ?? null) === null
                          ? 'Total'
                          : t.total![c.key] === undefined
                            ? ''
                            : fmtValue(t.total![c.key], c.fmt)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(t.rows.length > limit || t.truncated) && (
            <div className="rd-more">
              {t.rows.length > limit && (
                <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 200)}>
                  Mostrar mais ({t.rows.length - limit} restantes)
                </Button>
              )}
              {t.truncated && (
                <span className="cm-hint">
                  Lista limitada; escolha um período menor para ver tudo.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
