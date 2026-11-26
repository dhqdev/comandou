import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIRTHDAY_THEMES } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { birthdayArtSvg, contrast, readable } from './birthday-art';
import {
  artFonts,
  encodePng,
  FONTS_DIR,
  logoForArt,
  renderBirthdayArt,
  shrink,
} from './birthday-image';
import { covers, parseFont, textWidth } from './font-metrics';

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const LOGO = join(__dirname, '..', '..', '..', 'web', 'public', 'site', 'food', 'logo.webp');

describe('medidas da fonte', () => {
  const inter = parseFont(readFileSync(join(FONTS_DIR, 'Inter_800ExtraBold.ttf')));

  it('lê a largura das letras e sabe o que a fonte desenha', () => {
    expect(inter.unitsPerEm).toBe(2048);
    expect(inter.advance(0x41)).toBeGreaterThan(0);
    expect(textWidth(inter, 'WWW', 100)).toBeGreaterThan(textWidth(inter, 'iii', 100));
    expect(covers(inter, 'João Conceição')).toBe(true);
    expect(covers(inter, 'Ana 🎂')).toBe(false);
  });
});

describe('arte do parabéns', () => {
  it('cor de texto sempre legível sobre o fundo', () => {
    expect(contrast(readable('#ffd166', '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readable('#e23a00', '#111111'), '#111111')).toBeGreaterThanOrEqual(4.5);
  });

  it('escapa o nome, tira emoji e encolhe nome comprido para caber', async () => {
    const fonts = await artFonts();
    const svg = birthdayArtSvg(
      {
        theme: 'festa',
        name: 'Ana<script>🎉',
        line: 'Hoje é dia & festa',
        restaurant: 'Bar "Zé"',
      },
      fonts,
    );
    expect(svg).toContain('Ana&lt;script&gt;');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('🎉');
    expect(svg).toContain('Hoje é dia &amp; festa');
    expect(svg).toContain('Bar &quot;Zé&quot;');

    const size = (s: string, name: string) =>
      Number(new RegExp(`font-size="([0-9.]+)"[^>]*>${name}<`).exec(s)?.[1]);
    const short = birthdayArtSvg(
      { theme: 'simples', name: 'Zé', line: 'x', restaurant: 'R' },
      fonts,
    );
    const long = birthdayArtSvg(
      { theme: 'simples', name: 'Maximilianaaa', line: 'x', restaurant: 'R' },
      fonts,
    );
    expect(size(short, 'Zé')).toBe(250);
    expect(size(long, 'Maximilianaaa')).toBeLessThan(200);
    const w = textWidth(fonts.bold, 'Maximilianaaa', size(long, 'Maximilianaaa'));
    expect(w).toBeLessThanOrEqual(900);
  });

  it('sem nome usável, vira "Parabéns!"', async () => {
    const svg = birthdayArtSvg(
      { theme: 'bolo', name: '🎂🎂', line: 'x', restaurant: 'R' },
      await artFonts(),
    );
    expect(svg).toContain('>Parabéns!<');
  });

  it('desenha os quatro estilos em PNG 1080 × 1350, com a logo em WebP', async () => {
    const logo = await logoForArt({ type: 'image/webp', bytes: readFileSync(LOGO) });
    expect(logo).toMatch(/^data:image\/png;base64,/);
    for (const theme of BIRTHDAY_THEMES) {
      const png = await renderBirthdayArt({
        theme,
        name: 'Mariana',
        line: 'Hoje o dia é todo seu!',
        restaurant: 'Fumaça Burger',
        brand: '#0c8040',
        logo,
        gift: { title: '+100 pontos', note: 'de presente na sua conta' },
      });
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(pngSize(png)).toEqual({ w: 1080, h: 1350 });
      // O gateway aceita até 10 MB; a arte fica bem abaixo.
      expect(png.length).toBeLessThan(1_500_000);
    }
  });

  it('logo que não abre fica de fora (sem derrubar o parabéns)', async () => {
    expect(await logoForArt({ type: 'image/webp', bytes: Buffer.from('não é webp') })).toBeNull();
    expect(await logoForArt(null)).toBeNull();
  });

  it('reduz e regrava em PNG', () => {
    const px = new Uint8Array(4 * 4 * 4).fill(255);
    const s = shrink(4, 4, px, 2);
    expect([s.width, s.height]).toEqual([2, 2]);
    expect(pngSize(encodePng(s.width, s.height, s.data))).toEqual({ w: 2, h: 2 });
  });
});
