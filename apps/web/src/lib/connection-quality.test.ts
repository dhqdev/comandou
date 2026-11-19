import { describe, expect, it } from 'vitest';
import { levelOf } from './connection-quality';

describe('levelOf', () => {
  it('sem medição = sem sinal', () => {
    expect(levelOf([])).toEqual({ level: 0, rtt: null });
  });

  it('barrinhas pela mediana das três últimas medições', () => {
    expect(levelOf([900, 60, 80, 120])).toEqual({ level: 4, rtt: 80 });
    expect(levelOf([200, 300, 100])).toEqual({ level: 3, rtt: 200 });
    expect(levelOf([500, 700, 900])).toEqual({ level: 2, rtt: 700 });
    expect(levelOf([1200, 1500, 2000])).toEqual({ level: 1, rtt: 1500 });
  });

  it('uma sem resposta pesa, duas seguidas derrubam para ruim', () => {
    expect(levelOf([80, null, 90])).toEqual({ level: 4, rtt: 90 });
    expect(levelOf([80, null, null])).toEqual({ level: 1, rtt: null });
    expect(levelOf([null])).toEqual({ level: 1, rtt: null });
  });
});
