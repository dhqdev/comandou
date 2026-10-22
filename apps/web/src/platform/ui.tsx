import { ReactNode, useEffect, useRef } from 'react';

/** Peças visuais do painel Super Admin (ver admin.css). */

export type Level = 'ok' | 'warn' | 'bad' | 'info' | 'off';

export function Section({
  title,
  sub,
  actions,
  children,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="adm-section">
      <div className="adm-section__head">
        <h2 className="adm-section__title">{title}</h2>
        {sub && <span className="adm-section__sub">{sub}</span>}
        <span className="adm-section__rule" />
        {actions && <div className="adm-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Tile({
  label,
  value,
  sub,
  level,
  meter,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  level?: Level;
  /** 0–100: desenha a barra segmentada. */
  meter?: number | null;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="adm-label">{label}</span>
      <span className={`adm-value ${level && level !== 'off' ? `adm-value--${level}` : ''}`}>
        {value}
      </span>
      {sub !== undefined && <span className="adm-sub">{sub}</span>}
      {meter !== undefined && meter !== null && <Meter percent={meter} />}
    </>
  );
  return onClick ? (
    <button type="button" className="adm-tile" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="adm-tile">{body}</div>
  );
}

export function levelFor(percent: number | null | undefined, warn = 70, bad = 90): Level {
  if (percent === null || percent === undefined) return 'off';
  return percent >= bad ? 'bad' : percent >= warn ? 'warn' : 'ok';
}

export function Meter({ percent, segments = 20 }: { percent: number; segments?: number }) {
  const on = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * segments);
  const level = levelFor(percent);
  return (
    <span className="adm-meter" data-level={level} aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Linha simples (SVG) para o histórico; escala de 0 ao maior valor (ou ao máximo fixo). */
export function Sparkline({
  values,
  max,
  color = 'var(--a-ok)',
  label,
}: {
  values: number[];
  max?: number;
  color?: string;
  label: string;
}) {
  if (values.length < 2) return <div className="adm-empty">coletando dados…</div>;
  const top = max ?? Math.max(...values, 1);
  const w = 100;
  const h = 40;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - (Math.min(v, top) / top) * (h - 2) - 1,
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(2)},${y!.toFixed(2)}`).join('');
  return (
    <svg
      className="adm-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={w}
          y1={h * f}
          y2={h * f}
          stroke="var(--a-line)"
          strokeWidth="0.4"
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path className="area" d={`${line}L${w},${h}L0,${h}Z`} fill={color} />
      <path className="line" d={line} stroke={color} />
    </svg>
  );
}

export function Dot({ level }: { level: Level }) {
  return <span className={`adm-dot ${level !== 'off' ? `adm-dot--${level}` : ''}`} aria-hidden />;
}

export function Tag({ level, children }: { level?: Level; children: ReactNode }) {
  return (
    <span className={`adm-tag ${level && level !== 'off' ? `adm-tag--${level}` : ''}`}>
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: [T, string][];
}) {
  return (
    <div className="adm-tabs" role="tablist">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Repete `fn` a cada `ms` enquanto a aba estiver visível. */
export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function bytes(n: number | string | null | undefined, digits = 1) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${i ? x.toFixed(digits) : x} ${units[i]}`;
}

export function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

/** "há 5 min", "há 2 h", "há 3 dias". */
export function ago(iso: string | null | undefined) {
  if (!iso) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
