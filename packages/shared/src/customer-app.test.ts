import { describe, expect, it } from 'vitest';
import {
  couponDiscount,
  couponHeadline,
  itemPoints,
  levelOf,
  normalizeCouponCode,
  orderPoints,
  scheduleText,
  storeSchedule,
} from './customer-app';

const HOURS = [
  { day: 1, open: '10:30', close: '15:00' },
  { day: 1, open: '18:00', close: '23:00' },
  { day: 5, open: '18:00', close: '02:00' },
];

describe('horário da loja no app', () => {
  it('aberta: diz até que horas', () => {
    expect(storeSchedule(HOURS, 1, '12:00', true)).toEqual({ closesAt: '15:00', opensAt: null });
    expect(scheduleText(true, storeSchedule(HOURS, 1, '12:00', true))).toBe('Aberta até 15h');
  });
  it('turno que vira a noite conta no dia seguinte', () => {
    expect(storeSchedule(HOURS, 6, '01:00', true).closesAt).toBe('02:00');
  });
  it('fechada: abre hoje, amanhã ou no dia da semana', () => {
    const s = storeSchedule(HOURS, 1, '08:00', false);
    expect(s.opensAt).toEqual({ day: 1, time: '10:30', when: 'today' });
    expect(scheduleText(false, s)).toBe('Fechada. Abre hoje às 10h30');
    expect(storeSchedule(HOURS, 1, '16:00', false).opensAt?.time).toBe('18:00');
    expect(scheduleText(false, storeSchedule(HOURS, 0, '23:00', false))).toBe(
      'Fechada. Abre amanhã às 10h30',
    );
    expect(scheduleText(false, storeSchedule(HOURS, 2, '09:00', false))).toBe(
      'Fechada. Abre sexta às 18h',
    );
  });
  it('sem horário cadastrado', () => {
    expect(scheduleText(false, storeSchedule([], 1, '08:00', false))).toBe('Fechada agora');
    expect(scheduleText(true, storeSchedule([], 1, '08:00', true))).toBe('Aberta agora');
  });
});

describe('níveis', () => {
  const levels = [
    { id: 'b', name: 'Bronze', minPoints: 0, perks: null, color: null },
    { id: 'o', name: 'Ouro', minPoints: 1000, perks: null, color: null },
    { id: 'p', name: 'Prata', minPoints: 300, perks: null, color: null },
  ];
  it('acha o nível atual e quanto falta para o próximo', () => {
    const l = levelOf(levels, 500);
    expect(l.current?.name).toBe('Prata');
    expect(l.next?.name).toBe('Ouro');
    expect(l.missing).toBe(500);
    expect(l.pct).toBe(29);
  });
  it('no último nível a barra fica cheia', () => {
    expect(levelOf(levels, 5000)).toMatchObject({ next: null, missing: 0, pct: 100 });
  });
  it('sem níveis', () => {
    expect(levelOf([], 10)).toMatchObject({ current: null, next: null });
  });
});

describe('pontos por item e do pedido', () => {
  const rule = { mode: 'points' as const, pointsPerReal: '1.00', stampMinOrder: '0' };
  it('item com número fixo ou pelo preço', () => {
    expect(itemPoints(rule, 3990, null)).toBe(39);
    expect(itemPoints(rule, 3990, 180)).toBe(180);
    expect(itemPoints({ mode: 'stamps', pointsPerReal: '1' }, 3990, 10)).toBeNull();
  });
  it('pedido soma os fixos e a regra no resto', () => {
    const lines = [
      { totalCents: 2000, quantity: 2, fixed: 50 },
      { totalCents: 3000, quantity: 1, fixed: null },
    ];
    expect(orderPoints(rule, 5000, lines)).toBe(130);
    // Desconto de R$ 10: só os itens sem número fixo rendem menos.
    expect(orderPoints(rule, 4000, lines)).toBe(120);
    expect(orderPoints(rule, 0, lines)).toBe(0);
  });
});

describe('cupons', () => {
  it('porcentagem com teto e mínimo', () => {
    const c = { kind: 'percent' as const, value: '20', maxDiscount: '15.00', minOrder: '50.00' };
    expect(couponDiscount(c, 4000, 0)).toBe(0);
    expect(couponDiscount(c, 6000, 0)).toBe(1200);
    expect(couponDiscount(c, 10000, 0)).toBe(1500);
  });
  it('valor fixo nunca passa do subtotal', () => {
    const c = { kind: 'fixed' as const, value: '30.00', maxDiscount: null, minOrder: '0' };
    expect(couponDiscount(c, 2000, 500)).toBe(2000);
  });
  it('entrega grátis devolve a taxa', () => {
    const c = { kind: 'free_delivery' as const, value: null, maxDiscount: null, minOrder: '0' };
    expect(couponDiscount(c, 2000, 700)).toBe(700);
  });
  it('frases e código', () => {
    expect(couponHeadline({ kind: 'percent', value: '15' })).toBe('15% de desconto');
    expect(couponHeadline({ kind: 'fixed', value: '10.00' })).toBe('R$ 10 de desconto');
    expect(couponHeadline({ kind: 'free_delivery', value: null })).toBe('Entrega grátis');
    expect(normalizeCouponCode(' bem vindo ')).toBe('BEMVINDO');
    expect(normalizeCouponCode('pão10')).toBe('PAO10');
  });
});
