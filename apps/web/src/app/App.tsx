import { BrowserRouter, Route, Routes } from 'react-router';
import { Alert, Spinner, ToastProvider } from '../design-system';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { LoginPage } from '../pages/LoginPage';
import { MenuPage } from '../pages/MenuPage';
import { CashPage } from '../pages/CashPage';
import { DeliveriesPage } from '../pages/DeliveriesPage';
import { FinancePage } from '../pages/FinancePage';
import { FiscalPage } from '../pages/FiscalPage';
import { WhatsAppPage } from '../pages/WhatsAppPage';
import { PrintingPage } from '../pages/PrintingPage';
import { StockPage } from '../pages/StockPage';
import { TeamPage } from '../pages/TeamPage';
import { TrackingPage } from '../pages/TrackingPage';
import { KitchenPage } from '../pages/KitchenPage';
import { OrdersPage } from '../pages/OrdersPage';
import { PdvPage } from '../pages/PdvPage';
import { PlanPage } from '../pages/PlanPage';
import { PlatformApp, isPlatformHost } from '../platform/PlatformApp';
import { ReleasesPage } from '../pages/ReleasesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TablesPage } from '../pages/TablesPage';
import { AppShell } from './AppShell';
import { AuthProvider, useAuth } from './auth';
import { UpdatePrompt } from './UpdatePrompt';

const SOON: [string, string][] = [['clientes', 'Clientes']];

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
        <Route index element={<PdvPage />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="mesas" element={<TablesPage />} />
        <Route path="cozinha" element={<KitchenPage />} />
        <Route path="caixa" element={<CashPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="cardapio" element={<MenuPage />} />
        <Route path="novidades" element={<ReleasesPage />} />
        <Route path="entregas" element={<DeliveriesPage />} />
        <Route path="estoque" element={<StockPage />} />
        <Route path="financeiro" element={<FinancePage />} />
        <Route path="equipe" element={<TeamPage />} />
        <Route path="impressao" element={<PrintingPage />} />
        <Route path="nota-fiscal" element={<FiscalPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="plano" element={<PlanPage />} />
        {SOON.map(([path, title]) => (
          <Route key={path} path={path} element={<ComingSoonPage title={title} />} />
        ))}
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
