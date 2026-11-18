import { useEffect, useRef, useState } from 'react';
import { BRAND_CACHED_EVENT, BRAND_EVENT } from '../design-system';
import Particles from './reactbits/Particles';

type Rgb = [number, number, number];

/** Lê uma cor do tema (var CSS) como RGB de 0 a 1, do jeito que o navegador resolveu. */
function readColor(probe: HTMLElement, cssVar: string): Rgb {
  probe.style.color = `var(${cssVar})`;
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  if (!m || m.length < 3) return [0.89, 0.23, 0];
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

/**
 * Fundo das telas de entrada, minimalista: poucos pontinhos flutuando devagar (Particles do React
 * Bits), metade na cor da marca da loja e metade no cinza do texto. Fica atrás de tudo, sem
 * receber clique nem foco.
 */
export function LoginBackdrop() {
  const probe = useRef<HTMLSpanElement>(null);
  const [colors, setColors] = useState<Rgb[] | null>(null);

  useEffect(() => {
    const read = () => {
      const el = probe.current;
      if (!el) return;
      const next = [readColor(el, '--cm-brand-500'), readColor(el, '--cm-text-subtle')];
      // Mesma cor de antes: não recria os pontos (cada leitura sortearia outros lugares).
      setColors((prev) => (prev && prev.flat().join() === next.flat().join() ? prev : next));
    };
    read();
    // A identidade da loja e o tema (claro/escuro) podem chegar depois do primeiro quadro.
    window.addEventListener(BRAND_EVENT, read);
    window.addEventListener(BRAND_CACHED_EVENT, read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', read);
    const head = new MutationObserver(read);
    head.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener(BRAND_EVENT, read);
      window.removeEventListener(BRAND_CACHED_EVENT, read);
      mo.disconnect();
      scheme?.removeEventListener?.('change', read);
      head.disconnect();
    };
  }, []);

  return (
    <div className="login__bg" aria-hidden>
      <span ref={probe} className="login__bg-probe" />
      {colors && (
        <Particles
          className="login__particles"
          colors={colors}
          count={160}
          spread={6}
          speed={0.08}
          baseSize={120}
        />
      )}
    </div>
  );
}
