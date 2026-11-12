import { describe, expect, it } from 'vitest';
import { draftPrice, nameKey, readyDrafts, toDrafts } from './menu-import';

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

describe('importar cardápio: repetidos e outras páginas', () => {
  it('item que já está no cardápio vem desmarcado, mesmo com acento e caixa diferentes', () => {
    const list = toDrafts(
      [{ name: 'Lanches', items: [{ name: 'X-Búrguer', description: null, price: '24.90' }] }],
      [],
      new Set([nameKey('x-burguer ')]),
    );
    expect(list[0]).toMatchObject({ on: false, dup: 'menu' });
    expect(readyDrafts(list)).toHaveLength(0);
  });

  it('outra página com a mesma categoria entra no mesmo grupo e repetido vem desmarcado', () => {
    const first = toDrafts([
      { name: 'Bebidas', items: [{ name: 'Suco', description: null, price: '9.00' }] },
    ]);
    const second = toDrafts(
      [
        {
          name: 'BEBIDAS',
          items: [
            { name: 'suco', description: null, price: '9.00' },
            { name: 'Água', description: null, price: '4.00' },
          ],
        },
      ],
      first,
    );
    expect(second.map((d) => d.group)).toEqual([first[0]!.group, first[0]!.group]);
    expect(second.map((d) => [d.name, d.on, d.dup])).toEqual([
      ['suco', false, 'import'],
      ['Água', true, undefined],
    ]);
  });
});
