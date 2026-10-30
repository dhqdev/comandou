import { lazy, useState, type ComponentType } from 'react';

/**
 * Tela carregada só quando é aberta (arquivo separado no build). Cada perfil baixa o que usa: o
 * cliente do cardápio não baixa o painel, o garçom não baixa relatórios, e assim por diante.
 *
 * Diferente de React.lazy, depois de baixada a tela desenha na hora, sem passar pelo Suspense.
 * Por isso `preloadPages` (logo depois da primeira tela) deixa a troca entre telas instantânea.
 */
export type LazyPage<P extends object> = ComponentType<P> & { preload: () => Promise<void> };

export function lazyPage<M, P extends object = object>(
  load: () => Promise<M>,
  pick: (mod: M) => ComponentType<P>,
): LazyPage<P> {
  let Comp: ComponentType<P> | null = null;
  let loading: Promise<void> | null = null;
  const preload = () =>
    (loading ??= load().then(
      (mod) => {
        Comp = pick(mod);
      },
      (err: unknown) => {
        // falhou (rede caiu): a próxima tentativa baixa de novo
        loading = null;
        throw err;
      },
    ));
  const Lazy = lazy(() => preload().then(() => ({ default: Comp! })));
  function Page(props: P) {
    // Escolhido uma vez por tela aberta: trocar de componente no meio apagaria o estado dela.
    const [C] = useState<ComponentType<P>>(() => Comp ?? Lazy);
    return <C {...props} />;
  }
  return Object.assign(Page, { preload });
}

/** Baixa as telas em segundo plano quando o navegador fica livre, sem atrasar a tela atual. */
export function preloadPages(pages: { preload: () => Promise<void> }[]): () => void {
  // Em desenvolvimento o Vite serve cada arquivo solto: baixar tudo travaria o servidor local.
  if (import.meta.env.DEV) return () => undefined;
  const run = () => {
    for (const p of pages) p.preload().catch(() => undefined);
  };
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
