import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { spring, SPRINGS } from './spring';

/**
 * Abrir e fechar janelas: simples e rápido.
 *
 * A janela abre no centro da tela (o CSS centraliza), sólida, com um esmaecer curto e um nada de
 * escala; fecha do mesmo jeito. No celular a folha sobe de baixo; arrastada para baixo, desce. Não
 * há vidro (desfoque) nem janela que nasce do botão: isso custava quadros em máquina fraca.
 *
 * "Reduzir movimento", navegador sem Web Animations e testes (jsdom) abrem e fecham na hora.
 */

/** Último toque, guardado na fase de captura (antes do React abrir a janela). */
let lastPress: { el: Element; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPress = { el: e.target as Element, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

const ANCHOR =
  'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], label, tr, li, .cm-card';

/** Quem abriu a janela: o último toque (até 1,5 s atrás) ou, pelo teclado, o elemento com foco. */
export function pressedAnchor(): Element | null {
  if (typeof document === 'undefined') return null;
  const fresh =
    lastPress && performance.now() - lastPress.at < 1500 && lastPress.el.isConnected
      ? lastPress.el
      : null;
  const focus =
    document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  const base = fresh ?? focus;
  const el = base?.closest(ANCHOR) ?? base;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? el : null;
}

const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
/** Pode animar: tem Web Animations e a pessoa não pediu menos movimento. */
export const canAnimate = (el: Element | null | undefined) =>
  !!el &&
  typeof (el as HTMLElement).animate === 'function' &&
  typeof matchMedia === 'function' &&
  !media('(prefers-reduced-motion: reduce)');

/** Molas (spring.ts): a janela estica e assenta; a folha sobe sem pulo. */
const smooth = () => spring(...SPRINGS.smooth);
/** Volta para dentro do botão: acelera no fim, como se fosse sugada. */
const CLOSE_EASE = 'cubic-bezier(.4, 0, .2, 1)';
/** Curva das folhas do iOS. */
const SHEET_EASE = 'cubic-bezier(.32, .72, 0, 1)';

/** Folha (ocupa a largura toda da tela, presa embaixo): celular e tablet em pé. */
const isSheetBox = (r: DOMRect) => r.width >= innerWidth - 2;

type Morph = { anims: Animation[]; timer: number };
/** morph: janela/folha; panel: painel que desliza da direita. */
export type LiquidKind = 'morph' | 'panel';

/** A janela já aberta (showModal) esmaece no lugar; a folha do celular sobe de baixo. */
function morphIn(d: HTMLElement, m: Morph, onDone: () => void) {
  const to = d.getBoundingClientRect();
  if (!to.width || !to.height) return onDone();
  const sheet = isSheetBox(to);
  const shape = d.animate(
    [
      { transform: sheet ? `translateY(${Math.min(to.height, 140)}px)` : 'scale(.98)' },
      { transform: 'none' },
    ],
    sheet ? smooth() : { duration: 120, easing: 'ease-out' },
  );
  const fade = d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: 'ease-out' });
  m.anims = [shape, fade];
  shape.onfinish = () => {
    m.anims = [];
    onDone();
  };
}

/**
 * Abre um <dialog> no centro (celular: folha que sobe; painel lateral: entra da direita pelo CSS).
 * Devolve quem abriu, para o foco voltar a ele.
 */
export function showLiquid(
  d: HTMLDialogElement,
  kind: LiquidKind = 'morph',
  m?: Morph,
): Element | null {
  const s = m ?? { anims: [], timer: 0 };
  const anchor = pressedAnchor();
  const animate = canAnimate(d) && kind !== 'panel';
  if (animate) d.setAttribute('data-liquid', '');
  else d.removeAttribute('data-liquid');
  d.showModal?.();
  if (animate) morphIn(d, s, () => undefined);
  return anchor;
}

/** Painel lateral: sai pela direita. */
function panelOut(d: HTMLElement, m: Morph, done: () => void) {
  m.anims.push(
    d.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], {
      duration: 180,
      easing: SHEET_EASE,
      fill: 'forwards',
    }),
  );
  try {
    m.anims.push(
      d.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180,
        fill: 'forwards',
        pseudoElement: '::backdrop',
      }),
    );
  } catch {
    /* sem animação no ::backdrop */
  }
  m.timer = window.setTimeout(done, 170);
}

/** Fecha esmaecendo no lugar (a folha do celular desce) e só então chama done. */
function morphOut(d: HTMLElement, m: Morph, done: () => void) {
  m.anims.forEach((a) => a.cancel());
  m.anims = [];
  const backdrop = (keyframes: Keyframe[], duration: number) => {
    try {
      m.anims.push(
        d.animate(keyframes, { duration, fill: 'forwards', pseudoElement: '::backdrop' }),
      );
    } catch {
      /* navegador sem animação no ::backdrop: o fundo some junto com o close() */
    }
  };
  const to = d.getBoundingClientRect();
  // A folha do celular sempre desce de onde está (arrastada ou não).
  if (isSheetBox(to)) {
    const cur = getComputedStyle(d).transform;
    const down = d.animate(
      [
        { transform: cur === 'none' ? 'none' : cur },
        { transform: `translateY(${innerHeight - to.top + 24}px)` },
      ],
      { duration: 160, easing: SHEET_EASE, fill: 'forwards' },
    );
    m.anims.push(down);
    backdrop([{ opacity: 1 }, { opacity: 0 }], 160);
    m.timer = window.setTimeout(done, 150);
    return;
  }
  // Fecha no lugar, esmaecendo.
  const dur = 100;
  m.anims.push(
    d.animate([{ transform: 'none' }, { transform: 'scale(.98)' }], {
      duration: dur,
      easing: CLOSE_EASE,
      fill: 'forwards',
    }),
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' }),
  );
  backdrop([{ opacity: 1 }, { opacity: 0 }], dur);
  m.timer = window.setTimeout(done, dur - 10);
}

/**
 * Abre e fecha um <dialog> com a animação acima. Devolve `shown`: verdadeiro enquanto a janela está
 * aberta ou ainda fechando (o conteúdo continua na tela até ela sumir). Quem usa trata o Esc no
 * onCancel (preventDefault + onClose) para o fechamento também ser animado.
 *
 * Marca o dialog com data-liquid (o CSS desliga a animação de entrada própria) e data-glass quando a
 * forma parou (o CSS liga o vidro).
 */
export function useLiquidDialog(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
  kind: LiquidKind = 'morph',
) {
  const [closing, setClosing] = useState(false);
  const anchor = useRef<Element | null>(null);
  const m = useRef<Morph>({ anims: [], timer: 0 });

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const s = m.current;
    const reset = () => {
      clearTimeout(s.timer);
      s.anims.forEach((a) => a.cancel());
      s.anims = [];
      d.style.transformOrigin = '';
    };
    if (open) {
      if (closing || s.timer) {
        // reaberta no meio do fechamento: volta ao normal sem piscar
        reset();
        s.timer = 0;
        setClosing(false);
        return;
      }
      if (d.open) return;
      anchor.current = showLiquid(d, kind, s);
      return;
    }
    if (!d.open) {
      reset();
      setClosing(false);
      return;
    }
    // Navegador de teste (Playwright): fecha na hora, como antes. O conteúdo que ainda está saindo
    // repetiria textos da tela e confundiria as buscas por texto dos testes.
    if (!canAnimate(d) || !d.isConnected || navigator.webdriver) {
      reset();
      d.close?.();
      setClosing(false);
      return;
    }
    setClosing(true);
    (kind === 'panel' ? panelOut.bind(null, d, s) : morphOut.bind(null, d, s))(() => {
      s.timer = 0;
      d.close?.();
      reset();
      setClosing(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const s = m.current;
    const d = ref.current;
    return () => {
      // StrictMode (desenvolvimento) desmonta e remonta de mentira com a janela ainda na tela.
      // Cortar a mola aqui deixava a janela "ocupada" para sempre: sem vidro e sem voltar para
      // dentro da tela quando o conteúdo crescia (o rodapé com Salvar ficava fora da tela).
      if (d?.isConnected) return;
      clearTimeout(s.timer);
      s.anims.forEach((a) => a.cancel());
    };
  }, []);

  return { shown: open || closing, closing };
}
