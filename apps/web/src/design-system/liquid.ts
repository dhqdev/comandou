import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { spring, SPRINGS } from './spring';

/**
 * Janelas que nascem de quem foi clicado (jeito do iOS, "vidro líquido").
 *
 * No computador e no tablet a janela abre perto do próprio botão (ou linha, cartão...) que a abriu,
 * não no meio da tela: botão à direita, janela à direita; embaixo dele se couber. Ela já nasce no
 * lugar final e só cresce (escala rápida com mola discreta) a partir do canto mais perto do botão,
 * sem viajar pela tela; ao fechar, encolhe para esse lado. Depois de aberta nunca desliza: se o
 * conteúdo crescer, é empurrada para dentro da tela no mesmo quadro. Só transform e opacidade se
 * movem (placa de vídeo) e o vidro (desfoque do fundo) liga só quando ela para. No celular a folha
 * sobe rápido de baixo; arrastada para baixo, desce.
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
const expand = () => spring(...SPRINGS.expand);
const smooth = () => spring(...SPRINGS.smooth);
/** Volta para dentro do botão: acelera no fim, como se fosse sugada. */
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

/** Folha (ocupa a largura toda da tela, presa embaixo): celular e tablet em pé. */
const isSheetBox = (r: DOMRect) => r.width >= innerWidth - 2;

/* ---------------------------------------------------------------- perto de quem abriu */
/** Respiro da borda da tela e distância do botão. */
const EDGE = 12;
const GAP = 8;
type Placed = { left: number; top: number; busy: boolean; off: () => void };
const placed = new WeakMap<HTMLElement, Placed>();

/** Parte visível da tela (o teclado do tablet encolhe a altura). */
function visibleArea() {
  const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
  return { top: vv ? Math.max(0, vv.offsetTop) : 0, h: vv ? vv.height : innerHeight };
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
function clampTo(left: number, top: number, w: number, h: number) {
  const area = visibleArea();
  return {
    left: clamp(left, EDGE, innerWidth - w - EDGE),
    top: clamp(top, area.top + EDGE, area.top + area.h - h - EDGE),
  };
}

/**
 * Onde a janela fica, ao lado de quem abriu: botão à direita, janela alinhada pela direita (e
 * vice-versa); embaixo do botão se couber, senão em cima, senão o mais perto possível dele.
 */
export function nearAnchor(a: DOMRect, w: number, h: number) {
  const area = visibleArea();
  const cx = a.left + a.width / 2;
  const left =
    a.width >= w
      ? cx - w / 2
      : cx > innerWidth * 0.6
        ? a.right - w
        : cx < innerWidth * 0.4
          ? a.left
          : cx - w / 2;
  const bottom = area.top + area.h - EDGE;
  // Janela que ainda carrega abre baixinha e cresce: só vai para baixo do botão se couber uma
  // janela de tamanho comum, senão ela teria de mudar de lugar quando os dados chegam.
  const room = Math.max(h, Math.min(area.h * 0.55, 420));
  const top =
    a.bottom + GAP + room <= bottom
      ? a.bottom + GAP
      : a.top - GAP - room >= area.top + EDGE
        ? a.top - GAP - h
        : a.top + a.height / 2 - h / 2;
  return clampTo(left, top, w, h);
}

function setInset(d: HTMLElement, left: number, top: number) {
  d.style.margin = '0';
  d.style.inset = `${Math.round(top)}px auto auto ${Math.round(left)}px`;
}

/** Tira a janela do lugar marcado (volta ao centro do CSS) e para de vigiar o tamanho. */
function unplace(d: HTMLElement) {
  placed.get(d)?.off();
  placed.delete(d);
  d.style.removeProperty('margin');
  d.style.removeProperty('inset');
  d.removeAttribute('data-at');
}

/**
 * Conteúdo que chega depois (carregando → dados da mesa) ou tela que muda de tamanho: se a janela
 * passou da borda, ela é empurrada para dentro no mesmo quadro (o ResizeObserver roda antes de
 * pintar), sem deslizar: a janela só cresce para cima. Antes ela abria embaixo e subia depois.
 */
function keepInView(d: HTMLElement) {
  const p = placed.get(d);
  if (!p || !(d as HTMLDialogElement).open) return;
  const next = clampTo(p.left, p.top, d.offsetWidth, d.offsetHeight);
  if (Math.abs(p.left - next.left) < 1 && Math.abs(p.top - next.top) < 1) return;
  p.left = next.left;
  p.top = next.top;
  setInset(d, next.left, next.top);
}

/** Põe a janela (já aberta) perto de quem abriu. Devolve o retângulo final. */
function placeNear(d: HTMLElement, a: DOMRect, box: DOMRect): DOMRect {
  unplace(d);
  const { left, top } = nearAnchor(a, box.width, box.height);
  setInset(d, left, top);
  d.setAttribute('data-at', '');
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => keepInView(d)) : null;
  ro?.observe(d);
  const onResize = () => keepInView(d);
  window.addEventListener('resize', onResize);
  visualViewport?.addEventListener('resize', onResize);
  const onClose = () => unplace(d);
  d.addEventListener('close', onClose, { once: true });
  placed.set(d, {
    left,
    top,
    busy: true,
    off: () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      visualViewport?.removeEventListener('resize', onResize);
      d.removeEventListener('close', onClose);
    },
  });
  return new DOMRect(left, top, box.width, box.height);
}
/** A forma parou: daqui em diante o tamanho pode mudar e a janela se ajusta. */
function settle(d: HTMLElement) {
  const p = placed.get(d);
  if (!p) return;
  p.busy = false;
  keepInView(d);
}

type Morph = { anims: Animation[]; timer: number };
/** morph: janela/folha; panel: painel que desliza da direita. */
export type LiquidKind = 'morph' | 'panel';

/**
 * A janela já aberta (showModal) vai para perto de quem abriu e estica a partir dele com mola,
 * passando um nadinha do tamanho e assentando. Folha (celular): cresce do botão até a folha, sem
 * pulo; sem botão à vista, sobe de baixo.
 */
function morphIn(d: HTMLElement, from: DOMRect | null, m: Morph, onDone: () => void) {
  let to = d.getBoundingClientRect();
  if (!to.width || !to.height) return onDone();
  const sheet = isSheetBox(to);
  if (from && !sheet) to = placeNear(d, from, to);
  // Abre JÁ no lugar final: só cresce (escala) a partir do canto mais perto de quem abriu, sem
  // viajar pela tela. Antes ela saía do botão e subia até o lugar, o que parecia "abrir embaixo e
  // depois subir". Folha do celular: sobe rápido de baixo.
  if (!sheet) d.style.transformOrigin = originToward(from, to);
  const start = sheet ? `translateY(${Math.min(to.height, 140)}px)` : 'scale(.94)';
  const shape = d.animate(
    [{ transform: start }, { transform: 'none' }],
    sheet ? smooth() : expand(),
  );
  const fade = d.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: sheet ? 120 : 90,
    easing: 'ease-out',
  });
  m.anims = [shape, fade];
  shape.onfinish = () => {
    m.anims = [];
    d.style.transformOrigin = '';
    settle(d);
    onDone();
  };
}

/** Ponto da janela mais perto de quem abriu (origem da escala); sem botão, o meio. */
function originToward(a: DOMRect | null, to: DOMRect) {
  if (!a) return '50% 50%';
  const x = clamp(a.left + a.width / 2 - to.left, 0, to.width);
  const y = clamp(a.top + a.height / 2 - to.top, 0, to.height);
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

/**
 * Abre um <dialog> nascendo de quem foi clicado e perto dele (celular: folha que cresce do botão;
 * painel lateral: entra da direita pelo CSS). Para janelas que somem do React ao fechar e por isso
 * não têm volta animada. Devolve quem abriu, para a volta.
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
  if (!animate) {
    // sem animação (reduzir movimento, testes): mesmo assim abre perto de quem abriu
    const from = kind === 'panel' ? null : visibleRect(anchor);
    const box = d.getBoundingClientRect?.();
    if (from && box?.width && !isSheetBox(box)) {
      placeNear(d, from, box);
      settle(d);
    }
    glass();
  } else morphIn(d, visibleRect(anchor), s, glass);
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

/**
 * Volta para dentro de quem abriu e só então chama done. Folha arrastada para baixo (ou sem o
 * botão à vista) desce dali mesmo.
 */
function morphOut(d: HTMLElement, anchor: Element | null, m: Morph, done: () => void) {
  m.anims.forEach((a) => a.cancel());
  m.anims = [];
  const p = placed.get(d);
  if (p) p.busy = true;
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
  const from = visibleRect(anchor);
  const dragged = !!d.style.getPropertyValue('--drag');
  if (isSheetBox(to) && (dragged || !from)) {
    const cur = getComputedStyle(d).transform;
    const down = d.animate(
      [
        { transform: cur === 'none' ? 'none' : cur },
        { transform: `translateY(${innerHeight - to.top + 24}px)` },
      ],
      { duration: 190, easing: SHEET_EASE, fill: 'forwards' },
    );
    m.anims.push(down);
    backdrop([{ opacity: 1 }, { opacity: 0 }], 190);
    m.timer = window.setTimeout(done, 180);
    return;
  }
  // Fecha no lugar, encolhendo para o lado de quem abriu (sem viajar até o botão).
  if (!isSheetBox(to)) d.style.transformOrigin = originToward(from, to);
  const dur = 120;
  m.anims.push(
    d.animate(
      [{ transform: 'none' }, { transform: isSheetBox(to) ? 'translateY(60px)' : 'scale(.95)' }],
      {
        duration: dur,
        easing: CLOSE_EASE,
        fill: 'forwards',
      },
    ),
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
        d.setAttribute('data-glass', '');
        settle(d);
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
