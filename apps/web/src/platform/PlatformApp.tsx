import {
  Activity,
  BrainCircuit,
  Building2,
  CreditCard,
  FileText,
  KanbanSquare,
  Download,
  LogOut,
  MessagesSquare,
  RefreshCw,
  ScrollText,
  Server,
  Tags,
  Calculator,
  Globe,
  Wallet,
} from 'lucide-react';
import {
  createContext,
  FormEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  Suspense,
} from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import {
  Alert,
  AppFrame,
  Button,
  FrameAvatar,
  FRAME_MENU_PATH,
  FrameItem,
  LivePanda,
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
import { isStandalone, promptInstall } from './pwa';
import { AuthShell, deskFocus, PasswordField } from '../pages/AuthShell';
import { lazyPage, preloadPages } from '../lib/lazy-page';
import { PageLoading } from '../app/PageLoading';

/**
 * Cada tela do painel é um arquivo à parte, baixado quando abre (e em segundo plano logo depois da
 * primeira). Antes o painel inteiro vinha junto e a primeira tela demorava a aparecer.
 */
const OverviewPage = lazyPage(
  () => import('./OverviewPages'),
  (m) => m.OverviewPage,
);
const AuditPage = lazyPage(
  () => import('./OverviewPages'),
  (m) => m.AuditPage,
);
const TenantsPage = lazyPage(
  () => import('./TenantsPages'),
  (m) => m.TenantsPage,
);
const TenantDetailPage = lazyPage(
  () => import('./TenantsPages'),
  (m) => m.TenantDetailPage,
);
const SupportPage = lazyPage(
  () => import('./SupportPage'),
  (m) => m.SupportPage,
);
const InfraPage = lazyPage(
  () => import('./InfraPage'),
  (m) => m.InfraPage,
);
const FiscalPage = lazyPage(
  () => import('./FiscalPage'),
  (m) => m.FiscalPage,
);
const PlansPage = lazyPage(
  () => import('./PlansPage'),
  (m) => m.PlansPage,
);
const SitePage = lazyPage(
  () => import('./SitePage'),
  (m) => m.SitePage,
);
const QuotePage = lazyPage(
  () => import('./QuotePage'),
  (m) => m.QuotePage,
);
const BillingPage = lazyPage(
  () => import('./BillingPage'),
  (m) => m.BillingPage,
);
const OnlinePayPage = lazyPage(
  () => import('./OnlinePayPage'),
  (m) => m.OnlinePayPage,
);
const AiPage = lazyPage(
  () => import('./AiPage'),
  (m) => m.AiPage,
);
const TicketsBoardPage = lazyPage(
  () => import('./TicketsBoard'),
  (m) => m.TicketsBoardPage,
);
const ContractSignPage = lazyPage(
  () => import('./ContractSign'),
  (m) => m.ContractSignPage,
);
const PANEL_PAGES = [
  OverviewPage,
  AuditPage,
  TenantsPage,
  TenantDetailPage,
  SupportPage,
  InfraPage,
  FiscalPage,
  PlansPage,
  QuotePage,
  SitePage,
  BillingPage,
  OnlinePayPage,
  AiPage,
  TicketsBoardPage,
];
/** Mesmo nome de SupportPage.tsx (fica aqui para o painel não baixar a tela de conversas). */
const SUPPORT_CHANGED_EVENT = 'cm:admin-support-changed';
/** Link de assinatura do contrato (/assinar/<token>): igual a ContractSign.tsx. */
const signToken = (path = window.location.pathname) =>
  /^\/assinar\/([A-Za-z0-9_-]{30,60})\/?$/.exec(path)?.[1] ?? null;

/** O painel Super Admin só existe em admin.<domínio base>. */

interface Admin {
  id: string;
  name: string;
  email: string;
}
interface PlatformAuth {
  status: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  admin?: Admin;
  error?: string;
  login(email: string, password: string, code: string, remember?: boolean): Promise<void>;
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
    async (email: string, password: string, code: string, remember = false) => {
      await api('/platform/auth/login', {
        method: 'POST',
        json: { email, password, code, remember },
      });
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
  /** Marcado por padrão: o aparelho fica lembrado e o painel continua aberto (sessão renovada). */
  const [remember, setRemember] = useState(true);
  /** Navegador confiável: já entrou com o código antes, então o campo some. */
  const [trusted, setTrusted] = useState(false);
  const [desk] = useState(deskFocus);
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
      await login(email, password, trusted ? '' : code, !trusted && remember);
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
    <AuthShell
      place="Super Admin"
      title="Painel da plataforma"
      sub="Acesso restrito à equipe. Tudo fica na auditoria."
      pitch={
        <>
          Todos os restaurantes
          <span> num painel só.</span>
        </>
      }
    >
      <form onSubmit={onSubmit} className="login__form" noValidate>
        <TextField
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={desk && !email}
        />
        <PasswordField
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={desk && !!email}
        />
        {trusted ? (
          <p className="login__note">
            Navegador confiável: aqui não pede o código.{' '}
            <button type="button" className="login__link" onClick={() => setTrusted(false)}>
              Usar código
            </button>
          </p>
        ) : (
          <>
            <TextField
              label="Código do autenticador"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <label className="login__check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Lembrar este aparelho e continuar conectado
            </label>
          </>
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
    </AuthShell>
  );
}

const NAV = [
  { to: '/', label: 'Status', icon: Activity },
  { to: '/restaurantes', label: 'Restaurantes', short: 'Clientes', icon: Building2 },
  { to: '/conversas', label: 'Conversas', icon: MessagesSquare },
  { to: '/chamados', label: 'Chamados', icon: KanbanSquare },
  { to: '/servidor', label: 'Infraestrutura', short: 'Infra', icon: Server },
  { to: '/fiscal', label: 'Fiscal', icon: FileText },
  { to: '/planos', label: 'Planos', icon: Tags },
  { to: '/orcamento', label: 'Orçamento', icon: Calculator },
  { to: '/site', label: 'Site', icon: Globe },
  { to: '/cobranca', label: 'Cobrança', icon: Wallet },
  { to: '/pagamentos', label: 'Pagamentos pelo app', short: 'Pagamentos', icon: CreditCard },
  { to: '/tokens', label: 'Tokens', icon: BrainCircuit },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText },
];
/** Abas do celular; o resto fica em "Mais". */
const TABS = ['/', '/restaurantes', '/conversas', '/servidor'];

function titleFor(path: string) {
  if (path === '/') return 'Status';
  if (path === FRAME_MENU_PATH) return 'Mais';
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
  // Depois da primeira tela, baixa as outras quando o navegador fica livre: a troca fica imediata.
  useEffect(() => preloadPages(PANEL_PAGES), []);
  const standalone = isStandalone();
  // Mensagens novas dos restaurantes: bolinha no "Conversas".
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    const load = () =>
      api<{ chats: number }>('/platform/support/unread')
        .then((r) => setSupportUnread(r.chats))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => !document.hidden && void load(), 20_000);
    window.addEventListener(SUPPORT_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(SUPPORT_CHANGED_EVENT, load);
    };
  }, []);

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
    dot: to === '/conversas' && supportUnread > 0,
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
        brand={
          <span className="adm-brand">
            <LivePanda size={36} badge title="Comandou Admin" />
            <span className="adm-brand__name">Comandou Admin</span>
          </span>
        }
        brandCompact={<LivePanda size={28} badge title="Comandou Admin" />}
        showWhere={false}
        items={items}
        footer={[
          {
            key: 'conta',
            label: 'Conta',
            icon: <FrameAvatar name={admin?.name} />,
            panel: account,
          },
        ]}
        tabs={TABS}
        account={
          admin
            ? {
                name: admin.name,
                sub: admin.email,
                initials: admin.name.slice(0, 1).toUpperCase(),
                role: 'Super Admin',
                note: window.location.hostname,
                actions: [
                  ...(!standalone
                    ? [
                        {
                          key: 'instalar',
                          label: 'Instalar app',
                          icon: <Download />,
                          onClick: doInstall,
                        },
                      ]
                    : []),
                  { key: 'sair', label: 'Sair', icon: <LogOut />, onClick: logout, danger: true },
                ],
                footnote: `Comandou Admin v${__APP_VERSION__}`,
              }
            : undefined
        }
        contentKey={`${pathname}:${tick}`}
        top={
          <>
            <div className="topbar__tenant" title={window.location.hostname}>
              {titleFor(pathname)}
              <span className="topbar__version">v{__APP_VERSION__}</span>
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
        <Suspense fallback={<PageLoading />}>
          <Outlet key={tick} />
        </Suspense>
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
        <Route path="conversas" element={<SupportPage />} />
        <Route path="servidor/*" element={<InfraPage />} />
        {/* Endereços antigos: Bancos e Backups agora são abas da Infraestrutura. */}
        <Route path="bancos" element={<Navigate to="/servidor/bancos" replace />} />
        <Route path="backups" element={<Navigate to="/servidor/backups" replace />} />
        <Route path="fiscal" element={<FiscalPage />} />
        <Route path="planos" element={<PlansPage />} />
        <Route path="orcamento" element={<QuotePage />} />
        <Route path="site" element={<SitePage />} />
        <Route path="cobranca" element={<BillingPage />} />
        <Route path="pagamentos" element={<OnlinePayPage />} />
        <Route path="tokens" element={<AiPage />} />
        <Route path="ia" element={<AiPage />} />
        <Route path="chamados" element={<TicketsBoardPage />} />
        <Route path="auditoria" element={<AuditPage />} />
        {/* Tela "Mais" do celular: quem desenha é a moldura (AppFrame). */}
        <Route path="mais" element={null} />
        <Route path="*" element={<OverviewPage />} />
      </Route>
    </Routes>
  );
}

export function PlatformApp() {
  // Link de assinatura de contrato: página pública, sem login do painel.
  const token = signToken();
  if (token)
    return (
      <ToastProvider>
        <ContractSignPage token={token} />
      </ToastProvider>
    );
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
