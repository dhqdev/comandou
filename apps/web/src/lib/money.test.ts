import { describe, expect, it } from 'vitest';
import { brl, parseBrlInput, parseDecimalInput } from './money';

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
  it('aceita ponto como vírgula quando só pode ser a casa decimal', () => {
    expect(parseBrlInput('12.90')).toBe('12.90');
    expect(parseBrlInput('100.00')).toBe('100.00');
    expect(parseBrlInput('50.5')).toBe('50.5');
    expect(parseBrlInput('0.5')).toBe('0.5');
    expect(parseBrlInput('1.234')).toBe('1234');
    expect(parseBrlInput('1.234,56')).toBe('1234.56');
    expect(parseBrlInput('1.234.567')).toBe('1234567');
    expect(parseBrlInput('12,9')).toBe('12.9');
  });
});

describe('parseDecimalInput (quantidade, custo e fator)', () => {
  it('lê vírgula, ponto de casa decimal e ponto de milhar', () => {
    expect(parseDecimalInput('0,350', 3)).toBe('0.350');
    expect(parseDecimalInput('0.350', 3)).toBe('0.350');
    expect(parseDecimalInput('1.5', 3)).toBe('1.5');
    expect(parseDecimalInput('12.90', 4)).toBe('12.90');
    expect(parseDecimalInput('1.500', 3)).toBe('1500');
    expect(parseDecimalInput('1.234,5678', 4)).toBe('1234.5678');
    expect(parseDecimalInput('12,34567', 4)).toBeNull();
    expect(parseDecimalInput('abc', 3)).toBeNull();
  });
});
