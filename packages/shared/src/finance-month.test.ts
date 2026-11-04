import { describe, expect, it } from 'vitest';
import {
  financeMonth,
  financeMonthName,
  financeMonthRange,
  normalizeMonthStartDay,
} from './finance-month';

describe('mês financeiro', () => {
  it('dia 1 é o mês do calendário', () => {
    expect(financeMonth('2026-11-04', 1)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      year: 2026,
      month: 11,
    });
    expect(financeMonth('2026-02-10', 1).to).toBe('2026-02-28');
  });

  it('começa no dia escolhido e vai até a véspera no mês seguinte', () => {
    expect(financeMonth('2026-11-05', 5)).toMatchObject({ from: '2026-11-05', to: '2026-12-04' });
    expect(financeMonth('2026-12-04', 5)).toMatchObject({ from: '2026-11-05', to: '2026-12-04' });
    // Antes do dia 5 ainda é o mês anterior.
    expect(financeMonth('2026-11-04', 5)).toMatchObject({
      from: '2026-10-05',
      to: '2026-11-04',
      month: 10,
    });
  });

  it('anda para trás e para frente, virando o ano', () => {
    expect(financeMonth('2026-12-20', 5, 1)).toMatchObject({
      from: '2027-01-05',
      to: '2027-02-04',
      year: 2027,
      month: 1,
    });
    expect(financeMonth('2026-01-10', 5, -1)).toMatchObject({
      from: '2025-12-05',
      to: '2026-01-04',
      year: 2025,
    });
    expect(financeMonth('2026-06-15', 10, -12).from).toBe('2025-06-10');
  });

  it('dia maior que o mês começa no último dia dele', () => {
    expect(financeMonth('2026-02-28', 31)).toMatchObject({ from: '2026-02-28', to: '2026-03-30' });
    expect(financeMonth('2026-02-27', 31)).toMatchObject({ from: '2026-01-31', to: '2026-02-27' });
    expect(financeMonth('2028-02-29', 30)).toMatchObject({ from: '2028-02-29', to: '2028-03-29' });
  });

  it('períodos seguidos não pulam nem repetem dias', () => {
    for (const start of [1, 5, 15, 28, 29, 30, 31]) {
      let p = financeMonth('2026-01-15', start);
      for (let i = 0; i < 24; i++) {
        const n = financeMonth(p.from, start, 1);
        const after = new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000).toISOString();
        expect(n.from).toBe(after.slice(0, 10));
        expect(financeMonth(n.to, start).from).toBe(n.from);
        p = n;
      }
    }
  });

  it('nomes e dia inválido', () => {
    expect(financeMonthName({ year: 2026, month: 11 })).toBe('novembro de 2026');
    expect(financeMonthRange({ from: '2026-11-05', to: '2026-12-04' })).toBe('05/11 a 04/12');
    expect(normalizeMonthStartDay(0)).toBe(1);
    expect(normalizeMonthStartDay(32)).toBe(1);
    expect(normalizeMonthStartDay('5')).toBe(5);
    expect(normalizeMonthStartDay(2.5)).toBe(1);
  });
});
