import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Alert, Spinner, ToastProvider } from '../design-system';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { LoginPage } from '../pages/LoginPage';
import { MenuPage } from '../pages/MenuPage';
import { CustomersPage } from '../pages/CustomersPage';
import { OnlineStorePage } from '../pages/OnlineStorePage';
import { CashPage } from '../pages/CashPage';
import { DeliveriesPage } from '../pages/DeliveriesPage';
import { FinancePage } from '../pages/FinancePage';
import { FiscalPage } from '../pages/FiscalPage';
import { WhatsAppPage } from '../pages/WhatsAppPage';
import { PrintingPage } from '../pages/PrintingPage';
import { StockPage } from '../pages/StockPage';
import { TeamPage } from '../pages/TeamPage';
import { TrackingPage } from '../pages/TrackingPage';
import { CourierLinkPage } from '../pages/CourierLinkPage';
import { TableLinkPage } from '../pages/TableLinkPage';
import { PublicOrderPage } from '../pages/public/PublicOrderPage';
import { StoreApp } from '../pages/public/StoreApp';
import { KitchenPage } from '../pages/KitchenPage';
import { OrdersPage } from '../pages/OrdersPage';
import { PdvPage } from '../pages/PdvPage';
import { PlanPage } from '../pages/PlanPage';
import { PlatformApp, isPlatformHost } from '../platform/PlatformApp';
import { ReleasesPage } from '../pages/ReleasesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SupportEntryPage } from '../pages/SupportEntryPage';
import { TablesPage } from '../pages/TablesPage';
import { AppShell } from './AppShell';
import { AuthProvider, useAuth } from './auth';
import { ROLE_HOME, ROUTE_PERMS } from './role-home';
import { NoAccess } from './NoAccess';
import { UpdatePrompt } from './UpdatePrompt';

function Home() {
  const { me } = useAuth();
  const home = ROLE_HOME[me?.user.role ?? ''];
  if (home) return <Navigate to={home} replace />;
  if (!me?.permissions.includes('orders:write')) return <Navigate to="/pedidos" replace />;
  return <PdvPage />;
}

/** Tela protegida: sem nenhuma das permissões, mostra o aviso de acesso. */
function Guard({ path, children }: { path: string; children: ReactElement }) {
  const { me } = useAuth();
  const need = ROUTE_PERMS[path];
  if (need && !need.some((p) => me?.permissions.includes(p))) return <NoAccess />;
  return children;
}

function Gate() {
  const { status, error } = useAuth();
  if (status === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <Spinner />
      </div>
    );
  }
  if (status === 'unavailable') {
    return (
      <div style={{ maxWidth: 480, margin: '15vh auto', padding: 16 }}>
        <Alert tone="danger">
          Não foi possível falar com o servidor: {error}. Tente novamente em instantes.
        </Alert>
      </div>
    );
  }
  if (status === 'anonymous') return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route
          path="pdv"
          element={
            <Guard path="pdv">
              <PdvPage />
            </Guard>
          }
        />
        <Route
          path="pedidos"
          element={
            <Guard path="pedidos">
              <OrdersPage />
            </Guard>
          }
        />
        <Route
          path="mesas"
          element={
            <Guard path="mesas">
              <TablesPage />
            </Guard>
          }
        />
        <Route
          path="cozinha"
          element={
            <Guard path="cozinha">
              <KitchenPage />
            </Guard>
          }
        />
        <Route
          path="caixa"
          element={
            <Guard path="caixa">
              <CashPage />
            </Guard>
          }
        />
        <Route
          path="relatorios"
          element={
            <Guard path="relatorios">
              <ReportsPage />
            </Guard>
          }
        />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route
          path="cardapio"
          element={
            <Guard path="cardapio">
              <MenuPage />
            </Guard>
          }
        />
        <Route
          path="loja-online"
          element={
            <Guard path="loja-online">
              <OnlineStorePage />
            </Guard>
          }
        />
        <Route
          path="clientes"
          element={
            <Guard path="clientes">
              <CustomersPage />
            </Guard>
          }
        />
        <Route path="novidades" element={<ReleasesPage />} />
        <Route
          path="entregas"
          element={
            <Guard path="entregas">
              <DeliveriesPage />
            </Guard>
          }
        />
        <Route
          path="estoque"
          element={
            <Guard path="estoque">
              <StockPage />
            </Guard>
          }
        />
        <Route
          path="financeiro"
          element={
            <Guard path="financeiro">
              <FinancePage />
            </Guard>
          }
        />
        <Route
          path="equipe"
          element={
            <Guard path="equipe">
              <TeamPage />
            </Guard>
          }
        />
        <Route
          path="impressao"
          element={
            <Guard path="impressao">
              <PrintingPage />
            </Guard>
          }
        />
        <Route
          path="nota-fiscal"
          element={
            <Guard path="nota-fiscal">
              <FiscalPage />
            </Guard>
          }
        />
        <Route
          path="whatsapp"
          element={
            <Guard path="whatsapp">
              <WhatsAppPage />
            </Guard>
          }
        />
        <Route
          path="plano"
          element={
            <Guard path="plano">
              <PlanPage />
            </Guard>
          }
        />
        <Route path="*" element={<ComingSoonPage title="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}

export function App() {
  // admin.<domínio base>: painel Super Admin, com login e sessão próprios.
  if (isPlatformHost()) return <PlatformApp />;
  return (
    <BrowserRouter>
      <ToastProvider>
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
          <Route
            path="*"
            element={
              <AuthProvider>
                <Gate />
                <UpdatePrompt />
              </AuthProvider>
            }
          />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
