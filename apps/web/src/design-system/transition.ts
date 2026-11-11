import { useLayoutEffect } from 'react';
import { UNSAFE_createBrowserHistory, useLocation } from 'react-router';

/**
 * Troca de tela com View Transitions (estilos em liquid.css), como no Planejai.
 *
 * O roteador recebe este histórico: quando o caminho muda (link, navigate ou voltar do navegador), o
 * aviso ao React roda dentro de document.startViewTransition. O navegador fotografa a tela antiga, o
 * React desenha a nova e as duas animam juntas: a antiga sai enquanto a nova entra, sem quadro vazio.
 *
 * Fica de fora: só mudar ?/# (filtros), replace (redirecionar), "reduzir movimento", navegador sem a
 * API e navegador controlado por teste (Playwright), em que a foto por cima atrasaria os cliques.
 */
export const appHistory = UNSAFE_createBrowserHistory({ v5Compat: true });

type Vt = { finished: Promise<void> };
const doc = (typeof document !== 'undefined' ? document : null) as
  (Document & { startViewTransition?: (cb: () => Promise<void>) => Vt }) | null;

let running = false;
let turn = 0;
let drawn: (() => void) | null = null;

/** Esta troca de tela está acontecendo dentro de uma View Transition. */
export const inViewTransition = () => running;

/** A tela nova foi desenhada: libera a foto dela. */
function screenDrawn() {
  drawn?.();
  drawn = null;
}

/** Fica dentro do roteador: avisa quando a tela do caminho novo já está no DOM. */
export function ScreenDrawn() {
  const { pathname } = useLocation();
  useLayoutEffect(screenDrawn, [pathname]);
  return null;
}

// Troca de tela sem animação (pedido do David: o sistema tem que ser rápido). A estrutura fica
// para religar no futuro mudando esta linha.
const ENABLED = false;
const skip = () =>
  !ENABLED ||
  !doc?.startViewTransition ||
  navigator.webdriver ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
  // janela aberta por cima: a troca acontece por trás dela, sem foto
  !!document.querySelector('dialog[open]');

const listen = appHistory.listen.bind(appHistory);
appHistory.listen = (fn) => {
  let last = appHistory.location.pathname;
  return listen((update) => {
    const moved = update.location.pathname !== last;
    last = update.location.pathname;
    if (!moved || update.action === 'REPLACE' || skip()) return fn(update);
    const root = document.documentElement;
    root.dataset.nav = update.action === 'POP' ? 'pop' : 'push';
    // Os nomes da foto só existem enquanto roda: nome fixo prenderia as janelas de dentro do painel.
    root.classList.add('cm-vt');
    const mine = ++turn;
    const t = doc!.startViewTransition!(
      () =>
        new Promise<void>((done) => {
          running = true;
          drawn?.();
          drawn = done;
          fn(update);
          // tela que demora para carregar não segura a troca
          setTimeout(done, 800);
        }),
    );
    t.finished.finally(() => {
      // trocas seguidas: só a última desliga
      if (mine !== turn) return;
      running = false;
      root.classList.remove('cm-vt');
      delete root.dataset.nav;
    });
  });
};
