import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './design-system';
import { isPlatformHost } from './platform/PlatformApp';
import { applyAdminPwa } from './platform/pwa';

// admin.<domínio>: manifesto, ícone e tema do painel antes do primeiro desenho.
if (isPlatformHost()) applyAdminPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
