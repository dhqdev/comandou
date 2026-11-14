import { describe, expect, it } from 'vitest';
import { isPinFormat, isPinOnlyEmail, isPinRole, isWeakPin } from './pin';

describe('PIN da equipe', () => {
  it('aceita só 4 números', () => {
    expect(isPinFormat('0482')).toBe(true);
    expect(isPinFormat('482')).toBe(false);
    expect(isPinFormat('48a2')).toBe(false);
    expect(isPinFormat('04821')).toBe(false);
  });
  it('recusa PIN fácil de adivinhar', () => {
    for (const p of ['0000', '7777', '1234', '6789', '9876', '3210', '1212', '0909'])
      expect(isWeakPin(p), p).toBe(true);
    for (const p of ['0482', '1357', '2580', '1243', '9071']) expect(isWeakPin(p), p).toBe(false);
  });
  it('só garçom e entregador entram com PIN', () => {
    expect(isPinRole('waiter')).toBe(true);
    expect(isPinRole('driver')).toBe(true);
    expect(isPinRole('owner')).toBe(false);
    expect(isPinRole('kitchen')).toBe(false);
  });
  it('reconhece a conta criada só com PIN', () => {
    expect(isPinOnlyEmail('x1@pin.comandou.invalid')).toBe(true);
    expect(isPinOnlyEmail('ana@restaurante.com')).toBe(false);
    expect(isPinOnlyEmail(null)).toBe(false);
  });
});
