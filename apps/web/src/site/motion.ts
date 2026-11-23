import Lenis from 'lenis';
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Rolagem do site público: suave no computador (Lenis, só com mouse ou trackpad; no toque fica a
 * rolagem nativa do aparelho) e cenas ligadas à rolagem. Cada cena só escreve variáveis CSS
 * (`--p` de 0 a 1) e o CSS move tudo com transform e opacity. Um único laço por quadro, e só
 * quando a página rola ou muda de tamanho. Com "reduzir movimento" nada disso liga.
 */

export const calmMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

interface Scene {
  els: HTMLElement[];
  apply: (rects: DOMRect[], vh: number) => void;
}

const scenes = new Set<Scene>();
let queued = 0;
let lenis: Lenis | null = null;

function run() {
  queued = 0;
  const vh = window.innerHeight;
  const list = [...scenes];
  // Primeiro mede tudo e depois escreve: medir no meio das escritas força o navegador a refazer a
  // página várias vezes no mesmo quadro.
  const rects = list.map((s) => s.els.map((el) => el.getBoundingClientRect()));
  list.forEach((s, i) => s.apply(rects[i]!, vh));
}

function schedule() {
  if (!queued) queued = requestAnimationFrame(run);
}

/** Registra uma cena: `apply` recebe a posição dos elementos na tela a cada quadro de rolagem. */
function useScene(
  getEls: () => (HTMLElement | null | undefined)[],
  apply: Scene['apply'],
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (calmMotion()) return;
    const els = getEls().filter((x): x is HTMLElement => !!x);
    if (!els.length) return;
    const scene: Scene = { els, apply };
    scenes.add(scene);
    schedule();
    return () => {
      scenes.delete(scene);
    };
  }, deps);
}

/**
 * Progresso de um elemento pela tela, em `--p` no próprio elemento.
 * - `enter`: 0 quando o topo aparece embaixo, 1 quando chega a `until` da altura da tela.
 * - `pin`: seção alta com conteúdo preso (sticky): 0 no início, 1 quando o fim chega embaixo.
 * - `leave`: 0 com o elemento no lugar, 1 quando ele saiu inteiro por cima.
 * - `reveal`: 0 quando o topo aparece embaixo, 1 quando o elemento inteiro já está na tela.
 */
export function useScrollProgress<T extends HTMLElement>(
  mode: 'enter' | 'pin' | 'leave' | 'reveal',
  until = 0.35,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useScene(
    () => [ref.current],
    ([r], vh) => {
      if (!r) return;
      const p =
        mode === 'enter'
          ? (vh - r.top) / (vh * (1 - until))
          : mode === 'pin'
            ? -r.top / Math.max(1, r.height - vh)
            : mode === 'reveal'
              ? (vh - r.top) / Math.max(1, r.height)
              : -r.top / Math.max(1, r.height);
      ref.current?.style.setProperty('--p', clamp01(p).toFixed(4));
    },
  );
  return ref;
}

/** Barra de leitura no topo: `--p` de 0 a 1 em toda a página (funciona em qualquer navegador). */
export function useReadingBar<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useScene(
    () => [document.documentElement],
    ([r], vh) => {
      if (!r) return;
      ref.current?.style.setProperty(
        '--p',
        clamp01(-r.top / Math.max(1, r.height - vh)).toFixed(4),
      );
    },
  );
  return ref;
}

/**
 * Profundidade que segue o ponteiro: escreve `--tx` e `--ty` (-1 a 1, posição do mouse em relação
 * ao centro do elemento) e o CSS gira o palco em 3D com elas. Só com mouse (no toque fica parado
 * no ângulo de descanso), só enquanto o elemento está na tela e nunca com "reduzir movimento".
 * O valor anda até o alvo aos poucos, para o giro ficar macio.
 */
export function useTilt<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calmMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let id = 0;
    const frame = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty('--tx', x.toFixed(4));
      el.style.setProperty('--ty', y.toFixed(4));
      id = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(frame) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      tx = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / r.width) * 2));
      ty = Math.max(-1, Math.min(1, ((e.clientY - (r.top + r.height / 2)) / r.height) * 2));
      if (!id) id = requestAnimationFrame(frame);
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      if (!id) id = requestAnimationFrame(frame);
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(id);
    };
  }, []);
  return ref;
}

/** Liga a rolagem suave (computador) e o laço das cenas. Use uma vez, na raiz do site. */
export function useSmoothScroll() {
  useEffect(() => {
    if (calmMotion()) return;
    const onScroll = () => schedule();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // Só com mouse ou trackpad: no celular a rolagem nativa já é a melhor.
    if (window.matchMedia('(pointer: fine)').matches) {
      lenis = new Lenis({
        autoRaf: true,
        lerp: 0.11,
        wheelMultiplier: 0.95,
        // Links do menu (#preco etc.): o Lenis desconta scroll-margin e scroll-padding juntos;
        // somamos de volta um deles para a seção parar logo abaixo do menu.
        anchors: { offset: 72 },
        allowNestedScroll: true,
        // Janela aberta (<dialog>) ou campo de texto: a rolagem é deles, não da página.
        prevent: (node) =>
          !!document.querySelector('dialog[open]') ||
          !!node.closest?.('textarea, [data-lenis-prevent]'),
      });
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      lenis?.destroy();
      lenis = null;
    };
  }, []);
}

/** Leva a página até um elemento (suave, pelo mesmo motor da rolagem quando ele está ligado). */
export function scrollToEl(el: HTMLElement | null, center = false) {
  if (!el) return;
  if (lenis) {
    // O Lenis já desconta o scroll-margin do elemento e o scroll-padding da página; aqui só
    // ajustamos para o elemento parar logo abaixo do menu (ou no meio da tela).
    const extra = edges(el);
    const offset = center ? extra - (window.innerHeight - el.offsetHeight) / 2 : extra - 76;
    lenis.scrollTo(el, { offset, duration: 1.1 });
  } else {
    el.scrollIntoView({
      behavior: calmMotion() ? 'auto' : 'smooth',
      block: center ? 'center' : 'start',
    });
  }
}

/** scroll-margin do elemento + scroll-padding da página (o que o Lenis desconta sozinho). */
function edges(el: HTMLElement) {
  const n = (v: string) => parseFloat(v) || 0;
  return (
    n(getComputedStyle(el).scrollMarginTop) +
    n(getComputedStyle(document.documentElement).scrollPaddingTop)
  );
}
