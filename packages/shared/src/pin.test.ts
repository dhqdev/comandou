import { describe, expect, it } from 'vitest';
import { isPinFormat, isPinLoginFormat, isPinOnlyEmail, isPinRole, isWeakPin } from './pin';

describe('PIN da equipe', () => {
  it('PIN novo tem 6 números; a entrada aceita também o antigo, de 4', () => {
    expect(isPinFormat('048213')).toBe(true);
    expect(isPinFormat('0482')).toBe(false);
    expect(isPinFormat('48a213')).toBe(false);
    expect(isPinFormat('0482131')).toBe(false);
    expect(isPinLoginFormat('0482')).toBe(true);
    expect(isPinLoginFormat('048213')).toBe(true);
    expect(isPinLoginFormat('04821')).toBe(false);
  });
  it('recusa PIN fácil de adivinhar', () => {
    for (const p of ['000000', '777777', '123456', '456789', '987654', '121212', '123123', '0482'])
      expect(isWeakPin(p), p).toBe(true);
    for (const p of ['048213', '135792', '258031', '124390', '907164'])
      expect(isWeakPin(p), p).toBe(false);
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
