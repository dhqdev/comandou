import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import './slide-tabs.css';

export interface SlideTab<T extends string> {
  value: T;
  label: ReactNode;
  /** Número exibido ao lado do rótulo (ex.: pedidos na coluna). */
  count?: number;
  title?: string;
}

/**
 * Abas com indicador que DESLIZA até a aba ativa (efeito vidro). Rola sozinha para manter a aba
 * ativa visível quando há muitas (ex.: categorias do cardápio no celular).
 */
export function SlideTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  size = 'md',
  className = '',
}: {
  tabs: SlideTab<T>[];
  value: T;
  onChange(v: T): void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return setBox(null);
      setBox({ x: active.offsetLeft, w: active.offsetWidth });
      // Mantém a aba ativa à vista sem mexer na rolagem vertical da página.
      const left = active.offsetLeft - el.clientWidth / 2 + active.offsetWidth / 2;
      el.scrollTo?.({ left, behavior: 'smooth' });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [value, tabs.length]);

  return (
    <div
      ref={wrap}
      className={`slide-tabs slide-tabs--${size} ${className}`}
      role="tablist"
      aria-label={label}
    >
      {box && (
        <span
          className="slide-tabs__glider"
          aria-hidden
          style={{ transform: `translateX(${box.x}px)`, width: box.w }}
        />
      )}
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className="slide-tabs__tab"
          title={t.title}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && <span className="slide-tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
