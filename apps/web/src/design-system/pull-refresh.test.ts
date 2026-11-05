import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPullToRefresh, rubber } from './pull-refresh';

function touch(type: string, target: Element, y: number, x = 100) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: list });
  target.dispatchEvent(e);
  return e;
}

function scroller(scrollTop: number) {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  el.scrollTop = scrollTop;
  const child = document.createElement('p');
  el.appendChild(child);
  document.body.appendChild(el);
  return { el, child };
}

let off = () => {};
afterEach(() => {
  off();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('puxar para recarregar', () => {
  it('a resistência cresce devagar e nunca passa do teto', () => {
    expect(rubber(0, 100)).toBe(0);
    expect(rubber(50, 100)).toBeLessThan(50);
    expect(rubber(10_000, 100)).toBeLessThan(100);
  });

  it('fora do app instalado não faz nada', () => {
    const onRefresh = vi.fn();
    off = installPullToRefresh({ onRefresh });
    const { child } = scroller(0);
    touch('touchstart', child, 100);
    touch('touchmove', child, 400);
    touch('touchend', child, 400);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('puxou no topo e soltou depois do ponto: recarrega', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    off = installPullToRefresh({ force: true, onRefresh });
    const { child } = scroller(0);
    touch('touchstart', child, 100);
    touch('touchmove', child, 120);
    const move = touch('touchmove', child, 500);
    expect(move.defaultPrevented).toBe(true);
    expect(document.querySelector('.cm-ptr[data-armed]')).not.toBeNull();
    touch('touchend', child, 500);
    vi.advanceTimersByTime(200);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('puxada curta não recarrega', () => {
    const onRefresh = vi.fn();
    off = installPullToRefresh({ force: true, onRefresh });
    const { child } = scroller(0);
    touch('touchstart', child, 100);
    touch('touchmove', child, 120);
    touch('touchmove', child, 150);
    touch('touchend', child, 150);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('no meio da lista não puxa (rolagem normal)', () => {
    const onRefresh = vi.fn();
    off = installPullToRefresh({ force: true, onRefresh });
    const { child } = scroller(300);
    touch('touchstart', child, 100);
    touch('touchmove', child, 120);
    const move = touch('touchmove', child, 500);
    expect(move.defaultPrevented).toBe(false);
    touch('touchend', child, 500);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('no fim estica o conteúdo e volta, sem recarregar', () => {
    const onRefresh = vi.fn();
    off = installPullToRefresh({ force: true, onRefresh });
    const { child } = scroller(1400);
    touch('touchstart', child, 500);
    touch('touchmove', child, 480);
    touch('touchmove', child, 200);
    expect(child.style.transform).toMatch(/translateY\(-/);
    touch('touchend', child, 200);
    expect(child.style.transform).toBe('');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('dentro de uma janela não puxa', () => {
    const onRefresh = vi.fn();
    off = installPullToRefresh({ force: true, onRefresh });
    const { child } = scroller(0);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    child.appendChild(dlg);
    touch('touchstart', dlg, 100);
    touch('touchmove', dlg, 120);
    touch('touchmove', dlg, 500);
    touch('touchend', dlg, 500);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
