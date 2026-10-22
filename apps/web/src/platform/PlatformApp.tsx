import {
  Activity,
  Building2,
  DatabaseBackup,
  Download,
  LogOut,
  Menu,
  RefreshCw,
  ScrollText,
  Server,
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
import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import {
  Alert,
  Button,
  Mascot,
  Modal,
  Spinner,
  TextField,
  ToastProvider,
  useGlider,
  useToast,
} from '../design-system';
import { api, ApiError } from '../lib/api';
import '../app/shell.css';
import '../app/ops.css';
import './admin.css';
import { AuditPage, BackupsPage, OverviewPage } from './OverviewPages';
import { PlansPage } from './PlansPage';
import { isStandalone, promptInstall } from './pwa';
import { ServerPage } from './ServerPage';
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
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form
        onSubmit={onSubmit}
        noValidate
        className="adm-panel"
        style={{ width: 'min(400px, 100%)', padding: 24, display: 'grid', gap: 14 }}
      >
        <div className="adm-logo" style={{ padding: 0 }}>
          <Mascot size={22} /> Comandou <span>//</span> admin
        </div>
        <div className="adm-sub" style={{ whiteSpace: 'normal', marginTop: -8 }}>
          Acesso restrito à equipe da plataforma. Tudo é auditado.
        </div>
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
  );
}

const NAV = [
  { to: '/', label: 'Status', icon: Activity },
  { to: '/restaurantes', label: 'Restaurantes', icon: Building2 },
  { to: '/servidor', label: 'Servidor', icon: Server },
  { to: '/planos', label: 'Planos', icon: Tags },
  { to: '/backups', label: 'Backups', icon: DatabaseBackup },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText },
];
const TABBAR = NAV.slice(0, 4);

function titleFor(path: string) {
  if (path === '/') return 'Status';
  return NAV.find((n) => n.to !== '/' && path.startsWith(n.to))?.label ?? 'Painel';
}

function InstallSheet({ onClose }: { onClose: () => void }) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <Modal open title="Instalar o app" onClose={onClose}>
      {ios ? (
        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          <li>Abra este endereço no Safari.</li>
          <li>
            Toque em <strong>Compartilhar</strong> (quadrado com seta para cima).
          </li>
          <li>
            Escolha <strong>Adicionar à Tela de Início</strong> e confirme.
          </li>
        </ol>
      ) : (
        <p style={{ margin: 0 }}>
          No Chrome: menu ⋮ → <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).
        </p>
      )}
      <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
        O app “Comandou Admin” abre direto no painel, em tela cheia.
      </p>
    </Modal>
  );
}

function PlatformShell() {
  const { admin, logout } = usePlatformAuth();
  const toast = useToast();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const [install, setInstall] = useState(false);
  const [tick, setTick] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const standalone = isStandalone();
  const railGlide = useGlider<HTMLDivElement>();

  useEffect(() => setMore(false), [pathname]);

  const refresh = () => {
    setTick((t) => t + 1);
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  };
  const doInstall = async () => {
    if (!(await promptInstall())) setInstall(true);
    else toast('Instalando…', 'success');
  };

  return (
    <div className="adm">
      <aside className="adm-rail" aria-label="Navegação">
        <div className="adm-logo">
          <Mascot size={22} /> Comandou <span>//</span> admin
        </div>
        <div className="adm-rail__nav cm-glide" ref={railGlide.ref}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `adm-nav ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
          {railGlide.glider}
        </div>
        <div className="adm-rail__foot">
          {!standalone && (
            <button className="adm-nav" style={{ padding: '6px 0' }} onClick={doInstall}>
              <Download size={14} /> Instalar app
            </button>
          )}
          <button className="adm-nav" style={{ padding: '6px 0' }} onClick={logout}>
            <LogOut size={14} /> Sair
          </button>
          <div>{admin?.name}</div>
          <div>{admin?.email}</div>
        </div>
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <div>
            <div className="adm-top__title">{titleFor(pathname)}</div>
            <div className="adm-top__sub">{window.location.hostname}</div>
          </div>
          <span className="adm-top__spacer" />
          <button
            className="adm-icon-btn"
            onClick={refresh}
            aria-label="Atualizar"
            aria-busy={spinning}
          >
            <RefreshCw size={16} />
          </button>
        </header>
        <main className="adm-content">
          <Outlet key={tick} />
        </main>
      </div>
      <nav className="adm-tabbar" aria-label="Navegação">
        {TABBAR.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <Icon size={20} />
            {label === 'Restaurantes' ? 'Clientes' : label}
          </NavLink>
        ))}
        <button className={more ? 'active' : ''} onClick={() => setMore(true)}>
          <Menu size={20} />
          Mais
        </button>
      </nav>
      <Modal open={more} title="Menu" onClose={() => setMore(false)}>
        <div className="adm-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {NAV.slice(4).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="adm-tile"
              style={{ justifyItems: 'center', textDecoration: 'none' }}
            >
              <Icon size={22} color="var(--a-accent)" />
              <span className="adm-label">{label}</span>
            </NavLink>
          ))}
          {!standalone && (
            <button className="adm-tile" style={{ justifyItems: 'center' }} onClick={doInstall}>
              <Download size={22} color="var(--a-accent)" />
              <span className="adm-label">Instalar</span>
            </button>
          )}
          <button
            className="adm-tile"
            style={{ justifyItems: 'center' }}
            onClick={() => {
              setMore(false);
              refresh();
            }}
          >
            <RefreshCw size={22} color="var(--a-accent)" />
            <span className="adm-label">Atualizar</span>
          </button>
          <button className="adm-tile" style={{ justifyItems: 'center' }} onClick={logout}>
            <LogOut size={22} color="var(--a-bad)" />
            <span className="adm-label">Sair</span>
          </button>
        </div>
        <p className="adm-sub" style={{ textAlign: 'center', marginBottom: 0 }}>
          {admin?.name} · {admin?.email}
        </p>
      </Modal>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
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
        <Route path="servidor" element={<ServerPage />} />
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
