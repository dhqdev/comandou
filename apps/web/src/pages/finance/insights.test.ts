import { describe, expect, it } from 'vitest';
import type { FinanceSummary } from '../../lib/types';
import { avgDailySales, cumulative, flowPoints } from './charts';
import { buildInsights, change, methodTotals, periodProgress, weekdayAverages } from './insights';
import type { ClosingDay } from './types';

const month = (over: Partial<FinanceSummary['month']> = {}): FinanceSummary['month'] => ({
  from: '2026-11-01',
  to: '2026-11-30',
  monthStartDay: 1,
  payableDue: '0',
  paid: '0',
  payableLeft: '0',
  receivableDue: '0',
  received: '0',
  receivableLeft: '0',
  sales: '0',
  refunds: '0',
  fees: '0',
  net: '0',
  ...over,
});
const summary = (
  over: Partial<FinanceSummary> = {},
  m: Partial<FinanceSummary['month']> = {},
): FinanceSummary => ({
  payableOpen: '0',
  payableOverdue: '0',
  payableNext7: '0',
  receivableOpen: '0',
  receivableOverdue: '0',
  receivableNext7: '0',
  month: month(m),
  ...over,
});
const period = { from: '2026-11-01', to: '2026-11-30', year: 2026, month: 11 } as const;

const closing = (day: string, gross: string, extra: Partial<ClosingDay['totals']> = {}) =>
  ({
    day,
    status: 'posted',
    sessions: [],
    methods: [
      {
        method: 'credit',
        gross,
        fee: (Number(gross) * 0.03).toFixed(2),
        net: '0',
        expectedDate: day,
        received: false,
        receivedAmount: '0',
        estimated: false,
      },
      {
        method: 'pix',
        gross,
        fee: '0',
        net: gross,
        expectedDate: day,
        received: true,
        receivedAmount: gross,
        estimated: false,
      },
    ],
    totals: {
      gross: (Number(gross) * 2).toFixed(2),
      fee: '0',
      net: '0',
      orders: 10,
      ticket: '0',
      discounts: '0',
      deliveryFees: '0',
      opening: '0',
      supplies: '0',
      withdrawals: '0',
      cashDifference: '0',
      ...extra,
    },
  }) as ClosingDay;

describe('leituras do mês', () => {
  it('põe conta vencida em primeiro e projeta as vendas do mês corrente', () => {
    const out = buildInsights({
      period: { ...period },
      previousName: 'outubro',
      today: '2026-11-10',
      summary: summary(
        { payableOverdue: '350.00', payableNext7: '1200.00' },
        { sales: '10000.00' },
      ),
      prevSummary: summary({}, { sales: '25000.00' }),
    });
    expect(out[0]!.id).toBe('payable-overdue');
    expect(out[0]!.tone).toBe('bad');
    const pace = out.find((i) => i.id === 'sales-pace')!;
    // 10 dias com R$ 10 mil → R$ 30 mil em 30 dias, 20% acima de outubro.
    expect(pace.title).toContain('30.000,00');
    expect(pace.tone).toBe('good');
    expect(pace.text).toContain('20%');
    expect(out.find((i) => i.id === 'next7')).toBeTruthy();
  });

  it('acha o dia da semana mais forte e a forma de pagamento mais cara', () => {
    // 06/11/2026 é sexta; 09/11 segunda; 10/11 terça.
    const out = buildInsights({
      period: { ...period },
      previousName: 'outubro',
      today: '2026-11-30',
      summary: summary(),
      closings: [
        closing('2026-11-06', '3000.00'),
        closing('2026-11-09', '1000.00'),
        closing('2026-11-10', '1500.00', { cashDifference: '-80.00' }),
      ],
    });
    const wd = out.find((i) => i.id === 'weekday')!;
    expect(wd.title).toBe('Sexta é o seu dia mais forte');
    expect(wd.text).toContain('segunda');
    const fees = out.find((i) => i.id === 'fees')!;
    expect(fees.text).toContain('Crédito');
    expect(out.find((i) => i.id === 'cash-breaks')!.title).toContain('80,00');
  });

  it('soma por forma de pagamento e por dia da semana', () => {
    const days = [closing('2026-11-06', '100.00'), closing('2026-11-13', '300.00')];
    const m = methodTotals(days);
    expect(m.map((x) => x.method)).toEqual(['credit', 'pix']);
    expect(m[0]!.gross).toBe(40000);
    expect(m[0]!.feePct).toBeCloseTo(3);
    expect(weekdayAverages(days)[5]).toEqual({ dow: 5, avg: 40000, days: 2 });
  });

  it('calcula o andamento do período e a variação', () => {
    expect(periodProgress(period, '2026-11-10')).toEqual({ total: 30, elapsed: 10, running: true });
    expect(periodProgress(period, '2026-12-02').running).toBe(false);
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
  });
});

describe('saldo acumulado e previsão', () => {
  const day = (d: string, sales: string, paid = '0', expectedOut = '0') => ({
    day: d,
    sales,
    refunds: '0',
    received: '0',
    paid,
    fees: '0',
    expectedIn: '0',
    expectedOut,
    net: (Number(sales) - Number(paid)).toFixed(2),
  });
  const days = [
    day('2026-11-01', '100.00'),
    day('2026-11-02', '300.00', '50.00'),
    day('2026-11-03', '0', '0', '120.00'),
    day('2026-11-04', '0'),
  ];
  it('acumula até hoje e projeta com a média de vendas e as contas a vencer', () => {
    const perDay = avgDailySales(days, '2026-11-02');
    expect(perDay).toBe(20000);
    const c = cumulative(flowPoints(days, '2026-11-02'), perDay);
    expect(c.real).toEqual([10000, 35000, null, null]);
    // A previsão começa no último dia real e segue: −120 + 200, depois +200.
    expect(c.proj).toEqual([null, 35000, 43000, 63000]);
    expect(c.end).toBe(63000);
  });
  it('sem dias futuros não há previsão', () => {
    const c = cumulative(flowPoints(days, '2026-11-30'));
    expect(c.proj.every((v) => v === null)).toBe(true);
  });
});
