import type { MouseEvent } from 'react';

/** Elementos que têm clique próprio dentro da linha: não abrem o detalhe. */
const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [data-no-row-click]';

/**
 * Deixa a linha inteira da tabela clicável (use junto com `cm-table--click`).
 * Ignora cliques em botões/links/campos da própria linha, cliques vindos de
 * modais abertos a partir dela (portais) e quando a pessoa está selecionando
 * texto. Com Ctrl/⌘ ou botão do meio, `href` abre em outra aba.
 */
export function rowClick(open: () => void, href?: string) {
  const handle = (e: MouseEvent<HTMLElement>) => {
    const row = e.currentTarget;
    const target = e.target as Element | null;
    if (!target || !row.contains(target)) return;
    const hit = target.closest(INTERACTIVE);
    if (hit && hit !== row && row.contains(hit)) return;
    if (window.getSelection()?.toString()) return;
    if (href && (e.ctrlKey || e.metaKey || e.button === 1)) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    if (e.button !== 0) return;
    open();
  };
  return { onClick: handle, onAuxClick: href ? handle : undefined };
}
