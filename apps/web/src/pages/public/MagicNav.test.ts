import { describe, expect, it } from 'vitest';
import { barPath, ITEMS_MAX, NAV, notchReach, sidePad } from './MagicNav';

const arcs = (d: string) => d.match(/A/g)?.length ?? 0;

describe('barPath', () => {
  it('desenha a barra lisa quando nenhuma aba está aberta', () => {
    const d = barPath(360, 100, 0);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Só os cantos de cima são redondos: embaixo a barra encosta na tela.
    expect(arcs(d)).toBe(2);
  });

  it('desce reta além da barra para cobrir o risco do iPhone até a borda da tela', () => {
    const bottom = NAV.h + NAV.skirt;
    expect(barPath(360, 100, 1)).toContain(`L360 ${bottom}L0 ${bottom}Z`);
  });

  it('abre o recorte centrado na aba, com as bordas arredondadas', () => {
    const d = barPath(360, 100, 1);
    expect(arcs(d)).toBe(5);
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

  it('centraliza as abas no celular deitado (a barra continua de ponta a ponta)', () => {
    const pad = sidePad(690, 5);
    expect(690 - 2 * pad).toBeLessThanOrEqual(ITEMS_MAX);
    expect(pad).toBe((690 - ITEMS_MAX) / 2);
  });
});
