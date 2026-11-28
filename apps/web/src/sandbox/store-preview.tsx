import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TenantBrand } from '../app/TenantBrand';
import { BRAND_EVENT, runSoftRefresh, ToastProvider } from '../design-system';
import { ErrorBoundary, ErrorFallback } from '../lib/error-boundary';
import { forgetMenus } from '../lib/menu-boot';
import {
  previewMenu,
  STORE_PREVIEW_MSG,
  STORE_PREVIEW_READY,
  type StorePreviewData,
} from '../lib/store-preview';
import { StoreApp } from '../pages/public/StoreApp';
import { installServer, on, Reply } from './server/http';

/**
 * Cardápio online de verdade dentro da criação pelo site (comandou.com/experimente?tela=loja): o
 * mesmo StoreApp do restaurante, com GET /store respondido aqui dentro a partir do que a página
 * de criar manda (nome, logo, cores e o cardápio que a IA leu e a pessoa conferiu). Nada sai do
 * navegador: pedir de verdade fica para o restaurante criado.
 */

let data: StorePreviewData | null = null;
const listeners = new Set<() => void>();

function registerStoreRoutes() {
  on('GET', '/store', () =>
    data ? previewMenu(data) : new Reply(404, { statusCode: 404, message: 'Montando' }),
  );
  on('GET', '/store/status', () => ({
    isOpen: true,
    acceptsDelivery: data?.delivery ?? true,
    acceptsPickup: (data?.pickup ?? true) || !data?.delivery,
    schedule: null,
  }));
  on('GET', '/store/branding', () => ({
    brandColor: data?.brandColor ?? null,
    accentColor: data?.accentColor ?? null,
    fontStyle: 'padrao',
    cornerStyle: 'padrao',
    faviconUrl: null,
    logoUrl: data?.logoUrl ?? null,
    staffApp: false,
  }));
  on('GET', '/store/account', () => ({ customer: null, addresses: [] }));
  on('GET', '/store/loyalty', () => ({ enabled: false }));
  on('POST', '/store/pixel', () => new Reply(204));
  on(
    'POST',
    '/store/orders',
    () =>
      new Reply(403, {
        statusCode: 403,
        message:
          'Esta é a prévia do seu cardápio. Os pedidos chegam quando o restaurante for criado.',
      }),
  );
}

const sameOrigin = (e: MessageEvent) => e.origin === window.location.origin;

function Preview() {
  const [ready, setReady] = useState(!!data);
  useEffect(() => {
    const on = () => setReady(true);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  if (!ready) return null;
  return (
    <MemoryRouter initialEntries={['/pedir']}>
      <TenantBrand />
      <ToastProvider>
        <Routes>
          <Route path="/pedir/*" element={<StoreApp />} />
          <Route path="*" element={<StoreApp />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

export function bootStorePreview(root: HTMLElement) {
  registerStoreRoutes();
  installServer();
  // Cardápio guardado de outra prévia não aparece antes do desta.
  forgetMenus();
  document.documentElement.dataset.sandbox = '';
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { source?: string; store?: StorePreviewData } | null;
    if (!sameOrigin(e) || d?.source !== STORE_PREVIEW_MSG || !d.store) return;
    const first = !data;
    data = d.store;
    if (first) listeners.forEach((fn) => fn());
    else {
      // Mudou com o cardápio na tela: busca de novo sem remontar (a rolagem fica onde estava).
      void runSoftRefresh();
      window.dispatchEvent(new CustomEvent(BRAND_EVENT));
    }
  });
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary fallback={ErrorFallback}>
        <Preview />
      </ErrorBoundary>
    </StrictMode>,
  );
  if (window.parent !== window)
    window.parent.postMessage({ source: STORE_PREVIEW_READY }, window.location.origin);
}
