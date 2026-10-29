import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Janelas que nascem de quem foi clicado (jeito do iOS, "vidro líquido").
 *
 * No computador e no tablet a janela sai do próprio botão (ou linha, cartão...) que a abriu, estica até
 * o tamanho final passando um nadinha do ponto e, ao fechar, volta para dentro dele. Só transform e
 * opacidade se movem (rodam na placa de vídeo); o conteúdo aparece logo depois da forma e o vidro
 * (desfoque do fundo) liga só quando ela para. No celular continua a folha que sobe de baixo, e ao
 * fechar ela desce em vez de sumir.
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
/** Celular: folha que sobe de baixo (mesmo corte do CSS, 640px). */
export const isPhone = () => media('(max-width: 640px)');

/** Curva da abertura: passa um pouco do ponto e assenta (como a mola do iOS). */
const OPEN_EASE = 'cubic-bezier(.25, 1.12, .4, 1)';
const CLOSE_EASE = 'cubic-bezier(.4, 0, .2, 1)';
/** Curva das folhas do iOS. */
const SHEET_EASE = 'cubic-bezier(.32, .72, 0, 1)';

function visibleRect(el: Element | null): DOMRect | null {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  return r;
}

function transformFrom(a: DOMRect, to: DOMRect) {
  const sx = Math.max(0.05, a.width / to.width);
  const sy = Math.max(0.03, a.height / to.height);
  return `translate(${a.left - to.left}px, ${a.top - to.top}px) scale(${sx}, ${sy})`;
}

type Morph = { anims: Animation[]; timer: number };
/** morph: janela/folha; panel: painel que desliza da direita. */
export type LiquidKind = 'morph' | 'panel';

/** A janela já aberta (showModal) nasce do retângulo de quem abriu. */
function morphIn(d: HTMLElement, from: DOMRect | null, m: Morph, onDone: () => void) {
  const to = d.getBoundingClientRect();
  if (!to.width || !to.height) return onDone();
  d.style.transformOrigin = '0 0';
  const start = from
    ? transformFrom(from, to)
    : `translate(${to.width * 0.03}px, ${to.height * 0.03}px) scale(.94)`;
  const shape = d.animate(
    [
      { transform: start, opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: from ? 380 : 260, easing: OPEN_EASE },
  );
  const inner = Array.from(d.children).map((c) =>
    (c as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      delay: from ? 140 : 60,
      easing: 'ease-out',
      fill: 'backwards',
    }),
  );
  m.anims = [shape, ...inner];
  shape.onfinish = () => {
    m.anims = [];
    d.style.transformOrigin = '';
    onDone();
  };
}

/** Folha do celular: sobe de baixo com a curva do iOS. */
function sheetIn(d: HTMLElement, m: Morph, onDone: () => void) {
  const h = d.getBoundingClientRect().height || innerHeight;
  const up = d.animate([{ translate: `0 ${h}px` }, { translate: '0 0' }], {
    duration: 380,
    easing: SHEET_EASE,
  });
  m.anims = [up];
  up.onfinish = () => {
    m.anims = [];
    onDone();
  };
}

/**
 * Abre um <dialog> nascendo de quem foi clicado (celular: sobe de baixo; painel lateral: entra da
 * direita pelo CSS). Para janelas que somem do React ao fechar e por isso não têm volta animada.
 * Devolve quem abriu, para a volta.
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
  d.removeAttribute('data-glass');
  d.showModal?.();
  const glass = () => d.setAttribute('data-glass', '');
  if (!animate) glass();
  else if (isPhone()) sheetIn(d, s, glass);
  else morphIn(d, visibleRect(anchor), s, glass);
  return anchor;
}

/** Painel lateral: sai pela direita. */
function panelOut(d: HTMLElement, m: Morph, done: () => void) {
  m.anims.push(
    d.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], {
      duration: 240,
      easing: SHEET_EASE,
      fill: 'forwards',
    }),
  );
  try {
    m.anims.push(
      d.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 240,
        fill: 'forwards',
        pseudoElement: '::backdrop',
      }),
    );
  } catch {
    /* sem animação no ::backdrop */
  }
  m.timer = window.setTimeout(done, 230);
}

/** Volta para dentro de quem abriu (ou, no celular, desce) e só então chama done. */
function morphOut(d: HTMLElement, anchor: Element | null, m: Morph, done: () => void) {
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
  if (isPhone()) {
    const r = d.getBoundingClientRect();
    const cur = getComputedStyle(d).transform;
    const down = d.animate(
      [
        { transform: cur === 'none' ? 'none' : cur },
        { transform: `translateY(${innerHeight - r.top + 24}px)` },
      ],
      { duration: 260, easing: SHEET_EASE, fill: 'forwards' },
    );
    m.anims.push(down);
    backdrop([{ opacity: 1 }, { opacity: 0 }], 260);
    m.timer = window.setTimeout(done, 250);
    return;
  }
  const to = d.getBoundingClientRect();
  const from = visibleRect(anchor);
  d.style.transformOrigin = '0 0';
  const end = from
    ? transformFrom(from, to)
    : `translate(${to.width * 0.03}px, ${to.height * 0.03}px) scale(.94)`;
  Array.from(d.children).forEach((c) =>
    m.anims.push(
      (c as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 110,
        fill: 'forwards',
      }),
    ),
  );
  m.anims.push(
    d.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: end, opacity: 0 },
      ],
      { duration: from ? 240 : 170, easing: CLOSE_EASE, fill: 'forwards' },
    ),
  );
  backdrop([{ opacity: 1 }, { opacity: 0 }], 220);
  m.timer = window.setTimeout(done, from ? 230 : 160);
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
        d.setAttribute('data-glass', '');
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
    d.removeAttribute('data-glass');
    (kind === 'panel' ? panelOut.bind(null, d, s) : morphOut.bind(null, d, anchor.current, s))(
      () => {
        s.timer = 0;
        d.close?.();
        reset();
        setClosing(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const s = m.current;
    return () => {
      clearTimeout(s.timer);
      s.anims.forEach((a) => a.cancel());
    };
  }, []);

  return { shown: open || closing, closing };
}
