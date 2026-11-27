import { describe, expect, it } from 'vitest';
import {
  isCnpj,
  legalDocument,
  linksIn,
  mergeCompose,
  publicDraft,
  readComposeDraft,
  readSiteDraft,
} from './site-ai';

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

describe('campo único da criação (0.279)', () => {
  it('CNPJ e CPF com os dígitos conferidos', () => {
    expect(isCnpj('11222333000181')).toBe(true);
    expect(isCnpj('11222333000182')).toBe(false);
    expect(legalDocument('11.222.333/0001-81')).toBe('11222333000181');
    expect(legalDocument('529.982.247-25')).toBe('52998224725');
    expect(legalDocument('111.111.111-11')).toBeNull();
    expect(legalDocument(null)).toBeNull();
  });

  it('links do texto (até 3), com e sem http', () => {
    expect(
      linksIn(
        'Somos a Pastelaria, site pastelaria.com.br e https://maps.app.goo.gl/abc123. www.ifood.com.br/x',
      ),
    ).toEqual([
      'https://pastelaria.com.br',
      'https://maps.app.goo.gl/abc123',
      'https://www.ifood.com.br/x',
    ]);
  });

  it('lê a parte nova: CNPJ, razão social, CEP e o tipo do arquivo', () => {
    const raw = JSON.stringify({
      store: {
        name: 'Pastelaria do Zé',
        document: '11.222.333/0001-81',
        legalName: 'Zé Pastéis Ltda',
        cep: '13040-702',
        address: 'Rua A, 10, Centro',
      },
      file: 'logo',
      suggested: true,
      categories: [{ name: 'Pastéis', items: [{ name: 'Carne', price: null }] }],
    });
    const { draft, file } = readComposeDraft(raw);
    expect(file).toBe('logo');
    expect(draft.legal).toEqual({ document: '11222333000181', legalName: 'Zé Pastéis Ltda' });
    expect(draft.store.cep).toBe('13040702');
    // Logo não traz itens (nem sugeridos).
    expect(draft.categories).toEqual([]);
    expect(draft.suggested).toBe(false);
  });

  it('junta as partes: cardápio de verdade tira a sugestão, a loja e a empresa se completam', () => {
    const a = readComposeDraft(
      JSON.stringify({
        store: { name: 'Pastelaria do Zé' },
        suggested: true,
        categories: [{ name: 'Sugestões', items: [{ name: 'Pastel de queijo' }] }],
      }),
    ).draft;
    const b = readComposeDraft(
      JSON.stringify({
        store: { name: 'Outro nome', address: 'Rua A, 10', document: '11222333000181' },
        file: 'menu',
        categories: [{ name: 'Pastéis', items: [{ name: 'Carne', price: '12.00' }] }],
      }),
    ).draft;
    const m = mergeCompose({ ...a, parts: 1 }, { ...b, parts: 1, files: ['menu'] });
    expect(m.store.name).toBe('Pastelaria do Zé');
    expect(m.store.address).toBe('Rua A, 10');
    expect(m.suggested).toBe(false);
    expect(m.categories.map((c) => c.name)).toEqual(['Pastéis']);
    expect(m.legal?.document).toBe('11222333000181');
    expect(m.parts).toBe(2);
    expect(m.files).toEqual(['menu']);
  });
});
