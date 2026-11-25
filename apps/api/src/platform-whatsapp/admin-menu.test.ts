import { describe, expect, it } from 'vitest';
import {
  ago,
  brasiliaNow,
  bytes,
  clip,
  findingsHeadline,
  findingsText,
  isHome,
  isYes,
  normalizeInput,
  optionOf,
  phoneKey,
  pickList,
} from './admin-menu';

describe('menu do admin pelo WhatsApp (partes puras)', () => {
  it('lê o que a pessoa digitou sem acento, caixa e pontuação', () => {
    expect(normalizeInput('  *Início*! ')).toBe('inicio');
    expect(normalizeInput('SIM.')).toBe('sim');
    expect(isYes(normalizeInput('Sim!'))).toBe(true);
    expect(isYes(normalizeInput('não'))).toBe(false);
    expect(isHome(normalizeInput('Menu'))).toBe(true);
  });

  it('número da opção', () => {
    expect(optionOf('3')).toBe(3);
    expect(optionOf('opcao 12')).toBe(12);
    expect(optionOf('3 pizzas')).toBeNull();
    expect(optionOf('pizza')).toBeNull();
  });

  it('telefone com ou sem 55 e sem o 9 cai na mesma chave', () => {
    expect(phoneKey('5511988887777')).toBe('1188887777');
    expect(phoneKey('551188887777')).toBe('1188887777');
    expect(phoneKey('11988887777')).toBe('1188887777');
    expect(phoneKey('123')).toBeNull();
  });

  it('tempo e tamanho legíveis', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(ago(new Date('2026-11-24T11:55:00Z'), now)).toBe('há 5 min');
    expect(ago(new Date('2026-11-24T09:00:00Z'), now)).toBe('há 3 h');
    expect(ago(new Date('2026-11-27T12:00:00Z'), now)).toBe('em 3 dias');
    expect(ago(null)).toBe('nunca');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('hora de Brasília para o resumo do dia', () => {
    expect(brasiliaNow(new Date('2026-11-24T11:30:00Z'))).toEqual({ hour: 8, day: '2026-11-24' });
    expect(brasiliaNow(new Date('2026-11-25T02:00:00Z'))).toEqual({ hour: 23, day: '2026-11-24' });
  });

  it('varredura mostra os problemas primeiro', () => {
    const list = [
      { level: 'ok' as const, text: 'No ar' },
      { level: 'bad' as const, text: 'Banco falhou' },
      { level: 'warn' as const, text: 'Sem pedidos' },
    ];
    expect(findingsText(list).split('\n')[0]).toBe('🔴 Banco falhou');
    expect(findingsHeadline(list)).toBe('🔴 1 problema · ⚠️ 1 ponto de atenção');
    expect(findingsHeadline([{ level: 'ok', text: 'x' }])).toBe('✅ Tudo certo');
  });

  it('lista numerada e corte de mensagem longa', () => {
    const t = pickList('*Escolha*', [
      { name: 'Pizzaria', slug: 'pizzaria', status: 'provisioned' },
      { name: 'Bar', slug: 'bar', status: 'suspended' },
    ]);
    expect(t).toContain('1. Pizzaria (pizzaria)');
    expect(t).toContain('2. Bar (bar) · suspenso');
    expect(pickList('*Escolha*', [])).toContain('Nenhum restaurante encontrado');
    const long = clip('x'.repeat(5000));
    expect(long.length).toBeLessThanOrEqual(3900);
    expect(long).toContain('lista cortada');
  });
});
