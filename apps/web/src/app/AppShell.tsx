import { BillingBanner } from '../features/BillingBanner';
import {
  BarChart3,
  Briefcase,
  CircleUserRound,
  Compass,
  LifeBuoy,
  BookOpen,
  Calculator,
  CalendarCheck,
  ClipboardCheck,
  Factory,
  PackageMinus,
  PackagePlus,
  Ruler,
  CreditCard,
  Boxes,
  Bot,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  KeyRound,
  Layers,
  MessageCircle,
  FileText,
  FileStack,
  Inbox,
  Ban,
  Scale,
  Printer,
  Receipt,
  UserCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  Store,
  Tags,
  Truck,
  UtensilsCrossed,
  Users,
  Wallet,
  WifiOff,
  MessagesSquare,
  Shirt,
} from 'lucide-react';
import { ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { PageLoading } from './PageLoading';
import { Outlet, useLocation } from 'react-router';
import {
  AppFrame,
  Badge,
  FrameItem,
  FrameLink,
  ThemeToggle,
  currentTheme,
  setTheme,
} from '../design-system';
import { GlobalSearch, GlobalSearchTrigger, useSearchHotkey } from '../features/GlobalSearch';
import { NewsBell } from '../features/NewsBell';
import { SoundControl } from '../features/SoundControl';
import { openTeamChat, useChatUnread } from '../features/chat/TeamChat';
import {
  openSupportInbox,
  SupportButton,
  SupportChatHost,
  useSupportUnread,
} from '../features/store-chat/SupportInbox';
import { WelcomeTour, tourSeen } from '../features/WelcomeTour';
import { PageTourHost } from '../features/tour/PageTour';
import { PandaStroll } from '../features/mascot/Stroll';
import { openWardrobe, useMascotSync } from '../features/mascot/state';
import { WardrobeHost } from '../features/mascot/Wardrobe';
import { PandaButton } from '../features/mascot/PandaButton';
import { useSearchSpotlight } from '../lib/deep-link';
import { useOnline } from '../lib/connectivity';
import { useRealtimeStatus } from '../lib/realtime';
import { useHasUnseenRelease } from '../lib/releases';
import { ChangePasswordModal } from '../pages/TeamPage';
import { useAuth } from './auth';
import { ROLE_HOME } from './role-home';
import './shell.css';
import './ops.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  /** Subitens: o ícone abre um submenu na barra (no celular, folha de baixo). */
  children?: (FrameLink & { perms?: string[] })[];
  /** Mostra o item se o usuário tiver ao menos uma destas permissões. */
  perms?: string[];
}

/** Operação: cada tela é um ícone na barra. */
const MAIN: NavItem[] = [
  { to: '/', label: 'PDV', icon: <Store />, perms: ['orders:write'] },
  { to: '/pedidos', label: 'Pedidos', icon: <ClipboardList />, perms: ['orders:read'] },
  {
    to: '/mesas',
    label: 'Salão',
    icon: <LayoutGrid />,
    perms: ['tables:operate', 'payments:create'],
  },
  {
    to: '/reservas',
    label: 'Reservas',
    icon: <CalendarCheck />,
    perms: ['tables:operate', 'settings:manage'],
  },
  {
    to: '/cozinha',
    label: 'Cozinha',
    icon: <ChefHat />,
    perms: ['kitchen:operate', 'orders:manage'],
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
    perms: ['delivery:manage'],
  },
  {
    to: '/cardapio',
    label: 'Cardápio',
    icon: <BookOpen />,
    perms: ['catalog:read'],
    children: [
      {
        to: '/cardapio',
        end: true,
        also: '/cardapio/itens/*',
        label: 'Itens',
        icon: <UtensilsCrossed />,
      },
      { to: '/cardapio/familias', label: 'Famílias de item', icon: <Tags /> },
      { to: '/cardapio/complementos', label: 'Grupos de complementos', icon: <Layers /> },
      { to: '/cardapio/cardapios', label: 'Cardápios', icon: <BookOpen /> },
    ],
  },
  {
    to: '/estoque',
    label: 'Estoque',
    icon: <Boxes />,
    perms: ['stock:read'],
    children: [
      {
        to: '/estoque',
        end: true,
        also: '/estoque/insumos/*',
        label: 'Visão geral',
        icon: <Boxes />,
      },
      { to: '/estoque/lotes', label: 'Lotes', icon: <Tags /> },
      { to: '/estoque/producao', label: 'Produção', icon: <Factory /> },
      { to: '/estoque/recebimento', label: 'Recebimento', icon: <PackagePlus /> },
      { to: '/estoque/saida', label: 'Saída de estoque', icon: <PackageMinus /> },
      { to: '/estoque/inventario', label: 'Inventário', icon: <ClipboardCheck /> },
      { to: '/estoque/fichas', label: 'Fichas técnicas', icon: <ClipboardList /> },
      { to: '/estoque/fatores', label: 'Fatores de conversão', icon: <Ruler /> },
      {
        to: '/estoque/precificacao',
        label: 'Precificação',
        icon: <Calculator />,
        perms: ['stock:write', 'reports:read'],
      },
    ],
  },
  {
    to: '/fiscal',
    label: 'Fiscal',
    icon: <FileText />,
    perms: ['fiscal:emit', 'fiscal:manage'],
    children: [
      { to: '/fiscal/nfce', also: '/fiscal/nota/*', label: 'NFC-e', icon: <Receipt /> },
      { to: '/fiscal/nfe', label: 'NF-e', icon: <FileStack /> },
      { to: '/fiscal/recebidas', label: 'Notas recebidas', icon: <Inbox /> },
      { to: '/fiscal/inutilizacao', label: 'Inutilização', icon: <Ban /> },
      {
        to: '/fiscal/padroes',
        label: 'Padrões fiscais',
        icon: <Scale />,
        perms: ['fiscal:manage'],
      },
      {
        to: '/fiscal/configuracao',
        label: 'Configuração',
        icon: <Settings />,
        perms: ['fiscal:manage'],
      },
    ],
  },
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
        to: '/whatsapp',
        label: 'WhatsApp',
        icon: <MessageCircle />,
        perms: ['messaging:manage'],
      },
      {
        to: '/assistente-ia',
        label: 'Assistente de IA',
        icon: <Bot />,
        perms: ['settings:manage'],
      },
      { to: '/chamados', label: 'Chamados', icon: <LifeBuoy />, perms: ['plan:read'] },
      {
        to: '/plano',
        label: 'Assinatura',
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
const TAB_PREFERENCE = ['/', '/pedidos', '/mesas', '/cozinha', '/caixa', '/entregas', '/cardapio'];

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
  const chatUnread = useChatUnread();
  const support = useSupportUnread();
  useMascotSync(me?.user.id);
  const [pwOpen, setPwOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const location = useLocation();
  const perms = me?.permissions;
  const allowed = useCallback(
    (list?: string[]) => !list || list.some((p) => perms?.includes(p)),
    [perms],
  );
  const can = (item: NavItem) => allowed(item.perms);
  useSearchHotkey(() => setSearchOpen(true));
  useSearchSpotlight();
  // Primeiro acesso deste usuário neste aparelho: apresenta as telas (não no acesso de suporte).
  useEffect(() => {
    if (me && !me.support && !tourSeen(me.tenant.id, me.user.id)) setTourOpen(true);
  }, [me]);
  const initials = (me?.user.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Quem tem outra tela inicial (garçom, entregador…) abre o PDV pelo endereço /pdv.
  const pdvTo = ROLE_HOME[me?.user.role ?? ''] ? '/pdv' : '/';
  const main: FrameItem[] = MAIN.filter(can).map((i) => ({
    key: i.to,
    to: i.children ? undefined : i.to === '/' ? pdvTo : i.to,
    label: i.label,
    icon: i.icon,
    children: i.children?.filter((c) => allowed(c.perms)).map(({ perms: _perms, ...c }) => c),
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
      {me?.permissions.includes('plan:read') && (
        <button type="button" className="account__action" onClick={() => openTeamChat('suporte')}>
          <LifeBuoy size={18} /> Falar com a Comandou
        </button>
      )}
      <button type="button" className="account__action" onClick={() => setTourOpen(true)}>
        <Compass size={18} /> Rever apresentação
      </button>
      <button type="button" className="account__action" onClick={openWardrobe}>
        <Shirt size={18} /> Roupa do panda
      </button>
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
        brand={<PandaButton size={60} />}
        brandCompact={<PandaButton size={42} />}
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
        moreActions={[
          {
            key: 'conversas',
            label: 'Conversas',
            icon: <MessagesSquare />,
            badge: chatUnread,
            onClick: () => openTeamChat(),
          },
          ...(allowed(['orders:manage'])
            ? [
                {
                  key: 'clientes-chat',
                  label: 'Mensagens de clientes',
                  icon: <MessageCircle />,
                  badge: support.chats,
                  onClick: () => openSupportInbox(),
                },
              ]
            : []),
        ]}
        contentKey={location.pathname}
        top={
          <>
            <div className="topbar__tenant" title={me?.tenant.name}>
              {me?.tenant.name}
              <span className="topbar__version">v{__APP_VERSION__}</span>
            </div>
            <GlobalSearchTrigger onOpen={() => setSearchOpen(true)} />
            <div className="topbar__spacer" />
            {!online ? (
              <Badge tone="warning">Sem conexão</Badge>
            ) : live === 'live' ? (
              <span className="cm-badge cm-badge--success topbar__live" title="Tempo real">
                <span className="cm-dot cm-dot--pulse" />{' '}
                <span className="topbar__live-text">Tempo real</span>
              </span>
            ) : (
              <Badge tone="warning">Reconectando…</Badge>
            )}
            <GlobalSearchTrigger icon onOpen={() => setSearchOpen(true)} />
            {location.pathname !== '/' && location.pathname !== '/pdv' && (
              <SupportButton className="topbar__support" />
            )}
            <NewsBell />
            <SoundControl />
            <ThemeToggle />
          </>
        }
        banners={
          <>
            <BillingBanner />
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
        {/* A tela que ainda está chegando não apaga o menu nem o topo. */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </AppFrame>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <WardrobeHost />
      <SupportChatHost />
      <PandaStroll />
      {me && (
        <WelcomeTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          tenantId={me.tenant.id}
          userId={me.user.id}
          userName={me.user.name}
          tenantName={me.tenant.name}
          items={[...main, ...groups]}
          tabs={tabs}
        />
      )}
      {me && <PageTourHost items={[...main, ...groups]} tabs={tabs} />}
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
