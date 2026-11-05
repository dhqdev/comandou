import { useSyncExternalStore } from 'react';
import type { PublicMenu, PublicProduct } from './store';

/**
 * Como o cardápio se arruma em cada tela:
 * - phone (até 699px): abas embaixo, carrossel de categorias e uma categoria por vez;
 * - tablet (700–1099px): estilo totem, com barra no topo, categorias numa coluna à esquerda e
 *   todas as seções em sequência (tocar numa categoria rola até ela);
 * - desktop (1100px+): menu lateral fixo com as categorias e, nas telas largas, a sacola ao lado.
 */
export type Layout = 'phone' | 'tablet' | 'desktop';

const TABLET = '(min-width: 700px)';
const DESKTOP = '(min-width: 1100px)';

function match(q: string) {
  return typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
}
export function currentLayout(): Layout {
  return match(DESKTOP) ? 'desktop' : match(TABLET) ? 'tablet' : 'phone';
}
function subscribeLayout(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const lists = [TABLET, DESKTOP].map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener?.('change', cb));
  return () => lists.forEach((l) => l.removeEventListener?.('change', cb));
}
export function useLayout(): Layout {
  return useSyncExternalStore(subscribeLayout, currentLayout, () => 'phone');
}

/** Uma seção do cardápio: categoria da loja ou as especiais (Destaques, Mais pedidos). */
export interface Section {
  id: string;
  name: string;
  imageUrl: string | null;
  products: PublicProduct[];
}

/**
 * Seções na ordem do cardápio: Destaques e Mais pedidos primeiro (quando houver), depois as
 * categorias com produto. As especiais usam a foto de um produto delas, uma diferente de cada.
 */
export function buildSections(menu: PublicMenu): Section[] {
  const all = menu.categories.flatMap((c) => c.products);
  const byId = new Map(all.map((p) => [p.id, p]));
  const featured = all.filter((p) => p.featured);
  const popular = menu.popular.map((id) => byId.get(id)).filter(Boolean) as PublicProduct[];
  const used = new Set(
    menu.categories
      .map((c) => c.imageUrl ?? c.products.find((p) => p.imageUrl)?.imageUrl)
      .filter(Boolean) as string[],
  );
  const cover = (list: PublicProduct[]) => {
    const withPhoto = list.filter((p) => p.imageUrl);
    const pick = withPhoto.find((p) => !used.has(p.imageUrl!)) ?? withPhoto[0];
    if (pick) used.add(pick.imageUrl!);
    return pick?.imageUrl ?? null;
  };
  return [
    ...(featured.length
      ? [
          {
            id: '__featured',
            name: menu.appearance.featuredTitle || 'Destaques',
            imageUrl: cover(featured),
            products: featured,
          },
        ]
      : []),
    ...(popular.length > 2
      ? [{ id: '__popular', name: 'Mais pedidos', imageUrl: cover(popular), products: popular }]
      : []),
    ...menu.categories.filter((c) => c.products.length > 0),
  ];
}

/** Foto da seção: a da categoria ou a do primeiro produto com foto. */
export const sectionPhoto = (s: Section) =>
  s.imageUrl ?? s.products.find((p) => p.imageUrl)?.imageUrl ?? null;

/* ------------------------------------------------------------------ seção ativa (rolagem) */
/*
 * A seção que está na tela agora (a rolagem marca) e o pedido de "ir até a seção" que vem do
 * menu lateral. Ficam fora do React: o menu lateral e a tela do início leem o mesmo valor.
 */
let active: string | null = null;
let pending: string | null = null;
const subs = new Set<() => void>();
const JUMP = 'sf:jump';

export function setActiveSection(id: string | null) {
  if (id === active) return;
  active = id;
  subs.forEach((f) => f());
}
function subscribeActive(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function useActiveSection() {
  return useSyncExternalStore(
    subscribeActive,
    () => active,
    () => null,
  );
}

/** Pede para o início rolar até a seção (agora, se ele está aberto; senão, ao abrir). */
export function requestJump(id: string) {
  pending = id;
  setActiveSection(id);
  window.dispatchEvent(new CustomEvent(JUMP, { detail: id }));
}
/** Pulo que ficou esperando o início abrir (o cliente tocou numa categoria em outra tela). */
export function takePendingJump() {
  const p = pending;
  pending = null;
  return p;
}
export function onJump(fn: (id: string) => void) {
  const h = (e: Event) => {
    pending = null;
    fn((e as CustomEvent<string>).detail);
  };
  window.addEventListener(JUMP, h);
  return () => window.removeEventListener(JUMP, h);
}
