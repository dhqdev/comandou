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
    // Sem a capa desde a 0.267.0: só o ícone do Comandou vai embutido.
    expect(r.html).toContain('src="cid:icon-192@comandou"');
    expect(r.html).not.toContain('src="https://comandou.com/icons/icon-192.png"');
    expect(r.attachments.map((a) => a.contentId)).toEqual(['icon-192@comandou']);
    const icon = r.attachments.find((a) => a.filename === 'icon-192.png')!;
    expect(icon.contentType).toBe('image/png');
    expect(icon.data.subarray(0, 4).toString('hex')).toBe('89504e47');
    // A capa antiga (se um HTML ainda trouxer) segue embutida.
    const old = inlineImages('<img src="https://comandou.com/email/hero-codigo.jpg">');
    expect(old.html).toContain('src="cid:hero-codigo@comandou"');
    expect(old.attachments[0]!.data.subarray(0, 2).toString('hex')).toBe('ffd8');
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
