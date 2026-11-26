import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  ageThisYear,
  birthdayLabel,
  birthdayMessage,
  daysUntilBirthday,
  DEFAULT_BIRTHDAY_MESSAGE,
  firstName,
  giftArt,
  giftMessageLine,
  isBirthdayOn,
  isValidBirthday,
  localNow,
} from './birthday';

const day = (year: number, month: number, d: number) => ({ year, month, day: d });

describe('aniversário', () => {
  it('valida dia e mês, com ano opcional', () => {
    expect(isValidBirthday({ day: 31, month: 1 })).toBe(true);
    expect(isValidBirthday({ day: 31, month: 4 })).toBe(false);
    expect(isValidBirthday({ day: 29, month: 2 })).toBe(true);
    expect(isValidBirthday({ day: 29, month: 2, year: 2000 })).toBe(true);
    expect(isValidBirthday({ day: 29, month: 2, year: 2001 })).toBe(false);
    expect(isValidBirthday({ day: 0, month: 5 })).toBe(false);
    expect(isValidBirthday({ day: 10, month: 13 })).toBe(false);
    expect(isValidBirthday({ day: 10, month: 5, year: 1899 })).toBe(false);
    expect(isValidBirthday({ day: 10, month: 5, year: 2031 }, 2026)).toBe(false);
  });

  it('29/02 cai em 28/02 fora do ano bissexto', () => {
    const b = { day: 29, month: 2 };
    expect(isBirthdayOn(b, day(2027, 2, 28))).toBe(true);
    expect(isBirthdayOn(b, day(2028, 2, 28))).toBe(false);
    expect(isBirthdayOn(b, day(2028, 2, 29))).toBe(true);
  });

  it('conta os dias que faltam e a idade', () => {
    const b = { day: 10, month: 3, year: 1990 };
    expect(daysUntilBirthday(b, day(2026, 3, 10))).toBe(0);
    expect(daysUntilBirthday(b, day(2026, 3, 8))).toBe(2);
    expect(daysUntilBirthday(b, day(2026, 3, 11))).toBe(364);
    expect(daysUntilBirthday({ day: 1, month: 1 }, day(2026, 12, 31))).toBe(1);
    expect(ageThisYear(b, day(2026, 1, 1))).toBe(36);
    expect(ageThisYear({ day: 1, month: 1 }, day(2026, 1, 1))).toBeNull();
    expect(birthdayLabel(b)).toBe('10 de março');
    expect(birthdayLabel(b, true)).toBe('10 de março de 1990');
  });

  it('dia e hora no fuso do restaurante', () => {
    // 02:30 em UTC ainda é dia anterior em São Paulo.
    const now = new Date('2026-03-10T02:30:00Z');
    expect(localNow(now, 'America/Sao_Paulo')).toEqual({ year: 2026, month: 3, day: 9, hour: 23 });
    expect(localNow(now, 'UTC')).toEqual({ year: 2026, month: 3, day: 10, hour: 2 });
    expect(addLocalDays(day(2026, 12, 28), 7)).toEqual(day(2027, 1, 4));
  });

  it('primeiro nome com a primeira letra maiúscula', () => {
    expect(firstName('maria eduarda')).toBe('Maria');
    expect(firstName('JOÃO PEDRO')).toBe('João');
    expect(firstName('  McLaren Silva ')).toBe('McLaren');
    expect(firstName('')).toBe('');
  });

  it('presente na mensagem e na arte', () => {
    const today = day(2026, 3, 10);
    expect(giftMessageLine({ kind: 'none' })).toBe('');
    expect(giftMessageLine({ kind: 'points', points: 1500 })).toBe(
      '🎁 Presente nosso: *1.500 pontos* já estão na sua conta de fidelidade.',
    );
    expect(giftMessageLine({ kind: 'points', points: 1, stamps: true })).toBe(
      '🎁 Presente nosso: *1 carimbo* já está no seu cartão fidelidade.',
    );
    expect(
      giftMessageLine({ kind: 'text', text: 'Sobremesa grátis', until: day(2026, 3, 17), today }),
    ).toBe('🎁 Presente nosso: *Sobremesa grátis*. Vale até 17/03.');
    expect(giftMessageLine({ kind: 'text', text: 'Chope grátis', until: today, today })).toContain(
      'Vale só hoje.',
    );
    expect(giftArt({ kind: 'points', points: 1 })).toEqual({
      title: '+1 ponto',
      note: 'de presente na sua conta',
    });
    expect(giftArt({ kind: 'points', points: 2, stamps: true })).toEqual({
      title: '+2 carimbos',
      note: 'de presente no seu cartão',
    });
    expect(giftArt({ kind: 'text', text: 'Chope', until: day(2026, 3, 17), today })).toEqual({
      title: 'Chope',
      note: 'Vale até 17/03',
    });
    expect(giftArt({ kind: 'text', text: '  ' })).toBeNull();
  });

  it('mensagem troca as variáveis e some com a linha do presente vazia', () => {
    const m = birthdayMessage(null, { cliente: 'Ana', restaurante: 'Fumaça', presente: '' });
    expect(m).toContain('Feliz aniversário, Ana!');
    expect(m).toContain('Equipe Fumaça');
    expect(m).not.toMatch(/\{|\n\n\n/);
    const g = birthdayMessage(DEFAULT_BIRTHDAY_MESSAGE, {
      cliente: 'Ana',
      restaurante: 'Fumaça',
      presente: '🎁 Presente',
    });
    expect(g).toContain('\n\n🎁 Presente\n\n');
    expect(
      birthdayMessage('Oi {cliente}, {cliente}! {outra}', {
        cliente: 'Zé',
        restaurante: 'X',
        presente: '',
      }),
    ).toBe('Oi Zé, Zé! {outra}');
  });
});
