import { describe, expect, it } from 'vitest';
import { renderPattern } from './sounds';

describe('renderPattern', () => {
  it('gera amostras audíveis e dentro do limite', () => {
    const out = renderPattern([{ at: 0, freq: 880, dur: 0.2 }], 0.7);
    expect(out.length).toBeGreaterThan(8000);
    const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  });
});
