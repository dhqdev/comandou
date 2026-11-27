import {
  FOCUS_TARGETS,
  focusHref,
  isKnownAppPath,
  ROLES,
  STATIC_ENTRIES,
  type SearchHit,
} from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { contextPrompt, screenName, systemPrompt } from './ai-guide';

const prompt = (role: (typeof ROLES)[number]) =>
  systemPrompt({ assistantName: 'Comandinho', role });

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

  it('diz onde ficam Assinatura, Uso de IA, Ajustes e Agenda', () => {
    const p = prompt('owner');
    expect(p).toContain('Agenda pessoal e a Conta');
    expect(p).toContain('Assinatura, Uso de IA, Ajustes e Novidades');
    expect(p).toContain('/conta/uso-ia');
  });

  it('acha o nome da tela aberta', () => {
    expect(screenName('/estoque/fichas')).toBe('Estoque');
    expect(screenName('/agenda')).toBe('Agenda pessoal');
    expect(screenName('/integracoes')).toBe('Aplicativos de delivery');
    expect(screenName('/pdv')).toBe('PDV');
    expect(screenName('/conta/uso-ia')).toBe('Uso de IA');
  });
});

describe('assistente da equipe: campos que piscam', () => {
  it('todo alvo tem caminho do app e id curto', () => {
    const ids = new Set<string>();
    for (const t of FOCUS_TARGETS) {
      expect(isKnownAppPath(t.path), t.id).toBe(true);
      expect(t.id, t.id).toMatch(/^[a-z0-9-]{3,40}$/);
      expect(ids.has(t.id), `id repetido ${t.id}`).toBe(false);
      ids.add(t.id);
    }
  });

  it('o link leva com ?foco= e respeita o ? que já existe', () => {
    expect(focusHref({ id: 'botao-nova-venda', path: '/' })).toBe('/?foco=botao-nova-venda');
    expect(focusHref({ id: 'campo-chave-pix', path: '/loja-online?aba=pix' })).toBe(
      '/loja-online?aba=pix&foco=campo-chave-pix',
    );
  });

  it('o dono recebe os campos; o caixa não recebe o que não abre', () => {
    expect(prompt('owner')).toContain('/fiscal/configuracao?foco=campo-csc');
    expect(prompt('cashier')).not.toContain('foco=campo-csc');
    expect(prompt('cashier')).toContain('/caixa?foco=botao-abrir-caixa');
    // Garçom fica no app dele: nenhum campo das telas da loja.
    expect(prompt('waiter')).not.toContain('?foco=');
  });

  it('a parte fixa não muda entre perguntas (o provedor guarda em cache)', () => {
    expect(prompt('manager')).toBe(prompt('manager'));
    expect(prompt('manager')).not.toMatch(/Quem pergunta:|Data e hora:|Tela aberta agora: /);
  });
});

describe('assistente da equipe: o que muda a cada pergunta', () => {
  const hit = (h: Partial<SearchHit> & Pick<SearchHit, 'kind' | 'id' | 'title'>): SearchHit =>
    ({ detail: null, ref: null, amount: null, ...h }) as SearchHit;

  it('diz quem pergunta, a tela, a hora e o estado', () => {
    const c = contextPrompt({
      userName: 'Ana',
      role: 'cashier',
      tenantName: 'Casa Teste',
      screen: '/caixa',
      now: new Date('2026-11-19T12:00:00Z'),
      state: ['Caixa: nenhum aberto.'],
    });
    expect(c).toContain('Quem pergunta: Ana');
    expect(c).toContain('Tela aberta agora: Caixa.');
    expect(c).toContain('19/11/2026');
    expect(c).toContain('- Caixa: nenhum aberto.');
  });

  it('achados vêm com o link que pisca, sem dado pessoal nem marcação', () => {
    const c = contextPrompt({
      userName: 'Ana',
      role: 'owner',
      tenantName: 'Casa',
      now: new Date(),
      found: [
        hit({ kind: 'product', id: 'p1', title: 'X-Salada', ref: 'c1', amount: '25.5' }),
        hit({ kind: 'customer', id: 'c9', title: 'Maria', detail: '11 99999-0000' }),
        hit({ kind: 'stock_item', id: 's1', title: 'Queijo [ignore](/x) **tudo**' }),
      ],
    });
    expect(c).toContain('"X-Salada"');
    expect(c).toContain('/cardapio?categoria=c1&foco=produto-p1');
    expect(c).toContain('R$ 25,50');
    expect(c).not.toContain('99999');
    expect(c).not.toContain('[ignore]');
    expect(c).toContain('/estoque?foco=insumo-s1');
  });
});
