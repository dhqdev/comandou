import { describe, expect, it } from 'vitest';
import { hitHref, type SearchHit } from './GlobalSearch';
import { STATIC_ENTRIES, filterStatic, fold } from './search-catalog';

const all = () => true;
const titles = (q: string, can: (p?: string[]) => boolean = all) =>
  filterStatic(STATIC_ENTRIES, q, can).map((e) => e.title);

describe('busca de telas e atalhos', () => {
  it('ignora acento e maiúscula', () => {
    expect(fold('Cardápio AÇÃO')).toBe('cardapio acao');
    expect(titles('cardapio')[0]).toBe('Cardápio');
    expect(titles('RELATÓRIOS')[0]).toBe('Relatórios');
  });

  it('acha pelo jeito que a equipe fala', () => {
    expect(titles('sangria')).toContain('Caixa');
    expect(titles('impressora')).toContain('Impressão');
    expect(titles('nfce')).toContain('Nota fiscal');
    expect(titles('modo escuro')).toContain('Alternar tema claro/escuro');
  });

  it('esconde o que o papel não pode ver', () => {
    const waiter = (p?: string[]) =>
      !p || p.some((x) => ['orders:read', 'tables:operate'].includes(x));
    expect(titles('equipe', waiter)).not.toContain('Equipe');
    expect(titles('financeiro', waiter)).not.toContain('Financeiro');
    expect(titles('salao', waiter)).toContain('Salão');
  });

  it('ids únicos', () => {
    const ids = STATIC_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('destino de cada resultado', () => {
  const h = (kind: SearchHit['kind'], ref: string | null = null): SearchHit => ({
    kind,
    id: 'X',
    title: 't',
    detail: null,
    ref,
    amount: null,
    status: null,
    at: null,
  });
  it('abre o item ou destaca na tela certa', () => {
    expect(hitHref(h('order'))).toBe('/pedidos?abrir=X');
    expect(hitHref(h('table', 'T1'))).toBe('/mesas?comanda=T1');
    expect(hitHref(h('table'))).toBe('/mesas?foco=mesa-X');
    expect(hitHref(h('product', 'C1'))).toBe('/cardapio?categoria=C1&foco=produto-X');
    expect(hitHref(h('customer'))).toBe('/clientes?abrir=X');
    expect(hitHref(h('cash_register'))).toBe('/caixa?foco=caixa-X');
  });
});
