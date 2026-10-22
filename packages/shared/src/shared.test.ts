import { describe, expect, it } from 'vitest';
import {
  allocateCents,
  fromCents,
  multiplyCents,
  toCents,
  validateTenantSlug,
  roleHas,
  isMoneyString,
} from './index';

describe('allocateCents', () => {
  it('reparte sem perder centavo e proporcionalmente', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(500, [1000, 3000])).toEqual([125, 375]);
    expect(allocateCents(0, [5, 5])).toEqual([0, 0]);
    const r = allocateCents(997, [2590, 4500, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(997);
    expect(r[2]).toBe(0);
  });
  it('recusa entradas inválidas', () => {
    expect(() => allocateCents(10, [0, 0])).toThrow();
    expect(() => allocateCents(-1, [1])).toThrow();
    expect(() => allocateCents(10, [1.5])).toThrow();
  });
});

describe('money', () => {
  it('converte strings decimais em centavos sem ponto flutuante', () => {
    expect(toCents('12.90')).toBe(1290);
    expect(toCents('12.9')).toBe(1290);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('-3')).toBe(-300);
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30');
  });
  it('rejeita formatos inválidos', () => {
    expect(() => toCents('1.999')).toThrow();
    expect(() => toCents('abc')).toThrow();
    expect(isMoneyString('1e3')).toBe(false);
  });
  it('formata centavos', () => {
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-1205)).toBe('-12.05');
  });
  it('multiplica com arredondamento half-even', () => {
    expect(multiplyCents(1000, 3)).toBe(3000);
    expect(multiplyCents(999, 0.5)).toBe(500); // 499.5 -> 500 (par)
    expect(multiplyCents(997, 0.5)).toBe(498); // 498.5 -> 498 (par)
  });
});

describe('tenant slug', () => {
  it('aceita slugs válidos', () => {
    expect(validateTenantSlug('maorefato').ok).toBe(true);
    expect(validateTenantSlug('bar-do-ze-2').ok).toBe(true);
  });
  it('rejeita slugs inválidos ou reservados', () => {
    for (const s of [
      'ab',
      '-abc',
      'abc-',
      'a--b',
      'Maiusculo',
      'com.ponto',
      'api',
      'admin',
      'x'.repeat(41),
    ]) {
      expect(validateTenantSlug(s).ok).toBe(false);
    }
  });
});

describe('roles', () => {
  it('aplica permissões padrão por papel', () => {
    expect(roleHas('owner', 'users:manage')).toBe(true);
    expect(roleHas('waiter', 'cash:close')).toBe(false);
    expect(roleHas('kitchen', 'catalog:write')).toBe(false);
  });
});
