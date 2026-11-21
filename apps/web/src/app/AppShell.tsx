import { BillingBanner } from '../features/BillingBanner';
import {
  BarChart3,
  Briefcase,
  LifeBuoy,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  PackagePlus,
  CreditCard,
  Bike,
  Boxes,
  Bot,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
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
  Smartphone,
  Store,
  Tags,
  Truck,
  UtensilsCrossed,
  Users,
  Wallet,
  MessagesSquare,
} from 'lucide-react';
import { ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { PageLoading } from './PageLoading';
import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppFrame,
  Badge,
  FrameAvatar,
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
import { WelcomeTour, markTourSeen, tourSeen } from '../features/WelcomeTour';
import {
  OnboardingChat,
  markOnboardingSeen,
  onboardingSeen,
} from '../features/onboarding/OnboardingChat';
import { api } from '../lib/api';
import { PageTourHost } from '../features/tour/PageTour';
import { useSearchSpotlight } from '../lib/deep-link';
import { rememberStaffApp } from '../lib/staff-app';
import { PrintStatus } from '../features/PrintStatus';
import { ConnectionSignal } from '../features/ConnectionSignal';
import { OfflineBanner } from './OfflineBanner';
import { useHasUnseenRelease } from '../lib/releases';
import { ChangePasswordModal } from '../pages/TeamPage';
import { useInstallApp } from './InstallApp';
import { useAuth } from './auth';
import type { AccountTools } from './account-tools';
import { StoreBrand } from './StoreBrand';
import { ROLE_HOME } from './role-home';
import { ErrorBoundary, ErrorFallback } from '../lib/error-boundary';
import { ChatTopButtons } from '../features/chat/ChatTopButtons';
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
      // Quatro telas; lotes, saída, produção, fatores e precificação são abas dentro delas.
      {
        to: '/estoque',
        end: true,
        also: ['/estoque/insumos/*', '/estoque/lotes'],
        label: 'Insumos',
        icon: <Boxes />,
      },
      {
        to: '/estoque/recebimento',
        also: ['/estoque/saida', '/estoque/producao'],
        label: 'Movimentações',
        icon: <PackagePlus />,
      },
      {
        to: '/estoque/fichas',
        also: ['/estoque/fatores', '/estoque/precificacao'],
        label: 'Fichas técnicas',
        icon: <ClipboardList />,
      },
      { to: '/estoque/inventario', label: 'Inventário', icon: <ClipboardCheck /> },
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
        to: '/integracoes',
        label: 'Aplicativos de delivery',
        icon: <Bike />,
        perms: ['orders:manage'],
      },
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
    ],
  },
];

/** Telas abertas pela Conta (antes ficavam em Sistema): acendem a Conta no menu. */
const ACCOUNT_PAGES: (FrameLink & { perms?: string[] })[] = [
  { to: '/plano', label: 'Assinatura', icon: <CreditCard />, perms: ['plan:read'] },
  {
    to: '/configuracoes',
    label: 'Ajustes',
    icon: <Settings />,
    perms: ['settings:manage', 'orders:read'],
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
  const unseen = useHasUnseenRelease();
  const chatUnread = useChatUnread();
  const support = useSupportUnread();
  const [pwOpen, setPwOpen] = useState(false);
  // "Instalar o app" no perfil: o sistema vira um programa no computador (ou app no celular).
  const install = useInstallApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [onbOpen, setOnbOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const perms = me?.permissions;
  const allowed = useCallback(
    (list?: string[]) => !list || list.some((p) => perms?.includes(p)),
    [perms],
  );
  const can = (item: NavItem) => allowed(item.perms);
  useSearchHotkey(() => setSearchOpen(true));
  useSearchSpotlight();
  // Painel aberto: o QR da mesa lido pela câmera deste aparelho volta a abrir no Salão.
  useEffect(() => rememberStaffApp('painel'), []);
  // Primeiro acesso deste usuário neste aparelho: apresenta as telas (não no acesso de suporte).
  // Quem administra uma loja ainda sem itens começa pela conversa de primeiros passos.
  useEffect(() => {
    if (!me || me.support || tourSeen(me.tenant.id, me.user.id)) return;
    if (!me.permissions.includes('settings:manage') || onboardingSeen(me.tenant.id, me.user.id)) {
      setTourOpen(true);
      return;
    }
    let alive = true;
    api<unknown[]>('/products')
      .then(
        (p) => p.length === 0,
        () => false,
      )
      .then((empty) => {
        if (!alive) return;
        if (empty) setOnbOpen(true);
        else setTourOpen(true);
      });
    return () => {
      alive = false;
    };
  }, [me]);
  const closeOnboarding = useCallback(() => {
    // Sair da conversa (ou pular) também dispensa a apresentação automática: as duas ficam em Conta.
    if (me) {
      markOnboardingSeen(me.tenant.id, me.user.id);
      markTourSeen(me.tenant.id, me.user.id);
    }
    setOnbOpen(false);
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
    // O PDV também abre por /pdv (links e atalhos): o topo e o menu mostram "PDV" nos dois.
    also: i.to === '/' && pdvTo === '/' ? '/pdv' : undefined,
    label: i.label,
    icon: i.icon,
    // Menu largo: o dia a dia em cima; cadastro, estoque e fiscal embaixo.
    section: i.children ? 'Retaguarda' : 'Operação',
    children: i.children?.filter((c) => allowed(c.perms)).map(({ perms: _perms, ...c }) => c),
  }));
  const groups: FrameItem[] = GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    icon: g.icon,
    section: 'Retaguarda',
    children: g.items.filter(can).map((i) => ({
      to: i.to,
      label: i.label,
      icon: i.icon,
      badge: i.soon ? <Badge>em breve</Badge> : undefined,
    })),
  })).filter((g) => g.children.length > 0);
  const tabs = TAB_PREFERENCE.filter((k) => main.some((m) => m.key === k)).slice(0, 4);

  // Conta: tela própria (/conta) com tudo em blocos grandes. As janelas continuam aqui na
  // moldura (abrem por cima de qualquer tela) e chegam à tela pelo contexto do Outlet.
  const accountTools: AccountTools = {
    openPassword: () => setPwOpen(true),
    openTour: () => setTourOpen(true),
    openOnboarding: () => setOnbOpen(true),
    install: { show: install.show, start: () => void install.start() },
    logout: () => void logout(),
    unseen,
  };
  const accountPages = ACCOUNT_PAGES.filter((p) => allowed(p.perms)).map(
    ({ perms: _perms, ...p }) => p,
  );
  const accountItem: FrameItem = {
    key: 'conta',
    to: '/conta',
    label: 'Conta',
    icon: <FrameAvatar name={me?.user.name} />,
    dot: unseen,
    profile: me ? { name: me.user.name, detail: me.user.roleLabel } : undefined,
    pages: accountPages,
  };
  // O tutorial acha Assinatura e Ajustes dentro da Conta (Conta › Ajustes).
  const tourItems = [...main, ...groups, accountItem];

  return (
    <>
      <AppFrame
        brand={<StoreBrand name={me?.tenant.name ?? 'Comandou'} />}
        brandCompact={<StoreBrand name={me?.tenant.name ?? 'Comandou'} compact />}
        items={[...main, ...groups]}
        footer={[
          {
            key: 'agenda',
            to: '/agenda',
            label: 'Agenda pessoal',
            icon: <CalendarDays />,
          },
          accountItem,
        ]}
        tabs={tabs}
        account={
          me
            ? {
                name: me.user.name,
                sub: me.user.email,
                initials,
                role: me.user.roleLabel,
                note: me.tenant.name,
                to: '/conta',
                // O resto da conta mora na tela Conta; aqui fica só o Sair, no fim da tela.
                actions: [
                  {
                    key: 'sair',
                    label: 'Sair',
                    icon: <LogOut />,
                    onClick: () => void logout(),
                    danger: true,
                  },
                ],
                footnote: `Comandou v${__APP_VERSION__}`,
              }
            : undefined
        }
        linksTitle="Operação"
        moreActionsTitle="Conversas"
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
            {/* Sinal da conexão (barrinhas): mede o tempo de resposta e o tempo real. */}
            <ConnectionSignal />
            {allowed(['printing:manage']) && <PrintStatus />}
            <GlobalSearchTrigger icon onOpen={() => setSearchOpen(true)} />
            <SupportButton className="topbar__support" />
            <ChatTopButtons />
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
            {/* Sem internet, o que for salvo fica no aparelho até a conexão voltar. */}
            <OfflineBanner />
          </>
        }
      >
        {/* A tela que ainda está chegando não apaga o menu nem o topo. */}
        <Suspense fallback={<PageLoading />}>
          {/* Erro numa tela fica nela: o menu continua e trocar de tela volta ao normal. */}
          <ErrorBoundary resetKey={location.pathname} fallback={ErrorFallback}>
            <Outlet context={accountTools} />
          </ErrorBoundary>
        </Suspense>
      </AppFrame>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      {install.modal}
      <SupportChatHost />
      {me && (
        <OnboardingChat
          open={onbOpen}
          onClose={closeOnboarding}
          onTour={() => {
            closeOnboarding();
            setTourOpen(true);
          }}
          userName={me.user.name}
          tenantName={me.tenant.name}
          canImport={me.permissions.includes('catalog:write')}
        />
      )}
      {me && (
        <WelcomeTour
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          tenantId={me.tenant.id}
          userId={me.user.id}
          userName={me.user.name}
          tenantName={me.tenant.name}
          items={tourItems}
          tabs={tabs}
        />
      )}
      {me && <PageTourHost items={tourItems} tabs={tabs} />}
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
