/**
 * Puxar para recarregar (app instalado na tela inicial).
 *
 * O app instalado (e o navegador em tela cheia) não tem a barra nem o "puxar para atualizar" do
 * navegador, e base.css desliga o elástico da página para a moldura não sair do lugar (no
 * navegador comum do celular o elástico é o nativo, ligado por base.css e app-frame.css). Aqui:
 * - no topo da tela, puxar para baixo e segurar mostra uma bolinha que vai enchendo; passou do
 *   ponto, ela fica cheia e, ao soltar, a página recarrega. Soltar antes desiste;
 * - no fim da tela, puxar para cima estica o conteúdo um pouco (com resistência) e ele volta
 *   sozinho ao soltar, sem recarregar. Vale também quando a rolagem chega na ponta com o dedo
 *   ainda na tela (continua puxando: estica);
 * - rolou rápido e soltou (a rolagem segue sozinha): ao bater no fim ou no topo, o conteúdo
 *   passa um pouco e volta, como o elástico do iPhone. Só onde o navegador não faz isso sozinho
 *   (overscroll-behavior: none, que base.css põe na página);
 * - a tela pode trocar o recarregar da página por um mais leve (`setPullRefreshHandler`): a
 *   bolinha gira enquanto os dados chegam e o conteúdo volta ao lugar, sem piscar a tela.
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

/** Quanto o conteúdo passa da ponta, no máximo, quando a rolagem rápida bate nela. */
const BOUNCE_MAX = 56;

/** Recarregar mais leve da tela aberta (null: recarrega a página). */
let softRefresh: (() => Promise<unknown>) | null = null;

/**
 * A tela aberta troca o "recarregar a página" por buscar os dados de novo (o cardápio, por
 * exemplo). Devolve a função que desfaz (ao sair da tela).
 */
export function setPullRefreshHandler(fn: () => Promise<unknown>): () => void {
  softRefresh = fn;
  return () => {
    if (softRefresh === fn) softRefresh = null;
  };
}

/**
 * Roda o recarregar leve da tela aberta sem o gesto (prévia do cardápio na criação pelo site:
 * os dados mudam fora e o cardápio busca de novo sem remontar nem voltar ao topo).
 */
export function runSoftRefresh(): Promise<unknown> {
  return softRefresh ? softRefresh() : Promise.resolve();
}

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
 * Partes da página que esticam sem levar junto o que é preso na tela (position: fixed). Um
 * `transform` num pai faz o fixo passar a contar a partir desse pai: o menu de baixo do cardápio
 * ia parar no fim da página (sumia da tela) enquanto o dedo esticava, e só voltava ao soltar.
 * Aqui o que contém uma peça fixa é aberto nos filhos, e a peça fixa fica parada.
 */
export function pageMovers(root: HTMLElement): HTMLElement[] {
  const fixed = [...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) => getComputedStyle(el).position === 'fixed',
  );
  if (!fixed.length) return [root];
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    if (fixed.includes(el)) return;
    if (!fixed.some((f) => el.contains(f))) {
      out.push(el);
      return;
    }
    for (const c of el.children) if (c instanceof HTMLElement) walk(c);
  };
  walk(root);
  return out;
}

/**
 * O que mexe na tela: o conteúdo de dentro de quem rola (ele continua cortado pela caixa, sem
 * passar por cima do cabeçalho). A página inteira rola pelo documento: aí desce o #root, menos
 * as peças presas na tela (menu de baixo, pílula da sacola), que ficam onde estão.
 */
function moversFor(scroller: HTMLElement | undefined): HTMLElement[] {
  if (!scroller || scroller === document.scrollingElement) {
    const root = document.getElementById('root') ?? document.body;
    return pageMovers(root);
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
  // No navegador comum, só em tela cheia (F11 ou o botão da Cozinha): aí também some a barra dele.
  const enabled = () => opts.force || standalone || !!document.fullscreenElement;
  const reload = () => window.location.reload();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // 'scroll': rolando normal, de olho para esticar se chegar na ponta com o dedo na tela.
  let mode: 'idle' | 'pending' | 'scroll' | 'pull' | 'stretch' | 'done' = 'idle';
  /** Esticando no topo (1, o conteúdo desce) ou no fim (-1, o conteúdo sobe). */
  let stretchDir: 1 | -1 = -1;
  let lastY = 0;
  let lastT = 0;
  /** Velocidade do dedo (px/ms, positiva descendo o dedo) no fim do toque. */
  let fingerV = 0;
  let buzzed = false;
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
    buzzed = false;
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
    lastY = t.clientY;
    lastT = e.timeStamp || performance.now();
    fingerV = 0;
    fling = null;
    mode = 'pending';
  };

  const startStretch = (dir: 1 | -1, scroller: HTMLElement | undefined, y: number) => {
    mode = 'stretch';
    stretchDir = dir;
    movers = moversFor(scroller);
    startY = y;
    for (const el of movers) {
      el.style.transition = '';
      el.style.willChange = 'transform';
    }
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
    // Velocidade do dedo, suavizada (para a rolagem rápida que segue depois de soltar).
    const now = e.timeStamp || performance.now();
    const dt = now - lastT;
    if (dt > 0) {
      const v = (t.clientY - lastY) / dt;
      fingerV = dt > 100 ? v : fingerV * 0.4 + v * 0.6;
    }
    const stepY = t.clientY - lastY;
    lastY = t.clientY;
    lastT = now;

    if (mode === 'scroll') {
      // Rolando com o dedo na tela e chegou na ponta: continua puxando, estica.
      const inner = chain[0];
      if (!inner) return;
      if (stepY < 0 && atBottom(inner)) startStretch(-1, inner, t.clientY + 1);
      else if (stepY > 0 && chain.every(atTop))
        startStretch(1, chain[chain.length - 1], t.clientY - 1);
      return;
    }

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
        stretchDir = -1;
        movers = moversFor(chain[0]);
      } else {
        mode = chain.length ? 'scroll' : 'idle';
        return;
      }
      // Recomeça a contar daqui: o pedaço até decidir não conta como puxada.
      startY = t.clientY - Math.sign(dy) * 1;
      for (const el of movers) {
        el.style.transition = '';
        el.style.willChange = 'transform';
      }
    }

    const down = mode === 'pull' || (mode === 'stretch' && stretchDir === 1);
    const dist = down ? t.clientY - startY : startY - t.clientY;
    // A página rolou de volta (o dedo voltou além do começo): sai do gesto.
    const edge = down ? chain.every(atTop) : !chain[0] || atBottom(chain[0]);
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
      const wasArmed = armed;
      armed = offset >= PULL_TRIGGER;
      // Passou do ponto: um toque leve no celular (Android), uma vez por puxada.
      if (armed && !wasArmed && !buzzed) {
        buzzed = true;
        navigator.vibrate?.(8);
      }
      move(movers, offset * 0.6);
      if (indicator) {
        const p = Math.min(1, offset / PULL_TRIGGER);
        const top = Number(indicator.dataset.top ?? 0);
        indicator.style.opacity = String(Math.min(1, p * 1.4));
        indicator.style.transform = `translate(-50%, ${top + offset - 20}px) scale(${0.7 + 0.3 * p})`;
        indicator.style.setProperty('--p', String(Math.round(p * 100)));
        indicator.toggleAttribute('data-armed', armed);
      }
    } else {
      offset = rubber(dist, STRETCH_MAX);
      move(movers, stretchDir * offset);
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
      const soft = !opts.onRefresh && softRefresh;
      if (!soft) {
        // Um instante para a bolinha girar antes de a tela sumir.
        setTimeout(opts.onRefresh ?? reload, 120);
        return;
      }
      // Recarregar leve: a bolinha gira enquanto os dados chegam (no mínimo um instante, para
      // dar para ver; no máximo 8 s) e o conteúdo volta ao lugar.
      const held = movers;
      const started = performance.now();
      void Promise.race([
        soft().catch(() => undefined),
        new Promise((r) => setTimeout(r, 8000)),
      ]).then(() => {
        const wait = Math.max(0, 450 - (performance.now() - started));
        setTimeout(() => {
          settle(held);
          hideIndicator();
          reset();
        }, wait);
      });
      return;
    }
    if (mode === 'pull' || mode === 'stretch') {
      settle(movers);
      hideIndicator();
    } else if (mode === 'scroll' || mode === 'pending') watchFling();
    reset();
  };

  // ------------------------------------------------ rolagem rápida que bate na ponta
  let fling: {
    scroller: HTMLElement;
    dir: 1 | -1;
    until: number;
    lastTop: number;
    lastT: number;
    v: number;
  } | null = null;
  let bouncing = false;

  /** O navegador já faz o elástico sozinho nesta caixa? (aí não fazemos de novo) */
  const nativeBounce = (el: HTMLElement) => {
    const page = el === document.scrollingElement;
    const style = getComputedStyle(page ? document.documentElement : el);
    return (style.overscrollBehaviorY || style.overscrollBehavior || 'auto') !== 'none';
  };

  /** Soltou o dedo rolando rápido: acompanha a rolagem que segue sozinha. */
  const watchFling = () => {
    const scroller = chain[0];
    if (reduced || !scroller || Math.abs(fingerV) < 0.5 || nativeBounce(scroller)) return;
    // Dedo subindo = conteúdo indo para o fim (-1: bate no fim).
    const dir: 1 | -1 = fingerV < 0 ? -1 : 1;
    fling = {
      scroller,
      dir,
      until: performance.now() + 2500,
      lastTop: scroller.scrollTop,
      lastT: performance.now(),
      v: Math.abs(fingerV),
    };
  };

  const bounce = (scroller: HTMLElement, dir: 1 | -1, v: number) => {
    const els = moversFor(scroller);
    if (bouncing || !els.length || typeof els[0]!.animate !== 'function') return;
    bouncing = true;
    // Mais rápido, passa mais (com teto); devagar quase não passa.
    const over = Math.min(BOUNCE_MAX, 10 + v * 22);
    const y = dir === -1 ? -over : over;
    let left = els.length;
    for (const el of els) {
      const a = el.animate(
        [
          { transform: 'translateY(0)', easing: 'cubic-bezier(0.15, 0.6, 0.35, 1)' },
          { transform: `translateY(${y}px)`, offset: 0.3, easing: 'cubic-bezier(0.35, 0, 0.2, 1)' },
          { transform: 'translateY(0)' },
        ],
        { duration: 300 + over * 4 },
      );
      const done = () => {
        if (--left === 0) bouncing = false;
      };
      a.onfinish = done;
      a.oncancel = done;
    }
  };

  const onScroll = (e: Event) => {
    const f = fling;
    if (!f || mode !== 'idle') return;
    const el = e.target === document ? (document.scrollingElement as HTMLElement) : e.target;
    if (el !== f.scroller) return;
    const now = performance.now();
    if (now > f.until) {
      fling = null;
      return;
    }
    const dt = now - f.lastT;
    const moved = f.scroller.scrollTop - f.lastTop;
    if (dt > 0 && moved !== 0) f.v = Math.abs(moved) / dt;
    f.lastTop = f.scroller.scrollTop;
    f.lastT = now;
    const hit = f.dir === -1 ? atBottom(f.scroller) : atTop(f.scroller);
    if (!hit) return;
    fling = null;
    // Chegou devagar (a rolagem já ia parando): sem pulo.
    if (f.v < 0.35) return;
    bounce(f.scroller, f.dir, f.v);
  };

  const onEnd = () => end(true);
  const onCancel = () => end(false);

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onCancel, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
    indicator?.remove();
    move(movers, 0);
    reset();
  };
}
