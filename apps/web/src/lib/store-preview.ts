import type { PublicMenu } from '../pages/public/store';

/**
 * Prévia do cardápio na criação pelo site (0.282, pedido do David: "começar a aparecer o cardápio
 * do lado igual o meu dentro do sistema, igualzinho"). A página de criar manda os dados da
 * conversa para a moldura (`/experimente?tela=loja&previa=1`) e lá dentro roda o cardápio online
 * de verdade (StoreApp), com o "servidor" respondido no navegador (sandbox/store-preview.tsx).
 * Este arquivo é pequeno de propósito: o site só monta a mensagem.
 */

export const STORE_PREVIEW_MSG = 'comandou-store-preview';
/** A moldura avisa que está pronta para receber os dados. */
export const STORE_PREVIEW_READY = 'comandou-store-preview-ready';
export const STORE_PREVIEW_URL = '/experimente?tela=loja&previa=1';

export interface StorePreviewItem {
  name: string;
  description: string | null;
  /** "24.90" (vazio = sem preço ainda). */
  price: string;
  imageUrl: string | null;
}

export interface StorePreviewData {
  name: string;
  about: string | null;
  address: string | null;
  whatsapp: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  accentColor: string | null;
  delivery: boolean;
  pickup: boolean;
  etaMin: number;
  etaMax: number;
  categories: { name: string; items: StorePreviewItem[] }[];
}

const slugOf = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'seu-restaurante';

/** O cardápio público (o mesmo formato que a API devolve em GET /store) a partir da conversa. */
export function previewMenu(d: StorePreviewData): PublicMenu {
  let n = 0;
  return {
    restaurant: {
      name: d.name || 'Seu restaurante',
      slug: slugOf(d.name),
      about: d.about,
      address: d.address,
      whatsapp: d.whatsapp,
      waOrder: null,
      city: null,
      state: null,
      coverUrl: d.coverUrl,
      logoUrl: d.logoUrl,
    },
    store: {
      isOpen: true,
      schedule: null,
      acceptsDelivery: d.delivery,
      acceptsPickup: d.pickup || !d.delivery,
      deliveryFee: '0.00',
      minOrder: '0.00',
      etaMin: d.etaMin,
      etaMax: d.etaMax,
      deliveryZones: false,
      tables: false,
    },
    table: null,
    pix: null,
    onlinePay: null,
    mode: 'online',
    appearance: {
      theme: 'light',
      headline: null,
      featuredTitle: null,
      accountsEnabled: false,
      chatEnabled: false,
    },
    loyalty: null,
    coupons: 0,
    notices: [],
    banners: [],
    popular: [],
    categories: d.categories
      .filter((c) => c.items.length)
      .map((c, ci) => ({
        id: `c${ci}`,
        name: c.name || 'Cardápio',
        imageUrl: null,
        products: c.items.map((i) => ({
          id: `p${++n}`,
          name: i.name || 'Item',
          description: i.description,
          price: /^\d+(\.\d{1,2})?$/.test(i.price) ? i.price : '0.00',
          soldOut: false,
          imageUrl: i.imageUrl,
          featured: false,
          badge: null,
          rating: null,
          loyaltyPoints: null,
          optionGroups: [],
        })),
      })),
  };
}
