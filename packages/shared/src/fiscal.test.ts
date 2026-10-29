import { describe, expect, it } from 'vitest';
import {
  explainFiscalError,
  formatDocument,
  icmsMatchesRegime,
  interstateCfop,
  isValidCnpj,
  isValidCpf,
  suggestedRules,
} from './fiscal';

describe('fiscal', () => {
  it('valida CPF e CNPJ pelos dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('explica recusas conhecidas pelo código e as outras pela mensagem', () => {
    expect(explainFiscalError('778', 'Rejeição: NCM inexistente')).toMatchObject({
      title: 'NCM inexistente',
      fix: 'items',
      code: '778',
    });
    expect(explainFiscalError('999', 'Rejeição: CFOP de operação incompatível')).toMatchObject({
      title: 'CFOP não aceito para esta nota',
      fix: 'rules',
    });
    const other = explainFiscalError(null, 'Algo inesperado');
    expect(other.title).toBe('A SEFAZ recusou a nota');
    expect(other.detail).toContain('Algo inesperado');
  });

  it('CSOSN no Simples e CST no regime normal; CFOP interestadual', () => {
    expect(icmsMatchesRegime('102', 1)).toBe(true);
    expect(icmsMatchesRegime('00', 1)).toBe(false);
    expect(icmsMatchesRegime('00', 3)).toBe(true);
    expect(icmsMatchesRegime('102', null)).toBe(true);
    expect(interstateCfop('5102')).toBe('6102');
    expect(suggestedRules(1).filter((r) => r.isDefault)).toHaveLength(1);
    expect(suggestedRules(3)[0].icmsCst).toBe('00');
  });
});
