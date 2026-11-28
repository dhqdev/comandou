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
import { flyToCart } from './fly-to-cart';
import { track } from './pixel';
import {
  AccountState,
  CartLine,
  COUPON_KEY,
  CustomerInfo,
  EMPTY_CUSTOMER,
  isLine,
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
  /** "Estou no restaurante": o cliente leu o QR Code da mesa e passa a pedir para ela. */
  enterTable(tableId: string): void;
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
  /** Código do cupom escolhido para o próximo pedido (aba Cupons ou sacola). */
  coupon: string | null;
  setCoupon(code: string | null): void;
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

export function StoreProvider({
  menu,
  refreshStatus,
  refreshMenu,
  leaveTable,
  enterTable,
  children,
}: {
  menu: PublicMenu;
  refreshStatus(): Promise<void>;
  refreshMenu(): Promise<void>;
  leaveTable(): void;
  enterTable(tableId: string): void;
  children: ReactNode;
}) {
  const [rawCart, setCart] = useStored<CartLine[]>('cm-cart', []);
  // Linha guardada por uma versão antiga (sem `optionIds`…) quebraria as contas da sacola.
  const cart = useMemo<CartLine[]>(() => {
    const lines: unknown[] = rawCart;
    return lines.every((l) => isLine(l)) ? rawCart : lines.filter(isLine);
  }, [rawCart]);
  const [stored, setCustomer] = useStored<CustomerInfo>('cm-customer', EMPTY_CUSTOMER);
  // Dados salvos por versões antigas não têm os campos novos (CEP, cidade…).
  const customer = useMemo(() => ({ ...EMPTY_CUSTOMER, ...stored }), [stored]);
  const [favs, setFavs] = useStored<string[]>('cm-favs', []);
  // Cupom escolhido na aba Cupons: fica guardado até o pedido sair (ou o cliente tirar).
  const [coupon, setCouponState] = useStored<string | null>(COUPON_KEY, null);
  const setCoupon = useCallback(
    (code: string | null) => setCouponState(code?.trim() ? code.trim().toUpperCase() : null),
    [setCouponState],
  );
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
    // Link do WhatsApp da loja (?entrar=...): entra na conta e já mostra a sacola montada na
    // conversa. O link é de uso único; tira do endereço para não ficar no histórico.
    const params = new URLSearchParams(window.location.search);
    const link = params.get('entrar');
    if (link !== null) {
      params.delete('entrar');
      const rest = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
      );
    }
    const load =
      link && /^[A-Za-z0-9_-]{24,64}$/.test(link)
        ? api<AccountState>('/store/account/link', {
            method: 'POST',
            json: { token: link },
          }).catch(() => api<AccountState>('/store/account'))
        : api<AccountState>('/store/account');
    load.then(setAccount).catch(() => setAccount({ customer: null, addresses: [] }));
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

  // A sacola da conta também muda pelo WhatsApp da loja (0.280: o atendente vai colocando os
  // itens da conversa). Com a aba aberta, confere a cada 15 s e quando o cliente volta para ela;
  // mudou depois do último salvamento deste aparelho, vale a da conta.
  const waOrder = !!menu.restaurant.waOrder;
  useEffect(() => {
    if (!customerId || cartReadyFor !== customerId || !waOrder) return;
    let off = false;
    const check = () => {
      if (document.hidden) return;
      api<{ lines: unknown[]; updatedAt: string | null }>('/store/account/cart')
        .then((saved) => {
          const sync = cartSyncRef.current;
          if (off || !saved.updatedAt || sync?.customerId !== customerId) return;
          if (new Date(saved.updatedAt) <= new Date(sync.at)) return;
          setCartSync({ customerId, at: saved.updatedAt });
          pushed.current = JSON.stringify(saved.lines);
          setCart(syncCart(mergeCarts([], saved.lines), (id) => indexRef.current.get(id)));
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(check, 15_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      off = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [customerId, cartReadyFor, waOrder, setCart, setCartSync]);

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
      const land = () => setBump((n) => n + 1);
      if (from) flyToCart(from, !!leaving, visibleCartTarget, land);
      else land();
      track('add_to_cart', {
        productId: line.productId,
        quantity: line.quantity,
        value: lineTotal(line) / 100,
      });
      navigator.vibrate?.(12);
    },
    [setCart],
  );

  const value: StoreCtx = {
    menu,
    rules,
    table: menu.table ?? null,
    leaveTable,
    enterTable,
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
      setCoupon(null);
      // Aparelho dividido (tablet da mesa, celular emprestado): o próximo cliente não vê nome,
      // telefone, CPF nem a observação de quem saiu.
      setCustomer(() => EMPTY_CUSTOMER);
      try {
        localStorage.removeItem('cm-cart-notes');
      } catch {
        /* modo privado: nada guardado */
      }
      setAccount({ customer: null, addresses: [] });
    },
    customer,
    setCustomer,
    refreshStatus,
    refreshMenu,
    loyalty,
    refreshLoyalty,
    coupon: rules.coupons ? coupon : null,
    setCoupon,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
