import { fromCents } from '@comandou/shared';
import { ChevronRight, Heart, House, ReceiptText, ShoppingBag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router';
import { applyTheme, Mascot, useGlider } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { AccountScreen, AddressesScreen, PasswordScreen, ProfileScreen } from './AccountScreens';
import { CartScreen } from './CartScreen';
import { StoreProvider, useStore } from './context';
import { FavoritesScreen, HomeScreen } from './HomeScreen';
import { OrdersScreen } from './OrdersScreen';
import { ProductScreen } from './ProductScreen';
import { PublicOrderPage } from './PublicOrderPage';
import type { PublicMenu } from './store';
import './public.css';
import './storefront.css';

/** Abas de baixo (no computador viram o menu do topo). */
function BottomNav() {
  const { menu, account } = useStore();
  const { pathname } = useLocation();
  // Produto e sacola têm a própria barra embaixo (adicionar / finalizar).
  const focused = /^\/pedir\/(produto|sacola)/.test(pathname);
  const name = account?.customer?.name.split(' ')[0];
  const tabs = [
    { to: '/pedir', label: 'Início', icon: House, end: true },
    { to: '/pedir/favoritos', label: 'Favoritos', icon: Heart },
    { to: '/pedir/pedidos', label: 'Pedidos', icon: ReceiptText },
    ...(menu.appearance.accountsEnabled
      ? [{ to: '/pedir/conta', label: name ?? 'Entrar', icon: UserRound }]
      : []),
  ];
  const glider = useGlider<HTMLElement>({ selector: '.tabbar__item.active' });
  return (
    <nav
      className="tabbar cm-glide"
      ref={glider.ref}
      data-focused={focused || undefined}
      aria-label="Navegação do cardápio"
    >
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="tabbar__item">
          <t.icon size={22} aria-hidden />
          <span>{t.label}</span>
        </NavLink>
      ))}
      {glider.glider}
    </nav>
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
      <span
        className="cartpill__icon"
        data-cart-target
        key={bump}
        data-bump={bump > 0 || undefined}
      >
        <ShoppingBag size={18} />
        <span className="cartpill__count">{count}</span>
      </span>
      <span className="cartpill__label">Ver sacola</span>
      <strong>{brl(fromCents(subtotal))}</strong>
      <ChevronRight size={18} aria-hidden />
    </button>
  );
}

/** Cada tela entra deslizando: para a frente ao abrir, para trás ao voltar. */
function Screens() {
  const location = useLocation();
  const nav = useNavigationType();
  useEffect(() => {
    if (nav !== 'POP') window.scrollTo({ top: 0 });
  }, [location.pathname, nav]);
  return (
    <div className="screen" key={location.pathname} data-dir={nav === 'POP' ? 'back' : 'fwd'}>
      <Routes location={location}>
        <Route index element={<HomeScreen />} />
        <Route path="produto/:id" element={<ProductScreen />} />
        <Route path="sacola" element={<CartScreen />} />
        <Route path="favoritos" element={<FavoritesScreen />} />
        <Route path="pedidos" element={<OrdersScreen />} />
        <Route path="pedidos/:id" element={<PublicOrderPage />} />
        <Route path="conta" element={<AccountScreen />} />
        <Route path="conta/dados" element={<ProfileScreen />} />
        <Route path="conta/enderecos" element={<AddressesScreen />} />
        <Route path="conta/senha" element={<PasswordScreen />} />
        <Route path="*" element={<HomeScreen />} />
      </Routes>
    </div>
  );
}

function Skeleton() {
  return (
    <main className="sf" aria-busy="true">
      <div className="sf-hero sf-hero--skeleton" />
      <div className="sf-wrap">
        <div className="sk sk--search" />
        <div className="sk-row">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="sk sk--chip" />
          ))}
        </div>
        <div className="sk sk--banner" />
        <div className="sk-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="sk sk--product" />
          ))}
        </div>
      </div>
    </main>
  );
}

/** Cardápio online do restaurante (/pedir/*): um app de pedidos para o cliente final. */
export function StoreApp() {
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PublicMenu>('/store')
      .then((m) => {
        setMenu(m);
        document.title = `${m.restaurant.name} · Cardápio`;
      })
      .catch((e: ApiError) =>
        setError(
          e.status === 404
            ? 'Este restaurante não está recebendo pedidos online.'
            : 'Não foi possível carregar o cardápio. Tente de novo em instantes.',
        ),
      );
  }, []);

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
        <Mascot size={72} mood="sleep" />
        <p>{error}</p>
      </main>
    );
  if (!menu) return <Skeleton />;
  return (
    <StoreProvider menu={menu}>
      <main className="sf">
        <Screens />
        <CartPill />
        <BottomNav />
      </main>
    </StoreProvider>
  );
}
