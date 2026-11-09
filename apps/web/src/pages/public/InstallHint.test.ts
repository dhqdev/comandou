import { describe, expect, it } from 'vitest';
import { installKind } from './InstallHint';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const WIN_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const INSTAGRAM = `${IPHONE} Instagram 350.0.0.0`;
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36';

const env = (ua: string, o: Partial<Parameters<typeof installKind>[0]> = {}) => ({
  ua,
  touchPoints: 0,
  standalone: false,
  canPrompt: false,
  ...o,
});

describe('installKind: como cada aparelho instala o cardápio', () => {
  it('iPhone e iPad (mesmo o iPad que se diz Mac) usam a Tela de Início', () => {
    expect(installKind(env(IPHONE, { touchPoints: 5 }))).toBe('ios');
    expect(installKind(env(IPAD_DESKTOP, { touchPoints: 5 }))).toBe('ios');
  });
  it('Safari do Mac: Dock', () => {
    expect(installKind(env(IPAD_DESKTOP))).toBe('mac');
  });
  it('com o pedido do navegador: baixar no celular, área de trabalho no computador', () => {
    expect(installKind(env(ANDROID, { canPrompt: true }))).toBe('phone');
    expect(installKind(env(WIN_CHROME, { canPrompt: true }))).toBe('desktop');
  });
  it('Android sem o pedido: pelo menu; computador sem o pedido: nada', () => {
    expect(installKind(env(ANDROID))).toBe('android');
    expect(installKind(env(WIN_CHROME))).toBeNull();
    expect(installKind(env(WIN_FIREFOX))).toBeNull();
  });
  it('já instalado ou dentro do Instagram/WebView: não aparece', () => {
    expect(installKind(env(IPHONE, { touchPoints: 5, standalone: true }))).toBeNull();
    expect(installKind(env(INSTAGRAM, { touchPoints: 5 }))).toBeNull();
    expect(installKind(env(ANDROID_WEBVIEW, { canPrompt: true }))).toBeNull();
  });
});
