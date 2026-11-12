import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackViewport } from './viewport';

type Listener = () => void;

function fakeViewport(height: number, offsetTop: number) {
  const listeners: Listener[] = [];
  const vv = {
    height,
    offsetTop,
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

const root = document.documentElement;
const css = (name: string) => root.style.getPropertyValue(name);

describe('trackViewport', () => {
  afterEach(() => {
    root.className = '';
    root.removeAttribute('style');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('com o teclado do iPhone aberto, guarda o retângulo visível', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    // iPhone: a tela de layout continua com 844px, só 500 aparecem e a parte visível desceu 120
    fakeViewport(500, 120);
    trackViewport();
    expect(css('--cm-vvh')).toBe('500px');
    expect(css('--cm-vvtop')).toBe('120px');
    expect(css('--cm-kb')).toBe('224px');
    expect(root.classList.contains('cm-kb-open')).toBe(true);
  });

  it('zoom de pinça sem campo focado não conta como teclado', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
    fakeViewport(400, 200);
    trackViewport();
    expect(css('--cm-vvtop')).toBe('0px');
    expect(css('--cm-kb')).toBe('0px');
    expect(root.classList.contains('cm-kb-open')).toBe(false);
  });

  it('menu preso embaixo que subiu (Safari do iOS 26) ganha a folga para descer', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    // As peças fixas acabam 200px antes do fim da janela.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 644,
    } as DOMRect);
    fakeViewport(844, 0);
    trackViewport();
    expect(css('--cm-fixgap')).toBe('200px');
  });

  it('com as peças fixas no fim da tela, a folga é 0', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 844,
    } as DOMRect);
    fakeViewport(844, 0);
    trackViewport();
    expect(css('--cm-fixgap')).toBe('0px');
  });
});
