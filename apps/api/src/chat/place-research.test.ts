import { describe, expect, it } from 'vitest';
import { EMPTY_STORE } from './store-import';
import { mergeStores, placeQuestion, readPlace, usableLink } from './place-research';

describe('achar o restaurante na internet', () => {
  it('lê a loja, os links do cardápio e só os itens com preço', () => {
    const raw = JSON.stringify({
      found: true,
      store: {
        name: 'Fumaça Burger',
        whatsapp: '+55 (11) 98888-7777',
        address: 'Av. Paulista, 1000',
        city: 'São Paulo',
        state: 'sp',
        hours: [{ day: 1, open: '18h', close: '23:00' }],
      },
      links: {
        menu: 'https://fumaca.anota.ai/',
        ifood: 'https://www.ifood.com.br/delivery/sao-paulo-sp/fumaca',
        site: 'https://www.google.com/maps/place/Fumaca',
      },
      categories: [
        {
          name: 'Lanches',
          items: [
            { name: 'Smash', price: 'R$ 29,90' },
            { name: 'Chute', price: null },
          ],
        },
      ],
    });
    const p = readPlace(raw, ['https://goomer.app/fumaca', 'https://blog.qualquer.com/post']);
    expect(p.found).toBe(true);
    expect(p.store).toMatchObject({
      name: 'Fumaça Burger',
      whatsapp: '11988887777',
      state: 'SP',
      hours: [{ day: 1, open: '18:00', close: '23:00' }],
    });
    // Link do Maps não serve; página citada de cardápio digital entra no fim.
    expect(p.menuLinks).toEqual([
      'https://fumaca.anota.ai/',
      'https://www.ifood.com.br/delivery/sao-paulo-sp/fumaca',
      'https://goomer.app/fumaca',
    ]);
    expect(p.categories).toEqual([
      { name: 'Lanches', items: [{ name: 'Smash', description: null, price: '29.90' }] },
    ]);
  });

  it('não achou: nada da pesquisa entra', () => {
    const p = readPlace('{"found":false}', ['https://goomer.app/x']);
    expect(p).toMatchObject({ found: false, menuLinks: [], categories: [] });
    expect(readPlace('sem json').found).toBe(false);
  });

  it('só aceita link de página comum', () => {
    expect(usableLink('cardapio.com.br/loja')).toBe('https://cardapio.com.br/loja');
    expect(usableLink('https://maps.app.goo.gl/abc')).toBeNull();
    expect(usableLink('https://www.google.com/search?q=x')).toBeNull();
    expect(usableLink('javascript:alert(1)')).toBeNull();
    expect(usableLink(null)).toBeNull();
  });

  it('o primeiro valor achado fica ao juntar', () => {
    const a = { ...EMPTY_STORE, address: 'Rua A, 1' };
    const b = {
      ...EMPTY_STORE,
      address: 'Rua B, 2',
      whatsapp: '11999990000',
      hours: [{ day: 0, open: '10:00', close: '12:00' }],
    };
    expect(mergeStores(a, b)).toMatchObject({
      address: 'Rua A, 1',
      whatsapp: '11999990000',
      hours: b.hours,
    });
  });

  it('a pergunta leva tudo o que já se sabe', () => {
    const q = placeQuestion({
      name: 'Fumaça Burger',
      address: null,
      city: 'Campinas',
      state: 'SP',
      link: null,
    });
    expect(q).toContain('Nome: Fumaça Burger');
    expect(q).toContain('Cidade: Campinas - SP');
    expect(q).not.toContain('Endereço');
  });
});
