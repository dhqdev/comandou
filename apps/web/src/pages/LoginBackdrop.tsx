import { useEffect, useRef, useState } from 'react';
import { BRAND_CACHED_EVENT, BRAND_EVENT } from '../design-system';
import Aurora from './reactbits/Aurora';

type Rgb = [number, number, number];

/** Lê uma cor do tema (var CSS) como RGB de 0 a 1, do jeito que o navegador resolveu. */
function readColor(probe: HTMLElement, cssVar: string): Rgb {
  probe.style.color = `var(${cssVar})`;
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  if (!m || m.length < 3) return [0.89, 0.23, 0];
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

/**
 * Fundo das telas de entrada: aurora na cor da marca (a da loja, quando ela tem uma) descendo do
 * topo, uma grade de pontinhos que some nas bordas e um brilho suave atrás do formulário. Fica
 * atrás de tudo, sem receber clique nem foco.
 */
export function LoginBackdrop() {
  const probe = useRef<HTMLSpanElement>(null);
  const [stops, setStops] = useState<[Rgb, Rgb, Rgb] | null>(null);
  const [light, setLight] = useState(false);

  useEffect(() => {
    const read = () => {
      const el = probe.current;
      if (!el) return;
      // Bordas na cor da marca e o meio um pouco mais claro: dá o brilho sem trazer outra cor.
      const brand = readColor(el, '--cm-brand-500');
      const light = brand.map((c) => c + (1 - c) * 0.35) as Rgb;
      setStops([brand, light, brand]);
      const [r, g, b] = readColor(el, '--cm-surface');
      setLight(0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5);
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
      {stops && (
        <Aurora
          className="login__aurora"
          colorStops={stops}
          amplitude={1.1}
          blend={0.6}
          speed={0.6}
          flat={light}
        />
      )}
      <div className="login__dots" />
      <div className="login__glow" />
    </div>
  );
}
