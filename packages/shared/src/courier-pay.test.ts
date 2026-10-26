import { describe, expect, it } from 'vitest';
import {
  courierTaxes,
  DEFAULT_COURIER_PAY_RULE,
  DEFAULT_COURIER_TAX_SETTINGS,
  deliveryPay,
  describePayRule,
  irrfMonthCents,
  routeDistanceM,
  type CourierPayRule,
} from './index';

const rule = (r: Partial<CourierPayRule>): CourierPayRule => ({
  ...DEFAULT_COURIER_PAY_RULE,
  ...r,
});

describe('deliveryPay', () => {
  it('padrão: toda a taxa de entrega', () => {
    expect(
      deliveryPay(DEFAULT_COURIER_PAY_RULE, { fee: '8.00', distanceM: null, status: 'delivered' }),
    ).toEqual({ amount: '8.00', missingDistance: false });
  });
  it('fixo, por km, fixo + km e mínimo', () => {
    expect(
      deliveryPay(rule({ mode: 'fixed', fixed: '7.00' }), {
        fee: '0',
        distanceM: 4000,
        status: 'delivered',
      }).amount,
    ).toBe('7.00');
    expect(
      deliveryPay(rule({ mode: 'per_km', perKm: '1.50' }), {
        fee: '0',
        distanceM: 4200,
        status: 'delivered',
      }).amount,
    ).toBe('6.30');
    expect(
      deliveryPay(rule({ mode: 'fixed_plus_km', fixed: '6.00', perKm: '1.00', kmIncluded: 3 }), {
        fee: '0',
        distanceM: 5500,
        status: 'delivered',
      }).amount,
    ).toBe('8.50');
    expect(
      deliveryPay(rule({ mode: 'per_km', perKm: '1.00', minPerDelivery: '5.00' }), {
        fee: '0',
        distanceM: 1200,
        status: 'delivered',
      }).amount,
    ).toBe('5.00');
  });
  it('sem distância avisa e não inventa km', () => {
    expect(
      deliveryPay(rule({ mode: 'per_km', perKm: '2.00' }), {
        fee: '0',
        distanceM: null,
        status: 'delivered',
      }),
    ).toEqual({ amount: '0.00', missingDistance: true });
  });
  it('entrega não realizada paga o percentual combinado', () => {
    const r = rule({ mode: 'fixed', fixed: '10.00', failedPercent: 50 });
    expect(deliveryPay(r, { fee: '0', distanceM: null, status: 'failed' }).amount).toBe('5.00');
    expect(
      deliveryPay(rule({ mode: 'fixed', fixed: '10.00' }), {
        fee: '0',
        distanceM: null,
        status: 'failed',
      }).amount,
    ).toBe('0.00');
  });
  it('descreve a regra', () => {
    expect(describePayRule(rule({ mode: 'fixed', fixed: '7.50', dailyRate: '40.00' }))).toBe(
      'R$ 7,50 por entrega · diária de R$ 40,00',
    );
  });
});

describe('routeDistanceM', () => {
  it('linha reta × 1,3', () => {
    const d = routeDistanceM({ lat: -23.55, lng: -46.63 }, { lat: -23.56, lng: -46.63 })!;
    expect(d).toBeGreaterThan(1430);
    expect(d).toBeLessThan(1460);
    expect(routeDistanceM(null, { lat: 0, lng: 0 })).toBeNull();
  });
});

describe('impostos do motoboy', () => {
  it('IRRF 2026: isento até R$ 5.000 e redução até R$ 7.350', () => {
    expect(irrfMonthCents(400_000, 44_000)).toBe(0);
    expect(irrfMonthCents(500_000, 55_000)).toBe(0);
    expect(irrfMonthCents(600_000, 66_000)).toBe(38_002);
    expect(irrfMonthCents(1_000_000, 93_231)).toBe(158_488);
  });
  it('MEI e CLT não têm retenção', () => {
    for (const r of ['mei', 'clt'] as const) {
      const t = courierTaxes(r, '3000.00', DEFAULT_COURIER_TAX_SETTINGS);
      expect(t.net).toBe('3000.00');
      expect(t.withheld).toBe('0.00');
    }
  });
  it('autônomo: INSS 11% com teto, IRRF e patronal', () => {
    const cfg = { ...DEFAULT_COURIER_TAX_SETTINGS, employerRate: 20, issRate: 5 };
    const t = courierTaxes('autonomo', '10000.00', cfg);
    expect(t.inss).toBe('932.31');
    expect(t.irrf).toBe('1584.88');
    expect(t.iss).toBe('500.00');
    expect(t.net).toBe('6982.81');
    expect(t.employer).toBe('2000.00');
    expect(t.cost).toBe('12000.00');
  });
  it('repasses no mesmo mês somam para o teto e a tabela', () => {
    const cfg = DEFAULT_COURIER_TAX_SETTINGS;
    const a = courierTaxes('autonomo', '3000.00', cfg);
    expect(a.inss).toBe('330.00');
    expect(a.irrf).toBe('0.00');
    const b = courierTaxes('autonomo', '3000.00', cfg, {
      gross: '3000.00',
      inss: a.inss,
      irrf: a.irrf,
    });
    expect(b.inss).toBe('330.00');
    expect(b.irrf).toBe('380.02');
  });
});
