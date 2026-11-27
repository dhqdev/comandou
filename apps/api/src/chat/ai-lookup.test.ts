import { describe, expect, it } from 'vitest';
import { lookupQueries } from './ai-lookup';

describe('assistente da equipe: o que procurar no cadastro', () => {
  it('tira as palavras de pergunta e fica com o nome do item', () => {
    expect(lookupQueries('Onde fica o X-Salada no cardápio?')).toEqual(['salada']);
    expect(lookupQueries('me leva no insumo queijo mussarela')).toEqual([
      'queijo mussarela',
      'mussarela',
      'queijo',
    ]);
  });

  it('número entra como está (mesa, pedido)', () => {
    expect(lookupQueries('cadê a mesa 12?')).toEqual(['12']);
    expect(lookupQueries('o pedido 345 sumiu')).toEqual(['345']);
  });

  it('pergunta só de palavras comuns não procura nada', () => {
    expect(lookupQueries('como faço para abrir o caixa?')).toEqual([]);
    expect(lookupQueries('oi, tudo bom?')).toEqual([]);
    expect(lookupQueries('')).toEqual([]);
  });

  it('no máximo três buscas, sem repetir', () => {
    const q = lookupQueries('hambúrguer artesanal picanha cheddar bacon cebola caramelizada');
    expect(q.length).toBeLessThanOrEqual(3);
    expect(new Set(q).size).toBe(q.length);
    expect(q[0]).toBe('hamburguer artesanal picanha cheddar');
  });
});
