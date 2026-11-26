import { type CSSProperties, useState } from 'react';

/**
 * Gráficos pequenos do Super Admin (aba Operação do restaurante, 0.267.0), feitos à mão em
 * HTML/SVG, sem biblioteca. Cores das categorias por `data-slot` (1 a 6, em admin.css): fixas
 * por categoria (a mesma forma de pagamento tem sempre a mesma cor), validadas para daltonismo no
 * claro e no escuro. O texto (nome e número) vem sempre junto, a cor nunca é a única pista.
 */

export interface Part {
  key: string;
  label: string;
  value: number;
  /** Texto do valor (ex.: "12 · R$ 340,00"). */
  text: string;
  /** Cor fixa da categoria (1 a 6); sem slot, cinza ("Outros"). */
  slot?: number;
}

const share = (v: number, total: number) =>
  total > 0 ? `${(Math.round((v / total) * 1000) / 10).toLocaleString('pt-BR')}%` : '0%';

/** Rosca com o total no meio e a legenda ao lado (nome, %, valor). */
export function Donut({
  parts,
  center,
  centerLabel,
  label,
}: {
  parts: Part[];
  center: string;
  centerLabel: string;
  label: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const list = parts.filter((p) => p.value > 0);
  const total = list.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return <div className="adm-empty">Sem dados nos últimos 30 dias</div>;
  const r = 60;
  const c = 2 * Math.PI * r;
  const gap = list.length > 1 ? 2 : 0;
  let acc = 0;
  const shown = hover ? list.find((p) => p.key === hover) : null;
  return (
    <div className="adm-viz-donut">
      <figure className="adm-viz-donut__fig">
        <svg
          viewBox="0 0 160 160"
          role="img"
          aria-label={`${label}: ${list.map((p) => `${p.label} ${share(p.value, total)}`).join(', ')}`}
        >
          {list.map((p) => {
            const len = (p.value / total) * c;
            const start = acc;
            acc += len;
            return (
              <circle
                key={p.key}
                className="adm-viz-donut__slice"
                data-slot={p.slot}
                data-dim={hover && hover !== p.key ? '' : undefined}
                cx="80"
                cy="80"
                r={r}
                strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                strokeDashoffset={-start}
                onMouseEnter={() => setHover(p.key)}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {p.label}: {p.text}
                </title>
              </circle>
            );
          })}
        </svg>
        <figcaption className="adm-viz-donut__mid" aria-hidden>
          <strong>{shown ? share(shown.value, total) : center}</strong>
          <small>{shown ? shown.label : centerLabel}</small>
        </figcaption>
      </figure>
      <Legend parts={list} total={total} onHover={setHover} />
    </div>
  );
}

/** Legenda em linhas: quadradinho da cor, nome, % e o valor. */
export function Legend({
  parts,
  total,
  onHover,
}: {
  parts: Part[];
  total: number;
  onHover?: (key: string | null) => void;
}) {
  return (
    <ul className="adm-viz-legend">
      {parts.map((p) => (
        <li key={p.key} onMouseEnter={() => onHover?.(p.key)} onMouseLeave={() => onHover?.(null)}>
          <i className="adm-viz-swatch" data-slot={p.slot} aria-hidden />
          <span className="adm-viz-legend__name">{p.label}</span>
          <span className="adm-viz-legend__pct">{share(p.value, total)}</span>
          <span className="adm-viz-legend__val">{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Barra dividida (o todo em partes, de relance) com a % dentro do bloco quando cabe. */
export function SplitBar({ parts }: { parts: Part[] }) {
  const list = parts.filter((p) => p.value > 0);
  const total = list.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return <div className="adm-empty">Sem dados nos últimos 30 dias</div>;
  return (
    <div className="adm-viz-split">
      <div
        className="adm-viz-split__bar"
        role="img"
        aria-label={list.map((p) => `${p.label} ${share(p.value, total)}`).join(', ')}
      >
        {list.map((p) => (
          <span
            key={p.key}
            data-slot={p.slot}
            style={{ flexGrow: p.value }}
            title={`${p.label}: ${p.text}`}
          >
            {p.value / total >= 0.1 ? share(p.value, total) : ''}
          </span>
        ))}
      </div>
      <Legend parts={list} total={total} />
    </div>
  );
}

export interface Column {
  key: string;
  /** Rótulo do eixo (só alguns aparecem embaixo). */
  label: string;
  value: number;
  /** Texto da dica ao passar o mouse. */
  tip: string;
  /** Coluna em destaque (ex.: hoje, o pico). */
  strong?: boolean;
}

/**
 * Colunas com um eixo só: o maior valor em cima, a média tracejada, a dica ao passar o mouse e
 * alguns rótulos embaixo (`ticks`: quais índices mostram o rótulo).
 */
export function Columns({
  cols,
  format,
  ticks,
  label,
  average = true,
  height = 150,
}: {
  cols: Column[];
  format: (n: number) => string;
  ticks?: number[];
  label: string;
  average?: boolean;
  height?: number;
}) {
  const max = Math.max(...cols.map((c) => c.value), 0);
  if (max <= 0) return <div className="adm-empty">Sem dados nos últimos 30 dias</div>;
  const avg = cols.reduce((n, c) => n + c.value, 0) / Math.max(cols.length, 1);
  const show = new Set(ticks ?? cols.map((_, i) => i));
  return (
    <div className="adm-viz-cols" style={{ '--h': `${height}px` } as CSSProperties}>
      <div className="adm-viz-cols__scale" aria-hidden>
        <span>{format(max)}</span>
        {average && <span>média {format(avg)}</span>}
      </div>
      <div className="adm-viz-cols__plot" role="img" aria-label={label}>
        {cols.map((c) => (
          <span
            key={c.key}
            className="adm-viz-cols__col"
            data-strong={c.strong || undefined}
            data-tip={c.tip}
            tabIndex={0}
          >
            <i style={{ height: `${c.value > 0 ? Math.max((c.value / max) * 100, 2) : 0}%` }} />
          </span>
        ))}
        {average && (
          <i
            className="adm-viz-cols__avg"
            style={{ bottom: `${(avg / max) * 100}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="adm-viz-cols__axis" aria-hidden>
        {cols.map((c, i) => (
          <span key={c.key}>{show.has(i) ? c.label : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Ranking: barras deitadas, a primeira na cor de destaque e o resto em cinza. */
export function Ranking({
  rows,
}: {
  rows: { key: string; name: string; value: number; text: string }[];
}) {
  const top = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || top <= 0)
    return <div className="adm-empty">Sem dados nos últimos 30 dias</div>;
  return (
    <ol className="adm-viz-rank">
      {rows.map((r, i) => (
        <li key={r.key} data-first={i === 0 || undefined}>
          <span className="adm-viz-rank__name">{r.name}</span>
          <span className="adm-viz-rank__track" aria-hidden>
            <i style={{ width: `${Math.max((r.value / top) * 100, 2)}%` }} />
          </span>
          <span className="adm-viz-rank__val">{r.text}</span>
        </li>
      ))}
    </ol>
  );
}
