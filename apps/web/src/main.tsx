import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import {
  applyBranding,
  applyTheme,
  cachedBranding,
  installDecimalEntry,
  installPullToRefresh,
  trackViewport,
} from './design-system';
import { isPlatformHost } from './platform/host';
import { reloadIfStale } from './lib/fresh-reload';
import { isMenuPath, storeTheme } from './lib/menu-boot';
import { ErrorBoundary, ErrorFallback } from './lib/error-boundary';
import { applyPosMode } from './lib/pos-device';
import { applyAdminPwa, listenInstallPrompt } from './platform/pwa';

// admin.<domínio>: manifesto, ícone e tema do painel antes do primeiro desenho.
if (isPlatformHost()) applyAdminPwa();
else {
  // Cores e ícone do restaurante (última vez que este navegador viu) antes do primeiro desenho.
  const brand = cachedBranding();
  if (brand) applyBranding(brand);
}
// "Instalar app" (Chrome/Android): o navegador avisa uma vez, logo no começo.
listenInstallPrompt();
// Tema claro/escuro salvo neste navegador (ou o do sistema) antes do primeiro desenho.
applyTheme();
// Cardápio do cliente com tema próprio da loja (guardado da última visita): já abre nessa cor.
const menuTheme = isMenuPath(window.location.pathname) ? storeTheme() : null;
if (menuTheme) applyTheme(menuTheme);
// Abriu uma cópia velha guardada no cache (saiu versão nova)? Limpa os caches e recarrega uma vez.
void reloadIfStale();
// Teclado do celular: as folhas que sobem de baixo acompanham a área visível.
trackViewport();
// App instalado: puxar no topo recarrega; no fim, o conteúdo estica e volta.
installPullToRefresh();
// Campos de valor ("0,00"): digitar começa antes da vírgula; a vírgula pula para os centavos.
installDecimalEntry();
// Maquininha (Smart POS): botões maiores para o dedo, antes do primeiro desenho.
applyPosMode();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Último recurso: um erro fora das telas não deixa o app em branco. */}
    <ErrorBoundary fallback={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
