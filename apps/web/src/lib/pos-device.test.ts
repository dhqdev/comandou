import { afterEach, describe, expect, it } from 'vitest';
import {
  looksLikePos,
  paperCss,
  paperWidth,
  posActive,
  setPaperWidth,
  setPosMode,
} from './pos-device';

const SUNMI =
  'Mozilla/5.0 (Linux; Android 11; SUNMI P2 Build/RKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('maquininha (pos-device)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('cm-pos');
  });

  it('reconhece Smart POS Android e não confunde com celular comum', () => {
    expect(looksLikePos(SUNMI)).toBe(true);
    expect(looksLikePos('Mozilla/5.0 (Linux; Android 10; A920 Build/QKQ1) Chrome/99')).toBe(true);
    expect(looksLikePos('Mozilla/5.0 (Linux; Android 7.1; GPOS700) Chrome/80')).toBe(true);
    expect(looksLikePos(PIXEL)).toBe(false);
    expect(looksLikePos(IPHONE)).toBe(false);
  });

  it('modo manual liga a classe e muda a bobina padrão para 58 mm', () => {
    expect(posActive()).toBe(false);
    expect(paperWidth()).toBe('80');
    setPosMode('on');
    expect(document.documentElement.classList.contains('cm-pos')).toBe(true);
    expect(paperWidth()).toBe('58');
    setPaperWidth('80');
    expect(paperWidth()).toBe('80');
    setPosMode('off');
    expect(document.documentElement.classList.contains('cm-pos')).toBe(false);
  });

  it('42 colunas cabem na largura útil da bobina de 58 mm', () => {
    const css = paperCss('58');
    expect(css.page).toContain('size:58mm');
    expect(css.font).toBe('calc(48mm / 42 / 0.6)');
    expect(paperCss('80').page).toContain('size:80mm');
  });
});
