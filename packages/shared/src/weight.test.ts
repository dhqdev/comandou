import { describe, expect, it } from 'vitest';
import { formatGrams, isValidKg, netGrams, parseWeightGrams, qtyLabel, qtyTicket } from './weight';
import { multiplyCents } from './money';

describe('venda por peso', () => {
  it('lê o peso em kg ou gramas', () => {
    expect(parseWeightGrams('0,350')).toBe(350);
    expect(parseWeightGrams('0.35')).toBe(350);
    expect(parseWeightGrams('1,2 kg')).toBe(1200);
    expect(parseWeightGrams('350 g')).toBe(350);
    expect(parseWeightGrams('350g')).toBe(350);
    // Inteiro grande sem unidade é grama; pequeno é kg.
    expect(parseWeightGrams('350')).toBe(350);
    expect(parseWeightGrams('2')).toBe(2000);
    expect(parseWeightGrams('')).toBeNull();
    expect(parseWeightGrams('0')).toBeNull();
    expect(parseWeightGrams('abc')).toBeNull();
    expect(parseWeightGrams('1,2345')).toBeNull();
  });

  it('desconta a tara sem ficar negativo', () => {
    expect(netGrams(370, '0.020')).toBe(350);
    expect(netGrams(10, '0.020')).toBe(0);
    expect(netGrams(500, null)).toBe(500);
  });

  it('mostra a quantidade como unidade ou peso', () => {
    expect(qtyLabel('2.000', 'un')).toBe('2×');
    expect(qtyLabel('2.000')).toBe('2×');
    expect(qtyLabel('0.350', 'kg')).toBe('350 g');
    expect(qtyLabel(1.25, 'kg')).toBe('1,250 kg');
    expect(formatGrams(1000)).toBe('1,000 kg');
    expect(qtyTicket('0.350', 'kg')).toBe('0,350kg');
    expect(qtyTicket('3.000', 'un')).toBe('3x');
  });

  it('valida o peso e calcula o valor', () => {
    expect(isValidKg(0.35)).toBe(true);
    expect(isValidKg(0.3505)).toBe(false);
    expect(isValidKg(0)).toBe(false);
    expect(isValidKg(6, 5)).toBe(false);
    // R$ 69,90 o kg × 350 g = R$ 24,465 → 24,46 (meio centavo arredonda para o par).
    expect(multiplyCents(6990, 0.35)).toBe(2446);
  });
});
