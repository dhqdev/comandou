import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyBranding, applyTheme, cachedBranding, trackViewport } from './design-system';
import { isPlatformHost } from './platform/PlatformApp';
import { reloadIfStale } from './lib/fresh-reload';
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
// Abriu uma cópia velha guardada no cache (saiu versão nova)? Limpa os caches e recarrega uma vez.
void reloadIfStale();
// Teclado do celular: as folhas que sobem de baixo acompanham a área visível.
trackViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
