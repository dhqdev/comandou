/**
 * Puxar para recarregar (app instalado na tela inicial).
 *
 * O app instalado (e o navegador em tela cheia) não tem a barra nem o "puxar para atualizar" do
 * navegador, e base.css desliga o elástico da página para a moldura não sair do lugar. Aqui:
 * - no topo da tela, puxar para baixo e segurar mostra uma bolinha que vai enchendo; passou do
 *   ponto, ela fica cheia e, ao soltar, a página recarrega. Soltar antes desiste;
 * - no fim da tela, puxar para cima estica o conteúdo um pouco (com resistência) e ele volta
 *   sozinho ao soltar, sem recarregar.
 *
 * Vale para qualquer tela que role (painel, cardápio digital, garçom, entregador). Fica de fora
 * quem começa o toque numa janela, num mapa, num campo de texto ou em [data-no-pull].
 */

/** Quanto puxar (já com a resistência) para valer como "recarregar". */
export const PULL_TRIGGER = 70;
/** Até onde a bolinha e o conteúdo descem. */
const PULL_MAX = 110;
/** Até onde o conteúdo estica no fim da tela. */
const STRETCH_MAX = 90;

/** Resistência: quanto mais puxa, menos anda (como o elástico do iPhone). */
export function rubber(distance: number, max: number) {
  if (distance <= 0) return 0;
  return max * (1 - 1 / (distance / max + 1));
}

const SKIP =
  'dialog, [role="dialog"], [aria-modal="true"], .leaflet-container, input, textarea, select, ' +
  '[contenteditable=""], [contenteditable="true"], [data-no-pull]';

/** Elementos que rolam na vertical, do mais perto do dedo até a página. */
export function scrollChain(target: Element | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let el = target; el && el !== document.body && el !== document.documentElement;) {
    if (el instanceof HTMLElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1)
        chain.push(el);
    }
    el = el.parentElement;
  }
  const page = document.scrollingElement as HTMLElement | null;
  if (page && page.scrollHeight > page.clientHeight + 1) chain.push(page);
  return chain;
}

const atTop = (el: HTMLElement) => el.scrollTop <= 0;
const atBottom = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

/**
 * O que mexe na tela: o conteúdo de dentro de quem rola (ele continua cortado pela caixa, sem
 * passar por cima do cabeçalho). A página inteira rola pelo documento: aí desce o #root.
 */
function moversFor(scroller: HTMLElement | undefined): HTMLElement[] {
  if (!scroller || scroller === document.scrollingElement) {
    const root = document.getElementById('root') ?? document.body;
    return [root];
  }
  return [...scroller.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}

/** Topo visível de quem rola (abaixo do cabeçalho fixo da moldura, se houver). */
function topOf(scroller: HTMLElement | undefined) {
  if (!scroller || scroller === document.scrollingElement) return 0;
  return Math.max(0, scroller.getBoundingClientRect().top);
}

const move = (els: HTMLElement[], y: number) => {
  for (const el of els) el.style.transform = y ? `translateY(${y}px)` : '';
};

function makeIndicator() {
  const el = document.createElement('div');
  el.className = 'cm-ptr';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22"><circle class="cm-ptr__track" cx="12" cy="12" r="9"/>' +
    '<circle class="cm-ptr__ring" cx="12" cy="12" r="9" pathLength="100"/>' +
    '<path class="cm-ptr__arrow" d="M12 8v8m-3.5-3.5L12 16l3.5-3.5"/></svg>';
  return el;
}

interface Options {
  /** Liga também fora do app instalado (testes). */
  force?: boolean;
  /** O que fazer ao soltar depois do ponto (padrão: recarregar a página). */
  onRefresh?: () => void;
}

/** Liga o gesto. Devolve uma função que desliga (testes). */
export function installPullToRefresh(opts: Options = {}): () => void {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // No navegador comum, só em tela cheia (a abinha do topo): aí também some a barra dele.
  const enabled = () => opts.force || standalone || !!document.fullscreenElement;
  const refresh = opts.onRefresh ?? (() => window.location.reload());
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let mode: 'idle' | 'pending' | 'pull' | 'stretch' | 'done' = 'idle';
  let startX = 0;
  let startY = 0;
  let chain: HTMLElement[] = [];
  let movers: HTMLElement[] = [];
  let indicator: HTMLElement | null = null;
  let offset = 0;
  let armed = false;

  const reset = () => {
    mode = 'idle';
    chain = [];
    movers = [];
    offset = 0;
    armed = false;
  };

  const settle = (els: HTMLElement[]) => {
    for (const el of els) {
      el.style.transition = reduced ? '' : 'transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2)';
      el.style.transform = '';
    }
    const clear = () => {
      for (const el of els) {
        el.style.transition = '';
        el.style.willChange = '';
      }
    };
    if (reduced) clear();
    else setTimeout(clear, 360);
  };

  const hideIndicator = () => {
    const el = indicator;
    indicator = null;
    if (!el) return;
    el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = `translate(-50%, ${el.dataset.top ?? 0}px) scale(0.6)`;
    setTimeout(() => el.remove(), 220);
  };

  const onStart = (e: TouchEvent) => {
    if (mode === 'done') return;
    reset();
    if (!enabled() || e.touches.length !== 1) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(SKIP)) return;
    chain = scrollChain(target);
    const t = e.touches[0]!;
    startX = t.clientX;
    startY = t.clientY;
    mode = 'pending';
  };

  const onMove = (e: TouchEvent) => {
    if (mode === 'idle' || mode === 'done') return;
    if (e.touches.length !== 1) {
      end(false);
      return;
    }
    const t = e.touches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (mode === 'pending') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Deslizar para os lados (carrosséis, abas) não é com a gente.
      if (Math.abs(dx) > Math.abs(dy)) return reset();
      if (dy > 0 && chain.every(atTop)) {
        mode = 'pull';
        const page = chain[chain.length - 1];
        movers = moversFor(page);
        indicator = makeIndicator();
        const top = topOf(page);
        indicator.dataset.top = String(top);
        document.body.appendChild(indicator);
      } else if (dy < 0 && chain.length > 0 && atBottom(chain[0]!)) {
        mode = 'stretch';
        movers = moversFor(chain[0]);
      } else return reset();
      // Recomeça a contar daqui: o pedaço até decidir não conta como puxada.
      startY = t.clientY - Math.sign(dy) * 1;
      for (const el of movers) {
        el.style.transition = '';
        el.style.willChange = 'transform';
      }
    }

    const dist = mode === 'pull' ? t.clientY - startY : startY - t.clientY;
    // A página rolou de volta (o dedo voltou além do começo): sai do gesto.
    const edge = mode === 'pull' ? chain.every(atTop) : !chain[0] || atBottom(chain[0]);
    if (!edge) return end(false);
    if (dist <= 0) {
      // Voltou o dedo: devolve a rolagem normal para o navegador.
      move(movers, 0);
      if (indicator) indicator.style.opacity = '0';
      offset = 0;
      armed = false;
      return;
    }
    if (e.cancelable) e.preventDefault();

    if (mode === 'pull') {
      offset = rubber(dist, PULL_MAX);
      armed = offset >= PULL_TRIGGER;
      move(movers, offset * 0.6);
      if (indicator) {
        const p = Math.min(1, offset / PULL_TRIGGER);
        const top = Number(indicator.dataset.top ?? 0);
        indicator.style.opacity = String(Math.min(1, p * 1.4));
        indicator.style.transform = `translate(-50%, ${top + offset - 20}px)`;
        indicator.style.setProperty('--p', String(Math.round(p * 100)));
        indicator.toggleAttribute('data-armed', armed);
      }
    } else {
      offset = rubber(dist, STRETCH_MAX);
      move(movers, -offset);
    }
  };

  const end = (canRefresh = true) => {
    if (mode === 'pull' && armed && canRefresh) {
      mode = 'done';
      if (indicator) {
        const top = Number(indicator.dataset.top ?? 0);
        indicator.setAttribute('data-loading', '');
        indicator.style.transition = 'transform 0.2s ease';
        indicator.style.transform = `translate(-50%, ${top + PULL_TRIGGER - 20}px)`;
      }
      for (const el of movers) el.style.transition = 'transform 0.2s ease';
      move(movers, PULL_TRIGGER * 0.6);
      // Um instante para a bolinha girar antes de a tela sumir.
      setTimeout(refresh, 120);
      return;
    }
    if (mode === 'pull' || mode === 'stretch') {
      settle(movers);
      hideIndicator();
    }
    reset();
  };

  const onEnd = () => end(true);
  const onCancel = () => end(false);

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
    indicator?.remove();
    move(movers, 0);
    reset();
  };
}
