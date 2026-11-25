import { describe, expect, it } from 'vitest';
import { tunePixels, type PhotoAdjust } from './item-ai';

const ZERO: PhotoAdjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
const px = (...rgb: number[]) => new Uint8ClampedArray([...rgb, 255]);

describe('Retoque da foto do item (no navegador)', () => {
  it('sem ajuste (ou com força 0) a foto fica igual', () => {
    const d = px(120, 80, 40);
    tunePixels(d, ZERO);
    expect([...d]).toEqual([120, 80, 40, 255]);
    tunePixels(d, { brightness: 0.3, contrast: 0.3, saturation: 0.4, warmth: 0.3 }, 0);
    expect([...d]).toEqual([120, 80, 40, 255]);
  });

  it('clarear sobe o meio sem estourar o branco nem mexer no preto', () => {
    const d = new Uint8ClampedArray([128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    tunePixels(d, { ...ZERO, brightness: 0.2 });
    expect(d[0]).toBeGreaterThan(140);
    expect(d[4]).toBe(255);
    expect(d[8]).toBe(0);
  });

  it('saturação não colore o cinza; temperatura puxa para o vermelho', () => {
    const gray = px(100, 100, 100);
    tunePixels(gray, { ...ZERO, saturation: 0.4 });
    expect([...gray]).toEqual([100, 100, 100, 255]);
    const warm = px(100, 100, 100);
    tunePixels(warm, { ...ZERO, warmth: 0.2 });
    expect(warm[0]).toBeGreaterThan(100);
    expect(warm[2]).toBeLessThan(100);
    expect(warm[3]).toBe(255);
  });
});
