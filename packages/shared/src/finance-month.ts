/**
 * Mês financeiro do restaurante: começa no dia escolhido pelo gerente (ex.: dia 5, quando o
 * dinheiro entra) e vai até a véspera do mesmo dia no mês seguinte. Dia 1 = mês do calendário.
 * Em meses mais curtos que o dia escolhido (ex.: 31 em fevereiro), o mês começa no último dia.
 * Tudo em datas AAAA-MM-DD, sem fuso: quem chama passa o "hoje" já no fuso do restaurante.
 */

export const FINANCE_MONTH_START_MIN = 1;
export const FINANCE_MONTH_START_MAX = 31;

export interface FinanceMonth {
  /** Primeiro dia (inclusive), AAAA-MM-DD. */
  from: string;
  /** Último dia (inclusive), AAAA-MM-DD. */
  to: string;
  /** Ano e mês (1–12) em que o período começa: dá o nome do mês. */
  year: number;
  month: number;
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Dia de início válido (1–31); qualquer outra coisa vira 1. */
export function normalizeMonthStartDay(day: unknown): number {
  const n = typeof day === 'string' ? Number(day) : day;
  return typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= FINANCE_MONTH_START_MIN &&
    n <= FINANCE_MONTH_START_MAX
    ? n
    : 1;
}

/** Dia em que o mês financeiro começa dentro do mês do calendário (y, m0 de 0 a 11). */
function startIn(y: number, m0: number, startDay: number) {
  const ny = y + Math.floor(m0 / 12);
  const nm = ((m0 % 12) + 12) % 12;
  return new Date(Date.UTC(ny, nm, Math.min(startDay, daysIn(ny, nm))));
}

/**
 * Mês financeiro que contém `refIso` (offset 0), ou o anterior/seguinte (offset −1, +1, ...).
 */
export function financeMonth(refIso: string, startDay: number, offset = 0): FinanceMonth {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refIso);
  if (!m) throw new Error(`data inválida: ${refIso}`);
  const day = normalizeMonthStartDay(startDay);
  const y = Number(m[1]);
  let m0 = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (d < startIn(y, m0, day).getUTCDate()) m0 -= 1;
  m0 += offset;
  const from = startIn(y, m0, day);
  const next = startIn(y, m0 + 1, day);
  const to = new Date(next.getTime() - 86_400_000);
  return {
    from: iso(from),
    to: iso(to),
    year: from.getUTCFullYear(),
    month: from.getUTCMonth() + 1,
  };
}

/** "novembro de 2026" */
export function financeMonthName(p: Pick<FinanceMonth, 'year' | 'month'>): string {
  return `${MONTH_NAMES[p.month - 1]} de ${p.year}`;
}

/** "05/11 a 04/12" */
export function financeMonthRange(p: Pick<FinanceMonth, 'from' | 'to'>): string {
  const f = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return `${f(p.from)} a ${f(p.to)}`;
}
