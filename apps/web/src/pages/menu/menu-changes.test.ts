import { describe, expect, it } from 'vitest';
import {
  describeMenuChanges,
  invalidPrices,
  itemsChanged,
  nameChanged,
  type MenuSnapshot,
} from './menu-changes';

const products = [
  { id: 'a', name: 'Chopp', price: '14.90' },
  { id: 'b', name: 'IPA', price: '24.90' },
  { id: 'c', name: 'Limonada', price: '11.90' },
  { id: 'd', name: 'Água', price: '6.90' },
];
const base: MenuSnapshot = {
  name: 'Delivery',
  rows: {
    a: { on: true, price: '' },
    b: { on: true, price: '' },
    c: { on: false, price: '' },
    d: { on: false, price: '' },
  },
};
const edit = (rows: Partial<MenuSnapshot['rows']>, name = base.name): MenuSnapshot => ({
  name,
  rows: { ...base.rows, ...rows } as MenuSnapshot['rows'],
});

describe('salvamento automático do cardápio', () => {
  it('diz o preço novo e a volta ao preço do item', () => {
    const before = edit({ b: { on: true, price: '25' } });
    const after = edit({ a: { on: true, price: '15,90' } });
    expect(describeMenuChanges(before, after, products)).toEqual([
      'Chopp: R$ 15,90',
      'IPA: volta ao preço do item (R$ 24,90)',
    ]);
  });

  it('agrupa entradas e saídas e conta quando são muitas', () => {
    const after = edit({
      a: { on: false, price: '' },
      c: { on: true, price: '' },
      d: { on: true, price: '' },
    });
    expect(describeMenuChanges(base, after, products)).toEqual([
      'Limonada e Água entraram no cardápio',
      'Chopp saiu do cardápio',
    ]);
    const all = edit({ c: { on: true, price: '' }, d: { on: true, price: '3' } });
    const allOff = edit({
      a: { on: false, price: '' },
      b: { on: false, price: '' },
      c: { on: false, price: '' },
    });
    expect(describeMenuChanges(all, allOff, products)).toEqual(['4 itens saíram do cardápio']);
  });

  it('14,9 e 14,90 são o mesmo preço e nome em branco não grava', () => {
    const before = edit({ a: { on: true, price: '14,9' } });
    const after = edit({ a: { on: true, price: '14,90' } }, '   ');
    expect(itemsChanged(before, after)).toBe(false);
    expect(nameChanged(before, after)).toBe(false);
    expect(nameChanged(base, edit({}, 'Delivery noite'))).toBe(true);
    expect(describeMenuChanges(base, edit({}, 'Delivery noite'), products)).toEqual([
      'Nome do cardápio: Delivery noite',
    ]);
  });

  it('preço ilegível segura a gravação', () => {
    const snap = edit({ a: { on: true, price: '12,,9' }, c: { on: false, price: 'x' } });
    expect(invalidPrices(snap, products).map((p) => p.name)).toEqual(['Chopp']);
  });
});
