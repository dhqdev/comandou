import { BrowserRouter, Route, Routes } from 'react-router';
import { Alert, Spinner, ToastProvider } from '../design-system';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { LoginPage } from '../pages/LoginPage';
import { MenuPage } from '../pages/MenuPage';
import { PdvPage } from '../pages/PdvPage';
import { AppShell } from './AppShell';
import { AuthProvider, useAuth } from './auth';
import { UpdatePrompt } from './UpdatePrompt';

const SOON: [string, string][] = [
  ['pedidos', 'Pedidos'],
  ['mesas', 'Salão e mesas'],
  ['cozinha', 'Cozinha (KDS)'],
  ['caixa', 'Caixa'],
  ['entregas', 'Entregas'],
  ['clientes', 'Clientes'],
  ['estoque', 'Estoque'],
  ['financeiro', 'Financeiro'],
  ['relatorios', 'Relatórios'],
  ['configuracoes', 'Configurações'],
];

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
        <Route path="cardapio" element={<MenuPage />} />
        {SOON.map(([path, title]) => (
          <Route key={path} path={path} element={<ComingSoonPage title={title} />} />
        ))}
        <Route path="*" element={<ComingSoonPage title="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
          <UpdatePrompt />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
