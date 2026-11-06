import { describe, expect, it } from 'vitest';
import { mergeCarts, syncCart, type CartLine, type PublicProduct } from './store';

const burger: PublicProduct = {
  id: 'p1',
  name: 'X-Burger',
  description: null,
  price: '30.00',
  soldOut: false,
  imageUrl: '/api/v1/media/a',
  featured: false,
  badge: null,
  optionGroups: [
    {
      id: 'g1',
      name: 'Adicionais',
      minSelect: 0,
      maxSelect: 2,
      options: [{ id: 'o1', name: 'Bacon', priceDelta: '5.00' }],
    },
  ],
};

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: 'p1:o1',
  productId: 'p1',
  name: 'X-Burger',
  imageUrl: '/api/v1/media/a',
  unit: '35.00',
  optionIds: ['o1'],
  optionNames: ['Bacon'],
  quantity: 2,
  notes: '',
  ...over,
});

const find = (list: PublicProduct[]) => (id: string) => list.find((p) => p.id === id);

describe('syncCart', () => {
  it('devolve a mesma lista quando nada mudou', () => {
    const cart = [line()];
    expect(syncCart(cart, find([burger]))).toBe(cart);
  });

  it('atualiza preço, nome e foto com o cardápio atual', () => {
    const next = syncCart(
      [line()],
      find([{ ...burger, name: 'X-Bacon', price: '32.50', imageUrl: '/api/v1/media/b' }]),
    );
    expect(next[0]).toMatchObject({
      unit: '37.50',
      name: 'X-Bacon',
      imageUrl: '/api/v1/media/b',
      quantity: 2,
    });
  });

  it('tira o que saiu do cardápio ou cuja opção sumiu', () => {
    expect(syncCart([line()], find([]))).toEqual([]);
    expect(syncCart([line()], find([{ ...burger, optionGroups: [] }]))).toEqual([]);
  });
});

describe('mergeCarts', () => {
  it('junta a sacola do aparelho com a da conta sem perder nada', () => {
    // O mesmo item salvo deste aparelho antes não dobra: fica a maior quantidade.
    const local = [line({ quantity: 1 }), line({ key: 'p1:', optionIds: [], quantity: 3 })];
    const saved = [
      line({ quantity: 2 }),
      line({ key: 'p2:', productId: 'p2', optionIds: [], quantity: 1 }),
    ];
    expect(mergeCarts(local, saved).map((l) => [l.key, l.quantity])).toEqual([
      ['p1:o1', 2],
      ['p2:', 1],
      ['p1:', 3],
    ]);
  });

  it('ignora linhas estranhas vindas da conta', () => {
    expect(mergeCarts([line()], [null, { key: 'x' }, 'a'])).toEqual([line()]);
  });
});
