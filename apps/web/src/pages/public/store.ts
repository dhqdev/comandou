import { multiplyCents, toCents } from '@comandou/shared';
import { useEffect, useState } from 'react';
import type { MenuGroup } from '../../lib/types';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  soldOut: boolean;
  imageUrl: string | null;
  optionGroups: MenuGroup[];
}
export interface PublicCategory {
  id: string;
  name: string;
  imageUrl: string | null;
  products: PublicProduct[];
}
export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    about: string | null;
    address: string | null;
    whatsapp: string | null;
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
  };
  categories: PublicCategory[];
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
  street: string;
  number: string;
  district: string;
  complement: string;
  reference: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'voucher';
}

export const EMPTY_CUSTOMER: CustomerInfo = {
  customerName: '',
  customerPhone: '',
  channel: 'delivery',
  street: '',
  number: '',
  district: '',
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

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
