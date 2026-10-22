import { KeyboardEvent, ReactNode, useCallback, useLayoutEffect, useRef } from 'react';

const ACTIVE =
  '[aria-selected="true"], [aria-current="page"], [aria-pressed="true"], [aria-checked="true"], .active';

/**
 * Indicador deslizante ("liquid glass"): um único elemento que escorrega até o item ativo
 * de um grupo (abas, menu, chips), esticando e assentando como uma gota.
 *
 * Uso:
 *   const g = useGlider<HTMLDivElement>();
 *   <div ref={g.ref} className="cm-glide">…itens com aria-selected…{g.glider}</div>
 *
 * Detecta sozinho quando o item ativo muda (observa aria-selected/aria-current/class),
 * então funciona com NavLink, botões e qualquer lista sem passar dependências.
 */
export function useGlider<T extends HTMLElement = HTMLDivElement>(
  opts: { selector?: string; variant?: 'glass' | 'brand' } = {},
) {
  const { selector = ACTIVE, variant = 'glass' } = opts;
  const ref = useRef<T>(null);
  const gRef = useRef<HTMLSpanElement>(null);
  const last = useRef<{ l: number; t: number; el: Element } | null>(null);

  const place = useCallback(
    (instant: boolean) => {
      const box = ref.current;
      const g = gRef.current;
      if (!box || !g) return;
      const el = box.querySelector<HTMLElement>(selector);
      if (!el || el.offsetParent === null) {
        g.dataset.ready = 'false';
        last.current = null;
        return;
      }
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // Coordenadas relativas à caixa de padding do contêiner, somando a rolagem.
      const l = r.left - b.left - box.clientLeft + box.scrollLeft;
      const t = r.top - b.top - box.clientTop + box.scrollTop;
      const right = box.clientWidth - (l + r.width);
      const bottom = box.clientHeight - (t + r.height);
      const prev = last.current;
      const moved = prev && prev.el !== el;
      g.dataset.dir = prev && (l > prev.l + 0.5 || t > prev.t + 0.5) ? 'fwd' : 'back';
      g.style.setProperty('--g-l', `${l}px`);
      g.style.setProperty('--g-t', `${t}px`);
      g.style.setProperty('--g-r', `${right}px`);
      g.style.setProperty('--g-b', `${bottom}px`);
      g.dataset.ready = instant || !prev ? 'instant' : 'true';
      if (g.dataset.ready === 'instant') {
        // Próximo quadro: volta a animar as próximas mudanças.
        requestAnimationFrame(() => {
          if (gRef.current) gRef.current.dataset.ready = 'true';
        });
      }
      if (moved && box.scrollWidth > box.clientWidth) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      last.current = { l, t, el };
    },
    [selector],
  );

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    place(true);
    let raf = 0;
    const schedule = (instant: boolean) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => place(instant));
    };
    const mo = new MutationObserver(() => schedule(false));
    mo.observe(box, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'aria-checked', 'class'],
    });
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule(true)) : null;
    ro?.observe(box);
    const onResize = () => schedule(true);
    window.addEventListener('resize', onResize);
    // Fontes carregando mudam a largura dos itens.
    document.fonts?.ready.then(() => schedule(true)).catch(() => undefined);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [place]);

  const glider = (
    <span
      ref={gRef}
      className={`cm-glider ${variant === 'brand' ? 'cm-glider--brand' : ''}`}
      aria-hidden
      data-ready="false"
    />
  );
  return { ref, glider };
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

/**
 * Abas segmentadas com o indicador deslizante. Teclado: setas esquerda/direita, Home e End.
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block,
  className = '',
}: {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Rótulo acessível do grupo. */
  label: string;
  size?: 'md' | 'lg';
  block?: boolean;
  className?: string;
}) {
  const g = useGlider<HTMLDivElement>();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(enabled[next]!.value);
    const btn = g.ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')[
      next
    ];
    btn?.focus();
  };
  return (
    <div
      ref={g.ref}
      role="tablist"
      aria-label={label}
      className={`cm-seg cm-glide ${size === 'lg' ? 'cm-seg--lg' : ''} ${block ? 'cm-seg--block' : ''} ${className}`}
      onKeyDown={onKey}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          className="cm-seg__item"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
          {o.count !== undefined && <span className="cm-seg__count">{o.count}</span>}
        </button>
      ))}
      {g.glider}
    </div>
  );
}

/**
 * Grupo de chips (filtros, categorias, setores) com o indicador deslizante na cor da marca.
 * Os filhos são botões `.chip` com aria-selected/aria-pressed.
 */
export function ChipGroup({
  label,
  children,
  role = 'tablist',
  className = '',
}: {
  label?: string;
  children: ReactNode;
  role?: string;
  className?: string;
}) {
  const g = useGlider<HTMLDivElement>({ variant: 'brand' });
  return (
    <div ref={g.ref} className={`chips cm-glide ${className}`} role={role} aria-label={label}>
      {children}
      {g.glider}
    </div>
  );
}
