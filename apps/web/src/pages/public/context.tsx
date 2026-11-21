import { kgToGrams, ONLINE_WEIGHT_MAX_G, storeRules, type StoreRules } from '@comandou/shared';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../../lib/api';
import { reducedMotion } from './morph';
import { track } from './pixel';
import {
  AccountState,
  CartLine,
  CustomerInfo,
  EMPTY_CUSTOMER,
  lineCount,
  lineTotal,
  mergeCarts,
  PublicLoyalty,
  PublicMenu,
  PublicProduct,
  PublicTable,
  rememberPresence,
  storedPresence,
  syncCart,
  type TablePresence,
  useStored,
} from './store';

export interface StoreCtx {
  menu: PublicMenu;
  /** O que este cardápio mostra (mesa: só pedir e acompanhar; online: tudo o que a loja ligou). */
  rules: StoreRules;
  /** Mesa do QR Code: o pedido vai para a comanda dela (null fora da mesa). */
  table: PublicTable | null;
  /** "Não estou nesta mesa": volta para entrega e retirada. */
  leaveTable(): void;
  /**
   * Mesa que confere a localização: onde o celular estava quando o cliente confirmou que está no
   * restaurante (vai junto com o pedido). null = ainda não confirmou (a confirmação aparece).
   */
  here: TablePresence | null;
  setHere(p: TablePresence | null): void;
  product(id: string): (PublicProduct & { categoryId: string }) | undefined;
  cart: CartLine[];
  setCart(fn: (c: CartLine[]) => CartLine[]): void;
  /** `leaving`: a tela que adicionou está fechando (a foto voa depois de voltar ao cardápio). */
  addToCart(line: CartLine, from?: HTMLElement | null, leaving?: boolean): void;
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
  /** Confere de novo se a loja está aberta (ex.: o pedido voltou com "loja fechada"). */
  refreshStatus(): Promise<void>;
  /** Busca o cardápio de novo (ex.: o pedido voltou com "produto esgotado"). */
  refreshMenu(): Promise<void>;
  /** Programa de fidelidade (null enquanto carrega). Com a conta aberta, traz o saldo. */
  loyalty: PublicLoyalty | null;
  refreshLoyalty(): Promise<void>;
}

const Ctx = createContext<StoreCtx | null>(null);
export const useStore = () => useContext(Ctx)!;

/**
 * Botão da sacola que está à vista agora. Cada moldura tem o seu (barra do topo no tablet, menu
 * lateral ou sacola ao lado no notebook, pílula no celular); os escondidos (`data-hidden`,
 * `display: none`, fora da tela) não contam.
 */
export function visibleCartTarget(doc: Document = document): HTMLElement | null {
  const all = [...doc.querySelectorAll<HTMLElement>('[data-cart-target]')].filter(
    (el) => el.offsetParent !== null && !el.closest('[data-hidden], [aria-hidden="true"]'),
  );
  const vw = doc.documentElement.clientWidth || window.innerWidth;
  const vh = doc.documentElement.clientHeight || window.innerHeight;
  const onScreen = all.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  });
  return onScreen ?? all[0] ?? null;
}

/**
 * A foto "voa" até o botão da sacola (efeito de adicionar). A cópia da foto é tirada na hora;
 * o destino é medido depois. Saindo da tela do item (`leaving`), espera a volta ao cardápio,
 * porque lá a sacola pode estar em outro lugar (no notebook largo ela fica no alto, à direita).
 */
function flyToCart(from: HTMLElement, leaving = false) {
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
  const fly = () => {
    const target = visibleCartTarget();
    if (!target) return ghost.remove();
    const b = target.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    // O arco sobe um pouco antes de descer; indo para cima, só segue a curva.
    const lift = dy < 0 ? 0 : 90;
    ghost
      .animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          {
            transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(0.55)`,
            opacity: 0.95,
            offset: 0.5,
          },
          { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0.3 },
        ],
        { duration: leaving ? 380 : 300, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' },
      )
      .finished.finally(() => ghost.remove());
  };
  if (!leaving) return void window.setTimeout(fly, 40);
  // Espera o endereço mudar (a tela do item some em ~160 ms) e o cardápio desenhar.
  const path = window.location.pathname;
  const t0 = performance.now();
  const wait = () => {
    if (window.location.pathname !== path)
      return void requestAnimationFrame(() => requestAnimationFrame(fly));
    if (performance.now() - t0 > 600) return fly();
    requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}

export function StoreProvider({
  menu,
  refreshStatus,
  refreshMenu,
  leaveTable,
  children,
}: {
  menu: PublicMenu;
  refreshStatus(): Promise<void>;
  refreshMenu(): Promise<void>;
  leaveTable(): void;
  children: ReactNode;
}) {
  const [cart, setCart] = useStored<CartLine[]>('cm-cart', []);
  const [stored, setCustomer] = useStored<CustomerInfo>('cm-customer', EMPTY_CUSTOMER);
  // Dados salvos por versões antigas não têm os campos novos (CEP, cidade…).
  const customer = useMemo(() => ({ ...EMPTY_CUSTOMER, ...stored }), [stored]);
  const [favs, setFavs] = useStored<string[]>('cm-favs', []);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [bump, setBump] = useState(0);
  const tableId = menu.table?.id ?? null;
  const [here, setHereState] = useState<TablePresence | null>(() =>
    tableId ? storedPresence(tableId) : null,
  );
  useEffect(() => setHereState(tableId ? storedPresence(tableId) : null), [tableId]);
  const setHere = useCallback(
    (p: TablePresence | null) => {
      if (tableId) rememberPresence(tableId, p);
      setHereState(p);
    },
    [tableId],
  );
  const [loyalty, setLoyalty] = useState<PublicLoyalty | null>(null);
  const rules = useMemo(
    () => storeRules(tableId ? 'table' : 'online', menu.appearance),
    [tableId, menu.appearance],
  );

  const index = useMemo(() => {
    const m = new Map<string, PublicProduct & { categoryId: string }>();
    for (const c of menu.categories)
      for (const p of c.products) m.set(p.id, { ...p, categoryId: c.id });
    return m;
  }, [menu]);

  // Acerta a sacola (preço, foto, itens que saíram) e os favoritos com o cardápio atual.
  useEffect(() => {
    setCart((c) => syncCart(c, (id) => index.get(id)));
    setFavs((f) => f.filter((id) => index.has(id)));
  }, [index, setCart, setFavs]);

  useEffect(() => {
    if (!menu.appearance.accountsEnabled) return setAccount({ customer: null, addresses: [] });
    api<AccountState>('/store/account')
      .then(setAccount)
      .catch(() => setAccount({ customer: null, addresses: [] }));
  }, [menu.appearance.accountsEnabled]);

  // Sacola na conta: ao entrar, a sacola deste aparelho se junta com a que estava guardada na
  // conta (de outro aparelho ou navegador) e, daí em diante, cada mudança é salva nela.
  const customerId = account?.customer?.id;
  const indexRef = useRef(index);
  indexRef.current = index;
  // Última sacola que este aparelho sabe estar igual à da conta (de quem e de quando).
  const [cartSync, setCartSync] = useStored<{ customerId: string; at: string } | null>(
    'cm-cart-sync',
    null,
  );
  const cartSyncRef = useRef(cartSync);
  cartSyncRef.current = cartSync;
  // Conta cuja sacola já foi juntada: só então as mudanças vão para a conta.
  const [cartReadyFor, setCartReadyFor] = useState<string | null>(null);
  const pushed = useRef<string | null>(null);

  useEffect(() => {
    setCartReadyFor(null);
    pushed.current = null;
    if (!customerId) return;
    let off = false;
    api<{ lines: unknown[]; updatedAt: string | null }>('/store/account/cart')
      .then((saved) => {
        if (off) return;
        const sync = cartSyncRef.current;
        const mine = sync?.customerId === customerId;
        // A conta mudou depois da última vez que este aparelho salvou (outro aparelho mexeu ou
        // o pedido saiu): vale a da conta. Senão, junta com a do aparelho (nada se perde).
        const newer = mine && !!saved.updatedAt && new Date(saved.updatedAt) > new Date(sync.at);
        if (newer) pushed.current = JSON.stringify(saved.lines);
        setCart((local) =>
          syncCart(newer ? mergeCarts([], saved.lines) : mergeCarts(local, saved.lines), (id) =>
            indexRef.current.get(id),
          ),
        );
        setCartReadyFor(customerId);
      })
      // Sem rede: segue com a sacola do aparelho e não sobrescreve a da conta sem ter juntado.
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [customerId, setCart]);

  useEffect(() => {
    if (!customerId || cartReadyFor !== customerId) return;
    const body = JSON.stringify(cart);
    if (body === pushed.current) return;
    const id = window.setTimeout(() => {
      api<{ updatedAt: string | null }>('/store/account/cart', {
        method: 'PUT',
        json: { lines: cart },
      })
        .then((r) => {
          pushed.current = body;
          if (r.updatedAt) setCartSync({ customerId, at: r.updatedAt });
        })
        .catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(id);
  }, [cart, customerId, cartReadyFor, setCartSync]);

  // Fidelidade: recarrega ao entrar ou sair da conta (o saldo é de quem está logado).
  const refreshLoyalty = useCallback(
    () =>
      api<PublicLoyalty>('/store/loyalty')
        .then(setLoyalty)
        .catch(() => setLoyalty((l) => l ?? { enabled: false })),
    [],
  );
  useEffect(() => {
    if (account && rules.loyalty) void refreshLoyalty();
  }, [account === null, customerId, refreshLoyalty, rules.loyalty]);

  const addToCart = useCallback(
    (line: CartLine, from?: HTMLElement | null, leaving?: boolean) => {
      setCart((c) => {
        const same = c.find((x) => x.key === line.key);
        return same
          ? c.map((x) =>
              x === same
                ? {
                    ...x,
                    quantity: x.weight
                      ? Math.min(ONLINE_WEIGHT_MAX_G, kgToGrams(x.quantity + line.quantity)) / 1000
                      : Math.min(50, x.quantity + line.quantity),
                  }
                : x,
            )
          : [...c, line];
      });
      if (from) flyToCart(from, leaving);
      track('add_to_cart', {
        productId: line.productId,
        quantity: line.quantity,
        value: lineTotal(line) / 100,
      });
      navigator.vibrate?.(12);
      window.setTimeout(() => setBump((n) => n + 1), from ? 700 : 0);
    },
    [setCart],
  );

  const value: StoreCtx = {
    menu,
    rules,
    table: menu.table ?? null,
    leaveTable,
    here,
    setHere,
    product: (id) => index.get(id),
    cart,
    setCart,
    addToCart,
    count: cart.reduce((n, l) => n + lineCount(l), 0),
    subtotal: cart.reduce((n, l) => n + lineTotal(l), 0),
    bump,
    favs,
    toggleFav: (id) => {
      navigator.vibrate?.(8);
      if (!favs.includes(id)) track('favorite', { productId: id });
      setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
    },
    account,
    setAccount,
    logout: async () => {
      await api('/store/account/logout', { method: 'POST' }).catch(() => undefined);
      // A sacola fica guardada na conta; o aparelho volta vazio para o próximo cliente.
      setCart(() => []);
      setCartSync(null);
      setAccount({ customer: null, addresses: [] });
    },
    customer,
    setCustomer,
    refreshStatus,
    refreshMenu,
    loyalty,
    refreshLoyalty,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
