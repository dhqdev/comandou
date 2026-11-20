import { describe, expect, it } from 'vitest';
import { cepForDistrict, type CepAddress } from './cep';

const hit = (cep: string, district: string): CepAddress => ({
  cep,
  street: 'Rua Doutor Herculano Gouvea Neto',
  district,
  city: 'Campinas',
  state: 'SP',
});

describe('CEP pelo bairro', () => {
  it('fica com o CEP do trecho do bairro digitado', () => {
    const hits = [hit('13000001', 'Centro'), hit('13000002', 'Loteamento Parque São Martinho')];
    expect(cepForDistrict(hits, 'Parque São Martinho')?.cep).toBe('13000002');
    expect(cepForDistrict(hits, 'pq s martinho')?.cep).toBe('13000002');
  });

  it('rua com um CEP só vale mesmo com o bairro escrito de outro jeito', () => {
    expect(cepForDistrict([hit('13000003', 'Jardim Nova')], 'Vila Qualquer')?.cep).toBe('13000003');
  });

  it('não escolhe quando o bairro tem mais de um CEP ou não bate com nenhum', () => {
    const hits = [hit('13000001', 'Centro'), hit('13000002', 'Centro')];
    expect(cepForDistrict(hits, 'Centro')).toBeNull();
    expect(cepForDistrict(hits, 'Jardim')).toBeNull();
    expect(cepForDistrict([], 'Centro')).toBeNull();
  });
});
