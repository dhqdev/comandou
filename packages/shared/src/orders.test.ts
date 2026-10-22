import { describe, expect, it } from 'vitest';
import { canTransition, paymentStatusFor, splitCents } from './orders';

describe('orders', () => {
  it('aplica a máquina de estados', () => {
    expect(canTransition('new', 'in_production')).toBe(true);
    expect(canTransition('completed', 'new')).toBe(false);
    expect(canTransition('cancelled', 'new')).toBe(false);
    expect(canTransition('ready', 'dispatched', 'delivery')).toBe(true);
    expect(canTransition('ready', 'dispatched', 'table')).toBe(false);
  });
  it('calcula status financeiro', () => {
    expect(paymentStatusFor(1000, 0)).toBe('unpaid');
    expect(paymentStatusFor(1000, 400)).toBe('partial');
    expect(paymentStatusFor(1000, 1000)).toBe('paid');
  });
  it('divide conta sem perder centavos', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitCents(1, 2)).toEqual([1, 0]);
    expect(splitCents(9999, 4).reduce((a, b) => a + b)).toBe(9999);
    expect(() => splitCents(100, 0)).toThrow();
  });
});
