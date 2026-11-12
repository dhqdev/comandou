import { describe, expect, it } from 'vitest';
import { draftPrice, readyDrafts, toDrafts } from './menu-import';

describe('importar cardápio: conferência', () => {
  it('lê o preço como a pessoa digita', () => {
    expect(draftPrice('24,90')).toBe('24.90');
    expect(draftPrice('R$ 1.250,00')).toBe('1250.00');
    expect(draftPrice('18')).toBe('18.00');
    expect(draftPrice('')).toBeNull();
    expect(draftPrice('abc')).toBeNull();
  });

  it('item sem preço vem desmarcado e só entra com nome e preço', () => {
    const list = toDrafts([
      {
        name: 'Lanches',
        items: [
          { name: 'X-Burger', description: null, price: '24.90' },
          { name: 'Suco', description: 'Laranja', price: null },
        ],
      },
    ]);
    expect(list.map((d) => [d.category, d.price, d.on])).toEqual([
      ['Lanches', '24,90', true],
      ['Lanches', '', false],
    ]);
    expect(readyDrafts(list).map((d) => d.name)).toEqual(['X-Burger']);
    const typed = list.map((d) => (d.name === 'Suco' ? { ...d, price: '9', on: true } : d));
    expect(readyDrafts(typed)).toHaveLength(2);
    expect(readyDrafts(typed.map((d) => ({ ...d, name: ' ' })))).toHaveLength(0);
  });
});
