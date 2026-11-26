import { daysUntilBirthday, isValidBirthday, type BirthdayDate } from '@comandou/shared';

/**
 * Campos do aniversário (ficha do cliente e Conta do cardápio): dia e mês, ano opcional. Os três
 * vazios apagam a data.
 */
export interface BirthdayForm {
  day: string;
  month: string;
  year: string;
}

type WithBirthday = {
  birthDay?: number | null;
  birthMonth?: number | null;
  birthYear?: number | null;
};

export const birthdayForm = (c: WithBirthday | null | undefined): BirthdayForm => ({
  day: c?.birthDay ? String(c.birthDay) : '',
  month: c?.birthMonth ? String(c.birthMonth) : '',
  year: c?.birthYear ? String(c.birthYear) : '',
});

/** Lê os campos: a data pronta para a API (null = sem aniversário) ou o que corrigir. */
export function readBirthday(f: BirthdayForm): {
  value: BirthdayDate | null;
  error: string | null;
} {
  const day = f.day.trim();
  const month = f.month.trim();
  const year = f.year.trim();
  if (!day && !month && !year) return { value: null, error: null };
  if (!day || !month) return { value: null, error: 'Escolha o dia e o mês' };
  if (year && !/^[0-9]{4}$/.test(year)) return { value: null, error: 'O ano tem 4 números' };
  const value = { day: Number(day), month: Number(month), year: year ? Number(year) : null };
  if (!isValidBirthday(value))
    return {
      value: null,
      error:
        year && Number(year) > new Date().getFullYear() ? 'Ano no futuro' : 'Essa data não existe',
    };
  return { value, error: null };
}

/** Mesmo aniversário (para saber se mudou). */
export const sameBirthday = (a: BirthdayDate | null, c: WithBirthday) =>
  (a?.day ?? null) === (c.birthDay ?? null) &&
  (a?.month ?? null) === (c.birthMonth ?? null) &&
  (a?.year ?? null) === (c.birthYear ?? null);

/** Hoje no aparelho (o restaurante e a equipe estão no mesmo fuso). */
export const deviceToday = (d = new Date()) => ({
  year: d.getFullYear(),
  month: d.getMonth() + 1,
  day: d.getDate(),
});

/** Dias até o próximo aniversário (null sem a data). */
export function daysToBirthday(c: WithBirthday, today = deviceToday()) {
  if (!c.birthDay || !c.birthMonth) return null;
  return daysUntilBirthday({ day: c.birthDay, month: c.birthMonth }, today);
}

/** "hoje", "amanhã", "em 5 dias". */
export const inDaysLabel = (n: number) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
