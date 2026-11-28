import { describe, expect, it } from 'vitest';
import { artFonts, encodePng, renderSvgPixels } from '../birthdays/birthday-image';
import { CARD_W, menuCardSvg, wrap } from './wa-menu-card';

/** Foto de mentira (quadrado colorido) em PNG. */
function photo(r: number, g: number, b: number) {
  const px = new Uint8Array(40 * 30 * 4);
  for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 255], i);
  return `data:image/png;base64,${encodePng(40, 30, px).toString('base64')}`;
}

describe('cartão da categoria para o WhatsApp', () => {
  it('monta as fotos com número, nome, preço, selo e esgotado; desenha de verdade', async () => {
    const fonts = await artFonts();
    const items = Array.from({ length: 7 }, (_, k) => ({
      n: k + 1,
      name:
        k === 0 ? 'Gorgonzola e cebola caramelizada na cerveja preta da casa' : `Burger ${k + 1}`,
      price: 'R$ 39,90',
      badge: k === 1 ? 'Vegetariano' : null,
      soldOut: k === 2,
      photo: k === 3 ? null : photo(200, 80 + k * 10, 40),
    }));
    const { svg, height } = menuCardSvg(
      { store: 'Fumaça Burger', category: 'Burgers', color: '#e8590c', logo: null, items, more: 5 },
      fonts,
    );
    expect(svg).toContain('>Burgers<');
    expect(svg).toContain('12 opções'); // 7 no cartão + 5 na legenda
    expect(svg).toContain('>Vegetariano<');
    expect(svg).toContain('>Esgotado<');
    expect(svg).toContain('+ 5 itens na lista da mensagem');
    // Nome comprido quebra em duas linhas com reticências, nunca passa do cartão.
    expect(svg).toMatch(/caramelizada|…/);
    const img = await renderSvgPixels(svg, CARD_W);
    expect(img.width).toBe(CARD_W);
    expect(img.height).toBe(height);
    expect(img.pixels.length).toBe(CARD_W * height * 4);
  });

  it('cor clara da loja: letra escura no topo; texto com < e & escapado', async () => {
    const fonts = await artFonts();
    const { svg } = menuCardSvg(
      {
        store: 'Bar <do> Zé & Cia',
        category: 'Porções',
        color: '#ffe066',
        logo: null,
        items: [
          { n: 1, name: 'Batata & cheddar', price: null, badge: null, soldOut: false, photo: null },
        ],
        more: 0,
      },
      fonts,
    );
    expect(svg).toContain('Bar &lt;do&gt; Zé &amp; Cia');
    expect(svg).toContain('fill="#2b211c"');
    expect(svg).not.toContain('R$');
  });

  it('quebra o nome em até duas linhas pela largura', async () => {
    const { bold } = await artFonts();
    const lines = wrap(bold, 'Hambúrguer artesanal de costela defumada com barbecue', 28, 280, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });
});
