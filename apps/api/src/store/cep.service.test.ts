import { describe, expect, it } from 'vitest';
import { fromBrasilApi, fromViaCep, isUf } from './cep.service';

describe('CEP', () => {
  it('lê a resposta da ViaCEP', () => {
    expect(
      fromViaCep({
        cep: '01001-000',
        logradouro: 'Praça da Sé',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'sp',
      }),
    ).toEqual({
      cep: '01001000',
      street: 'Praça da Sé',
      district: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    });
  });
  it('CEP inexistente (erro) e resposta inválida viram null', () => {
    expect(fromViaCep({ erro: 'true' })).toBeNull();
    expect(fromViaCep({ cep: '123' })).toBeNull();
  });
  it('lê a resposta da BrasilAPI', () => {
    expect(
      fromBrasilApi({
        cep: '01001000',
        street: 'Praça da Sé',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      })?.district,
    ).toBe('Sé');
  });
  it('valida a UF', () => {
    expect(isUf('sp')).toBe(true);
    expect(isUf('XX')).toBe(false);
  });
});
