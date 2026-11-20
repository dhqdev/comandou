import { AppSkeleton, Skeleton } from '../design-system';
import { isPublicPath } from '../features/FullscreenTab';
import { isMenuPath } from '../lib/menu-boot';
import { MenuSkeleton } from './MenuSkeleton';

/** Enquanto o arquivo da tela chega (só na primeira vez que ela abre): o esqueleto da tela. */
export function PageLoading() {
  return (
    <div className="cm-page-loading">
      <Skeleton variant="page" />
    </div>
  );
}

/**
 * Abertura do app, antes de o arquivo do sistema chegar: a moldura inteira (topo, menu e abas),
 * igual ao esqueleto do index.html. Telas do cliente (cardápio, rastreio) sem a moldura da equipe.
 */
export function AppLoading({ plain }: { plain?: boolean }) {
  // Cardápio do cliente: o formato da loja, igual ao do index.html e ao da espera do cardápio.
  if (isMenuPath(window.location.pathname)) return <MenuSkeleton />;
  return <AppSkeleton plain={plain || isPublicPath(window.location.pathname)} />;
}
