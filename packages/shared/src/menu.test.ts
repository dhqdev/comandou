import { describe, expect, it } from 'vitest';
import {
  adjustPriceCents,
  defaultOptionIds,
  groupOptionCharges,
  menuKindOf,
  optionsTotalCents,
} from './menu';

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
  it('opção padrão sem estoque não vem marcada', () => {
    const groups = [
      {
        maxSelect: 1,
        options: [
          { id: 'a', isDefault: true, stockOut: true },
          { id: 'b', isDefault: true },
        ],
      },
    ];
    expect(defaultOptionIds(groups)).toEqual(['b']);
  });
  it('canal → tipo de cardápio', () => {
    expect(menuKindOf('table')).toBe('principal');
    expect(menuKindOf('counter')).toBe('principal');
    expect(menuKindOf('pickup')).toBe('delivery');
  });
});

describe('reajuste de preços em massa', () => {
  it('aplica o percentual sem arredondar', () => {
    expect(adjustPriceCents(3990, 10, 'none')).toBe(4389);
    expect(adjustPriceCents(3990, -10, 'none')).toBe(3591);
    expect(adjustPriceCents(1000, 15.5, 'none')).toBe(1155);
  });
  it('aumento arredonda para cima no final escolhido', () => {
    expect(adjustPriceCents(3990, 5, 'x90')).toBe(4190); // 41,895
    expect(adjustPriceCents(3990, 1, 'x90')).toBe(4090); // 40,30 -> 40,90
    expect(adjustPriceCents(3990, 10, 'x99')).toBe(4399);
    expect(adjustPriceCents(3990, 10, 'x50')).toBe(4400);
    expect(adjustPriceCents(3990, 10, 'x00')).toBe(4400);
  });
  it('redução arredonda para baixo e nunca zera o preço', () => {
    expect(adjustPriceCents(3990, -10, 'x90')).toBe(3590);
    expect(adjustPriceCents(3990, -10, 'x00')).toBe(3500);
    expect(adjustPriceCents(100, -90, 'x90')).toBe(90);
    expect(adjustPriceCents(100, -90, 'x00')).toBe(100);
  });
  it('só arredondar vai para o final mais próximo', () => {
    expect(adjustPriceCents(4212, 0, 'x90')).toBe(3990 + 100 * 2); // 42,12 -> 41,90
    expect(adjustPriceCents(4260, 0, 'x90')).toBe(4290);
    expect(adjustPriceCents(4224, 0, 'x50')).toBe(4200);
  });
  it('sem preço continua sem preço', () => {
    expect(adjustPriceCents(0, 20, 'x90')).toBe(0);
  });
});
