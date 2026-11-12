import { describe, expect, it } from 'vitest';
import { feePercentToBps, platformFeeCents, splitParts } from './online-pay';

describe('taxa da Comandou no pagamento pelo app', () => {
  it('percentual com metade para o par', () => {
    expect(platformFeeCents(10_000, '1', 0)).toBe(100);
    // 1,5% de R$ 0,50 = 0,75 centavo → 1
    expect(platformFeeCents(50, '1.5', 0)).toBe(1);
    // 1% de R$ 0,50 = 0,5 centavo → 0 (par)
    expect(platformFeeCents(50, '1', 0)).toBe(0);
    // 1% de R$ 1,50 = 1,5 centavo → 2 (par)
    expect(platformFeeCents(150, '1', 0)).toBe(2);
  });

  it('soma o fixo e nunca passa de metade do pagamento', () => {
    expect(platformFeeCents(4_590, '0.99', 50)).toBe(95);
    expect(platformFeeCents(100, '10', 500)).toBe(50);
  });

  it('sem total ou sem taxa: zero (sem split)', () => {
    expect(platformFeeCents(0, '1', 10)).toBe(0);
    expect(platformFeeCents(9_990, '0', 0)).toBe(0);
  });

  it('percentual inválido ou acima de 20% é recusado', () => {
    expect(() => feePercentToBps('abc')).toThrow();
    expect(() => feePercentToBps('20.01')).toThrow();
    expect(feePercentToBps('20')).toBe(2000);
    expect(feePercentToBps('0.25')).toBe(25);
  });

  it('as partes somam o total', () => {
    expect(splitParts(4_590, 95)).toEqual({ restaurant: 4_495, platform: 95 });
  });
});
