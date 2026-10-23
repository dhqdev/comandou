import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { reducedMotion } from './morph';
import {
  AccountState,
  CartLine,
  CustomerInfo,
  EMPTY_CUSTOMER,
  lineTotal,
  PublicMenu,
  PublicProduct,
  useStored,
} from './store';

export interface StoreCtx {
  menu: PublicMenu;
  product(id: string): (PublicProduct & { categoryId: string }) | undefined;
  cart: CartLine[];
  setCart(fn: (c: CartLine[]) => CartLine[]): void;
  addToCart(line: CartLine, from?: HTMLElement | null): void;
  count: number;
  subtotal: number;
  /** Muda a cada item adicionado (anima o botão da sacola). */
  bump: number;
  favs: string[];
  toggleFav(id: string): void;
  /** null enquanto carrega. */
  account: AccountState | null;
  setAccount(a: AccountState): void;
  logout(): Promise<void>;
  customer: CustomerInfo;
  setCustomer(fn: (c: CustomerInfo) => CustomerInfo): void;
}

const Ctx = createContext<StoreCtx | null>(null);
export const useStore = () => useContext(Ctx)!;

/**
 * A foto "voa" até o botão da sacola (efeito de adicionar). A cópia da foto é tirada na hora;
 * o destino é medido um instante depois, porque a sacola pode estar entrando na tela.
 */
function flyToCart(from: HTMLElement) {
  if (reducedMotion() || !from.animate) return;
  const a = from.getBoundingClientRect();
  const ghost = from.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: '0',
    zIndex: '90',
    pointerEvents: 'none',
    borderRadius: '16px',
    overflow: 'hidden',
    transformOrigin: 'center',
  });
  document.body.appendChild(ghost);
  window.setTimeout(() => {
    const target = [...document.querySelectorAll<HTMLElement>('[data-cart-target]')].find(
      (el) => el.offsetParent !== null,
    );
    if (!target) return ghost.remove();
    const b = target.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost
      .animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          {
            transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 90}px) scale(0.55)`,
            opacity: 0.95,
            offset: 0.5,
          },
          { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0.3 },
        ],
        { duration: 640, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' },
      )
      .finished.finally(() => ghost.remove());
  }, 90);
}

export function StoreProvider({ menu, children }: { menu: PublicMenu; children: ReactNode }) {
  const [cart, setCart] = useStored<CartLine[]>('cm-cart', []);
  const [customer, setCustomer] = useStored<CustomerInfo>('cm-customer', EMPTY_CUSTOMER);
  const [favs, setFavs] = useStored<string[]>('cm-favs', []);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [bump, setBump] = useState(0);

  const index = useMemo(() => {
    const m = new Map<string, PublicProduct & { categoryId: string }>();
    for (const c of menu.categories)
      for (const p of c.products) m.set(p.id, { ...p, categoryId: c.id });
    return m;
  }, [menu]);

  // Tira da sacola e dos favoritos o que saiu do cardápio.
  useEffect(() => {
    setCart((c) => c.filter((l) => index.has(l.productId)));
    setFavs((f) => f.filter((id) => index.has(id)));
  }, [index, setCart, setFavs]);

  useEffect(() => {
    if (!menu.appearance.accountsEnabled) return setAccount({ customer: null, addresses: [] });
    api<AccountState>('/store/account')
      .then(setAccount)
      .catch(() => setAccount({ customer: null, addresses: [] }));
  }, [menu.appearance.accountsEnabled]);

  const addToCart = useCallback(
    (line: CartLine, from?: HTMLElement | null) => {
      setCart((c) => {
        const same = c.find((x) => x.key === line.key);
        return same
          ? c.map((x) =>
              x === same ? { ...x, quantity: Math.min(50, x.quantity + line.quantity) } : x,
            )
          : [...c, line];
      });
      if (from) flyToCart(from);
      navigator.vibrate?.(12);
      window.setTimeout(() => setBump((n) => n + 1), from ? 700 : 0);
    },
    [setCart],
  );

  const value: StoreCtx = {
    menu,
    product: (id) => index.get(id),
    cart,
    setCart,
    addToCart,
    count: cart.reduce((n, l) => n + l.quantity, 0),
    subtotal: cart.reduce((n, l) => n + lineTotal(l), 0),
    bump,
    favs,
    toggleFav: (id) => {
      navigator.vibrate?.(8);
      setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
    },
    account,
    setAccount,
    logout: async () => {
      await api('/store/account/logout', { method: 'POST' }).catch(() => undefined);
      setAccount({ customer: null, addresses: [] });
    },
    customer,
    setCustomer,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
