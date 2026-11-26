import { describe, expect, it } from 'vitest';
import { flightPlan, liftedSize } from './fly-to-cart';

const card = { left: 16, top: 300, width: 170, height: 128 }; // foto do cartão no celular
const pill = { left: 40, top: 760, width: 36, height: 36 }; // pílula da sacola embaixo
const topBag = { left: 1300, top: 20, width: 32, height: 32 }; // sacola no alto (notebook)

describe('voo até a sacola', () => {
  it('no celular, descendo, a bolinha sobe antes de cair', () => {
    const p = flightPlan(card, pill);
    expect(p.dy).toBeGreaterThan(0);
    expect(p.hop).toBeGreaterThanOrEqual(28);
    expect(p.hop).toBeLessThanOrEqual(96);
  });

  it('no notebook, subindo, segue a curva sem pulo', () => {
    const p = flightPlan(card, topBag);
    expect(p.dy).toBeLessThan(0);
    expect(p.hop).toBe(0);
    expect(p.spin).toBeGreaterThan(0);
  });

  it('é rápido em qualquer distância (300 a 460 ms)', () => {
    for (const to of [pill, topBag, { ...card, left: card.left + 4 }]) {
      const { duration } = flightPlan(card, to);
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThanOrEqual(460);
    }
  });

  it('chega do tamanho da sacola e a foto grande encolhe ao ser pega', () => {
    const p = flightPlan(card, pill);
    expect(p.landed).toBeLessThanOrEqual(pill.width);
    expect(liftedSize(400)).toBe(104);
    expect(liftedSize(40)).toBe(40);
    expect(p.side).toBe(128);
  });
});
