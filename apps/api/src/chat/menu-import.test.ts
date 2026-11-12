import { describe, expect, it } from 'vitest';
import { parsePrice, readImport } from './menu-import.service';

describe('importar cardápio: leitura da resposta da IA', () => {
  it('lê o JSON completo, mesmo com texto em volta', () => {
    const r = readImport(
      '```json\n{"categories":[{"name":"Lanches","items":[{"name":"X-Burger","description":null,"price":"24,90"}]}]}\n```',
    );
    expect(r).toEqual({
      partial: false,
      categories: [
        { name: 'Lanches', items: [{ name: 'X-Burger', description: null, price: '24.90' }] },
      ],
    });
  });

  it('cardápio grande cortado no meio: aproveita os itens que vieram inteiros', () => {
    const cut =
      '{"categories":[{"name":"Lanches","items":[{"name":"X-Burger","description":null,"price":"24.90"},' +
      '{"name":"X-Salada","description":"Alface, tom';
    expect(readImport(cut)).toEqual({
      partial: true,
      categories: [
        { name: 'Lanches', items: [{ name: 'X-Burger', description: null, price: '24.90' }] },
      ],
    });

    const cutInSecond =
      '{"categories":[{"name":"Lanches","items":[{"name":"X-Burger","description":null,"price":"24.90"}]},' +
      '{"name":"Bebidas","items":[{"name":"Suco","description":null,"price":"9.00"},{"name":"Ref';
    expect(readImport(cutInSecond).categories.map((c) => [c.name, c.items.length])).toEqual([
      ['Lanches', 1],
      ['Bebidas', 1],
    ]);
  });

  it('resposta sem JSON vira lista vazia', () => {
    expect(readImport('não consegui ler')).toEqual({ categories: [], partial: false });
    expect(readImport('{"categories":[{"name":"A","items":[{"na')).toEqual({
      categories: [],
      partial: false,
    });
  });

  it('preço em reais', () => {
    expect(parsePrice('R$ 1.234,50')).toBe('1234.50');
    expect(parsePrice(24.9)).toBe('24.90');
    expect(parsePrice(null)).toBeNull();
  });
});
