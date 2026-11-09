import { Suspense } from 'react';
import { Route, Routes, unstable_HistoryRouter as HistoryRouter, useLocation } from 'react-router';
import { appHistory, ScreenDrawn, ToastProvider } from '../design-system';
import { TenantBrand } from './TenantBrand';
import { PageLoading } from './PageLoading';
import { FullscreenTab, isPublicPath } from '../features/FullscreenTab';
import { UpdatePrompt } from './UpdatePrompt';
import { isPlatformHost } from '../platform/host';
import { lazyPage } from '../lib/lazy-page';

// Cada tela vira um arquivo separado no build (o app abre mais rápido, principalmente no celular).
// O cardápio do cliente não baixa nada do sistema da equipe (StaffApp).
const StaffApp = lazyPage(
  () => import('./StaffApp'),
  (m) => m.StaffApp,
);
const TrackingPage = lazyPage(
  () => import('../pages/TrackingPage'),
  (m) => m.TrackingPage,
);
const CourierLinkPage = lazyPage(
  () => import('../pages/CourierLinkPage'),
  (m) => m.CourierLinkPage,
);
const TableLinkPage = lazyPage(
  () => import('../pages/TableLinkPage'),
  (m) => m.TableLinkPage,
);
const PublicOrderPage = lazyPage(
  () => import('../pages/public/PublicOrderPage'),
  (m) => m.PublicOrderPage,
);
const StoreApp = lazyPage(
  () => import('../pages/public/StoreApp'),
  (m) => m.StoreApp,
);
const PricingPage = lazyPage(
  () => import('../pages/PricingPage'),
  (m) => m.PricingPage,
);
const SupportEntryPage = lazyPage(
  () => import('../pages/SupportEntryPage'),
  (m) => m.SupportEntryPage,
);
const PlatformApp = lazyPage(
  () => import('../platform/PlatformApp'),
  (m) => m.PlatformApp,
);

/** Aba de tela cheia no topo de todas as telas do sistema (fora as do cliente final). */
function ShellFullscreenTab() {
  const { pathname } = useLocation();
  return <FullscreenTab hidden={isPublicPath(pathname)} />;
}

export function App() {
  // admin.<domínio base>: painel Super Admin, com login e sessão próprios.
  if (isPlatformHost()) {
    return (
      <>
        <Suspense fallback={<PageLoading />}>
          <PlatformApp />
        </Suspense>
        <UpdatePrompt />
        <FullscreenTab />
      </>
    );
  }
  return (
    // Histórico próprio: cada troca de tela roda com foto e animação (design-system/transition.ts).
    <HistoryRouter history={appHistory}>
      <ScreenDrawn />
      <TenantBrand />
      {/* Em todas as telas: painel, garçom, cozinha, cardápio do cliente e links públicos. */}
      <UpdatePrompt />
      <ShellFullscreenTab />
      <ToastProvider>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            {/* Rastreio público do cliente final: fora do login. */}
            <Route path="/rastreio/:token" element={<TrackingPage />} />
            {/* Cardápio online e acompanhamento do pedido do cliente final: fora do login. */}
            <Route path="/pedir/*" element={<StoreApp />} />
            <Route path="/pedido/:token" element={<PublicOrderPage />} />
            {/* Link do entregador (sem login) e QR Code colado na mesa. */}
            <Route path="/entregador/:token" element={<CourierLinkPage />} />
            <Route path="/mesa/:id" element={<TableLinkPage />} />
            {/* Link de acesso do suporte (painel Super Admin): troca o token por uma sessão. */}
            <Route path="/suporte" element={<SupportEntryPage />} />
            {/* Planos e preços (público): sai do Super Admin → Planos. */}
            <Route path="/precos" element={<PricingPage />} />
            <Route path="/preços" element={<PricingPage />} />
            <Route path="*" element={<StaffApp />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </HistoryRouter>
  );
}
