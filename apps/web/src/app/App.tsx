import { Suspense, useEffect, type ReactElement } from 'react';
import {
  Navigate,
  Route,
  Routes,
  unstable_HistoryRouter as HistoryRouter,
  useLocation,
} from 'react-router';
import { Alert, appHistory, Mascot, ScreenDrawn, Spinner, ToastProvider } from '../design-system';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { LoginPage } from '../pages/LoginPage';
import { AppShell } from './AppShell';
import { AuthProvider, useAuth } from './auth';
import { TenantBrand } from './TenantBrand';
import { ROLE_HOME, ROUTE_PERMS } from './role-home';
import { NoAccess } from './NoAccess';
import { PageLoading } from './PageLoading';
import { UpdatePrompt } from './UpdatePrompt';
import { WaiterEntry } from './WaiterEntry';
import { TeamChat } from '../features/chat/TeamChat';
import { isPlatformHost } from '../platform/host';
import { lazyPage, preloadPages } from '../lib/lazy-page';

// Cada tela vira um arquivo separado no build (o app abre mais rápido, principalmente no celular).
const MenuPage = lazyPage(
  () => import('../pages/MenuPage'),
  (m) => m.MenuPage,
);
const CustomersPage = lazyPage(
  () => import('../pages/CustomersPage'),
  (m) => m.CustomersPage,
);
const OnlineStorePage = lazyPage(
  () => import('../pages/OnlineStorePage'),
  (m) => m.OnlineStorePage,
);
const CashPage = lazyPage(
  () => import('../pages/CashPage'),
  (m) => m.CashPage,
);
const DeliveriesPage = lazyPage(
  () => import('../pages/DeliveriesPage'),
  (m) => m.DeliveriesPage,
);
const FinancePage = lazyPage(
  () => import('../pages/FinancePage'),
  (m) => m.FinancePage,
);
const FiscalPage = lazyPage(
  () => import('../pages/fiscal/FiscalPage'),
  (m) => m.FiscalPage,
);
const WhatsAppPage = lazyPage(
  () => import('../pages/WhatsAppPage'),
  (m) => m.WhatsAppPage,
);
const PrintingPage = lazyPage(
  () => import('../pages/PrintingPage'),
  (m) => m.PrintingPage,
);
const StockPage = lazyPage(
  () => import('../pages/StockPage'),
  (m) => m.StockPage,
);
const TeamPage = lazyPage(
  () => import('../pages/TeamPage'),
  (m) => m.TeamPage,
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
const KitchenPage = lazyPage(
  () => import('../pages/KitchenPage'),
  (m) => m.KitchenPage,
);
const OrdersPage = lazyPage(
  () => import('../pages/OrdersPage'),
  (m) => m.OrdersPage,
);
const PdvPage = lazyPage(
  () => import('../pages/PdvPage'),
  (m) => m.PdvPage,
);
const PlanPage = lazyPage(
  () => import('../pages/PlanPage'),
  (m) => m.PlanPage,
);
const ReleasesPage = lazyPage(
  () => import('../pages/ReleasesPage'),
  (m) => m.ReleasesPage,
);
const ReportsPage = lazyPage(
  () => import('../pages/ReportsPage'),
  (m) => m.ReportsPage,
);
const ReservationsPage = lazyPage(
  () => import('../pages/ReservationsPage'),
  (m) => m.ReservationsPage,
);
const SettingsPage = lazyPage(
  () => import('../pages/SettingsPage'),
  (m) => m.SettingsPage,
);
const SupportEntryPage = lazyPage(
  () => import('../pages/SupportEntryPage'),
  (m) => m.SupportEntryPage,
);
const TablesPage = lazyPage(
  () => import('../pages/TablesPage'),
  (m) => m.TablesPage,
);
const WaiterApp = lazyPage(
  () => import('../waiter/WaiterApp'),
  (m) => m.WaiterApp,
);
const DriverApp = lazyPage(
  () => import('../driver/DriverApp'),
  (m) => m.DriverApp,
);
const KitchenApp = lazyPage(
  () => import('../kitchen/KitchenApp'),
  (m) => m.KitchenApp,
);
const PlatformApp = lazyPage(
  () => import('../platform/PlatformApp'),
  (m) => m.PlatformApp,
);

/** Telas do painel: baixadas em segundo plano depois da primeira, para a troca ser instantânea. */
const PANEL_PAGES = [
  PdvPage,
  OrdersPage,
  TablesPage,
  ReservationsPage,
  KitchenPage,
  CashPage,
  ReportsPage,
  SettingsPage,
  MenuPage,
  OnlineStorePage,
  CustomersPage,
  ReleasesPage,
  DeliveriesPage,
  StockPage,
  FinancePage,
  TeamPage,
  PrintingPage,
  FiscalPage,
  WhatsAppPage,
  PlanPage,
  WaiterApp,
];

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

function WaiterOnly() {
  const { search } = useLocation();
  return (
    <Routes>
      <Route path="garcom/*" element={<WaiterApp />} />
      <Route path="*" element={<Navigate to={`/garcom/mesas${search}`} replace />} />
    </Routes>
  );
}

const OWN_APP_ROLES = ['waiter', 'driver', 'kitchen'];

function Gate() {
  const { status, error, me } = useAuth();
  const { pathname } = useLocation();
  const role = me?.user.role;
  // Painel aberto: baixa as outras telas em segundo plano (garçom, entregador e cozinha não precisam).
  useEffect(() => {
    if (!role || OWN_APP_ROLES.includes(role)) return;
    return preloadPages(PANEL_PAGES);
  }, [role]);
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
  if (status === 'suspended') {
    return (
      <main className="cm-suspended" role="alert">
        <Mascot size={88} mood="sleep" />
        <h1>Restaurante suspenso</h1>
        <p>
          O acesso a este sistema está pausado. Nenhum dado foi apagado: assim que for reativado,
          tudo volta como estava. Fale com o suporte do Comandou.
        </p>
      </main>
    );
  }
  if (status === 'anonymous') return <LoginPage />;
  // Garçom: só o app dele (/garcom). Qualquer outro endereço leva ao mapa de mesas, mantendo o
  // ?mesa= do QR da mesa.
  if (me?.user.role === 'waiter')
    return (
      <>
        <WaiterOnly />
        <TeamChat variant="waiter" />
      </>
    );
  // Entregador e cozinha: só o app de cada um (/entregas e /cozinha), sem o menu da loja.
  if (me?.user.role === 'driver')
    return (
      <>
        <DriverApp />
        <TeamChat variant="driver" />
      </>
    );
  if (me?.user.role === 'kitchen')
    return (
      <>
        <KitchenApp />
        <TeamChat variant="kitchen" />
      </>
    );
  return (
    <>
      <Routes>
        {/* Gestor também abre o app do garçom (para conferir o que a equipe vê). */}
        <Route path="garcom/*" element={<WaiterApp />} />
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
            path="reservas"
            element={
              <Guard path="reservas">
                <ReservationsPage />
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
          {/* Endereço do garçom: sem sessão mostra o login do garçom; com sessão leva ao Salão. */}
          <Route path="garcom" element={<WaiterEntry />} />
          <Route path="garçom" element={<WaiterEntry />} />
          <Route path="configuracoes" element={<SettingsPage />} />
          <Route
            path="cardapio/*"
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
            path="estoque/*"
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
            path="fiscal/*"
            element={
              <Guard path="fiscal">
                <FiscalPage />
              </Guard>
            }
          />
          <Route path="nota-fiscal" element={<Navigate to="/fiscal/nfce" replace />} />
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
      {/* Chat da equipe em todas as telas (painel e app do garçom aberto pelo gestor). */}
      <TeamChat variant={pathname.startsWith('/garcom') ? 'waiter' : 'shell'} />
    </>
  );
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
            <Route
              path="*"
              element={
                <AuthProvider>
                  <Gate />
                </AuthProvider>
              }
            />
          </Routes>
        </Suspense>
      </ToastProvider>
    </HistoryRouter>
  );
}
