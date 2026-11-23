import { describe, expect, it } from 'vitest';
import {
  periodDays,
  DEFAULT_STAFF_PAY_RULE,
  describeStaffPay,
  nextDay,
  prorateMonthly,
  staffPay,
  staffRuleEmpty,
  type StaffPayRule,
} from './index';

const rule = (r: Partial<StaffPayRule>): StaffPayRule => ({ ...DEFAULT_STAFF_PAY_RULE, ...r });

describe('pagamento da equipe', () => {
  it('salário proporcional: mês inteiro é o salário inteiro, meio mês é a metade', () => {
    expect(prorateMonthly('1800.00', '2026-11-01', '2026-11-30')).toBe('1800.00');
    expect(prorateMonthly('1800.00', '2026-02-01', '2026-02-28')).toBe('1800.00');
    expect(prorateMonthly('1800.00', '2026-11-01', '2026-11-15')).toBe('900.00');
    // 16 a 31 de outubro (16/31) + novembro inteiro.
    expect(prorateMonthly('3100.00', '2026-10-16', '2026-11-30')).toBe('4700.00');
    expect(prorateMonthly('1800.00', '2026-11-10', '2026-11-09')).toBe('0.00');
    expect(prorateMonthly('0', '2026-11-01', '2026-11-30')).toBe('0.00');
  });

  it('soma salário, diárias, comissão, taxa de serviço e ajuste', () => {
    const b = staffPay(
      rule({ monthly: '1500.00', dailyRate: '50.00', salesPercent: 2, servicePercent: 100 }),
      {
        from: '2026-11-01',
        to: '2026-11-30',
        days: 4,
        sales: '1000.00',
        service: '100.00',
        adjustments: '-30.00',
      },
    );
    expect(b).toEqual({
      salary: '1500.00',
      daily: '200.00',
      commission: '20.00',
      serviceShare: '100.00',
      adjustments: '-30.00',
      gross: '1790.00',
    });
  });

  it('descreve a regra em português e reconhece a regra vazia', () => {
    expect(describeStaffPay(DEFAULT_STAFF_PAY_RULE)).toBe('Sem regra de pagamento');
    expect(staffRuleEmpty(DEFAULT_STAFF_PAY_RULE)).toBe(true);
    expect(describeStaffPay(rule({ dailyRate: '80.00', servicePercent: 100 }))).toBe(
      'Diária de R$ 80,00 + toda a taxa de serviço',
    );
    expect(describeStaffPay(rule({ monthly: '1800.00', salesPercent: 2.5 }))).toBe(
      'Salário de R$ 1.800,00 por mês + 2,5% das vendas',
    );
  });

  it('conta os dias do período', () => {
    expect(periodDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(periodDays('2026-11-05', '2026-11-05')).toBe(1);
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});
