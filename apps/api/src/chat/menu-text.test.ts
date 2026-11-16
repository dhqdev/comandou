import { describe, expect, it } from 'vitest';
import { parseMenuText } from './menu-text';

describe('cardápio escrito, lido sem IA', () => {
  it('um item por linha, com o preço no fim', () => {
    expect(parseMenuText('Lasanha 42\nNhoque - R$ 38,5\nRefrigerante lata: 7\nCoxinha')).toEqual([
      {
        name: 'Cardápio',
        items: [
          { name: 'Lasanha', description: null, price: '42.00' },
          { name: 'Nhoque', description: null, price: '38.50' },
          { name: 'Refrigerante lata', description: null, price: '7.00' },
          { name: 'Coxinha', description: null, price: null },
        ],
      },
    ]);
  });

  it('separa categorias e descrições', () => {
    const r = parseMenuText(
      'Lanches\n- X-Burger - pão, carne e queijo 28,90\n• X-Salada 32\n\nBEBIDAS\nSuco (500 ml) 12\nPizzas:\n1. Calabresa 55.9',
    );
    expect(r.map((c) => c.name)).toEqual(['Lanches', 'BEBIDAS', 'Pizzas']);
    expect(r[0]!.items).toEqual([
      { name: 'X-Burger', description: 'pão, carne e queijo', price: '28.90' },
      { name: 'X-Salada', description: null, price: '32.00' },
    ]);
    expect(r[1]!.items[0]).toEqual({ name: 'Suco', description: '500 ml', price: '12.00' });
    expect(r[2]!.items[0]).toEqual({ name: 'Calabresa', description: null, price: '55.90' });
  });

  it('aceita ponto e vírgula numa linha só e ignora o que não é item', () => {
    expect(parseMenuText('X-Burger 28.90; Refri 7').flatMap((c) => c.items)).toEqual([
      { name: 'X-Burger', description: null, price: '28.90' },
      { name: 'Refri', description: null, price: '7.00' },
    ]);
    expect(parseMenuText('\n\n a \n')).toEqual([]);
  });
});
