import type { PublicOnlinePay } from './OnlinePay';
import {
  fromCents,
  itemPoints,
  multiplyCents,
  optionsTotalCents,
  orderPoints,
  toCents,
  type CouponKind,
  type HourSlot,
  type LoyaltyLevel,
  type PixKeyType,
  type StoreSchedule,
} from '@comandou/shared';
import { useEffect, useState } from 'react';
import type { MenuGroup } from '../../lib/types';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  soldOut: boolean;
  imageUrl: string | null;
  featured: boolean;
  badge: string | null;
  /** Vendido por peso: o preço é do kg e o cliente escolhe quanto quer. */
  soldByWeight?: boolean;
  /** Fotos extras do item (a principal é imageUrl), na ordem do cadastro. */
  photos?: string[];
  /** Média das avaliações dos clientes; null sem avaliação. */
  rating?: { average: number; count: number } | null;
  /** Pontos fixos que o item rende na fidelidade (null = pela regra do programa). */
  loyaltyPoints?: number | null;
  optionGroups: MenuGroup[];
}
export interface PublicCategory {
  id: string;
  name: string;
  imageUrl: string | null;
  products: PublicProduct[];
}
/** Situação da loja agora (GET /store/status). */
export type StoreStatus = Pick<
  PublicMenu['store'],
  'isOpen' | 'acceptsDelivery' | 'acceptsPickup' | 'schedule'
>;

export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    about: string | null;
    address: string | null;
    whatsapp: string | null;
    /** Número do atendente automático do WhatsApp que faz o pedido (null = desligado). */
    waOrder?: string | null;
    /** Cidade e UF da loja: base para achar o CEP pelo nome da rua. */
    city?: string | null;
    state?: string | null;
    coverUrl: string | null;
    logoUrl: string | null;
  };
  store: {
    isOpen: boolean;
    /** Faixa do app: aberta até que horas ou quando abre de novo (sem horário: null). */
    schedule?: StoreSchedule | null;
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    deliveryFee: string;
    minOrder: string;
    etaMin: number;
    etaMax: number;
    /** A loja desenhou áreas de entrega: o endereço precisa ser confirmado no mapa. */
    deliveryZones?: boolean;
    /** A loja tem mesas cadastradas (o cardápio online oferece "Estou no restaurante"). */
    tables?: boolean;
  };
  /** Mesa do QR Code (cardápio aberto com ?mesa=); null fora dela ou mesa que não existe mais. */
  table?: PublicTable | null;
  /**
   * Pix da loja (pagar agora pelo QR Code e mandar o comprovante). null = Pix é pago na entrega
   * ou na retirada, como antes.
   */
  pix?: PublicPix | null;
  /** Cartão e Pix pelo app (PagBank conectado). null = como antes. */
  onlinePay?: PublicOnlinePay | null;
  /** Cardápio de mesa (QR Code) ou online (entrega e retirada). */
  mode?: 'table' | 'online';
  appearance: {
    theme: 'auto' | 'light' | 'dark';
    headline: string | null;
    featuredTitle: string | null;
    accountsEnabled: boolean;
    /** Aba Perfil no cardápio da mesa e os cupons da conta no pedido da mesa. */
    tableAccount?: boolean;
    tableCoupons?: boolean;
    /** Conversa com a loja pelo cardápio (no lugar do WhatsApp). */
    chatEnabled: boolean;
  };
  /**
   * Resumo da fidelidade (o saldo vem em /store/loyalty): o início mostra os pontos de cada item
   * sem esperar outra chamada. null = programa desligado (ou cardápio da mesa).
   */
  loyalty?: PublicLoyaltyRule | null;
  /** Quantos cupons estão na vitrine (aba Cupons). 0 = a aba não aparece. */
  coupons?: number;
  /** Ids dos avisos da loja no ar (o sino do início mostra a bolinha se houver um novo). */
  notices?: string[];
  banners: PublicBanner[];
  /** Ids dos produtos que mais saíram nos últimos 30 dias. */
  popular: string[];
  categories: PublicCategory[];
}
/** Recebedor do Pix da loja: o checkout monta o copia e cola com o valor do pedido. */
export interface PublicPix {
  keyType: PixKeyType;
  key: string;
  keyLabel: string;
  name: string;
  city: string;
}
/** Mesa em que o cliente está sentado (leu o QR Code colado nela). */
export interface PublicTable {
  id: string;
  label: string;
  /** Taxa de serviço que a comanda da mesa cobra ("10.00"), ou null. */
  serviceFeePercent: string | null;
  /** O cliente confirma a localização (no restaurante) antes de pedir. */
  confirmLocation?: boolean;
  /** Pedido pronto: o cliente busca no balcão. */
  selfPickup?: boolean;
}

/** Canal do pedido feito pelo cardápio: na mesa só pelo QR Code. */
export type StoreChannel = 'delivery' | 'pickup' | 'table';

export interface PublicBanner {
  id: string;
  title: string;
  subtitle: string | null;
  tag: string | null;
  cta: string | null;
  imageUrl: string | null;
  targetType: 'none' | 'product' | 'category';
  targetId: string | null;
}

export interface CustomerAccount {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  /** CPF (só números): já vem preenchido no pedido da mesa. */
  cpf?: string | null;
  createdAt: string;
  /** Avatar desenhado escolhido (null = o automático pela conta). */
  avatar?: string | null;
  /** Foto do perfil (null = mostra o avatar). */
  photoUrl?: string | null;
  /** Aniversário (dia e mês, ano opcional) e se quer o parabéns da loja. */
  birthDay?: number | null;
  birthMonth?: number | null;
  birthYear?: number | null;
  birthdayOptOut?: boolean;
}
export interface SavedAddress {
  id: string;
  label: string | null;
  street: string;
  number: string;
  district: string;
  complement: string | null;
  reference: string | null;
  cep?: string | null;
  city?: string | null;
  state?: string | null;
  isDefault: boolean;
  lat?: string | null;
  lng?: string | null;
}
export interface AccountState {
  customer: CustomerAccount | null;
  addresses: SavedAddress[];
}
export interface AccountOrder {
  id: string;
  number: number;
  step: 'awaiting' | 'accepted' | 'ready' | 'dispatched' | 'completed' | 'cancelled';
  channel: StoreChannel;
  total: string;
  createdAt: string;
  items: { name: string; quantity: number; unit?: string; imageUrl?: string | null }[];
}

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  /** Preço unitário com opções (exibição; o servidor recalcula). */
  unit: string;
  optionIds: string[];
  optionNames: string[];
  /** Unidades, ou o peso em kg quando `weight`. */
  quantity: number;
  /** Item vendido por peso (o preço `unit` é o do kg). */
  weight?: boolean;
  notes: string;
}

/** Quantos itens a linha soma no contador da sacola (item por peso conta 1). */
export const lineCount = (l: CartLine) => (l.weight ? 1 : l.quantity);

export interface CustomerInfo {
  customerName: string;
  customerPhone: string;
  channel: 'delivery' | 'pickup';
  cep: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  complement: string;
  reference: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'voucher';
  /** CPF (pedido da mesa pelo celular, vai para a nota). Guardado para os próximos pedidos. */
  customerCpf?: string;
}

export const EMPTY_CUSTOMER: CustomerInfo = {
  customerName: '',
  customerPhone: '',
  channel: 'delivery',
  cep: '',
  street: '',
  number: '',
  district: '',
  city: '',
  state: '',
  complement: '',
  reference: '',
  paymentMethod: 'pix',
};

export const PAYMENT_OPTIONS: { value: CustomerInfo['paymentMethod']; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'credit', label: 'Crédito' },
  { value: 'debit', label: 'Débito' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'voucher', label: 'Vale-refeição' },
];

export const lineTotal = (l: CartLine) => multiplyCents(toCents(l.unit), l.quantity);

/** Nomes das opções na sacola, na ordem escolhida: a mesma repetida vira "2× Nome". */
export function optionNamesOf(ids: string[], opts: { id: string; name: string }[]) {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, n]) => {
    const name = opts.find((o) => o.id === id)?.name ?? '';
    return n > 1 ? `${n}× ${name}` : name;
  });
}

/**
 * Acerta a sacola guardada no aparelho com o cardápio atual: tira o que saiu do cardápio (ou
 * cuja opção sumiu) e atualiza preço, nome e foto. Assim o total mostrado é o que o servidor vai
 * cobrar. Devolve a mesma lista quando nada mudou.
 */
export function syncCart(cart: CartLine[], product: (id: string) => PublicProduct | undefined) {
  let changed = false;
  const out: CartLine[] = [];
  for (const l of cart) {
    const p = product(l.productId);
    const opts = p?.optionGroups.flatMap((g) => g.options) ?? [];
    const chosen = l.optionIds.map((id) => opts.find((o) => o.id === id));
    // Item que passou a ser (ou deixou de ser) vendido por peso: a quantidade muda de sentido.
    if (!p || chosen.some((o) => !o) || !!p.soldByWeight !== !!l.weight) {
      changed = true;
      continue;
    }
    const unit = fromCents(toCents(p.price) + optionsTotalCents(p.optionGroups, l.optionIds));
    const optionNames = optionNamesOf(l.optionIds, opts);
    if (
      unit !== l.unit ||
      p.name !== l.name ||
      p.imageUrl !== l.imageUrl ||
      optionNames.join('\u0000') !== l.optionNames.join('\u0000')
    ) {
      changed = true;
      out.push({ ...l, unit, name: p.name, imageUrl: p.imageUrl, optionNames });
    } else out.push(l);
  }
  return changed ? out : cart;
}

/** Máximo de linhas na sacola (o mesmo limite do pedido e da sacola guardada na conta). */
export const MAX_CART_LINES = 60;

/** Linha vinda da sacola guardada na conta: só aceita o formato que o cardápio monta. */
export const isLine = (l: unknown): l is CartLine => {
  const x = l as Partial<CartLine> | null;
  return (
    !!x &&
    typeof x.key === 'string' &&
    typeof x.productId === 'string' &&
    typeof x.quantity === 'number' &&
    x.quantity > 0 &&
    Array.isArray(x.optionIds) &&
    Array.isArray(x.optionNames)
  );
};

/**
 * Junta a sacola montada no aparelho (antes de entrar na conta) com a que já estava guardada na
 * conta. Nada se perde: o mesmo item (mesma chave: produto, opções e observação) fica com a maior
 * quantidade, para não dobrar o que já tinha sido salvo deste mesmo aparelho; o resto se soma.
 */
export function mergeCarts(local: CartLine[], saved: unknown[]): CartLine[] {
  const out = saved.filter(isLine);
  for (const l of local) {
    const i = out.findIndex((x) => x.key === l.key);
    if (i < 0) out.push(l);
    else out[i] = { ...out[i]!, quantity: Math.max(out[i]!.quantity, l.quantity) };
  }
  return out.slice(0, MAX_CART_LINES);
}

/** Estado salvo no navegador do cliente (carrinho, dados e pedidos recentes). */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v: unknown = JSON.parse(raw);
    // Valor salvo por versão antiga ou mexido à mão com outro formato: volta ao padrão em vez de
    // quebrar o cardápio toda vez que abre.
    if (Array.isArray(fallback)) return (Array.isArray(v) ? v : fallback) as T;
    if (fallback !== null && typeof fallback === 'object')
      return (v && typeof v === 'object' && !Array.isArray(v) ? v : fallback) as T;
    if (fallback !== null && typeof v !== typeof fallback) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* modo privado ou armazenamento cheio: segue sem salvar */
  }
}

export function useStored<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(() => read(key, fallback));
  useEffect(() => write(key, v), [key, v]);
  return [v, setV] as const;
}

export interface RecentOrder {
  token: string;
  number: number;
  at: string;
  /** Mesa do QR Code em que o pedido foi feito (a aba Pedidos da mesa mostra só os dela). */
  tableId?: string;
  /** Total do pedido em centavos e quantos itens (resumo da mesa, sem buscar no servidor). */
  totalCents?: number;
  items?: number;
}
const RECENT = 'cm-store-orders';
export const recentOrders = () =>
  read<RecentOrder[]>(RECENT, []).filter(
    (o) =>
      !!o &&
      typeof o.token === 'string' &&
      typeof o.at === 'string' &&
      Date.now() - Date.parse(o.at) < 2 * 86_400_000,
  );
/** Pedidos deste aparelho para a mesa, do mais novo ao mais antigo. */
export const tableOrders = (tableId: string) => recentOrders().filter((o) => o.tableId === tableId);
export function rememberOrder(o: RecentOrder) {
  write(RECENT, [o, ...recentOrders().filter((x) => x.token !== o.token)].slice(0, 10));
}
/** Tira pedidos deste aparelho (ex.: a conta da mesa foi paga e eles saem do celular). */
export function forgetOrders(tokens: string[]) {
  if (!tokens.length) return;
  write(
    RECENT,
    recentOrders().filter((x) => !tokens.includes(x.token)),
  );
}
/**
 * Endereço do pedido citado na conversa com a loja: o da conta (histórico do cliente logado) ou
 * o do link guardado neste aparelho. O número do pedido é único no restaurante, então acha sempre
 * o mesmo pedido. Sem nenhum dos dois (pedido antigo, feito em outro aparelho), a aba Pedidos.
 */
export function chatOrderPath(
  n: number,
  mine: Pick<AccountOrder, 'id' | 'number'>[] | null,
  here: Pick<RecentOrder, 'number' | 'token'>[],
): string {
  const own = mine?.find((o) => o.number === n);
  if (own) return `/pedir/pedidos/${encodeURIComponent(own.id)}`;
  const local = here.find((o) => o.number === n);
  if (local) return `/pedido/${encodeURIComponent(local.token)}`;
  return '/pedir/pedidos';
}

/** A API respondeu que a conta da mesa deste pedido já foi fechada (o pedido saiu do celular). */
export const TABLE_CLOSED = 'table_closed';
export const isTableClosed = (e: unknown) =>
  (e as { status?: number; body?: { code?: string } } | null)?.status === 410 &&
  (e as { body?: { code?: string } }).body?.code === TABLE_CLOSED;

/**
 * Mesa do QR Code lembrada nesta aba do navegador (sessionStorage): o cliente vai e volta entre o
 * cardápio e o acompanhamento sem perder a mesa, e ela some ao fechar a aba ou depois de 6 horas
 * (quem abrir o cardápio em casa no dia seguinte não pede para a mesa por engano).
 */
const TABLE_KEY = 'cm-store-table';
const TABLE_TTL_MS = 6 * 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTableId = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

/**
 * Mesa do QR Code lido pela câmera do cardápio ("Estou no restaurante"): o link `/mesa/<id>` ou
 * `?mesa=<id>` deste mesmo restaurante. QR de outro endereço (outro restaurante) não vale.
 */
export function tableIdFromQr(text: string, host: string): string | null {
  const raw = text.trim();
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.host.toLowerCase() !== host.toLowerCase()) return null;
      path = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  const m = path.match(/(?:^\/mesa\/|[?&]mesa=)([0-9a-f-]{36})(?:[/?&#]|$)/i);
  return m && isTableId(m[1]) ? m[1]!.toLowerCase() : null;
}

export function storedTableId(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(TABLE_KEY);
    const t = raw ? (JSON.parse(raw) as { id?: string; at?: number }) : null;
    return t && isTableId(t.id) && typeof t.at === 'number' && now - t.at < TABLE_TTL_MS
      ? t.id
      : null;
  } catch {
    return null;
  }
}
export function rememberTable(id: string | null, now = Date.now()) {
  try {
    if (id) sessionStorage.setItem(TABLE_KEY, JSON.stringify({ id, at: now }));
    else sessionStorage.removeItem(TABLE_KEY);
  } catch {
    /* modo privado: a mesa vale só enquanto a página está aberta */
  }
}

/** Onde o celular estava quando o cliente confirmou que está no restaurante. */
export interface TablePresence {
  lat: number;
  lng: number;
  accuracy: number;
}
const HERE_KEY = 'cm-table-here';
/** A confirmação vale uma refeição: depois disso (ou em outra mesa) pede de novo. */
const HERE_TTL_MS = 4 * 3_600_000;

export function storedPresence(tableId: string, now = Date.now()): TablePresence | null {
  try {
    const raw = sessionStorage.getItem(HERE_KEY);
    const h = raw
      ? (JSON.parse(raw) as { tableId?: string; at?: number } & Partial<TablePresence>)
      : null;
    if (!h || h.tableId !== tableId || typeof h.at !== 'number' || now - h.at > HERE_TTL_MS)
      return null;
    if (typeof h.lat !== 'number' || typeof h.lng !== 'number' || typeof h.accuracy !== 'number')
      return null;
    return { lat: h.lat, lng: h.lng, accuracy: h.accuracy };
  } catch {
    return null;
  }
}
export function rememberPresence(tableId: string, p: TablePresence | null, now = Date.now()) {
  try {
    if (p) sessionStorage.setItem(HERE_KEY, JSON.stringify({ tableId, at: now, ...p }));
    else sessionStorage.removeItem(HERE_KEY);
  } catch {
    /* modo privado: vale enquanto a página está aberta */
  }
}

/** Taxa de serviço da mesa sobre os itens (centavos), na mesma conta do servidor. */
export function tableServiceFee(baseCents: number, percent: string | null | undefined) {
  if (!percent || baseCents <= 0) return 0;
  return Math.round((baseCents * toCents(percent)) / 10_000);
}

/** Token aleatório do link de acompanhamento (o servidor guarda só o hash). */
export function newOrderToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Formata o telefone enquanto digita: (11) 98888-7777. */
export function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** (11) 98888-7777 a partir dos dígitos. */
export const fmtPhone = (digits: string) => maskPhone(digits);

export const addressLine = (a: Pick<SavedAddress, 'street' | 'number' | 'district'>) =>
  `${a.street}, ${a.number} · ${a.district}`;

export { maskCep } from '../../lib/cep';

export const STEP_LABEL: Record<AccountOrder['step'], string> = {
  awaiting: 'Em análise',
  accepted: 'Em preparo',
  ready: 'Pronto',
  dispatched: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Taxa e tempo de entrega para um ponto do mapa (a API recalcula ao criar o pedido). */
export interface DeliveryQuote {
  covered: boolean;
  zone: { id: string; name: string } | null;
  fee: string;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
  /** Fora de todas as áreas: os nomes delas (onde a loja entrega). */
  areas?: string[];
}
export interface PinnedQuote {
  lat: number;
  lng: number;
  quote: DeliveryQuote;
}

/** Programa de fidelidade da loja (GET /store/loyalty). */
export interface LoyaltyReward {
  id: string;
  name: string;
  cost: number;
  kind: 'discount' | 'product';
  /** Desconto em reais; no produto grátis, o preço base dele hoje. */
  amount: string | null;
  productId: string | null;
  productName: string | null;
  imageUrl: string | null;
}
export interface LoyaltyEntry {
  id: string;
  kind: 'earn' | 'redeem' | 'refund' | 'expire' | 'adjust' | 'bonus' | 'store';
  points: number;
  discount: string | null;
  note: string | null;
  createdAt: string;
  orderNumber: number | null;
}
/** Regra dos pontos que vem junto com o cardápio. */
export interface PublicLoyaltyRule {
  mode: 'points' | 'stamps';
  pointsPerReal: string;
  /** O cardápio mostra "Ganhe N pts" em cada item. */
  showItemPoints: boolean;
}
export type { LoyaltyLevel };
export type PublicLoyalty =
  | { enabled: false }
  | {
      enabled: true;
      mode: 'points' | 'stamps';
      pointsPerReal: string;
      stampMinOrder: string;
      expiryDays: number | null;
      /** Pontos ganhos nos últimos N dias decidem o nível (null = desde sempre). */
      levelWindowDays?: number | null;
      showItemPoints?: boolean;
      /** Níveis do programa (Bronze, Prata, Ouro...), do menor para o maior. */
      levels?: LoyaltyLevel[];
      /** Indique um amigo: pontos de quem indica e do amigo (null = desligado). */
      referral?: { points: number; friendPoints: number } | null;
      rewards: LoyaltyReward[];
      account: {
        balance: number;
        expiresAt: string | null;
        pending: number;
        history: LoyaltyEntry[];
        /** Pontos ganhos na janela dos níveis. */
        earned?: number;
        /** PIN de 6 números para usar os pontos e os cupons no balcão. */
        pin?: string;
        referralCode?: string;
        /** Já informou o código de quem o convidou. */
        referred?: boolean;
        friends?: { invited: number; paid: number };
      } | null;
    };
export type LoyaltyOn = Extract<PublicLoyalty, { enabled: true }>;

/** Mesma conta da API: pontos (R$ × pontos por real, para baixo) ou 1 carimbo acima do mínimo. */
export function loyaltyPoints(l: LoyaltyOn, spentCents: number) {
  if (spentCents <= 0) return 0;
  if (l.mode === 'stamps') return spentCents >= toCents(l.stampMinOrder) ? 1 : 0;
  return Math.floor((spentCents * toCents(l.pointsPerReal)) / 10_000);
}

/**
 * Pontos que a sacola rende, na mesma conta da API (`orderPoints`): itens com número fixo rendem
 * esse número e o resto rende pela regra sobre o que sobrou depois do desconto.
 */
export function cartPoints(
  l: LoyaltyOn,
  cart: CartLine[],
  product: (id: string) => Pick<PublicProduct, 'loyaltyPoints'> | undefined,
  spentCents: number,
) {
  return orderPoints(
    { mode: l.mode, pointsPerReal: l.pointsPerReal, stampMinOrder: l.stampMinOrder },
    spentCents,
    cart.map((c) => ({
      totalCents: lineTotal(c),
      quantity: c.quantity,
      fixed: product(c.productId)?.loyaltyPoints ?? null,
      weight: c.weight,
    })),
  );
}

/**
 * "Ganhe N pts" do cartão do item: o número fixo do item ou o preço × pontos por real. null =
 * não mostra (programa de carimbos, desligado ou a loja escondeu os pontos dos itens).
 */
export function productPoints(
  rule: PublicLoyaltyRule | null | undefined,
  p: Pick<PublicProduct, 'price' | 'loyaltyPoints' | 'soldByWeight'>,
): number | null {
  if (!rule || !rule.showItemPoints || rule.mode !== 'points') return null;
  const n = itemPoints(rule, toCents(p.price), p.loyaltyPoints);
  return n && n > 0 ? n : null;
}

/** "1.250 pts" / "1 pt". */
export const ptsText = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'pt' : 'pts'}`;
export const loyaltyUnit = (l: Pick<LoyaltyOn, 'mode'>, n = 2) =>
  l.mode === 'stamps' ? (n === 1 ? 'carimbo' : 'carimbos') : n === 1 ? 'ponto' : 'pontos';

/** Frase da regra para o cliente. */
export function loyaltyRule(l: LoyaltyOn) {
  if (l.mode === 'stamps')
    return toCents(l.stampMinOrder) > 0
      ? `1 carimbo a cada pedido a partir de R$ ${l.stampMinOrder.replace('.', ',')}`
      : '1 carimbo a cada pedido';
  const per = Number(l.pointsPerReal);
  return `${per.toLocaleString('pt-BR')} ${per === 1 ? 'ponto' : 'pontos'} a cada R$ 1`;
}

/**
 * Desconto que a recompensa dá nesta sacola (centavos), ou null se não serve agora (produto
 * grátis fora da sacola). Nunca passa do subtotal.
 */
export function rewardDiscount(
  r: LoyaltyReward,
  cart: Pick<CartLine, 'productId'>[],
  subtotalCents: number,
) {
  if (r.kind === 'product' && !cart.some((l) => l.productId === r.productId)) return null;
  return Math.min(toCents(r.amount ?? '0'), subtotalCents);
}

export const LOYALTY_LABEL: Record<LoyaltyEntry['kind'], string> = {
  earn: 'Pedido concluído',
  redeem: 'Troca',
  refund: 'Devolvido (pedido cancelado)',
  expire: 'Venceram',
  adjust: 'Ajuste da loja',
  bonus: 'Indicação de amigo',
  store: 'Troca na loja',
};

// ---------------------------------------------------------------- cupons e telas do app

/** Cupom da vitrine (GET /store/coupons) ou conferido pelo código. */
export interface PublicCoupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: CouponKind;
  value: string | null;
  maxDiscount: string | null;
  minOrder: string;
  endsAt: string | null;
  firstOrderOnly: boolean;
  perCustomer: number;
  imageUrl: string | null;
  usedByMe: number;
  /** Por que não dá para usar agora (null = dá). */
  blocked: string | null;
}
/** Resposta de POST /store/coupons/check. */
export interface CouponCheck {
  coupon: PublicCoupon;
  /** Desconto nesta sacola ("12.00"), ou null se não vale agora. */
  discount: string | null;
}

/** Aviso da loja para os clientes (tela Notificações). */
export interface StoreNotice {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetType: 'none' | 'product' | 'coupon';
  target: string | null;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}
export interface StoreFaq {
  id: string;
  section: string;
  question: string;
  answer: string;
}
/** Telas Ajuda, Notificações, Sobre e Escolher loja (GET /store/app). */
export interface PublicAppInfo {
  about: string | null;
  instagram: string | null;
  address: string | null;
  whatsapp: string | null;
  hours: HourSlot[];
  location: { lat: number; lng: number } | null;
  faq: StoreFaq[];
  notices: StoreNotice[];
}

/** Avisos já vistos neste aparelho (a bolinha do sino some depois de abrir a tela). */
const SEEN_NOTICES = 'cm-notices-seen';
export const seenNotices = () => read<string[]>(SEEN_NOTICES, []);
export function markNoticesSeen(ids: string[]) {
  write(SEEN_NOTICES, [...new Set([...ids, ...seenNotices()])].slice(0, 100));
}

/** Cupom escolhido para o próximo pedido (aba Cupons → sacola). */
export const COUPON_KEY = 'cm-coupon';

/** Convite de um amigo (link com ?convite=CODIGO): fica guardado até a pessoa usar o código. */
const INVITE_KEY = 'cm-invite';
export function captureInvite(search: string) {
  const code = new URLSearchParams(search).get('convite')?.trim().toUpperCase();
  if (code && /^[A-Z0-9]{4,12}$/.test(code)) write(INVITE_KEY, code);
}
export const pendingInvite = () => {
  const v = read<string | null>(INVITE_KEY, null);
  return typeof v === 'string' ? v : null;
};
export const clearInvite = () => write(INVITE_KEY, null);
