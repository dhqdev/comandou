import { describe, expect, it } from 'vitest';
import { brl, parseBrlInput } from './money';

describe('money (web)', () => {
  it('formata em BRL', () => {
    expect(brl('1234.5').replace(/\s/g, ' ')).toBe('R$ 1.234,50');
  });
  it('interpreta entrada brasileira', () => {
    expect(parseBrlInput('12,90')).toBe('12.90');
    expect(parseBrlInput('R$ 1.234,5')).toBe('1234.5');
    expect(parseBrlInput('12,999')).toBeNull();
    expect(parseBrlInput('abc')).toBeNull();
  });
});
