import { describe, expect, it } from 'vitest';
import { ago, billingProblem, cleanText, sortProblems, whatsappProblem } from './ai-problems';

describe('problemas agora: textos', () => {
  const now = new Date('2026-11-27T12:00:00Z');

  it('diz há quanto tempo', () => {
    expect(ago(new Date('2026-11-27T11:35:00Z'), now)).toBe('há 25 min');
    expect(ago(new Date('2026-11-27T09:00:00Z'), now)).toBe('há 3 h');
    expect(ago(new Date('2026-11-17T12:00:00Z'), now)).toBe('há 10 dias');
  });

  it('texto de fora vira uma linha curta, sem marcação', () => {
    expect(cleanText('Rejeição 778:\n[NCM](x) *inválido*')).toBe('Rejeição 778: NCMx inválido');
    expect(cleanText('a'.repeat(300)).length).toBe(140);
  });

  it('assinatura: bloqueio e atraso são urgentes, teste e contrato pedem atenção', () => {
    expect(billingProblem({ level: 'none' })).toBeNull();
    expect(billingProblem({ level: 'blocked' })).toMatchObject({ level: 'urgente', to: '/plano' });
    expect(billingProblem({ level: 'warning', openInvoices: 1, daysLeft: 2 })?.text).toContain(
      '1 fatura',
    );
    expect(billingProblem({ level: 'info', trial: { daysLeft: 2 } })).toMatchObject({
      level: 'atencao',
    });
    expect(billingProblem({ level: 'info', contractPhase: 'renewal' })?.text).toContain(
      'renovação',
    );
  });

  it('WhatsApp: desconectado é urgente, religando pede atenção', () => {
    expect(whatsappProblem('connected')).toBeNull();
    expect(whatsappProblem(null)).toBeNull();
    expect(whatsappProblem('qr')).toMatchObject({
      level: 'urgente',
      to: '/whatsapp?foco=secao-qr',
    });
    expect(whatsappProblem('connecting', true)).toMatchObject({ level: 'atencao' });
  });

  it('urgente primeiro, na ordem em que vieram', () => {
    const list = sortProblems([
      { level: 'atencao', text: 'a' },
      { level: 'urgente', text: 'b' },
      { level: 'atencao', text: 'c' },
      { level: 'urgente', text: 'd' },
    ]);
    expect(list.map((p) => p.text)).toEqual(['b', 'd', 'a', 'c']);
  });
});
