import { fromCents, storeScreenAllowed } from '@comandou/shared';
import {
  BellRing,
  ChevronRight,
  HandPlatter,
  Heart,
  House,
  MessageCircle,
  ReceiptText,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import {
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router';
import { applyTheme, StoreMark, setPullRefreshHandler, Skeleton } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { lazyPage, preloadPages } from '../../lib/lazy-page';
import { brl } from '../../lib/money';
import { checkCacheEpoch } from '../../lib/tenant-cache';
import { MenuSkeleton } from '../../app/MenuSkeleton';
import { cachedMenu, forgetMenus, rememberStoreTheme, saveMenu } from '../../lib/menu-boot';
import { CustomerAvatar } from './avatars';
import { StoreChatProvider, useStoreChat } from './chat';
import { StoreProvider, useStore } from './context';
import { FavoritesScreen, HomeScreen } from './HomeScreen';
import { LoyaltyScreen } from './LoyaltyScreens';
import { ProductScreen } from './ProductScreen';
import { MyReservationsScreen, ReservationStatusScreen, ReserveScreen } from './ReservationScreens';
import { InstallHint, useHomeScreenMeta } from './InstallHint';
import { TableHere } from './TableHere';
import { TableBillScreen, TableServiceScreen } from './TableServiceScreen';
import {
  isTableId,
  rememberTable,
  storedTableId,
  type PublicMenu,
  type StoreStatus,
} from './store';
import { MagicNav, type MagicTab } from './MagicNav';
import { startPixel } from './pixel';
import { useLayout } from './sections';
import { CartPanel, OrderBar, SideBar, StoreStatusLine } from './Shell';
import { Photo } from './ui';
import './public.css';
import './storefront.css';
// Depois do storefront.css: a moldura do tablet e do notebook ajusta as peças comuns.
import './shell.css';

/*
 * Quem abre o cardápio baixa só o início e o produto. Sacola, pedidos, conversa e conta vêm em
 * arquivos à parte, baixados em segundo plano logo depois que o cardápio aparece (ao tocar, já
 * estão prontos).
 */
const CartScreen = lazyPage(
  () => import('./CartScreen'),
  (m) => m.CartScreen,
);
const OrdersScreen = lazyPage(
  () => import('./OrdersScreen'),
  (m) => m.OrdersScreen,
);
const PublicOrderPage = lazyPage(
  () => import('./PublicOrderPage'),
  (m) => m.PublicOrderPage,
);
const ChatScreen = lazyPage(
  () => import('./ChatScreen'),
  (m) => m.ChatScreen,
);
const AccountScreen = lazyPage(
  () => import('./AccountScreens'),
  (m) => m.AccountScreen,
);
const ProfileScreen = lazyPage(
  () => import('./AccountScreens'),
  (m) => m.ProfileScreen,
);
const AddressesScreen = lazyPage(
  () => import('./AccountScreens'),
  (m) => m.AddressesScreen,
);
const PasswordScreen = lazyPage(
  () => import('./AccountScreens'),
  (m) => m.PasswordScreen,
);
const ForgotPasswordScreen = lazyPage(
  () => import('./AccountScreens'),
  (m) => m.ForgotPasswordScreen,
);
const LATER_SCREENS = [
  CartScreen,
  OrdersScreen,
  AccountScreen,
  ProfileScreen,
  AddressesScreen,
  PasswordScreen,
  ForgotPasswordScreen,
  PublicOrderPage,
  ChatScreen,
];

/** Abas do cardápio: embaixo no celular, no topo no tablet e no menu lateral no notebook. */
function useNavTabs(): MagicTab[] {
  const { account, rules } = useStore();
  const chat = useStoreChat();
  const me = account?.customer ?? null;
  const name = me?.name.split(' ')[0];
  // Com a conta aberta, a aba "Conta" mostra a foto ou o avatar no lugar do ícone.
  const meIcon = useMemo(
    () =>
      me
        ? (forwardRef<HTMLSpanElement, { size?: number }>(function MeIcon({ size = 20 }, _ref) {
            return (
              <CustomerAvatar
                customer={me}
                size={Number(size) + 4}
                className="sf-tab-avatar"
                decorative
              />
            );
          }) as unknown as LucideIcon)
        : UserRound,
    [me],
  );
  // Cada cardápio só mostra as abas que as regras dele deixam (store-rules.ts): na mesa, o
  // cardápio, a aba do meio (chamar o garçom e fechar a conta) e os pedidos da mesa.
  const atTable = rules.mode === 'table';
  return [
    { to: '/pedir', label: 'Cardápio', icon: House, end: true, badge: 0 },
    ...(rules.tableService
      ? [{ to: '/pedir/mesa', label: 'Garçom', icon: BellRing, badge: 0 }]
      : []),
    ...(rules.favorites
      ? [{ to: '/pedir/favoritos', label: 'Favoritos', icon: Heart, badge: 0 }]
      : []),
    {
      to: '/pedir/pedidos',
      label: atTable ? 'Minha mesa' : 'Pedidos',
      icon: atTable ? HandPlatter : ReceiptText,
      badge: 0,
    },
    ...(chat.enabled
      ? [{ to: '/pedir/conversa', label: 'Conversa', icon: MessageCircle, badge: chat.unread }]
      : []),
    ...(rules.accountTab
      ? [{ to: '/pedir/conta', label: name ?? 'Entrar', icon: meIcon, badge: 0 }]
      : []),
  ];
}

/** Bolinha com o número de respostas da loja ainda não lidas. */
function Dot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <b className="sf-dot" aria-label={`${n} mensagem(ns) nova(s)`}>
      {n > 9 ? '9+' : n}
    </b>
  );
}
const dot = (n: number) => <Dot n={n} />;

/** Abas de baixo (celular): a aba aberta sobe numa bolinha encaixada na barra. */
function BottomNav() {
  const { pathname } = useLocation();
  // Produto e sacola têm a própria barra embaixo (adicionar / finalizar).
  const focused = /^\/pedir\/(produto|sacola|reservar|conversa)/.test(pathname);
  return <MagicNav tabs={useNavTabs()} hidden={focused} label="Navegação do cardápio" dot={dot} />;
}

/**
 * Barra do topo no tablet (como no totem): loja à esquerda, abas e sacola à direita. Fica presa
 * no topo e não cobre a capa nem o conteúdo.
 */
function TopBar() {
  const { menu, count, subtotal, bump } = useStore();
  const tabs = useNavTabs();
  const r = menu.restaurant;
  return (
    <header className="sf-appbar">
      <div className="sf-appbar__inner">
        <Link to="/pedir" className="sf-appbar__brand">
          <Photo src={r.logoUrl} alt={r.name} className="sf-appbar__logo" eager />
          <span>
            <strong>{r.name}</strong>
            <StoreStatusLine withTable />
          </span>
        </Link>
        <nav className="sf-appbar__nav" aria-label="Menu do cardápio">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className="sf-appbar__link">
              <t.icon size={18} aria-hidden />
              <span>{t.label}</span>
              <Dot n={t.badge} />
            </NavLink>
          ))}
        </nav>
        <Link to="/pedir/sacola" className="sf-appbar__cart" data-empty={count === 0 || undefined}>
          {/* Chaves diferentes entre irmãos: com a mesma chave o React deixava cópias da
              sacola na tela a cada item adicionado. */}
          <span
            className="sf-appbar__bag"
            data-cart-target
            key={`bag-${bump}`}
            data-bump={bump > 0 || undefined}
          >
            <ShoppingBag size={18} />
            {count > 0 && <span className="cartpill__count">{count}</span>}
          </span>
          <span key={`sum-${bump}`} className={bump > 0 && count > 0 ? 'sf-tick' : undefined}>
            {count > 0 ? brl(fromCents(subtotal)) : 'Sacola'}
          </span>
        </Link>
      </div>
    </header>
  );
}

/** Pílula da sacola, flutuando acima das abas. Pula a cada item adicionado. */
function CartPill() {
  const { count, subtotal, bump } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Só nas telas de navegar pelo cardápio (início, favoritos e lista de pedidos).
  const hidden = count === 0 || !/^\/pedir(\/favoritos|\/pedidos)?\/?$/.test(pathname);
  return (
    <button
      type="button"
      className="cartpill"
      data-hidden={hidden || undefined}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
      onClick={() => navigate('/pedir/sacola')}
    >
      {/* Ícone e total com chaves diferentes: com a mesma chave (irmãos) o React deixava a
          sacola antiga na tela e a barra mostrava "1 2 2" com dois itens. */}
      <span
        className="cartpill__icon"
        data-cart-target
        key={`bag-${bump}`}
        data-bump={bump > 0 || undefined}
      >
        <ShoppingBag size={18} />
        <span className="cartpill__count">{count}</span>
      </span>
      <span className="cartpill__label">Ver sacola</span>
      {/* O total dá um pulinho junto com a sacola quando o item chega. */}
      <strong key={`sum-${bump}`} className={bump > 0 ? 'sf-tick' : undefined}>
        {brl(fromCents(subtotal))}
      </strong>
      <ChevronRight size={18} aria-hidden />
    </button>
  );
}

/** Tela que o cardápio aberto não tem (ex.: conversa na mesa): volta para o início. */
function Allowed({ screen, el }: { screen: string; el: ReactElement }) {
  const { rules } = useStore();
  return storeScreenAllowed(rules, screen) ? el : <Navigate to="/pedir" replace />;
}

/** Tela que ainda não chegou (só se o cliente tocar antes de ela baixar). */
function ScreenLoading() {
  return (
    <div className="sf-wrap sf-page">
      <Skeleton />
    </div>
  );
}

/**
 * Telas do cardápio entram paradas, sem esmaecer nem deslizar: no iPhone a animação de entrada
 * voltava a rodar sozinha e a tela (o pedido, principalmente) ficava piscando mais clara e mais
 * escura (pedido do David). Abrir é trocar na hora.
 */
function Screens() {
  const location = useLocation();
  const nav = useNavigationType();
  useEffect(() => {
    if (nav !== 'POP') window.scrollTo({ top: 0 });
  }, [location.pathname, nav]);
  return (
    <div className="screen" key={location.pathname}>
      <Suspense fallback={<ScreenLoading />}>
        <Routes location={location}>
          <Route index element={<HomeScreen />} />
          <Route path="produto/:id" element={<ProductScreen />} />
          <Route path="sacola" element={<CartScreen />} />
          <Route
            path="favoritos"
            element={<Allowed screen="favoritos" el={<FavoritesScreen />} />}
          />
          <Route path="pedidos" element={<OrdersScreen />} />
          <Route path="mesa" element={<Allowed screen="mesa" el={<TableServiceScreen />} />} />
          <Route
            path="mesa/conta"
            element={<Allowed screen="mesa/conta" el={<TableBillScreen />} />}
          />
          <Route path="pedidos/:id" element={<PublicOrderPage />} />
          <Route path="reservar" element={<Allowed screen="reservar" el={<ReserveScreen />} />} />
          <Route path="reserva/:token" element={<ReservationStatusScreen />} />
          <Route
            path="reservas"
            element={<Allowed screen="reservas" el={<MyReservationsScreen />} />}
          />
          <Route
            path="reservas/:id"
            element={<Allowed screen="reservas" el={<ReservationStatusScreen />} />}
          />
          <Route path="conversa" element={<Allowed screen="conversa" el={<ChatScreen />} />} />
          <Route path="conta" element={<AccountScreen />} />
          <Route path="conta/dados" element={<ProfileScreen />} />
          <Route path="conta/enderecos" element={<AddressesScreen />} />
          <Route path="conta/senha" element={<PasswordScreen />} />
          <Route path="conta/esqueci-senha" element={<ForgotPasswordScreen />} />
          <Route
            path="fidelidade"
            element={<Allowed screen="fidelidade" el={<LoyaltyScreen />} />}
          />
          <Route path="*" element={<HomeScreen />} />
        </Routes>
      </Suspense>
    </div>
  );
}

/**
 * Moldura do cardápio conforme a tela: abas embaixo no celular, barra no topo e barra do pedido
 * no tablet, menu lateral e sacola ao lado no notebook.
 */
function Chrome() {
  const layout = useLayout();
  const { pathname } = useLocation();
  const tabs = useNavTabs();
  const { menu, table, here, rules } = useStore();
  // Mesa do QR Code que confere a localização: antes de pedir, o cliente confirma que está aqui.
  const confirmHere = !!table?.confirmLocation && !here;
  // Cardápio na tela: as outras telas baixam quando o navegador fica livre.
  useEffect(() => preloadPages(LATER_SCREENS), []);
  useHomeScreenMeta(menu.restaurant.name);
  // Aviso de instalar o app: só nas telas de olhar o cardápio (não no meio da sacola).
  const installSpot = /^\/pedir(\/favoritos|\/pedidos)?\/?$/.test(pathname);
  // Telas de escolher produto (início e favoritos): no notebook largo a sacola fica ao lado.
  const browse = /^\/pedir(\/favoritos)?\/?$/.test(pathname);
  return (
    <main
      className="sf"
      data-layout={layout}
      data-mode={rules.mode}
      data-browse={browse || undefined}
    >
      {layout === 'desktop' && <SideBar tabs={tabs} dot={dot} />}
      <div className="sf-main">
        {layout === 'tablet' && <TopBar />}
        <Screens />
      </div>
      {layout === 'desktop' && browse && <CartPanel />}
      {layout === 'tablet' && <OrderBar />}
      {layout === 'phone' && (
        <>
          <CartPill />
          <BottomNav />
        </>
      )}
      {installSpot && !confirmHere && rules.installHint && (
        <InstallHint name={menu.restaurant.name} logoUrl={menu.restaurant.logoUrl} />
      )}
      {confirmHere && <TableHere />}
    </main>
  );
}

/**
 * Mesa do QR Code: chega como /pedir?mesa=<id> (o QR /mesa/<id> manda o cliente para cá), fica
 * lembrada nesta aba e sai do endereço (quem compartilhar o link não manda a mesa junto).
 */
function useTableId() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromQr = new URLSearchParams(location.search).get('mesa');
  const [id, setId] = useState<string | null>(() => {
    if (isTableId(fromQr)) rememberTable(fromQr);
    return isTableId(fromQr) ? fromQr : storedTableId();
  });
  useEffect(() => {
    if (fromQr === null) return;
    if (isTableId(fromQr)) {
      rememberTable(fromQr);
      setId(fromQr);
    }
    const rest = new URLSearchParams(location.search);
    rest.delete('mesa');
    const q = rest.toString();
    navigate({ pathname: location.pathname, search: q ? `?${q}` : '' }, { replace: true });
  }, [fromQr]);
  const leave = useCallback(() => {
    rememberTable(null);
    setId(null);
  }, []);
  // "Estou no restaurante" (cardápio online): leu o QR Code da mesa pela câmera do app.
  const enter = useCallback((tableId: string) => {
    rememberTable(tableId);
    setId(tableId);
  }, []);
  return [id, leave, enter] as const;
}

/** Cardápio online do restaurante (/pedir/*): um app de pedidos para o cliente final. */
export function StoreApp() {
  const [tableId, leaveTable, enterTable] = useTableId();
  const menuPath = tableId ? `/store?mesa=${encodeURIComponent(tableId)}` : '/store';
  // Recarregou a página: o último cardápio guardado aparece na hora, sem esqueleto; o do servidor
  // chega em seguida e toma o lugar (preços e loja aberta/fechada sempre do servidor).
  const [menu, setMenu] = useState<PublicMenu | null>(() => cachedMenu<PublicMenu>(menuPath));
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(!!menu);
  shown.current = !!menu;
  // Página do cardápio: o navegador do celular devolve o elástico e o "puxar para atualizar"
  // (storefront.css), que o sistema da equipe desliga.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('sf-root');
    return () => root.classList.remove('sf-root');
  }, []);

  const loadMenu = useCallback(
    () =>
      api<PublicMenu>(menuPath).then((m) => {
        // Mesa que não existe mais (QR antigo): segue no cardápio de entrega e retirada.
        if (tableId && !m.table) rememberTable(null);
        setMenu(m);
        saveMenu(menuPath, m);
        rememberStoreTheme(m.appearance.theme);
      }),
    [menuPath, tableId],
  );
  useEffect(() => {
    loadMenu().catch((e: ApiError) => {
      const closed = e.status === 404 || e.status === 403;
      if (closed) forgetMenus();
      // Sem internet com o cardápio guardado na tela: segue com ele.
      else if (shown.current) return;
      setMenu(null);
      setError(
        closed
          ? tableId
            ? 'Este restaurante não recebe pedidos pelo celular. Chame o garçom para pedir.'
            : 'Este restaurante não está recebendo pedidos online.'
          : 'Não foi possível carregar o cardápio. Tente de novo em instantes.',
      );
    });
  }, [loadMenu]);
  const storeName = menu?.restaurant.name;
  useEffect(() => {
    if (storeName) document.title = `${storeName} · Cardápio`;
  }, [storeName]);
  // Recarregar com o cardápio já na tela: se falhar, segue com o que já tem.
  const refreshMenu = useCallback(() => loadMenu().catch(() => undefined), [loadMenu]);

  // A loja pode abrir ou fechar com o cardápio aberto: confere de tempos em tempos e ao voltar
  // para a aba, para o cliente não montar um pedido que não vai entrar.
  const loaded = !!menu;
  const refreshStatus = useCallback(async () => {
    const st = await api<StoreStatus & { cacheEpoch?: string | null }>('/store/status').catch(
      () => null,
    );
    if (!st || checkCacheEpoch(st.cacheEpoch)) return;
    setMenu((m) =>
      !m ||
      (m.store.isOpen === st.isOpen &&
        m.store.acceptsDelivery === st.acceptsDelivery &&
        m.store.acceptsPickup === st.acceptsPickup)
        ? m
        : { ...m, store: { ...m.store, ...st } },
    );
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const tick = () => document.visibilityState === 'visible' && void refreshStatus();
    const id = window.setInterval(tick, 45_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [loaded, refreshStatus]);

  // Puxar para recarregar no app instalado: busca o cardápio e a situação da loja de novo, sem
  // recarregar a página (a tela não pisca e o que está na sacola fica).
  useEffect(() => {
    if (!loaded) return;
    return setPullRefreshHandler(() => Promise.all([refreshMenu(), refreshStatus()]));
  }, [loaded, refreshMenu, refreshStatus]);

  // Pixel do cardápio: conta a visita quando o cardápio aparece (na mesa, marcada como mesa).
  const atTable = !!menu?.table;
  useEffect(() => {
    if (loaded) startPixel({ table: atTable });
  }, [loaded, atTable]);

  // Tema escolhido pelo restaurante (claro/escuro); "automático" segue o aparelho do cliente.
  useEffect(() => {
    const t = menu?.appearance.theme;
    if (t !== 'light' && t !== 'dark') return;
    applyTheme(t);
    return () => applyTheme();
  }, [menu?.appearance.theme]);

  if (error)
    return (
      <main className="sf sf--center">
        <StoreMark size={72} mood="sleep" />
        <p>{error}</p>
      </main>
    );
  if (!menu) return <MenuSkeleton />;
  return (
    <StoreProvider
      menu={menu}
      refreshStatus={refreshStatus}
      refreshMenu={refreshMenu}
      leaveTable={leaveTable}
      enterTable={enterTable}
    >
      <StoreChatProvider>
        <Chrome />
      </StoreChatProvider>
    </StoreProvider>
  );
}
