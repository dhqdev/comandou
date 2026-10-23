import {
  BarChart3,
  Briefcase,
  CircleUserRound,
  BookOpen,
  CreditCard,
  Boxes,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  KeyRound,
  MessageCircle,
  FileText,
  Printer,
  Receipt,
  UserCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  Store,
  Truck,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { ReactNode, useCallback, useState } from 'react';
import { CURRENT_RELEASE } from '@comandou/shared';
import { Outlet, useLocation } from 'react-router';
import {
  AppFrame,
  Badge,
  FrameItem,
  Logo,
  Mascot,
  ThemeToggle,
  currentTheme,
  setTheme,
} from '../design-system';
import { GlobalSearch, GlobalSearchTrigger, useSearchHotkey } from '../features/GlobalSearch';
import { useSearchSpotlight } from '../lib/deep-link';
import { useOnline } from '../lib/connectivity';
import { useRealtimeStatus } from '../lib/realtime';
import { useHasUnseenRelease } from '../lib/releases';
import { ChangePasswordModal } from '../pages/TeamPage';
import { useAuth } from './auth';
import './shell.css';
import './ops.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  /** Mostra o item se o usuário tiver ao menos uma destas permissões. */
  perms?: string[];
}

/** Operação: cada tela é um ícone na barra. */
const MAIN: NavItem[] = [
  { to: '/', label: 'PDV', icon: <Store /> },
  { to: '/pedidos', label: 'Pedidos', icon: <ClipboardList />, perms: ['orders:read'] },
  {
    to: '/mesas',
    label: 'Salão',
    icon: <LayoutGrid />,
    perms: ['tables:operate', 'payments:create'],
  },
  {
    to: '/cozinha',
    label: 'Cozinha',
    icon: <ChefHat />,
    perms: ['kitchen:operate', 'orders:read'],
  },
  {
    to: '/caixa',
    label: 'Caixa',
    icon: <Wallet />,
    perms: ['cash:operate', 'cash:close', 'reports:read'],
  },
  {
    to: '/entregas',
    label: 'Entregas',
    icon: <Truck />,
    perms: ['delivery:manage', 'delivery:operate'],
  },
  { to: '/cardapio', label: 'Cardápio', icon: <BookOpen /> },
];

/** Gestão e configurações: abrem um submenu que sai da barra (no celular, folha de baixo). */
const GROUPS: { key: string; label: string; icon: ReactNode; items: NavItem[] }[] = [
  {
    key: 'gestao',
    label: 'Gestão',
    icon: <Briefcase />,
    items: [
      {
        to: '/loja-online',
        label: 'Loja online',
        icon: <Smartphone />,
        perms: ['settings:manage'],
      },
      { to: '/clientes', label: 'Clientes', icon: <Users />, perms: ['customers:read'] },
      { to: '/estoque', label: 'Estoque', icon: <Boxes />, perms: ['stock:read'] },
      { to: '/financeiro', label: 'Financeiro', icon: <Receipt />, perms: ['finance:read'] },
      { to: '/relatorios', label: 'Relatórios', icon: <BarChart3 />, perms: ['reports:read'] },
      { to: '/equipe', label: 'Equipe', icon: <UserCog />, perms: ['users:manage'] },
    ],
  },
  {
    key: 'sistema',
    label: 'Sistema',
    icon: <SlidersHorizontal />,
    items: [
      { to: '/impressao', label: 'Impressão', icon: <Printer />, perms: ['printing:manage'] },
      {
        to: '/nota-fiscal',
        label: 'Nota fiscal',
        icon: <FileText />,
        perms: ['fiscal:emit', 'fiscal:manage'],
      },
      {
        to: '/whatsapp',
        label: 'WhatsApp',
        icon: <MessageCircle />,
        perms: ['messaging:manage'],
      },
      {
        to: '/plano',
        label: 'Plano',
        icon: <CreditCard />,
        perms: ['plan:read'],
      },
      {
        to: '/configuracoes',
        label: 'Ajustes',
        icon: <Settings />,
        perms: ['settings:manage', 'orders:read'],
      },
    ],
  },
];

/** Abas do celular, na ordem de preferência (as 4 primeiras que o usuário pode ver). */
const TAB_PREFERENCE = ['/', '/pedidos', '/mesas', '/cozinha', '/caixa', '/cardapio'];

export function AppShell() {
  const { me, logout } = useAuth();
  /** Encerra a sessão de suporte e volta para o painel admin (mesma porta em dev). */
  const endSupport = async () => {
    const host = me?.support?.adminHost;
    await logout();
    if (host) {
      const port = window.location.port ? `:${window.location.port}` : '';
      window.location.assign(
        `${window.location.protocol}//${host}${port}/restaurantes/${me?.tenant.id ?? ''}`,
      );
    }
  };
  const online = useOnline();
  const live = useRealtimeStatus();
  const unseen = useHasUnseenRelease();
  const [pwOpen, setPwOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const perms = me?.permissions;
  const allowed = useCallback(
    (list?: string[]) => !list || list.some((p) => perms?.includes(p)),
    [perms],
  );
  const can = (item: NavItem) => allowed(item.perms);
  useSearchHotkey(() => setSearchOpen(true));
  useSearchSpotlight();
  const initials = (me?.user.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const main: FrameItem[] = MAIN.filter(can).map((i) => ({
    key: i.to,
    to: i.to,
    label: i.label,
    icon: i.icon,
  }));
  const groups: FrameItem[] = GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    icon: g.icon,
    children: g.items.filter(can).map((i) => ({
      to: i.to,
      label: i.label,
      icon: i.icon,
      badge: i.soon ? <Badge>em breve</Badge> : undefined,
    })),
  })).filter((g) => g.children.length > 0);
  const tabs = TAB_PREFERENCE.filter((k) => main.some((m) => m.key === k)).slice(0, 4);

  const account = (
    <div className="account">
      <div className="account__who">
        <div className="account__avatar" aria-hidden>
          {initials}
        </div>
        <div>
          <div className="account__name">{me?.user.name}</div>
          <div className="account__sub">
            {me?.user.roleLabel} · {me?.tenant.name}
          </div>
        </div>
      </div>
      <div className="account__row">
        <span>Tema</span>
        <ThemeToggle />
      </div>
      <button type="button" className="account__action" onClick={() => setPwOpen(true)}>
        <KeyRound size={18} /> Trocar senha
      </button>
      <button type="button" className="account__action" onClick={logout}>
        <LogOut size={18} /> Sair
      </button>
    </div>
  );

  return (
    <>
      <AppFrame
        brand={<Mascot size={40} badge title="Comandou" />}
        brandCompact={<Logo size={30} wordmark={false} />}
        items={[...main, ...groups]}
        footer={[
          {
            key: 'novidades',
            to: '/novidades',
            label: 'Novidades',
            icon: <Sparkles />,
            dot: unseen,
          },
          { key: 'conta', label: 'Conta', icon: <CircleUserRound />, panel: account },
        ]}
        tabs={tabs}
        contentKey={location.pathname}
        top={
          <>
            <div className="topbar__tenant" title={me?.tenant.name}>
              {me?.tenant.name}
              <span className="topbar__version">v{CURRENT_RELEASE.version}</span>
            </div>
            <GlobalSearchTrigger onOpen={() => setSearchOpen(true)} />
            <div className="topbar__spacer" />
            {!online ? (
              <Badge tone="warning">Sem conexão</Badge>
            ) : live === 'live' ? (
              <Badge tone="success">
                <span className="cm-dot cm-dot--pulse" /> Tempo real
              </Badge>
            ) : (
              <Badge tone="warning">Reconectando…</Badge>
            )}
            <GlobalSearchTrigger icon onOpen={() => setSearchOpen(true)} />
            <ThemeToggle />
          </>
        }
        banners={
          <>
            {me?.support && (
              <div className="offline-banner support-banner" role="status">
                Acesso de suporte: {me.support.adminName} entrou como {me.user.name}. Tudo fica
                registrado. <button onClick={endSupport}>Encerrar acesso</button>
              </div>
            )}
            {!online && (
              <div className="offline-banner" role="status">
                <WifiOff size={14} style={{ verticalAlign: -2 }} /> Você está offline. Pagamentos,
                caixa e confirmação de pedidos ficam bloqueados até a conexão voltar.
              </div>
            )}
          </>
        }
      >
        <Outlet />
      </AppFrame>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        can={allowed}
        onAction={(a) => {
          if (a === 'theme') setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
          if (a === 'password') setPwOpen(true);
          if (a === 'logout') void logout();
        }}
      />
    </>
  );
}
