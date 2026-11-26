import { describe, expect, it } from 'vitest';
import { inlineImages } from './inline-images';
import { passwordCodeEmail } from './templates/emails';

describe('imagens embutidas no e-mail', () => {
  it('troca a capa e o ícone do site por cid: e anexa cada arquivo uma vez', () => {
    const m = passwordCodeEmail({
      code: '482915',
      minutes: 15,
      place: 'Fumaça Burger',
      assets: 'https://comandou.com',
    });
    const r = inlineImages(m.html);
    expect(r.html).toContain('src="cid:hero-codigo@comandou"');
    expect(r.html).toContain('src="cid:icon-192@comandou"');
    expect(r.html).not.toContain('src="https://comandou.com/email/hero-codigo.jpg"');
    expect(r.attachments.map((a) => a.contentId).sort()).toEqual([
      'hero-codigo@comandou',
      'icon-192@comandou',
    ]);
    const hero = r.attachments.find((a) => a.filename === 'hero-codigo.jpg')!;
    expect(hero.contentType).toBe('image/jpeg');
    expect(hero.data.subarray(0, 2).toString('hex')).toBe('ffd8');
    // Só as imagens trocam: o resto do e-mail fica como estava.
    expect(r.html).toContain('>482915</div>');
  });

  it('sem o arquivo, mantém o link do site; imagem de fora não é tocada', () => {
    const html =
      '<img src="https://comandou.com/email/hero-codigo.jpg"><img src="https://outro.com/x.png">';
    const r = inlineImages(html, '/nao/existe');
    expect(r.html).toBe(html);
    expect(r.attachments).toEqual([]);
  });
});
