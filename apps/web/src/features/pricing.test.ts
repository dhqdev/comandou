import { describe, expect, it } from 'vitest';
import { analyzePrice, markupFactor, roundTo90 } from './pricing';

const params = { taxPercent: 6, feePercent: 4, fixedPercent: 30, targetMargin: 15 };

describe('precificação por markup divisor', () => {
  it('markup = 1 ÷ (1 − soma dos percentuais)', () => {
    expect(markupFactor(params)).toBeCloseTo(1 / 0.45, 6);
    expect(markupFactor({ ...params, fixedPercent: 75 })).toBeNull();
  });

  it('arredonda o sugerido para cima terminando em ,90', () => {
    expect(roundTo90(2342)).toBe(2390);
    expect(roundTo90(2395)).toBe(2490);
    expect(roundTo90(2390)).toBe(2390);
  });

  it('calcula CMV, markup, margens e o preço sugerido', () => {
    // Custo R$ 9,00 → sugerido 9 ÷ 0,45 = R$ 20,00.
    const a = analyzePrice(2000, 900, params);
    expect(a.cmvPercent).toBeCloseTo(45);
    expect(a.markup).toBeCloseTo(2.2222, 3);
    expect(a.contributionCents).toBeCloseTo(2000 - 900 - 200);
    expect(a.netCents).toBeCloseTo(300); // exatamente os 15% de lucro
    expect(a.suggestedCents).toBeCloseTo(2000);
    expect(a.status).toBe('ok');
  });

  it('classifica abaixo do sugerido, prejuízo e sem ficha', () => {
    expect(analyzePrice(1800, 900, params).status).toBe('below');
    expect(analyzePrice(1400, 900, params).status).toBe('loss');
    const none = analyzePrice(2000, null, params);
    expect(none.status).toBe('no-recipe');
    expect(none.suggestedCents).toBeNull();
    expect(none.cmvPercent).toBeNull();
  });
});
