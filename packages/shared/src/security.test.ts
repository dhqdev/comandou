import { describe, expect, it } from 'vitest';
import { csvText, weakPasswordReason } from './security';

describe('weakPasswordReason', () => {
  it('recusa senha curta, comum, repetida ou em sequência', () => {
    expect(weakPasswordReason('abc123')).toMatch(/8 caracteres/);
    for (const pw of [
      '12345678',
      '87654321',
      'abcdefgh',
      'aaaaaaaa',
      'abababab',
      'Senha123',
      'SENHA@123',
      'Flamengo1',
      'Restaurante123',
      'comandou123',
      'q1w2e3r4',
      'Cardápio123',
    ])
      expect(weakPasswordReason(pw), pw).toMatch(/fácil de adivinhar/);
  });

  it('recusa o e-mail, o telefone ou o nome como senha', () => {
    expect(weakPasswordReason('joaosilva', ['joaosilva@gmail.com'])).toMatch(/e-mail/);
    expect(weakPasswordReason('11987654321', ['(11) 98765-4321'])).toMatch(/telefone/);
    expect(weakPasswordReason('Pizzaria do Zé', ['pizzaria do zé'])).toMatch(/nome/);
  });

  it('aceita senha razoável', () => {
    for (const pw of ['cavalo-azul-77', 'Tomate&Queijo9', 'minha pizza favorita', '8x!kq2pz'])
      expect(weakPasswordReason(pw, ['ana@ex.com', '11999990000']), pw).toBeNull();
  });

  it('respeita um mínimo maior (painel)', () => {
    expect(weakPasswordReason('cavalo-az', [], 10)).toMatch(/10 caracteres/);
  });
});

describe('csvText', () => {
  it('neutraliza fórmula e escapa aspas', () => {
    expect(csvText('=HYPERLINK("http://x","clique")')).toBe(
      `"'=HYPERLINK(""http://x"",""clique"")"`,
    );
    expect(csvText('+1+1')).toBe(`"'+1+1"`);
    expect(csvText('-2+3')).toBe(`"'-2+3"`);
    expect(csvText('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvText('\tcmd')).toBe(`"'\tcmd"`);
    expect(csvText('X-Burguer; duplo')).toBe(`"X-Burguer; duplo"`);
    expect(csvText(null)).toBe('""');
  });
});
