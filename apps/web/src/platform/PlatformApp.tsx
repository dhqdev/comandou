import {
  Activity,
  Building2,
  DatabaseBackup,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  Tags,
} from 'lucide-react';
import {
  createContext,
  FormEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { BrowserRouter, NavLink, Outlet, Route, Routes } from 'react-router';
import { Alert, Button, Spinner, TextField, ToastProvider } from '../design-system';
import { api, ApiError } from '../lib/api';
import '../app/shell.css';
import '../app/ops.css';
import '../pages/login.css';
import { AuditPage, BackupsPage, OverviewPage } from './OverviewPages';
import { PlansPage } from './PlansPage';
import { TenantDetailPage, TenantsPage } from './TenantsPages';

/** O painel Super Admin só existe em admin.<domínio base>. */
export function isPlatformHost(hostname = window.location.hostname): boolean {
  return hostname.startsWith('admin.');
}

interface Admin {
  id: string;
  name: string;
  email: string;
}
interface PlatformAuth {
  status: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  admin?: Admin;
  error?: string;
  login(email: string, password: string, code: string): Promise<void>;
  logout(): Promise<void>;
}
const Ctx = createContext<PlatformAuth | null>(null);
export const usePlatformAuth = () => useContext(Ctx)!;

function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Pick<PlatformAuth, 'status' | 'admin' | 'error'>>({
    status: 'loading',
  });
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ admin: Admin }>('/platform/auth/me');
      setS({ status: 'authenticated', admin: r.admin });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setS({ status: 'anonymous' });
      else setS({ status: 'unavailable', error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const login = useCallback(
    async (email: string, password: string, code: string) => {
      await api('/platform/auth/login', { method: 'POST', json: { email, password, code } });
      await refresh();
    },
    [refresh],
  );
  const logout = useCallback(async () => {
    await api('/platform/auth/logout', { method: 'POST' }).catch(() => undefined);
    setS({ status: 'anonymous' });
  }, []);
  return <Ctx.Provider value={{ ...s, login, logout }}>{children}</Ctx.Provider>;
}

function PlatformLogin() {
  const { login } = usePlatformAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password, code);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError('Muitas tentativas. Aguarde um minuto.');
      else if (err instanceof ApiError && err.status === 401)
        setError('E-mail, senha ou código inválidos.');
      else setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <div className="brand__mark" aria-hidden>
            P+
          </div>
          <span>PedeMais · Plataforma</span>
        </div>
        <h1 className="login__title">Painel Super Admin</h1>
        <p className="login__sub">Acesso restrito à equipe da plataforma. Tudo é auditado.</p>
        <form onSubmit={onSubmit} className="login__form" noValidate>
          <TextField
            label="E-mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="Código do autenticador"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            hint="6 dígitos do aplicativo autenticador"
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            disabled={!email || !password || code.length !== 6}
          >
            Entrar
          </Button>
        </form>
      </div>
      <div className="login__art" aria-hidden>
        <div className="login__quote">
          Restaurantes, planos,
          <br />
          saúde e backups.
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Visão geral', icon: <Activity size={18} /> },
  { to: '/restaurantes', label: 'Restaurantes', icon: <Building2 size={18} /> },
  { to: '/planos', label: 'Planos', icon: <Tags size={18} /> },
  { to: '/backups', label: 'Backups', icon: <DatabaseBackup size={18} /> },
  { to: '/auditoria', label: 'Auditoria', icon: <ScrollText size={18} /> },
];

function PlatformShell() {
  const { admin, logout } = usePlatformAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="shell" data-menu={menuOpen ? 'open' : 'closed'}>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <div className="brand__mark" aria-hidden>
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="brand__name">PedeMais</div>
            <div className="brand__tenant">Super Admin</div>
          </div>
        </div>
        <nav aria-label="Plataforma">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="user-chip">
            <div>
              <div>{admin?.name}</div>
              <div className="brand__tenant">{admin?.email}</div>
            </div>
          </div>
          <button
            className="nav-link"
            style={{ border: 0, background: 'none', cursor: 'pointer' }}
            onClick={logout}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            className="menu-toggle"
            aria-label="Abrir menu"
            onClick={() => setMenuOpen((v) => !v)}
            icon={<Menu size={20} />}
          />
          <strong>Painel da plataforma</strong>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Gate() {
  const { status, error } = usePlatformAuth();
  if (status === 'loading')
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <Spinner />
      </div>
    );
  if (status === 'unavailable')
    return (
      <div style={{ maxWidth: 480, margin: '15vh auto', padding: 16 }}>
        <Alert tone="danger">Painel indisponível: {error}</Alert>
      </div>
    );
  if (status === 'anonymous') return <PlatformLogin />;
  return (
    <Routes>
      <Route element={<PlatformShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="restaurantes" element={<TenantsPage />} />
        <Route path="restaurantes/:id" element={<TenantDetailPage />} />
        <Route path="planos" element={<PlansPage />} />
        <Route path="backups" element={<BackupsPage />} />
        <Route path="auditoria" element={<AuditPage />} />
        <Route path="*" element={<OverviewPage />} />
      </Route>
    </Routes>
  );
}

export function PlatformApp() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <PlatformAuthProvider>
          <Gate />
        </PlatformAuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
