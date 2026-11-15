import { describe, expect, it } from 'vitest';
import { arSupport, sceneViewerUrl } from './Model3D';

const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const IPHONE_GOOGLE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/300.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

describe('Ver na sua mesa (câmera do celular)', () => {
  it('escolhe o Quick Look no iPhone, o Scene Viewer no Android e nada no computador', () => {
    expect(arSupport(IPHONE_CHROME, false)).toBe('quick-look');
    expect(arSupport(IPHONE_GOOGLE, false)).toBeNull();
    expect(arSupport(ANDROID, false)).toBe('scene-viewer');
    expect(arSupport(DESKTOP, false)).toBeNull();
  });

  it('monta o link do Scene Viewer com o modelo em tamanho real e volta para o 3D sem câmera', () => {
    const url = sceneViewerUrl(
      '/api/v1/store/models/abc/modelo.glb?v=1',
      'Fumaça (o da casa)',
      'https://fumaca.comandou.com/pedir/produto/abc#x',
    );
    expect(url).toMatch(/^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.0\?/);
    expect(url).toContain(
      `file=${encodeURIComponent('https://fumaca.comandou.com/api/v1/store/models/abc/modelo.glb?v=1')}`,
    );
    expect(url).toContain('mode=ar_preferred');
    expect(url).toContain('resizable=false');
    expect(url).toContain(
      `S.browser_fallback_url=${encodeURIComponent('https://fumaca.comandou.com/pedir/produto/abc#sem-camera-3d')}`,
    );
  });
});
