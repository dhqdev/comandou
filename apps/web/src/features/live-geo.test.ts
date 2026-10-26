import { describe, expect, it } from 'vitest';
import { agoLabel, bearing, distanceM, etaMinutes, kmLabel, signalOf } from './live-geo';

describe('rastreio ao vivo', () => {
  it('mede distância e rumo', () => {
    // Praça da Sé → Av. Paulista (MASP): cerca de 2,6 km.
    const d = distanceM([-23.5503, -46.6339], [-23.5614, -46.6559]);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2700);
    expect(Math.round(bearing([0, 0], [1, 0]))).toBe(0);
    expect(Math.round(bearing([0, 0], [0, 1]))).toBe(90);
  });

  it('prevê a chegada com a velocidade do GPS ou a média da cidade', () => {
    const a: [number, number] = [-23.5503, -46.6339];
    const b: [number, number] = [-23.5614, -46.6559];
    expect(etaMinutes(a, a)).toBe(0);
    const parado = etaMinutes(a, b, 0);
    const rapido = etaMinutes(a, b, 11);
    expect(parado).toBeGreaterThan(rapido);
    expect(rapido).toBeGreaterThanOrEqual(1);
  });

  it('formata distância e tempo desde a última posição', () => {
    expect(kmLabel(430)).toBe('430 m');
    expect(kmLabel(2550)).toBe('2,6 km');
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(agoLabel('2026-10-26T11:59:55Z', now)).toBe('agora');
    expect(agoLabel('2026-10-26T11:59:20Z', now)).toBe('há 40 s');
    expect(agoLabel('2026-10-26T11:57:00Z', now)).toBe('há 3 min');
    expect(signalOf('2026-10-26T11:59:20Z', now)).toBe('live');
    expect(signalOf('2026-10-26T11:57:00Z', now)).toBe('late');
    expect(signalOf('2026-10-26T11:50:00Z', now)).toBe('lost');
    expect(signalOf(null, now)).toBe('none');
  });
});
