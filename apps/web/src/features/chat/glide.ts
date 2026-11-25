/**
 * Mensagem nova no fim da conversa: as de cima sobem deslizando até o lugar novo, em vez de
 * pularem de uma vez (o pulo, junto com o balão novo entrando, parecia uma piscada ao enviar).
 *
 * É o FLIP de sempre, só com transform: antes da troca (no render) guarda onde a última mensagem
 * estava na tela; depois da troca (no useLayoutEffect, já rolado até o fim) mede de novo e anima o
 * miolo da conversa da diferença até zero. Vale no chat em balões do cardápio, do suporte, dos
 * clientes e no chat da equipe (cada mensagem tem `data-k` com a chave dela).
 */

/** Mola padrão do sistema (tokens.css): o navegador que não entende linear() recebe a curva comum. */
function spring(): { easing: string; duration: number } {
  if (typeof document === 'undefined') return { easing: 'ease-out', duration: 260 };
  const css = getComputedStyle(document.documentElement);
  const easing = css.getPropertyValue('--cm-spring').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
  const duration = parseFloat(css.getPropertyValue('--cm-spring-dur')) || 260;
  return { easing, duration };
}

const reduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Elemento da mensagem pela chave (as chaves são ids ou `local-N`, sem aspas). */
export function messageEl(root: ParentNode | null, key: string | undefined): HTMLElement | null {
  if (!root || !key || /["\\]/.test(key)) return null;
  return root.querySelector<HTMLElement>(`[data-k="${key}"]`);
}

/** Onde a mensagem está na tela agora (topo, em px), ou null se ela não está na conversa. */
export function topOf(root: ParentNode | null, key: string | undefined): number | null {
  const el = messageEl(root, key);
  return el ? el.getBoundingClientRect().top : null;
}

/** Quanto a conversa subiu (px) para dar lugar ao que entrou; 0 se não subiu ou se pulou demais. */
export function glideShift(before: number | null, after: number | null, viewport: number): number {
  if (before === null || after === null) return 0;
  const dy = Math.round(before - after);
  // Menos de 2px não dá para ver; mais que a altura da conversa é troca de tela, não mensagem.
  return dy >= 2 && dy <= viewport ? dy : 0;
}

/**
 * Anima `inner` de `dy` px mais embaixo até o lugar dele. Interrompe a animação anterior (duas
 * mensagens seguidas continuam do ponto em que a outra estava, sem tranco).
 */
export function glide(inner: HTMLElement | null, dy: number) {
  if (!inner || dy <= 0 || reduced() || typeof inner.animate !== 'function') return;
  const { easing, duration } = spring();
  const running = inner.getAnimations?.().find((a) => a.id === 'cm-glide');
  let from = dy;
  if (running) {
    // Ainda subindo: soma o que faltava, para a conversa não voltar para trás.
    const m = new DOMMatrixReadOnly(getComputedStyle(inner).transform);
    from += Number.isFinite(m.m42) ? m.m42 : 0;
    running.cancel();
  }
  try {
    const a = inner.animate(
      [{ transform: `translate3d(0, ${from}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: Math.min(duration, 300), easing },
    );
    a.id = 'cm-glide';
  } catch {
    // Curva que o navegador não aceita no animate(): segue sem a animação.
  }
}
