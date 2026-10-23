/**
 * Transição "foto que cresce": o cartão guarda onde a foto estava; a tela do produto anima a
 * foto grande saindo desse ponto (técnica FLIP, funciona em qualquer navegador).
 */
let pending: { id: string; rect: DOMRect; at: number } | null = null;

export function setMorph(id: string, rect: DOMRect) {
  pending = { id, rect, at: Date.now() };
}

export function takeMorph(id: string): DOMRect | null {
  const p = pending;
  pending = null;
  return p && p.id === id && Date.now() - p.at < 1000 ? p.rect : null;
}

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
