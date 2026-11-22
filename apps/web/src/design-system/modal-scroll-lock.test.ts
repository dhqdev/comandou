import { describe, expect, it } from 'vitest';
import { canScroll } from './modal-scroll-lock';

describe('rolagem presa na janela aberta', () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });
  it('no topo, puxar para baixo não rola (iria para a página)', () => {
    expect(canScroll(box(0), 20)).toBe(false);
    expect(canScroll(box(0), -20)).toBe(true);
  });
  it('no fim, empurrar para cima não rola', () => {
    expect(canScroll(box(600), -20)).toBe(false);
    expect(canScroll(box(600), 20)).toBe(true);
  });
  it('no meio, rola para os dois lados', () => {
    expect(canScroll(box(300), 20)).toBe(true);
    expect(canScroll(box(300), -20)).toBe(true);
  });
});
