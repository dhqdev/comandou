import { describe, expect, it } from 'vitest';
import { publicDraft, readSiteDraft } from './site-ai';

describe('readSiteDraft', () => {
  it('lê loja, frase e itens, e usa a frase quando falta o "sobre"', () => {
    const d = readSiteDraft(
      JSON.stringify({
        store: { name: 'Fumaça', tagline: '  Smash na chapa  ', brandColor: '#E23A00' },
        categories: [{ name: 'Lanches', items: [{ name: 'Smash', price: 'R$ 32,90', image: 0 }] }],
      }),
      ['https://fumaca.com/smash.jpg'],
    );
    expect(d.tagline).toBe('Smash na chapa');
    expect(d.store.about).toBe('Smash na chapa');
    expect(d.store.brandColor).toBe('#e23a00');
    expect(d.categories[0]!.items[0]).toMatchObject({
      price: '32.90',
      imageUrl: 'https://fumaca.com/smash.jpg',
    });
    expect(publicDraft(d).items).toBe(1);
  });

  it('itens sugeridos (lugar sem cardápio) nunca vêm com preço', () => {
    const d = readSiteDraft(
      JSON.stringify({
        store: { name: 'Bar do Zé' },
        suggested: true,
        categories: [{ name: 'Petiscos', items: [{ name: 'Torresmo', price: '25.00' }] }],
      }),
    );
    expect(d.suggested).toBe(true);
    expect(d.categories[0]!.items[0]!.price).toBeNull();
  });

  it('resposta que não é JSON vira rascunho vazio', () => {
    const d = readSiteDraft('desculpe, não consegui');
    expect(d.categories).toEqual([]);
    expect(d.store.name).toBeNull();
  });
});
