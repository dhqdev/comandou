import { describe, expect, it } from 'vitest';
import { defaultOptionIds, groupOptionCharges, menuKindOf, optionsTotalCents } from './menu';

describe('cobrança dos complementos', () => {
  it('soma por padrão', () => {
    expect(groupOptionCharges('sum', [300, 500])).toEqual([300, 500]);
    expect(groupOptionCharges(undefined, [300])).toEqual([300]);
  });
  it('maior valor cobra só a mais cara', () => {
    expect(groupOptionCharges('max', [3990, 4590])).toEqual([0, 4590]);
  });
  it('média divide sem perder centavo e arredonda para cima', () => {
    const r = groupOptionCharges('average', [3990, 4591]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(4291);
    const three = groupOptionCharges('average', [1000, 1000, 1001]);
    expect(three.reduce((a, b) => a + b, 0)).toBe(1001);
  });
  it('total por grupo e opções padrão', () => {
    const groups = [
      {
        id: 'g1',
        charge: 'max' as const,
        maxSelect: 2,
        options: [
          { id: 'a', priceDelta: '39.90', isDefault: true },
          { id: 'b', priceDelta: '45.90' },
        ],
      },
      { id: 'g2', maxSelect: 1, options: [{ id: 'c', priceDelta: '2.00', isDefault: true }] },
    ];
    expect(optionsTotalCents(groups, ['a', 'b', 'c'])).toBe(4790);
    expect(defaultOptionIds(groups)).toEqual(['a', 'c']);
  });
  it('canal → tipo de cardápio', () => {
    expect(menuKindOf('table')).toBe('principal');
    expect(menuKindOf('counter')).toBe('principal');
    expect(menuKindOf('pickup')).toBe('delivery');
  });
});
