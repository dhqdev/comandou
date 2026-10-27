import { fromCents, multiplyCents, optionsTotalCents, toCents } from '@comandou/shared';
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
  optionGroups: MenuGroup[];
}
export interface PublicCategory {
  id: string;
  name: string;
  imageUrl: string | null;
  products: PublicProduct[];
}
/** Situação da loja agora (GET /store/status). */
export type StoreStatus = Pick<PublicMenu['store'], 'isOpen' | 'acceptsDelivery' | 'acceptsPickup'>;

export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    about: string | null;
    address: string | null;
    whatsapp: string | null;
    /** Cidade e UF da loja: base para achar o CEP pelo nome da rua. */
    city?: string | null;
    state?: string | null;
    coverUrl: string | null;
    logoUrl: string | null;
  };
  store: {
    isOpen: boolean;
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    deliveryFee: string;
    minOrder: string;
    etaMin: number;
    etaMax: number;
    /** A loja desenhou áreas de entrega: o endereço precisa ser confirmado no mapa. */
    deliveryZones?: boolean;
  };
  appearance: {
    theme: 'auto' | 'light' | 'dark';
    headline: string | null;
    featuredTitle: string | null;
    accountsEnabled: boolean;
  };
  banners: PublicBanner[];
  /** Ids dos produtos que mais saíram nos últimos 30 dias. */
  popular: string[];
  categories: PublicCategory[];
}
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
  createdAt: string;
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
  channel: 'delivery' | 'pickup';
  total: string;
  createdAt: string;
  items: { name: string; quantity: number; imageUrl?: string | null }[];
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
  quantity: number;
  notes: string;
}

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
    if (!p || chosen.some((o) => !o)) {
      changed = true;
      continue;
    }
    const unit = fromCents(toCents(p.price) + optionsTotalCents(p.optionGroups, l.optionIds));
    const optionNames = chosen.map((o) => o!.name);
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

/** Estado salvo no navegador do cliente (carrinho, dados e pedidos recentes). */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
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
}
const RECENT = 'cm-store-orders';
export const recentOrders = () =>
  read<RecentOrder[]>(RECENT, []).filter((o) => Date.now() - Date.parse(o.at) < 2 * 86_400_000);
export function rememberOrder(o: RecentOrder) {
  write(RECENT, [o, ...recentOrders().filter((x) => x.token !== o.token)].slice(0, 10));
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

/** CEP enquanto digita: 00000-000. */
export function maskCep(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

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
  kind: 'earn' | 'redeem' | 'refund' | 'expire' | 'adjust';
  points: number;
  discount: string | null;
  note: string | null;
  createdAt: string;
  orderNumber: number | null;
}
export type PublicLoyalty =
  | { enabled: false }
  | {
      enabled: true;
      mode: 'points' | 'stamps';
      pointsPerReal: string;
      stampMinOrder: string;
      expiryDays: number | null;
      rewards: LoyaltyReward[];
      account: {
        balance: number;
        expiresAt: string | null;
        pending: number;
        history: LoyaltyEntry[];
      } | null;
    };
export type LoyaltyOn = Extract<PublicLoyalty, { enabled: true }>;

/** Mesma conta da API: pontos (R$ × pontos por real, para baixo) ou 1 carimbo acima do mínimo. */
export function loyaltyPoints(l: LoyaltyOn, spentCents: number) {
  if (spentCents <= 0) return 0;
  if (l.mode === 'stamps') return spentCents >= toCents(l.stampMinOrder) ? 1 : 0;
  return Math.floor((spentCents * toCents(l.pointsPerReal)) / 10_000);
}
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
};
