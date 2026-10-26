import { describe, expect, it } from 'vitest';
import { syncCart, type CartLine, type PublicProduct } from './store';

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
