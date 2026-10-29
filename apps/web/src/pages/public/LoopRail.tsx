import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Cópias da lista lado a lado: a do meio é a "de verdade"; as outras dão a volta sem fim. */
const COPIES = 5;
const MIDDLE = Math.floor(COPIES / 2);

/**
 * Faixa que rola para o lado sem fim: ao chegar no último item, vem o primeiro de novo.
 * Funciona repetindo a lista e, quando a rolagem para, voltando em silêncio para a cópia do
 * meio (o cliente não percebe o salto). Com `auto`, anda sozinha um item por vez e pausa
 * enquanto a pessoa toca, passa o mouse ou quando a faixa sai da tela.
 */
export function LoopRail<T>({
  items,
  keyOf,
  render,
  className = '',
  label,
  auto = false,
  interval = 3500,
  onIndex,
}: {
  items: T[];
  keyOf(item: T): string;
  /** `copy` = true nas repetições (ficam fora da ordem de tabulação e dos leitores de tela). */
  render(item: T, index: number, copy: boolean): ReactNode;
  className?: string;
  label: string;
  auto?: boolean;
  interval?: number;
  /** Índice (0..n-1) do item mais à esquerda, para os pontinhos dos banners. */
  onIndex?(i: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = items.length;
  /** Só repete quando a lista não cabe na tela (com 2 itens que cabem, nada de cópias). */
  const [loop, setLoop] = useState(n > 1);
  const period = useRef(0);
  const step = useRef(0);
  const paused = useRef(false);
  const resume = useRef<number | undefined>(undefined);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const kids = el.children;
    if (loop && kids.length >= n * 2) {
      const a = kids[0] as HTMLElement;
      const b = kids[n] as HTMLElement;
      period.current = b.offsetLeft - a.offsetLeft;
      step.current = n > 1 ? (kids[1] as HTMLElement).offsetLeft - a.offsetLeft : period.current;
      // Lista inteira cabe na tela: desliga a volta sem fim.
      if (period.current <= el.clientWidth + 4) setLoop(false);
    } else if (!loop && n > 1) {
      const a = kids[0] as HTMLElement | undefined;
      step.current = a && kids[1] ? (kids[1] as HTMLElement).offsetLeft - a.offsetLeft : 0;
      if (el.scrollWidth > el.clientWidth + 40) setLoop(true);
    }
  }, [loop, n]);

  // Começa na cópia do meio.
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (el && loop && period.current) el.scrollLeft = period.current * MIDDLE;
  }, [measure, loop, n]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const before = period.current;
      measure();
      // Mudou a largura (girou o celular): mantém a mesma posição relativa.
      if (loop && before && period.current && before !== period.current)
        el.scrollLeft = (el.scrollLeft / before) * period.current;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, loop]);

  // Quando a rolagem para, volta para a cópia do meio mantendo o mesmo item na tela.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t: number | undefined;
    const settle = () => {
      const p = period.current;
      if (loop && p) {
        let x = el.scrollLeft;
        while (x < p * (MIDDLE - 0.5)) x += p;
        while (x >= p * (MIDDLE + 0.5)) x -= p;
        if (Math.abs(x - el.scrollLeft) > 1) el.scrollLeft = x;
      }
      if (onIndex && step.current) {
        const i = Math.round((el.scrollLeft % (p || Infinity)) / step.current);
        onIndex(((i % n) + n) % n);
      }
    };
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(settle, 140);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(t);
    };
  }, [loop, n, onIndex]);

  // Anda sozinha (um item por vez) só quando visível e ninguém está mexendo.
  useEffect(() => {
    const el = ref.current;
    if (!el || !auto || n < 2) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let visible = true;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting))
        : null;
    io?.observe(el);
    const id = window.setInterval(() => {
      if (paused.current || !visible || document.visibilityState !== 'visible') return;
      if (!loop && el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
        el.scrollTo({ left: 0, behavior: 'smooth' });
      else el.scrollBy({ left: step.current || el.clientWidth, behavior: 'smooth' });
    }, interval);
    return () => {
      window.clearInterval(id);
      io?.disconnect();
    };
  }, [auto, interval, loop, n]);

  const hold = () => {
    paused.current = true;
    window.clearTimeout(resume.current);
  };
  const release = () => {
    window.clearTimeout(resume.current);
    resume.current = window.setTimeout(() => (paused.current = false), 4000);
  };
  const nudge = (dir: 1 | -1) => {
    hold();
    ref.current?.scrollBy({ left: dir * (step.current || 200), behavior: 'smooth' });
    release();
  };

  const copies = loop ? COPIES : 1;
  return (
    <div className={`loop ${className}`} aria-label={label} role="region">
      <div
        ref={ref}
        className="loop__track"
        onPointerDown={hold}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerEnter={(e) => e.pointerType === 'mouse' && hold()}
        onPointerLeave={release}
        onFocus={hold}
        onBlur={release}
      >
        {Array.from({ length: copies }, (_, c) =>
          items.map((it, i) => {
            const copy = loop && c !== MIDDLE;
            return (
              <div key={`${c}:${keyOf(it)}`} className="loop__item" aria-hidden={copy || undefined}>
                {render(it, i, copy)}
              </div>
            );
          }),
        )}
      </div>
      {n > 1 && (
        <>
          <button
            type="button"
            className="loop__arrow loop__arrow--prev"
            aria-label="Anterior"
            onClick={() => nudge(-1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="loop__arrow loop__arrow--next"
            aria-label="Próximo"
            onClick={() => nudge(1)}
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
    </div>
  );
}
