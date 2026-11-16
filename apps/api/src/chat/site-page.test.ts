import { describe, expect, it } from 'vitest';
import { defaultSiteCopy, readSiteCopy, SiteCopy, type SiteFacts } from './site-page';

const facts: SiteFacts = {
  name: 'Top Burger',
  about: null,
  city: 'Campinas',
  state: 'SP',
  acceptsDelivery: true,
  acceptsPickup: true,
  etaMin: 30,
  etaMax: 45,
  categories: [
    { name: 'Lanches', items: ['X-Burger', 'X-Salada'] },
    { name: 'Bebidas', items: ['Refrigerante lata'] },
    { name: 'Vazia', items: [] },
  ],
};

describe('página do restaurante: textos', () => {
  it('texto padrão sem IA usa só o que a loja cadastrou e passa na validação', () => {
    const c = defaultSiteCopy(facts);
    expect(SiteCopy.parse(c)).toEqual(c);
    expect(c.headline).toContain('Top Burger');
    expect(c.tagline).toContain('Campinas, SP');
    expect(c.about).toContain('3 itens');
    expect(c.about).not.toContain('Vazia');
    expect(c.highlights.map((h) => h.title)).toEqual([
      'Cardápio completo',
      'Pedido pelo celular',
      'Entrega acompanhada',
    ]);
    // "Sobre" já escrito pela loja vale mais que o texto montado.
    expect(defaultSiteCopy({ ...facts, about: 'Desde 2010 no bairro.' }).about).toBe(
      'Desde 2010 no bairro.',
    );
    // Loja sem itens e só com retirada: página honesta, sem falar de entrega.
    const bare = defaultSiteCopy({ ...facts, categories: [], acceptsDelivery: false, city: null });
    expect(bare.highlights.map((h) => h.title)).toEqual(['Retire no balcão']);
    expect(bare.about).toBe('Conheça Top Burger e peça pelo cardápio online.');
  });

  it('resposta da IA: aproveita o que veio certo e completa o resto com o padrão', () => {
    const base = defaultSiteCopy(facts);
    const ok = readSiteCopy(
      'Aqui está: {"headline":"Hambúrguer  feito na chapa","tagline":"Do nosso balcão para a sua casa","about":"Lanches montados na hora.","highlights":[{"title":"Na chapa","text":"Carne grelhada na hora."},{"title":""},7],"cta":"Ver o cardápio"}',
      base,
    );
    expect(ok).toEqual({
      headline: 'Hambúrguer feito na chapa',
      tagline: 'Do nosso balcão para a sua casa',
      about: 'Lanches montados na hora.',
      highlights: [{ title: 'Na chapa', text: 'Carne grelhada na hora.' }],
      cta: 'Ver o cardápio',
    });
    expect(readSiteCopy('{"headline":123,"highlights":"x"}', base)).toEqual(base);
    expect(readSiteCopy('não é json', base)).toEqual(base);
    expect(readSiteCopy(`{"headline":"${'a'.repeat(200)}"}`, base).headline).toHaveLength(80);
  });
});
