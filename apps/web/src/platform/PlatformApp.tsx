import {
  Activity,
  Building2,
  DatabaseBackup,
  Download,
  CircleUserRound,
  LogOut,
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
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import {
  Alert,
  AppFrame,
  Button,
  FrameItem,
  Mascot,
  Modal,
  Spinner,
  TextField,
  ThemeToggle,
  ToastProvider,
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
  /** Navegador confiável: já entrou com o código antes, então o campo some. */
  const [trusted, setTrusted] = useState(false);
  useEffect(() => {
    api<{ trusted: boolean; email?: string }>('/platform/auth/device')
      .then((d) => {
        setTrusted(d.trusted);
        if (d.email) setEmail((e) => e || d.email!);
      })
      .catch(() => undefined);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password, trusted ? '' : code);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError('Muitas tentativas. Aguarde um minuto.');
      else if (err instanceof ApiError && err.status === 401 && trusted) {
        // A confiança pode ter sido revogada: volta a pedir o código.
        setTrusted(false);
        setError('E-mail ou senha inválidos, ou este navegador precisa do código de novo.');
      } else if (err instanceof ApiError && err.status === 401)
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
          <Mascot size={22} badge /> Comandou <span>//</span> admin
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
        {trusted ? (
          <div className="adm-sub" style={{ whiteSpace: 'normal' }}>
            Navegador confiável: o código do autenticador não é pedido aqui.{' '}
            <button type="button" className="adm-link" onClick={() => setTrusted(false)}>
              Usar código
            </button>
          </div>
        ) : (
          <TextField
            label="Código do autenticador"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            hint="6 dígitos do aplicativo autenticador. Depois disso, este navegador fica lembrado."
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          type="submit"
          size="lg"
          block
          loading={busy}
          disabled={!email || !password || (!trusted && code.length !== 6)}
        >
          Entrar
        </Button>
      </form>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Status', icon: Activity },
  { to: '/restaurantes', label: 'Restaurantes', short: 'Clientes', icon: Building2 },
  { to: '/servidor', label: 'Servidor', icon: Server },
  { to: '/planos', label: 'Planos', icon: Tags },
  { to: '/backups', label: 'Backups', icon: DatabaseBackup },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText },
];
/** Abas do celular; o resto fica em "Mais". */
const TABS = ['/', '/restaurantes', '/servidor', '/planos'];

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
  const [install, setInstall] = useState(false);
  const [tick, setTick] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const standalone = isStandalone();

  const refresh = () => {
    setTick((t) => t + 1);
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  };
  const doInstall = async () => {
    if (!(await promptInstall())) setInstall(true);
    else toast('Instalando…', 'success');
  };

  const items: FrameItem[] = NAV.map(({ to, label, short, icon: Icon }) => ({
    key: to,
    to,
    label,
    short,
    icon: <Icon />,
  }));
  const account = (
    <div className="account">
      <div className="account__who">
        <div className="account__avatar" aria-hidden>
          {(admin?.name ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="account__name">{admin?.name}</div>
          <div className="account__sub">{admin?.email}</div>
        </div>
      </div>
      <div className="account__row">
        <span>Tema</span>
        <ThemeToggle />
      </div>
      {!standalone && (
        <button type="button" className="account__action" onClick={doInstall}>
          <Download size={18} /> Instalar app
        </button>
      )}
      <button type="button" className="account__action" onClick={logout}>
        <LogOut size={18} /> Sair
      </button>
    </div>
  );

  return (
    <>
      <AppFrame
        className="adm-frame"
        brand={<Mascot size={40} badge title="Comandou Admin" />}
        brandCompact={<Mascot size={28} badge title="Comandou Admin" />}
        showWhere={false}
        items={items}
        footer={[{ key: 'conta', label: 'Conta', icon: <CircleUserRound />, panel: account }]}
        tabs={TABS}
        contentKey={`${pathname}:${tick}`}
        top={
          <>
            <div style={{ minWidth: 0 }}>
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
            <ThemeToggle />
          </>
        }
      >
        <Outlet key={tick} />
      </AppFrame>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </>
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
