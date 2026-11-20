import { describe, expect, it } from 'vitest';
import { districtWords, sameDistrict, zoneNamesDistrict } from './district';

describe('nomes de bairro', () => {
  it('ignora acento, pontuação, abreviação e "Loteamento"', () => {
    expect(districtWords('Loteamento Parque São Martinho')).toEqual(['parque', 'sao', 'martinho']);
    expect(districtWords('Pq. S. Martinho')).toEqual(['parque', 'sao', 'martinho']);
    expect(districtWords('Jd. das Flores')).toEqual(['jardim', 'flores']);
  });

  it('área com o nome do bairro acha o bairro digitado', () => {
    expect(zoneNamesDistrict('Parque São Martinho', 'Loteamento Parque São Martinho')).toBe(true);
    expect(zoneNamesDistrict('São Martinho', 'Lot. Pq. São Martinho')).toBe(true);
    expect(zoneNamesDistrict('Centro, Vila Nova', 'Vila Nova')).toBe(true);
    expect(zoneNamesDistrict('Centro / Jardim América', 'jardim america')).toBe(true);
  });

  it('uma palavra só não acha bairro maior', () => {
    expect(zoneNamesDistrict('Centro', 'Jardim Centro Oeste')).toBe(false);
    expect(zoneNamesDistrict('Centro', 'Centro')).toBe(true);
    expect(zoneNamesDistrict('Parque São Martinho', 'Parque São Jorge')).toBe(false);
    expect(zoneNamesDistrict('Parque São Martinho', '')).toBe(false);
  });

  it('mesmo bairro nos dois sentidos', () => {
    expect(sameDistrict('Parque São Martinho', 'Loteamento Parque São Martinho')).toBe(true);
    expect(sameDistrict('Loteamento Parque São Martinho', 'Parque São Martinho')).toBe(true);
    expect(sameDistrict('Vila Nova', 'Jardim Nova Vila')).toBe(false);
  });
});
