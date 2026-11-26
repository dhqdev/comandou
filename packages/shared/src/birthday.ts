/**
 * Parabéns de aniversário pelo WhatsApp do restaurante (Clientes › Aniversários): regras comuns
 * à API (varredura, mensagem, validação) e às telas (ficha do cliente, Conta do cardápio).
 * O aniversário é dia e mês; o ano é opcional. Quem nasceu em 29/02 recebe em 28/02 nos anos que
 * não são bissextos.
 */

export const BIRTHDAY_THEMES = ['festa', 'bolo', 'elegante', 'simples'] as const;
export type BirthdayTheme = (typeof BIRTHDAY_THEMES)[number];

/** Nome e uma frase de cada estilo da arte (a arte em si é desenhada na API). */
export const BIRTHDAY_THEME_INFO: Record<BirthdayTheme, { name: string; hint: string }> = {
  festa: { name: 'Festa', hint: 'Cor da loja, balões e confete' },
  bolo: { name: 'Bolo', hint: 'Fundo claro com um bolo de velas' },
  elegante: { name: 'Elegante', hint: 'Fundo escuro com dourado' },
  simples: { name: 'Simples', hint: 'Branco, limpo, nome bem grande' },
};

export const BIRTHDAY_GIFT_KINDS = ['none', 'points', 'text'] as const;
export type BirthdayGiftKind = (typeof BIRTHDAY_GIFT_KINDS)[number];

/** Frase pequena da arte, embaixo do nome. */
export const DEFAULT_BIRTHDAY_LINE = 'Hoje o dia é todo seu!';

/** Texto que vai junto da arte quando o restaurante não escreveu o dele. */
export const DEFAULT_BIRTHDAY_MESSAGE = [
  'Feliz aniversário, {cliente}! 🎉🎂',
  '',
  'Hoje o dia é todo seu! Toda a equipe {restaurante} deseja um novo ano cheio de saúde, alegria e muitos momentos gostosos.',
  '',
  '{presente}',
  '',
  'Um abraço,',
  'Equipe {restaurante} 🧡',
].join('\n');

/** Variáveis do texto, na ordem da tela. */
export const BIRTHDAY_VARS = [
  { key: '{cliente}', label: 'Primeiro nome do cliente' },
  { key: '{restaurante}', label: 'Nome do restaurante' },
  { key: '{presente}', label: 'Linha do presente (some quando não há presente)' },
] as const;

/** A partir dessa hora (no fuso do restaurante) não manda mais: fica para o ano que vem. */
export const BIRTHDAY_LAST_HOUR = 22;

export interface BirthdayDate {
  day: number;
  month: number;
  year?: number | null;
}

/** Nome dos meses (janeiro = posição 0), para escolher o mês do aniversário. */
export const BIRTHDAY_MONTHS = [
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

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Dias do mês; fevereiro tem 29 quando não se sabe o ano. */
export function daysInMonth(month: number, year?: number | null) {
  if (month === 2) return year == null || isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Aniversário que existe: dia do mês certo e, com ano, nascido entre 1900 e hoje (29/02 só em ano
 * bissexto).
 */
export function isValidBirthday(b: BirthdayDate, todayYear = new Date().getFullYear()) {
  const { day, month, year } = b;
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  if (year != null) {
    if (!Number.isInteger(year) || year < 1900 || year > todayYear) return false;
    return day <= daysInMonth(month, year);
  }
  return day <= daysInMonth(month);
}

/** "12 de março" (com o ano: "12 de março de 1990"). */
export function birthdayLabel(b: BirthdayDate, withYear = false) {
  const base = `${b.day} de ${BIRTHDAY_MONTHS[b.month - 1] ?? '?'}`;
  return withYear && b.year ? `${base} de ${b.year}` : base;
}

/** "12/03". */
export const birthdayShort = (b: BirthdayDate) =>
  `${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}`;

export interface LocalDay {
  year: number;
  month: number;
  day: number;
}

/** Dia em que o aniversário cai naquele ano (29/02 vira 28/02 fora do ano bissexto). */
export function birthdayInYear(b: BirthdayDate, year: number): LocalDay {
  const day = b.month === 2 && b.day === 29 && !isLeapYear(year) ? 28 : b.day;
  return { year, month: b.month, day };
}

/** É aniversário neste dia? */
export function isBirthdayOn(b: BirthdayDate, d: LocalDay) {
  const x = birthdayInYear(b, d.year);
  return x.month === d.month && x.day === d.day;
}

const dayNumber = (d: LocalDay) => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

/** Quantos dias faltam (0 = hoje). */
export function daysUntilBirthday(b: BirthdayDate, today: LocalDay) {
  let next = birthdayInYear(b, today.year);
  if (dayNumber(next) < dayNumber(today)) next = birthdayInYear(b, today.year + 1);
  return dayNumber(next) - dayNumber(today);
}

/** Idade que completa no aniversário deste ano (null sem o ano). */
export function ageThisYear(b: BirthdayDate, today: LocalDay) {
  return b.year ? today.year - b.year : null;
}

/** Ano, mês, dia e hora agora no fuso do restaurante. */
export function localNow(now: Date, timeZone: string): LocalDay & { hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24 };
}

/** Soma dias a uma data local (validade do presente). */
export function addLocalDays(d: LocalDay, days: number): LocalDay {
  const x = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
}

/** "2026-03-12". */
export const isoDay = (d: LocalDay) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * Primeiro nome para a arte e para a mensagem. Nome todo em minúsculas ou maiúsculas ganha só a
 * primeira letra maiúscula ("MARIA" e "maria" viram "Maria"); "Ana Clara" fica "Ana".
 */
export function firstName(name: string | null | undefined) {
  const w = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!w) return '';
  const lower = w.toLocaleLowerCase('pt-BR');
  if (w === lower || w === w.toLocaleUpperCase('pt-BR'))
    return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
  return w;
}

export interface BirthdayGift {
  kind: BirthdayGiftKind;
  points?: number | null;
  /** A fidelidade da loja é de carimbos: os "pontos" do presente são carimbos. */
  stamps?: boolean;
  text?: string | null;
  /** Último dia em que o presente em texto vale (null = sem validade escrita). */
  until?: LocalDay | null;
  /** O aniversário (para dizer "vale só hoje"). */
  today?: LocalDay | null;
}

const pointsText = (n: number, stamps = false) =>
  `${n.toLocaleString('pt-BR')} ${stamps ? (n === 1 ? 'carimbo' : 'carimbos') : n === 1 ? 'ponto' : 'pontos'}`;

/** Validade escrita: "Vale só hoje." ou "Vale até 19/03." */
function validity(g: BirthdayGift) {
  if (!g.until) return '';
  if (g.today && isoDay(g.today) === isoDay(g.until)) return 'Vale só hoje.';
  return `Vale até ${String(g.until.day).padStart(2, '0')}/${String(g.until.month).padStart(2, '0')}.`;
}

/** A linha {presente} da mensagem (vazia sem presente). */
export function giftMessageLine(g: BirthdayGift) {
  if (g.kind === 'points' && g.points) {
    const what = `*${pointsText(g.points, g.stamps)}*`;
    const verb = g.points === 1 ? 'já está' : 'já estão';
    return g.stamps
      ? `🎁 Presente nosso: ${what} ${verb} no seu cartão fidelidade.`
      : `🎁 Presente nosso: ${what} ${verb} na sua conta de fidelidade.`;
  }
  if (g.kind === 'text' && g.text?.trim()) {
    const v = validity(g);
    return `🎁 Presente nosso: *${g.text.trim()}*${v ? `. ${v}` : ''}`;
  }
  return '';
}

/** O presente como aparece na arte: título e a linha de validade (ou null sem presente). */
export function giftArt(g: BirthdayGift): { title: string; note: string } | null {
  if (g.kind === 'points' && g.points)
    return {
      title: `+${pointsText(g.points, g.stamps)}`,
      note: g.stamps ? 'de presente no seu cartão' : 'de presente na sua conta',
    };
  if (g.kind === 'text' && g.text?.trim())
    return { title: g.text.trim(), note: validity(g).replace(/\.$/, '') || 'Seu presente' };
  return null;
}

/**
 * Monta a mensagem: troca {cliente}, {restaurante} e {presente} e tira as linhas vazias que
 * sobram quando não há presente.
 */
export function birthdayMessage(
  template: string | null | undefined,
  v: { cliente: string; restaurante: string; presente: string },
) {
  const text = (template?.trim() || DEFAULT_BIRTHDAY_MESSAGE).replace(
    /\{(cliente|restaurante|presente)\}/g,
    (_, k: keyof typeof v) => v[k],
  );
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
