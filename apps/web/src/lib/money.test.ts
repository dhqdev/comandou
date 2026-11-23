import { describe, expect, it } from 'vitest';
import { brl, changeToBring, parseBrlInput, parseDecimalInput } from './money';

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

describe('changeToBring', () => {
  it('troco para 400,00 num pedido de 352,40: levar 47,60', () => {
    expect(changeToBring('400.00', '352.40')).toBe('47.60');
  });
  it('sem troco quando não pediu, quando já está pago ou quando a nota não passa do valor', () => {
    expect(changeToBring(null, '352.40')).toBeNull();
    expect(changeToBring('400.00', '0.00')).toBeNull();
    expect(changeToBring('352.40', '352.40')).toBeNull();
    expect(changeToBring('300.00', '352.40')).toBeNull();
  });
  it('pagou uma parte antes: o troco sai do que ainda falta', () => {
    expect(changeToBring('100.00', '52.40')).toBe('47.60');
  });
});
