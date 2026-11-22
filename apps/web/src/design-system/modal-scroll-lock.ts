/**
 * Janela ou folha aberta (`<dialog>` modal) prende a rolagem nela: no iPhone, arrastar o dedo
 * dentro da folha rolava a página de trás quando a lista chegava ao fim ou quando o toque
 * começava numa parte que não rola (topo, rodapé, alça). O CSS (`html:has(dialog:modal)`) tira a
 * rolagem da página; aqui o toque que não tem o que rolar dentro da janela é barrado.
 */

/** Elemento que rola na vertical a partir de `el`, subindo até `stop` (inclusive). */
export function scrollableAncestor(el: Element | null, stop: Element): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;
    }
    if (n === stop) break;
  }
  return null;
}

/**
 * O arrasto (dy > 0 = dedo descendo, conteúdo subindo para o topo) ainda rola `el`?
 * No topo puxando para baixo ou no fim empurrando para cima, não: o navegador passaria a
 * rolagem para a página.
 */
export function canScroll(
  el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  dy: number,
) {
  if (dy > 0) return el.scrollTop > 0;
  if (dy < 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  return true;
}

let installed = false;

export function installModalScrollLock() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let lastX = 0;
  let lastY = 0;
  document.addEventListener(
    'touchstart',
    (e) => {
      lastX = e.touches[0]?.clientX ?? 0;
      lastY = e.touches[0]?.clientY ?? 0;
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1 || !e.cancelable) return;
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
      const top = dialogs[dialogs.length - 1];
      if (!top || !isModal(top)) return;
      const { clientX: x, clientY: y } = e.touches[0]!;
      const dx = x - lastX;
      const dy = y - lastY;
      lastX = x;
      lastY = y;
      // Arrasto de lado (fileira de chips, carrossel) segue normal.
      if (Math.abs(dx) > Math.abs(dy)) return;
      const target = e.target instanceof Element ? e.target : null;
      // Campo de texto com o cursor dentro: deixa o navegador cuidar (selecionar texto).
      if (target?.closest('input, select')) return;
      if (!target || !top.contains(target)) return e.preventDefault();
      const box = scrollableAncestor(target, top);
      if (!box || !canScroll(box, dy)) e.preventDefault();
    },
    { passive: false },
  );
}

function isModal(d: HTMLDialogElement) {
  try {
    return d.matches(':modal');
  } catch {
    return true;
  }
}
