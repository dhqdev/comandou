import { describe, expect, it } from 'vitest';
import {
  abcClasses,
  buildInsights,
  type InsightProduct,
  type InsightsData,
  menuMatrix,
  presetRange,
  productsCsv,
  projection,
} from './reports-insights';

const prod = (
  id: string,
  quantity: number,
  revenue: number,
  cost: number,
  prev = 0,
): InsightProduct => ({
  productId: id,
  name: `Produto ${id}`,
  category: 'Lanches',
  quantity: String(quantity),
  revenue: revenue.toFixed(2),
  cost: cost.toFixed(2),
  prevQuantity: String(prev),
  prevRevenue: '0.00',
  hasRecipe: true,
});

const base = (over: Partial<InsightsData> = {}): InsightsData => ({
  from: '2026-10-01',
  to: '2026-10-30',
  days: 30,
  today: '2026-10-31',
  channel: null,
  totals: {
    orders: 100,
    cancelled: 0,
    cancelledValue: '0.00',
    revenue: '5000.00',
    discounts: '0.00',
    deliveryFees: '0.00',
    cost: '1500.00',
    customers: 0,
  },
  previous: {
    orders: 80,
    cancelled: 0,
    cancelledValue: '0.00',
    revenue: '4000.00',
    discounts: '0.00',
    deliveryFees: '0.00',
    cost: '1200.00',
    customers: 0,
  },
  daily: [],
  heat: [],
  products: [],
  idle: [],
  channels: [],
  payments: [],
  cancellations: [],
  staff: [],
  customers: { identified: 0, new: 0, repeat: 0, revenue: '0.00', top: [] },
  kitchen: { avg: null, p90: null, items: 0 },
  expenses: { paid: '0.00', count: 0 },
  ...over,
});

describe('presetRange', () => {
  it('monta os atalhos a partir de hoje', () => {
    expect(presetRange('7d', '2026-10-26')).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(presetRange('month', '2026-10-26')).toEqual({ from: '2026-10-01', to: '2026-10-26' });
    expect(presetRange('lastMonth', '2026-03-15')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('abcClasses', () => {
  it('classifica pelo faturamento acumulado', () => {
    const c = abcClasses([
      { productId: 'a', revenue: '700.00' },
      { productId: 'b', revenue: '200.00' },
      { productId: 'c', revenue: '60.00' },
      { productId: 'd', revenue: '40.00' },
    ]);
    expect([c.get('a'), c.get('b'), c.get('c'), c.get('d')]).toEqual(['A', 'A', 'B', 'C']);
  });
});

describe('menuMatrix', () => {
  it('separa estrelas, burros de carga, quebra-cabeças e abacaxis', () => {
    const m = menuMatrix([
      prod('star', 100, 3000, 900), // vende muito, margem 21/un
      prod('horse', 100, 1500, 1200), // vende muito, margem 3/un
      prod('puzzle', 5, 200, 40), // vende pouco, margem 32/un
      prod('dog', 5, 50, 40), // vende pouco, margem 2/un
    ]);
    expect(Object.fromEntries(m)).toEqual({
      star: 'star',
      horse: 'plowhorse',
      puzzle: 'puzzle',
      dog: 'dog',
    });
  });
  it('ignora produto sem ficha técnica', () => {
    const p = { ...prod('x', 10, 100, 0), hasRecipe: false };
    expect(menuMatrix([p, prod('y', 1, 10, 5), prod('z', 1, 10, 5)]).has('x')).toBe(false);
  });
});

describe('buildInsights', () => {
  it('aponta crescimento, CMV alto e cancelamentos', () => {
    const ins = buildInsights(
      base({
        totals: { ...base().totals, cost: '2100.00', cancelled: 8, cancelledValue: '400.00' },
        cancellations: [{ reason: 'Cliente desistiu', count: 5, value: '250.00' }],
      }),
    );
    const ids = ins.map((i) => i.id);
    expect(ids).toContain('revenue');
    expect(ins.find((i) => i.id === 'revenue')!.title).toBe('Faturamento subiu 25%');
    expect(ids).toContain('cmv');
    expect(ins.find((i) => i.id === 'cancel')!.detail).toContain('Cliente desistiu');
    // Ordenado por importância.
    expect(ins[0]!.weight).toBeGreaterThanOrEqual(ins[ins.length - 1]!.weight);
  });
  it('acha o pico e o produto em alta', () => {
    const ins = buildInsights(
      base({
        heat: [
          { dow: 5, hour: 20, orders: 30, revenue: '1500.00' },
          { dow: 2, hour: 12, orders: 3, revenue: '150.00' },
        ],
        products: [prod('a', 40, 1000, 300, 20), prod('b', 10, 200, 60, 10)],
      }),
    );
    expect(ins.find((i) => i.id === 'peak')!.title).toBe('Seu pico: sexta às 20h');
    expect(ins.find((i) => i.id === 'rising')!.title).toBe('Produto a está em alta (+100%)');
  });
  it('sem vendas, só avisa', () => {
    const ins = buildInsights(base({ totals: { ...base().totals, orders: 0, revenue: '0.00' } }));
    expect(ins.map((i) => i.id)).toEqual(['empty']);
  });
});

describe('projection', () => {
  it('projeta o período pelos dias já fechados', () => {
    const d = base({
      from: '2026-10-01',
      to: '2026-10-31',
      days: 31,
      today: '2026-10-11',
      daily: Array.from({ length: 10 }, (_, i) => ({
        day: `2026-10-${String(i + 1).padStart(2, '0')}`,
        orders: 1,
        revenue: '100.00',
        cost: '0',
        deliveryFees: '0',
      })),
    });
    expect(projection(d)).toBe(310_000);
    expect(projection({ ...d, today: '2026-11-02' })).toBeNull();
  });
});

describe('productsCsv', () => {
  it('gera CSV com ponto e vírgula e vírgula decimal', () => {
    const csv = productsCsv([{ ...prod('a', 2, 51.8, 10), name: 'X; especial' }]);
    expect(csv.split('\r\n')[1]).toBe('"X; especial";"Lanches";2;51,80;10,00;41,80;0;A;');
  });

  it('nome que começa com = + - @ não vira fórmula no Excel', () => {
    const csv = productsCsv([{ ...prod('a', 1, 10, 0), name: '=HYPERLINK("http://x")' }]);
    expect(csv.split('\r\n')[1]!.startsWith(`"'=HYPERLINK(""http://x"")";`)).toBe(true);
  });
});
