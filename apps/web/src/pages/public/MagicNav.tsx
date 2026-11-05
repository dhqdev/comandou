import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { reducedMotion } from './morph';
import './magic-nav.css';

/**
 * Menu de baixo do celular no estilo "magic navigation": a aba aberta sobe para uma bolinha na
 * cor da loja, encaixada num recorte da barra. Ao trocar de aba, a bolinha e o recorte deslizam
 * juntos até a aba nova (com um leve balanço). A barra é desenhada em SVG a cada quadro, com as
 * bordas do recorte arredondadas.
 */

/** Medidas da barra (px). */
export const NAV = {
  /** Altura da barra. */
  h: 64,
  /** Raio dos cantos da barra. */
  corner: 18,
  /** Raio do recorte (bolinha + folga). */
  hole: 31,
  /** Raio da curva que suaviza a borda do recorte. */
  fillet: 9,
  /** Centro do recorte em relação ao topo da barra (0: na borda; a bolinha fica meio para fora). */
  lift: 0,
  /** Raio da bolinha. */
  blob: 24.5,
} as const;

/** Distância do centro do recorte até onde a curva encosta na borda de cima. */
export function notchReach(t = 1) {
  const R = NAV.hole * t;
  const f = NAV.fillet * t;
  const cy = NAV.lift * t;
  return Math.sqrt((R + f) ** 2 - (f - cy) ** 2);
}

/**
 * Contorno da barra com o recorte centrado em `x`. `t` (0–1) abre o recorte: 0 é a barra lisa
 * (nenhuma aba aberta), 1 é o recorte inteiro.
 */
export function barPath(w: number, x: number, t = 1) {
  const { h, corner: r } = NAV;
  const n = (v: number) => Math.round(v * 100) / 100;
  let notch = '';
  if (t > 0.01) {
    const R = NAV.hole * t;
    const f = NAV.fillet * t;
    const cy = NAV.lift * t;
    const dx = notchReach(t);
    // Ponto onde a curva da borda encosta no círculo do recorte.
    const k = R / (R + f);
    const px = dx * k;
    const py = cy + (f - cy) * k;
    notch =
      `L${n(x - dx)} 0` +
      `A${n(f)} ${n(f)} 0 0 1 ${n(x - px)} ${n(py)}` +
      `A${n(R)} ${n(R)} 0 0 0 ${n(x + px)} ${n(py)}` +
      `A${n(f)} ${n(f)} 0 0 1 ${n(x + dx)} 0`;
  }
  return (
    `M0 ${r}A${r} ${r} 0 0 1 ${r} 0` +
    notch +
    `L${n(w - r)} 0A${r} ${r} 0 0 1 ${n(w)} ${r}` +
    `L${n(w)} ${h - r}A${r} ${r} 0 0 1 ${n(w - r)} ${h}` +
    `L${r} ${h}A${r} ${r} 0 0 1 0 ${h - r}Z`
  );
}

/** Folga nas pontas para o recorte da primeira e da última aba não pegar o canto da barra. */
export function sidePad(w: number, count: number) {
  if (count < 2) return 12;
  const need = NAV.corner + notchReach();
  return Math.max(12, Math.ceil((need - w / (2 * count)) / (1 - 1 / count)));
}

/** Balanço no fim do movimento (passa um pouco e volta). */
const easeOutBack = (p: number) => {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

export interface MagicTab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge: number;
}

/** Aba aberta para o caminho atual (as de baixo também valem para as telas dentro delas). */
function activeIndex(tabs: MagicTab[], pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return tabs.findIndex((t) =>
    t.end ? path === t.to : path === t.to || path.startsWith(`${t.to}/`),
  );
}

export function MagicNav({
  tabs,
  hidden,
  label,
  dot,
}: {
  tabs: MagicTab[];
  hidden?: boolean;
  label: string;
  dot(n: number): React.ReactNode;
}) {
  const { pathname } = useLocation();
  const idx = activeIndex(tabs, pathname);
  const bar = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);
  const blob = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  // Onde a bolinha está agora (x) e quanto o recorte está aberto (t): o desenho parte daqui.
  const pos = useRef<{ x: number; t: number } | null>(null);
  const frame = useRef(0);

  const pad = width ? sidePad(width, tabs.length) : 12;
  const itemW = width ? (width - 2 * pad) / tabs.length : 0;
  const target = { x: pad + itemW * (Math.max(idx, 0) + 0.5), t: idx >= 0 ? 1 : 0 };

  const paint = (x: number, t: number) => {
    path.current?.setAttribute('d', barPath(width, x, t));
    if (blob.current)
      blob.current.style.transform = `translate(${x - NAV.blob}px, ${NAV.lift * t - NAV.blob}px) scale(${Math.max(0, t)})`;
  };

  // Mede a barra (e de novo quando a tela gira ou muda de tamanho).
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Desliza da posição atual até a aba nova.
  useLayoutEffect(() => {
    if (!width) return;
    cancelAnimationFrame(frame.current);
    const from = pos.current;
    if (!from || reducedMotion()) {
      pos.current = target;
      paint(target.x, target.t);
      return;
    }
    // Sem aba aberta, a bolinha some onde está (não viaja até a primeira aba).
    const to = target.t === 0 ? { x: from.x, t: 0 } : target;
    const start = performance.now();
    const dur = 560;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const e = easeOutBack(p);
      const cur = {
        x: from.x + (to.x - from.x) * e,
        t: Math.min(1, from.t + (to.t - from.t) * (to.t > from.t ? e : p)),
      };
      pos.current = cur;
      paint(cur.x, cur.t);
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // Só quando a aba ou a largura mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, width, tabs.length]);

  return (
    <nav
      ref={bar}
      className="mnav"
      data-hidden={hidden || undefined}
      aria-label={label}
      style={{ ['--mnav-pad' as string]: `${pad}px` }}
    >
      <svg className="mnav__bg" width={width || 1} height={NAV.h} aria-hidden focusable="false">
        {/* Fundo do recorte na cor da página: o que passa por trás não aparece no buraco. */}
        <path className="mnav__well" d={width ? barPath(width, 0, 0) : ''} />
        <path
          ref={path}
          className="mnav__bar"
          d={width ? barPath(width, target.x, target.t) : ''}
        />
      </svg>
      <span ref={blob} className="mnav__blob" aria-hidden />
      <div className="mnav__items">
        {tabs.map((t, i) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className="mnav__item"
            data-on={i === idx || undefined}
          >
            <span className="mnav__icon">
              <t.icon size={22} aria-hidden strokeWidth={2.1} />
              {dot(t.badge)}
            </span>
            <span className="mnav__label">{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
