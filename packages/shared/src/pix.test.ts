import { describe, expect, it } from 'vitest';
import { crc16, formatPixKey, normalizePixKey, pixBrCode, pixText } from './pix';

describe('Pix copia e cola (BR Code estático)', () => {
  it('CRC16/CCITT-FALSE confere com o valor de referência', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('monta o exemplo do manual do Banco Central (sem valor)', () => {
    expect(
      pixBrCode({
        key: '123e4567-e12b-12d1-a456-426655440000',
        name: 'Fulano de Tal',
        city: 'BRASILIA',
      }),
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('leva o valor com ponto e duas casas e tira acento de nome e cidade', () => {
    const code = pixBrCode(
      { key: '+5511988887777', name: 'Lanchonete São João Ltda', city: 'São José dos Campos' },
      '46.9',
    );
    expect(code).toContain('540546.90');
    expect(code).toContain('5924Lanchonete Sao Joao Ltda');
    expect(code).toContain('6015Sao Jose dos Ca');
    expect(code.slice(-4)).toBe(crc16(code.slice(0, -4)));
    // Valor zero = o cliente digita no banco.
    expect(pixBrCode({ key: 'a@b.co', name: 'X', city: 'Y' }, '0.00')).not.toContain('5404');
  });

  it('normaliza e valida as chaves', () => {
    expect(normalizePixKey('cpf', '529.982.247-25')).toBe('52998224725');
    expect(normalizePixKey('cpf', '111.111.111-12')).toBeNull();
    expect(normalizePixKey('cnpj', '11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizePixKey('cnpj', '11.222.333/0001-00')).toBeNull();
    expect(normalizePixKey('phone', '(11) 98888-7777')).toBe('+5511988887777');
    expect(normalizePixKey('phone', '+55 11 98888-7777')).toBe('+5511988887777');
    expect(normalizePixKey('phone', '98888-7777')).toBeNull();
    expect(normalizePixKey('email', ' Caixa@Loja.com.br ')).toBe('caixa@loja.com.br');
    expect(normalizePixKey('email', 'sem-arroba')).toBeNull();
    expect(normalizePixKey('random', '123E4567-E12B-12D1-A456-426655440000')).toBe(
      '123e4567-e12b-12d1-a456-426655440000',
    );
    expect(normalizePixKey('random', '123e4567')).toBeNull();
  });

  it('mostra a chave com pontuação', () => {
    expect(formatPixKey('cpf', '52998224725')).toBe('529.982.247-25');
    expect(formatPixKey('cnpj', '11222333000181')).toBe('11.222.333/0001-81');
    expect(formatPixKey('phone', '+5511988887777')).toBe('(11) 98888-7777');
    expect(formatPixKey('phone', '+551133334444')).toBe('(11) 3333-4444');
  });

  it('texto do recebedor só com letras simples', () => {
    expect(pixText('Café & Cia. — Bar', 25)).toBe('Cafe Cia Bar');
  });
});
