import { describe, expect, it } from 'vitest';
import { elapsed } from './format';

describe('elapsed', () => {
  it('mostra minutos, horas e dias de forma curta', () => {
    expect(elapsed(0)).toBe('0 min');
    expect(elapsed(59)).toBe('59 min');
    expect(elapsed(60)).toBe('1 h');
    expect(elapsed(617)).toBe('10 h 17');
    expect(elapsed(8808)).toBe('6 d');
  });
});
