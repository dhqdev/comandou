import { Suspense } from 'react';
import { Route, Routes, unstable_HistoryRouter as HistoryRouter, useLocation } from 'react-router';
import { appHistory, ScreenDrawn, ToastProvider } from '../design-system';
import { TenantBrand } from './TenantBrand';
import { AppLoading } from './PageLoading';
import { UpdatePrompt } from './UpdatePrompt';
import { isPlatformHost } from '../platform/host';
import { lazyPage } from '../lib/lazy-page';
import { useSiteHost } from '../site/host';

// Cada tela vira um arquivo separado no build (o app abre mais rápido, principalmente no celular).
// O cardápio do cliente não baixa nada do sistema da equipe (StaffApp).
const RestaurantSite = lazyPage(
  () => import('../pages/site/RestaurantSite'),
  (m) => m.RestaurantSite,
);
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
const EntryPage = lazyPage(
  () => import('../pages/EntryPage'),
  (m) => m.EntryPage,
);
const SiteApp = lazyPage(
  () => import('../site/SiteApp'),
  (m) => m.SiteApp,
);
const PlatformApp = lazyPage(
  () => import('../platform/PlatformApp'),
  (m) => m.PlatformApp,
);

export function App() {
  const host = useSiteHost();
  // admin.<domínio base>: painel Super Admin, com login e sessão próprios.
  if (isPlatformHost()) {
    return (
      <>
        <Suspense fallback={<AppLoading />}>
          <PlatformApp />
        </Suspense>
        <UpdatePrompt />
      </>
    );
  }
  // comandou.com e www: o site público (página de vendas e cadastro do teste). /precos segue
  // sendo a página de planos.
  if (host === 'pending') return <AppLoading plain />;
  if (host === 'site' && !/^\/pre[cç]os\/?$/.test(decodeURI(window.location.pathname))) {
    return (
      <>
        <Suspense fallback={<AppLoading plain />}>
          <SiteApp />
        </Suspense>
        <UpdatePrompt />
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
      <ToastProvider>
        <Suspense fallback={<AppLoading />}>
          <Routes>
            {/* Rastreio público do cliente final: fora do login. */}
            <Route path="/rastreio/:token" element={<TrackingPage />} />
            {/* Cardápio online e acompanhamento do pedido do cliente final: fora do login. */}
            {/* Página do restaurante (landing page criada pela IA nos primeiros passos). */}
            <Route path="/site" element={<RestaurantSite />} />
            <Route path="/pedir/*" element={<StoreApp />} />
            <Route path="/pedido/:token" element={<PublicOrderPage />} />
            {/* Link do entregador (sem login) e QR Code colado na mesa. */}
            <Route path="/entregador/:token" element={<CourierLinkPage />} />
            <Route path="/mesa/:id" element={<TableLinkPage />} />
            {/* Link de acesso do suporte (painel Super Admin): troca o token por uma sessão. */}
            <Route path="/suporte" element={<SupportEntryPage />} />
            {/* Chegada de quem acabou de criar o restaurante pelo site (link de uso único). */}
            <Route path="/entrar" element={<EntryPage />} />
            {/* Planos e preços (público): sai do Super Admin → Preço. */}
            <Route path="/precos" element={<PricingPage />} />
            <Route path="/preços" element={<PricingPage />} />
            <Route path="*" element={<StaffApp />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </HistoryRouter>
  );
}
