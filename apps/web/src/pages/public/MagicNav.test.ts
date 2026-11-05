import { describe, expect, it } from 'vitest';
import { barPath, NAV, notchReach, sidePad } from './MagicNav';

const arcs = (d: string) => d.match(/A/g)?.length ?? 0;

describe('barPath', () => {
  it('desenha a barra lisa quando nenhuma aba está aberta', () => {
    const d = barPath(360, 100, 0);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(arcs(d)).toBe(4);
  });

  it('abre o recorte centrado na aba, com as bordas arredondadas', () => {
    const d = barPath(360, 100, 1);
    expect(arcs(d)).toBe(7);
    const reach = Math.round(notchReach() * 100) / 100;
    expect(d).toContain(`L${Math.round((100 - reach) * 100) / 100} 0`);
    expect(d).toContain(`${Math.round((100 + reach) * 100) / 100} 0L`);
  });
});

describe('sidePad', () => {
  it('afasta a primeira e a última aba o bastante para o recorte não pegar o canto', () => {
    for (const w of [300, 340, 370, 420, 480]) {
      for (const count of [3, 4, 5]) {
        const pad = sidePad(w, count);
        const firstCenter = pad + (w - 2 * pad) / (2 * count);
        expect(firstCenter).toBeGreaterThanOrEqual(NAV.corner + notchReach() - 0.5);
        expect(pad).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
