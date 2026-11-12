import { describe, expect, it } from 'vitest';
import { linkPreviewHtml, oneLine, previewPath, PRODUCT_PATH_RE } from './link-preview';

describe('prévia do link do cardápio', () => {
  it('aceita só caminhos do cardápio', () => {
    expect(previewPath('/pedir')).toBe('/pedir');
    expect(previewPath('/pedir/produto/abc-1')).toBe('/pedir/produto/abc-1');
    expect(previewPath('/admin')).toBe('/pedir');
    expect(previewPath('//evil.com/pedir')).toBe('/pedir');
    expect(previewPath('/pedir/"><script>')).toBe('/pedir');
    expect(previewPath(['/pedir'])).toBe('/pedir');
    expect(previewPath(undefined)).toBe('/pedir');
  });

  it('reconhece o link de um produto', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(PRODUCT_PATH_RE.exec(`/pedir/produto/${id}`)?.[1]).toBe(id);
    expect(PRODUCT_PATH_RE.exec('/pedir/produto/1')).toBeNull();
  });

  it('resume o texto em uma linha', () => {
    expect(oneLine('  Pães \n e   cafés  ')).toBe('Pães e cafés');
    expect(oneLine('a'.repeat(300), 10)).toHaveLength(10);
    expect(oneLine(null)).toBe('');
  });

  it('leva nome, texto e logo da loja, sem nada do Comandou', () => {
    const html = linkPreviewHtml({
      title: 'Aurora Café & Padaria',
      description: 'Pães "artesanais" <todo dia>',
      image: 'https://aurora.comandou.com/api/v1/media/x',
      imageType: 'image/webp',
      target: '/pedir',
      siteName: 'Aurora Café & Padaria',
    });
    expect(html).toContain('<title>Aurora Café &amp; Padaria</title>');
    expect(html).toContain('property="og:title" content="Aurora Café &amp; Padaria"');
    expect(html).toContain('content="Pães &quot;artesanais&quot; &lt;todo dia&gt;"');
    expect(html).toContain(
      'property="og:image" content="https://aurora.comandou.com/api/v1/media/x"',
    );
    expect(html).toContain('<link rel="icon" href="https://aurora.comandou.com/api/v1/media/x"');
    expect(html).toContain('location.replace("/pedir")');
    expect(html).not.toMatch(/comandou —|panda|favicon\.svg/i);
  });

  it('sem foto, não inventa imagem', () => {
    const html = linkPreviewHtml({
      title: 'Loja',
      description: 'Texto',
      image: null,
      imageType: null,
      target: '/pedir',
      siteName: 'Loja',
    });
    expect(html).not.toContain('og:image');
  });
});
