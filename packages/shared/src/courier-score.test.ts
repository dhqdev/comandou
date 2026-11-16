import { describe, expect, it } from 'vitest';
import { courierScore, rideTargetMinutes } from './courier-score';

describe('score do entregador', () => {
  it('poucas corridas: ainda sem nota', () => {
    expect(courierScore({ delivered: 4, failed: 0, onTime: 4 })).toEqual({
      score: null,
      level: 'novo',
      completionPct: null,
      onTimePct: null,
    });
  });

  it('tudo entregue e no prazo dá 5; falha e atraso baixam a nota', () => {
    expect(courierScore({ delivered: 20, failed: 0, onTime: 20 })).toMatchObject({
      score: 5,
      level: 'excelente',
      completionPct: 100,
      onTimePct: 100,
    });
    // 18 de 20 entregues (90%) e 9 de 18 no prazo (50%): 5 × (0,54 + 0,20) = 3,7.
    expect(courierScore({ delivered: 18, failed: 2, onTime: 9 })).toMatchObject({
      score: 3.7,
      level: 'bom',
      completionPct: 90,
      onTimePct: 50,
    });
    expect(courierScore({ delivered: 0, failed: 6, onTime: 0 })).toMatchObject({
      score: 0,
      level: 'atencao',
    });
  });

  it('prazo da corrida: piso de 20 minutos e 5 por quilômetro', () => {
    expect(rideTargetMinutes(null)).toBe(20);
    expect(rideTargetMinutes(1500)).toBe(20);
    expect(rideTargetMinutes(4000)).toBe(30);
    expect(rideTargetMinutes(10_000)).toBe(60);
  });
});
