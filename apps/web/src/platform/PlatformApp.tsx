import {
  Activity,
  BrainCircuit,
  Bike,
  Building2,
  CreditCard,
  KeyRound,
  KanbanSquare,
  Download,
  LogOut,
  MessagesSquare,
  MessageCircle,
  RefreshCw,
  ScrollText,
  Server,
  Tags,
  Calculator,
  Globe,
  Mail,
  Wallet,
} from 'lucide-react';
import {
  createContext,
  FormEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  TextField,
  ThemeToggle,
  ToastProvider,
  useToast,
  AppSkeleton,
} from '../design-system';
import { api, ApiError } from '../lib/api';
import '../app/shell.css';
import '../app/ops.css';
import './admin.css';
import { isStandalone, promptInstall } from './pwa';
import { ForgotLink, ForgotPassword } from '../pages/ForgotPassword';
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
const TenantsPage = lazyPage(
  () => import('./TenantsPages'),
  (m) => m.TenantsPage,
);
const TenantDetailPage = lazyPage(
  () => import('./TenantsPages'),
  (m) => m.TenantDetailPage,
);
const NewTenantPage = lazyPage(
  () => import('./NewTenant'),
  (m) => m.NewTenantPage,
);
const SupportPage = lazyPage(
  () => import('./SupportPage'),
  (m) => m.SupportPage,
);
const WhatsAppAdminPage = lazyPage(
  () => import('./WhatsAppAdminPage'),
  (m) => m.WhatsAppAdminPage,
);
const InfraPage = lazyPage(
  () => import('./InfraPage'),
  (m) => m.InfraPage,
);
const CredentialsPage = lazyPage(
  () => import('./credentials/CredentialsPage'),
  (m) => m.CredentialsPage,
);
const PlansPage = lazyPage(
  () => import('./PlansPage'),
  (m) => m.PlansPage,
);
const SiteArea = lazyPage(
  () => import('./SiteArea'),
  (m) => m.SiteArea,
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
const MailPage = lazyPage(
  () => import('./mail/MailPage'),
  (m) => m.MailPage,
);
const TicketsBoardPage = lazyPage(
  () => import('./TicketsBoard'),
  (m) => m.TicketsBoardPage,
);
const PanelLogModal = lazyPage(
  () => import('./audit'),
  (m) => m.PanelLogModal,
);
const ChannelsPage = lazyPage(
  () => import('./ChannelsPage'),
  (m) => m.ChannelsPage,
);
const ContractSignPage = lazyPage(
  () => import('./ContractSign'),
  (m) => m.ContractSignPage,
);
const PANEL_PAGES = [
  OverviewPage,
  TenantsPage,
  TenantDetailPage,
  NewTenantPage,
  SupportPage,
  WhatsAppAdminPage,
  InfraPage,
  CredentialsPage,
  PlansPage,
  QuotePage,
  SiteArea,
  BillingPage,
  OnlinePayPage,
  AiPage,
  TicketsBoardPage,
  MailPage,
  ChannelsPage,
];
/** Mesmo nome de SupportPage.tsx (fica aqui para o painel não baixar a tela de conversas). */
const SUPPORT_CHANGED_EVENT = 'cm:admin-support-changed';
/** Mesmo nome de WhatsAppAdminPage.tsx. */
const WA_CHANGED_EVENT = 'cm:admin-whatsapp-changed';
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
  /** Esqueci minha senha (código por e-mail) e o aviso depois de trocar. */
  const [forgot, setForgot] = useState(false);
  const [changed, setChanged] = useState(false);

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

  if (forgot)
    return (
      <ForgotPassword
        base="/platform/auth/password-reset"
        sub="Super Admin"
        initialEmail={email}
        minPassword={10}
        finishLabel="Salvar senha nova"
        onBack={() => setForgot(false)}
        onDone={(em) => {
          // A troca tira o painel de todos os navegadores: entra de novo, com o autenticador.
          setEmail(em);
          setPassword('');
          setCode('');
          setTrusted(false);
          setChanged(true);
          setForgot(false);
        }}
      />
    );

  return (
    <AuthShell title="Super Admin" sub="Super Admin">
      {changed && (
        <Alert tone="info">Senha trocada. Entre com a senha nova e o código do autenticador.</Alert>
      )}
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
        <ForgotLink
          onClick={() => {
            setError(null);
            setForgot(true);
          }}
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

/**
 * Menu em quatro grupos, na ordem do dia a dia: quem usa (Clientes), como chega gente nova
 * (Vendas), o dinheiro (Financeiro) e o que mantém tudo de pé (Sistema). O registro de ações
 * não tem tela própria: o de cada restaurante fica na aba Histórico dele e o do painel em Conta.
 */
const NAV: {
  to: string;
  label: string;
  short?: string;
  icon: typeof Activity;
  section?: string;
}[] = [
  { to: '/', label: 'Status', icon: Activity },
  {
    to: '/restaurantes',
    label: 'Restaurantes',
    short: 'Clientes',
    icon: Building2,
    section: 'Clientes',
  },
  { to: '/conversas', label: 'Conversas', icon: MessagesSquare, section: 'Clientes' },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, section: 'Clientes' },
  { to: '/chamados', label: 'Chamados', icon: KanbanSquare, section: 'Clientes' },
  { to: '/site', label: 'Site', icon: Globe, section: 'Vendas' },
  { to: '/planos', label: 'Preço', icon: Tags, section: 'Vendas' },
  { to: '/orcamento', label: 'Orçamento', icon: Calculator, section: 'Vendas' },
  { to: '/cobranca', label: 'Cobrança', icon: Wallet, section: 'Financeiro' },
  {
    to: '/pagamentos',
    label: 'Pagamentos pelo app',
    short: 'Pagamentos',
    icon: CreditCard,
    section: 'Financeiro',
  },
  {
    to: '/servidor',
    label: 'Infraestrutura',
    short: 'Infra',
    icon: Server,
    section: 'Sistema',
  },
  {
    to: '/aplicativos',
    label: 'Aplicativos de delivery',
    short: 'Aplicativos',
    icon: Bike,
    section: 'Sistema',
  },
  { to: '/email', label: 'E-mail', icon: Mail, section: 'Sistema' },
  { to: '/tokens', label: 'Tokens de IA', short: 'Tokens', icon: BrainCircuit, section: 'Sistema' },
  { to: '/credenciais', label: 'Credenciais', icon: KeyRound, section: 'Sistema' },
];
/** Abas do celular; o resto fica em "Mais". */
const TABS = ['/', '/restaurantes', '/conversas', '/servidor'];

function titleFor(path: string) {
  if (path === '/') return 'Status';
  if (path === FRAME_MENU_PATH) return 'Mais';
  return (
    NAV.find((n) => n.to !== '/' && (path === n.to || path.startsWith(`${n.to}/`)))?.label ??
    'Painel'
  );
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
  const [panelLog, setPanelLog] = useState(false);
  const [tick, setTick] = useState(0);
  const [spinning, setSpinning] = useState(false);
  // Depois da primeira tela, baixa as outras quando o navegador fica livre: a troca fica imediata.
  useEffect(() => preloadPages(PANEL_PAGES), []);
  const standalone = isStandalone();
  // Mensagens novas dos restaurantes: número no "Conversas", no título da aba do navegador e um
  // aviso quando chega conversa nova fora da tela de Conversas.
  const [supportUnread, setSupportUnread] = useState(0);
  const lastUnread = useRef<number | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  useEffect(() => {
    const load = () =>
      api<{ chats: number }>('/platform/support/unread')
        .then((r) => {
          const before = lastUnread.current;
          lastUnread.current = r.chats;
          setSupportUnread(r.chats);
          if (before !== null && r.chats > before && !pathRef.current.startsWith('/conversas'))
            toast('Mensagem nova de um restaurante em Conversas', 'neutral');
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(() => !document.hidden && void load(), 20_000);
    window.addEventListener(SUPPORT_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(SUPPORT_CHANGED_EVENT, load);
    };
  }, []);

  // Conversas com mensagem nova no WhatsApp do painel: número no menu e aviso fora da tela.
  const [waUnread, setWaUnread] = useState(0);
  const lastWa = useRef<number | null>(null);
  useEffect(() => {
    const load = () =>
      api<{ chats: number }>('/platform/whatsapp/unread')
        .then((r) => {
          const before = lastWa.current;
          lastWa.current = r.chats;
          setWaUnread(r.chats);
          if (before !== null && r.chats > before && !pathRef.current.startsWith('/whatsapp'))
            toast('Mensagem nova no WhatsApp', 'neutral');
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(() => !document.hidden && void load(), 20_000);
    window.addEventListener(WA_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(WA_CHANGED_EVENT, load);
    };
  }, []);

  useEffect(() => {
    const clean = document.title.replace(/^\(\d+\) /, '');
    const n = supportUnread + waUnread;
    document.title = n > 0 ? `(${n}) ${clean}` : clean;
  }, [supportUnread, waUnread]);

  const refresh = () => {
    setTick((t) => t + 1);
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  };
  const doInstall = async () => {
    if (!(await promptInstall())) setInstall(true);
    else toast('Instalando…', 'success');
  };

  const items: FrameItem[] = NAV.map(({ to, label, short, icon: Icon, section }) => ({
    key: to,
    to,
    label,
    short,
    icon: <Icon />,
    section,
    count: to === '/conversas' ? supportUnread : to === '/whatsapp' ? waUnread : undefined,
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
      <button type="button" className="account__action" onClick={() => setPanelLog(true)}>
        <ScrollText size={18} /> Registro do painel
      </button>
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
        menuBySection
        account={
          admin
            ? {
                name: admin.name,
                sub: admin.email,
                initials: admin.name.slice(0, 1).toUpperCase(),
                role: 'Super Admin',
                note: window.location.hostname,
                actions: [
                  {
                    key: 'registro',
                    label: 'Registro do painel',
                    icon: <ScrollText />,
                    onClick: () => setPanelLog(true),
                  },
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
      {panelLog && (
        <Suspense fallback={null}>
          <PanelLogModal onClose={() => setPanelLog(false)} />
        </Suspense>
      )}
    </>
  );
}

function Gate() {
  const { status, error } = usePlatformAuth();
  if (status === 'loading') return <AppSkeleton />;
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
        <Route path="restaurantes/novo" element={<NewTenantPage />} />
        <Route path="restaurantes/:id" element={<TenantDetailPage />} />
        <Route path="conversas" element={<SupportPage />} />
        <Route path="whatsapp" element={<WhatsAppAdminPage />} />
        <Route path="servidor/*" element={<InfraPage />} />
        {/* Endereços antigos: Bancos e Backups agora são abas da Infraestrutura. */}
        <Route path="bancos" element={<Navigate to="/servidor/bancos" replace />} />
        <Route path="backups" element={<Navigate to="/servidor/backups" replace />} />
        <Route path="credenciais" element={<CredentialsPage />} />
        <Route path="aplicativos" element={<ChannelsPage />} />
        {/* A aba Fiscal saiu: o que se configura da Focus NFe fica em Credenciais. */}
        <Route path="fiscal" element={<Navigate to="/credenciais#cred-focus_master" replace />} />
        <Route path="planos" element={<PlansPage />} />
        <Route path="orcamento" element={<QuotePage />} />
        <Route path="site/*" element={<SiteArea />} />
        {/* Sites com IA virou uma aba do Site. */}
        <Route path="sites-ia" element={<Navigate to="/site/ia" replace />} />
        <Route path="cobranca" element={<BillingPage />} />
        <Route path="pagamentos" element={<OnlinePayPage />} />
        <Route path="tokens" element={<AiPage />} />
        <Route path="ia" element={<AiPage />} />
        <Route path="chamados" element={<TicketsBoardPage />} />
        <Route path="email/*" element={<MailPage />} />
        {/* A Auditoria saiu do menu: cada restaurante tem a aba Histórico e o painel, o Registro
            do painel (em Conta). */}
        <Route path="auditoria" element={<Navigate to="/restaurantes" replace />} />
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
