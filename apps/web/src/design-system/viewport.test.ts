import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackViewport } from './viewport';

type Listener = () => void;

function fakeViewport(height: number, offsetTop: number) {
  const listeners: Listener[] = [];
  const vv = {
    height,
    offsetTop,
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    /** O iPhone avisa que a área visível mudou (teclado terminou de subir). */
    fire: () => listeners.forEach((fn) => fn()),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

/** Celular: tela de toque estreita. */
function phone(matches = true) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches }),
  });
}

const root = document.documentElement;
const css = (name: string) => root.style.getPropertyValue(name);

describe('trackViewport', () => {
  afterEach(() => {
    root.className = '';
    root.removeAttribute('style');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    localStorage.clear();
    phone(false);
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

  it('no fim da página (elástico ao passar do fim) a folga não muda e o menu não some', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(3000);
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ bottom: 844 } as DOMRect);
    const vv = fakeViewport(844, 0);
    trackViewport();
    expect(css('--cm-fixgap')).toBe('0px');
    // Passou do fim e está quicando: as medidas mudam, mas o menu fica onde estava.
    Object.defineProperty(window, 'scrollY', { value: 2200, configurable: true });
    rect.mockReturnValue({ bottom: 760 } as DOMRect);
    vv.fire();
    expect(css('--cm-fixgap')).toBe('0px');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
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

  it('no celular, tocar no campo da conversa já encolhe a conversa antes do teclado subir', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(1000);
    phone();
    const vv = fakeViewport(1000, 0);
    trackViewport();
    const panel = document.createElement('div');
    panel.className = 'tc-panel';
    const input = document.createElement('textarea');
    panel.append(input);
    document.body.append(panel);
    input.focus();
    // Primeira vez: 40% da tela para o teclado, sem esperar o iPhone.
    expect(root.classList.contains('cm-kb-open')).toBe(true);
    expect(css('--cm-kb')).toBe('400px');
    expect(css('--cm-vvh')).toBe('600px');
    expect(css('--cm-vvtop')).toBe('0px');
    // O teclado de verdade chegou: vale o tamanho dele e ele fica guardado para a próxima vez.
    vv.height = 640;
    vv.fire();
    expect(css('--cm-kb')).toBe('360px');
    expect(css('--cm-vvh')).toBe('640px');
    expect(localStorage.getItem('cm-kb-h')).toBe('360');
  });

  it('usa o tamanho de teclado guardado e não prevê fora das conversas', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(1000);
    localStorage.setItem('cm-kb-h', '330');
    phone();
    fakeViewport(1000, 0);
    trackViewport();
    const plain = document.createElement('input');
    document.body.append(plain);
    plain.focus();
    expect(root.classList.contains('cm-kb-open')).toBe(false);
    plain.blur();
    const chat = document.createElement('div');
    chat.className = 'sfchat';
    const input = document.createElement('input');
    chat.append(input);
    document.body.append(chat);
    input.focus();
    expect(css('--cm-kb')).toBe('330px');
  });

  it('no computador não prevê teclado', () => {
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(1000);
    phone(false);
    fakeViewport(1000, 0);
    trackViewport();
    const panel = document.createElement('div');
    panel.className = 'tc-panel';
    const input = document.createElement('input');
    panel.append(input);
    document.body.append(panel);
    input.focus();
    expect(root.classList.contains('cm-kb-open')).toBe(false);
  });
});
