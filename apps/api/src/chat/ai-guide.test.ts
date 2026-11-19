import { isKnownAppPath, ROLES, STATIC_ENTRIES } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { screenName, systemPrompt } from './ai-guide';

const prompt = (role: (typeof ROLES)[number]) =>
  systemPrompt({
    assistantName: 'Comandinho',
    userName: 'Ana',
    role,
    tenantName: 'Casa Teste',
    screen: '/financeiro',
    now: new Date('2026-11-19T12:00:00Z'),
  });

/** Todo caminho do app citado no prompt: "(/caixa)", ": /estoque/fichas", "em /estoque/lotes". */
function paths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])(\/[a-zà-ú0-9\-/?=&_.]*)/gim)) {
    const p = m[1]!.replace(/[.,;)]+$/, '');
    if (p.length > 1 || p === '/') out.add(p);
  }
  return [...out];
}

describe('assistente da equipe: mapa das telas', () => {
  it('só cita caminhos que existem no app', () => {
    for (const role of ROLES) {
      const bad = paths(prompt(role)).filter(
        (p) => !isKnownAppPath(p) && !['/pedir', '/caminho'].includes(p),
      );
      expect(bad, `perfil ${role}`).toEqual([]);
    }
  });

  it('conhece todas as telas do menu e da busca', () => {
    const p = prompt('owner');
    for (const e of STATIC_ENTRIES.filter((x) => x.to && !x.external))
      expect(p, e.title).toContain(e.to!.split('?')[0]);
    for (const path of ['/agenda', '/conta', '/integracoes', '/chamados', '/estoque/precificacao'])
      expect(p).toContain(path);
  });

  it('marca sem acesso o que o perfil não abre', () => {
    const cashier = prompt('cashier');
    expect(cashier).toMatch(/Equipe \(\/equipe\) \[sem acesso/);
    expect(cashier).not.toMatch(/Caixa \(\/caixa\) \[sem acesso/);
  });

  it('diz onde ficam Assinatura, Ajustes e Agenda', () => {
    const p = prompt('owner');
    expect(p).toContain('Agenda pessoal e a Conta');
    expect(p).toContain('Assinatura, Ajustes e Novidades');
  });

  it('acha o nome da tela aberta', () => {
    expect(screenName('/estoque/fichas')).toBe('Estoque');
    expect(screenName('/agenda')).toBe('Agenda pessoal');
    expect(screenName('/integracoes')).toBe('Aplicativos de delivery');
    expect(screenName('/pdv')).toBe('PDV');
  });
});
