import { describe, expect, it } from 'vitest';
import { surchargeAfterItems } from './orders.service';

describe('acréscimo depois de mudar os itens', () => {
  const base = { channel: 'dine_in', oldBaseCents: 10_000, newBaseCents: 6_000, feePercent: '10.00' };

  it('taxa automática acompanha os itens', () => {
    expect(surchargeAfterItems({ ...base, surchargeCents: 1_000 })).toBe(600);
  });

  it('acréscimo zerado ou mudado à mão fica como está', () => {
    expect(surchargeAfterItems({ ...base, surchargeCents: 0 })).toBe(0);
    expect(surchargeAfterItems({ ...base, surchargeCents: 500 })).toBe(500);
  });

  it('retirada não tem taxa', () => {
    expect(surchargeAfterItems({ ...base, channel: 'pickup', surchargeCents: 1_000 })).toBe(0);
  });

  it('sem taxa na comanda, mantém o acréscimo', () => {
    expect(surchargeAfterItems({ ...base, feePercent: null, surchargeCents: 300 })).toBe(300);
  });
});
