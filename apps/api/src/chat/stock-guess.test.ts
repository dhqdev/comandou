import { describe, expect, it } from 'vitest';
import { readStockGuess, STOCK_MAX, stockQuestion } from './stock-guess';

describe('estoque sugerido pela IA', () => {
  it('numera os itens com categoria, preço e descrição curta', () => {
    const q = stockQuestion([
      {
        name: 'X-Burger',
        category: 'Lanches',
        price: '28.90',
        description: 'Pão,  carne e queijo',
      },
      { name: 'Coca-Cola lata', category: 'Bebidas', price: null },
    ]);
    expect(q).toContain('0. X-Burger (Lanches) · R$ 28,90 · Pão, carne e queijo');
    expect(q).toContain('1. Coca-Cola lata (Bebidas) · sem preço');
  });

  it('lê a sugestão de cada item, o "não controlar" e o que faltou', () => {
    const raw =
      'Aqui está: {"items":[{"i":0,"qty":30,"min":6},{"i":1,"qty":null,"min":null},{"i":3,"qty":"48","min":"10"}]}';
    expect(readStockGuess(raw, 4)).toEqual([
      { qty: 30, min: 6 },
      null,
      undefined,
      { qty: 48, min: 10 },
    ]);
  });

  it('corrige número estranho: mínimo vazio, maior que a quantidade ou fora da lista', () => {
    const raw = JSON.stringify({
      items: [
        { i: 0, qty: 20 },
        { i: 1, qty: 10, min: 50 },
        { i: 2, qty: 1e9, min: 3 },
        { i: 9, qty: 5, min: 1 },
        { i: 0, qty: 99, min: 9 },
      ],
    });
    expect(readStockGuess(raw, 3)).toEqual([
      { qty: 20, min: 4 },
      { qty: 10, min: 10 },
      { qty: STOCK_MAX, min: 3 },
    ]);
  });

  it('resposta que não é JSON não sugere nada', () => {
    expect(readStockGuess('não sei', 2)).toEqual([undefined, undefined]);
    expect(readStockGuess('{"itens": 3}', 1)).toEqual([undefined]);
  });
});
