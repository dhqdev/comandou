import { describe, expect, it } from 'vitest';
import { buildSections, sectionPhoto, type Section } from './sections';
import type { PublicMenu, PublicProduct } from './store';

const product = (id: string, over: Partial<PublicProduct> = {}): PublicProduct => ({
  id,
  name: `Produto ${id}`,
  description: null,
  price: '10.00',
  soldOut: false,
  imageUrl: `/img/${id}.jpg`,
  featured: false,
  badge: null,
  optionGroups: [],
  ...over,
});

const menu = (over: {
  categories: { id: string; name: string; imageUrl?: string | null; products: PublicProduct[] }[];
  popular?: string[];
  featuredTitle?: string;
}) =>
  ({
    categories: over.categories.map((c) => ({ imageUrl: null, ...c })),
    popular: over.popular ?? [],
    appearance: { featuredTitle: over.featuredTitle ?? '' },
  }) as unknown as PublicMenu;

describe('buildSections', () => {
  it('põe Destaques e Mais pedidos antes das categorias e pula categoria vazia', () => {
    const a = product('a', { featured: true });
    const b = product('b');
    const c = product('c');
    const d = product('d');
    const s = buildSections(
      menu({
        categories: [
          { id: 'burgers', name: 'Burgers', products: [a, b] },
          { id: 'vazia', name: 'Vazia', products: [] },
          { id: 'bebidas', name: 'Bebidas', products: [c, d] },
        ],
        popular: ['b', 'c', 'd'],
      }),
    );
    expect(s.map((x) => x.id)).toEqual(['__featured', '__popular', 'burgers', 'bebidas']);
    expect(s[0]!.name).toBe('Destaques');
    expect(s[0]!.products).toEqual([a]);
    expect(s[1]!.products.map((p) => p.id)).toEqual(['b', 'c', 'd']);
  });

  it('só mostra Mais pedidos com três ou mais produtos e usa o título dos destaques da loja', () => {
    const s = buildSections(
      menu({
        categories: [
          { id: 'x', name: 'X', products: [product('a', { featured: true }), product('b')] },
        ],
        popular: ['a', 'b'],
        featuredTitle: 'Os queridinhos',
      }),
    );
    expect(s.map((x) => x.id)).toEqual(['__featured', 'x']);
    expect(s[0]!.name).toBe('Os queridinhos');
  });

  it('dá às seções especiais uma foto que as categorias ainda não usam', () => {
    const s = buildSections(
      menu({
        categories: [
          {
            id: 'x',
            name: 'X',
            products: [product('a', { featured: true }), product('b', { featured: true })],
          },
        ],
      }),
    );
    // A categoria já mostra a foto de "a"; os Destaques ficam com a de "b".
    expect(sectionPhoto(s[1]!)).toBe('/img/a.jpg');
    expect(s[0]!.imageUrl).toBe('/img/b.jpg');
  });
});

describe('sectionPhoto', () => {
  it('usa a foto da categoria ou a do primeiro produto com foto', () => {
    const base: Section = { id: 's', name: 'S', imageUrl: null, products: [] };
    expect(sectionPhoto({ ...base, imageUrl: '/cat.jpg' })).toBe('/cat.jpg');
    expect(
      sectionPhoto({ ...base, products: [product('a', { imageUrl: null }), product('b')] }),
    ).toBe('/img/b.jpg');
    expect(sectionPhoto(base)).toBeNull();
  });
});
