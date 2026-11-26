import { describe, expect, it } from 'vitest';
import { countStart, recipeStock } from './stock-math';

const items = new Map([
  ['pao', { name: 'Pão', unit: 'un', quantity: '3.000', allowNegative: false }],
  ['carne', { name: 'Carne', unit: 'kg', quantity: '0.250', allowNegative: false }],
  ['sal', { name: 'Sal', unit: 'kg', quantity: '0.000', allowNegative: true }],
]);

describe('recipeStock', () => {
  it('limita pelo insumo que acaba primeiro', () => {
    const r = recipeStock(
      [
        { stockItemId: 'pao', quantity: '1.000' },
        { stockItemId: 'carne', quantity: '0.120' },
      ],
      items,
    );
    expect(r.portions).toBe(2);
    expect(r.missing).toEqual([]);
  });

  it('trava quando um insumo não dá para mais uma unidade', () => {
    const r = recipeStock([{ stockItemId: 'carne', quantity: '0.300' }], items);
    expect(r.portions).toBe(0);
    expect(r.missing).toEqual(['Carne']);
    expect(r.lines[0]!.short).toBe(true);
  });

  it('insumo que pode ficar negativo não trava nem limita', () => {
    const r = recipeStock([{ stockItemId: 'sal', quantity: '0.010' }], items);
    expect(r.portions).toBeNull();
    expect(r.missing).toEqual([]);
  });

  it('venda por peso só trava quando o insumo zera', () => {
    const ok = recipeStock([{ stockItemId: 'carne', quantity: '1.000' }], items, true);
    expect(ok.portions).toBeNull();
    expect(ok.missing).toEqual([]);
    const zero = new Map(items).set('carne', { ...items.get('carne')!, quantity: '0.000' });
    expect(recipeStock([{ stockItemId: 'carne', quantity: '1.000' }], zero, true).missing).toEqual([
      'Carne',
    ]);
  });

  it('sem ficha não tem limite', () => {
    expect(recipeStock([], items)).toEqual({ portions: null, missing: [], lines: [] });
  });
});

describe('countStart', () => {
  it('começa no saldo do sistema e nunca abaixo de zero', () => {
    expect(countStart('12.500')).toBe('12.500');
    expect(countStart('0.000')).toBe('0.000');
    expect(countStart('-2.000')).toBe('0');
  });
});
