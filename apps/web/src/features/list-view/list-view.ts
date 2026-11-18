/**
 * Filtros dinâmicos das listas (no estilo do Frappe): abas salvas com contagem, busca,
 * filtros por campo com várias escolhas e período, e ordenação. Aqui fica só a lógica pura;
 * a barra está em ListToolbar.tsx.
 */

export type Filters = Record<string, string[]>;

export interface FieldOption {
  value: string;
  label: string;
}

export interface ListField<T> {
  key: string;
  label: string;
  /** "options" (padrão): lista com caixas de seleção. "date": período. */
  kind?: 'options' | 'date';
  /** Valor (ou valores) da linha para este campo. */
  value?: (row: T) => string | readonly string[] | null | undefined;
  /** Rótulos e ordem fixos. Sem isso, as opções saem das próprias linhas (valor = rótulo). */
  options?: readonly FieldOption[];
  /** Data da linha (ISO ou AAAA-MM-DD) para o filtro de período. */
  date?: (row: T) => string | null | undefined;
  /** Chip sempre visível, mesmo sem nada escolhido ("Tipo: Todos"). */
  pinned?: boolean;
  /** Nota no rodapé do filtro de data (qual data a lista usa). */
  dateNote?: string;
  /** Filtro feito pelo servidor ao carregar: a lista não refiltra por ele. */
  server?: boolean;
}

export interface ListTab {
  id: string;
  label: string;
  filters: Filters;
  /** Aba criada pela pessoa (pode ser apagada). */
  custom?: boolean;
}

export interface ListSort<T> {
  key: string;
  label: string;
  get(row: T): string | number;
  /** Direção inicial ao escolher este campo (padrão: decrescente). */
  asc?: boolean;
}

/* ------------------------------------------------------------------ período */

/** Atalhos da grade do filtro de data, na ordem em que aparecem (duas colunas). */
export const DATE_PRESETS: FieldOption[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mês' },
  { value: 'last-month', label: 'Mês passado' },
  { value: '3m', label: 'Últimos 3 meses' },
  { value: '12m', label: 'Últimos 12 meses' },
  { value: 'year', label: 'Este ano' },
];

/** Períodos que não estão na grade, mas seguem valendo em abas e filtros salvos. */
const EXTRA_PRESETS: FieldOption[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

/** Dia local no formato AAAA-MM-DD. */
export function isoDay(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Período escolhido → [primeiro dia, último dia] (inclusive), ou null para "qualquer data". */
export function dateBounds(value: string | undefined, now = new Date()): [string, string] | null {
  if (!value) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (value) {
    case 'today':
      return [isoDay(today), isoDay(today)];
    case 'yesterday':
      return [isoDay(addDays(today, -1)), isoDay(addDays(today, -1))];
    case '7d':
      return [isoDay(addDays(today, -6)), isoDay(today)];
    case '30d':
      return [isoDay(addDays(today, -29)), isoDay(today)];
    case 'week':
      // Semana começando na segunda-feira.
      return [isoDay(addDays(today, -((today.getDay() + 6) % 7))), isoDay(today)];
    case 'month':
      return [isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), isoDay(today)];
    case '3m':
    case '12m': {
      const n = value === '3m' ? 3 : 12;
      return [
        isoDay(new Date(today.getFullYear(), today.getMonth() - n, today.getDate() + 1)),
        isoDay(today),
      ];
    }
    case 'year':
      return [isoDay(new Date(today.getFullYear(), 0, 1)), isoDay(today)];
    case 'last-month':
      return [
        isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        isoDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      ];
  }
  // De/Até livre; uma das pontas pode ficar vazia ("daí em diante" / "até esse dia").
  const m = /^range:(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2})?$/.exec(value);
  if (!m || (!m[1] && !m[2])) return null;
  const a = m[1] ?? OPEN_FROM;
  const b = m[2] ?? OPEN_TO;
  return a <= b ? [a, b] : [b, a];
}

/** Pontas usadas quando o De ou o Até fica vazio (datas que nenhuma linha tem). */
const OPEN_FROM = '2000-01-01';
const OPEN_TO = '2999-12-31';

/** Valor do filtro para um De/Até (qualquer ponta pode vir vazia; invertido, desinverte). */
export function rangeValue(from: string, to: string) {
  if (!from && !to) return '';
  const [a, b] = from && to && from > to ? [to, from] : [from, to];
  return `range:${a}:${b}`;
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function dateLabel(value: string | undefined) {
  if (!value) return 'qualquer data';
  const preset = [...DATE_PRESETS, ...EXTRA_PRESETS].find((p) => p.value === value);
  if (preset) return preset.label;
  const b = dateBounds(value);
  if (!b) return 'qualquer data';
  if (b[0] === OPEN_FROM) return `até ${fmtDay(b[1])}`;
  if (b[1] === OPEN_TO) return `desde ${fmtDay(b[0])}`;
  // Período que atravessa o ano mostra o ano (01/12/2025 a 15/01/2026).
  const year =
    b[0].slice(0, 4) !== b[1].slice(0, 4) || b[0].slice(0, 4) !== String(new Date().getFullYear());
  const f = (d: string) => (year ? `${fmtDay(d)}/${d.slice(0, 4)}` : fmtDay(d));
  return b[0] === b[1] ? f(b[0]) : `${f(b[0])} a ${f(b[1])}`;
}

/** Limites de um dia local AAAA-MM-DD em instantes ISO: [início do primeiro, início do dia seguinte ao último). */
export function boundsToIso([a, b]: [string, string]): [string, string] {
  const from = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  return [from.toISOString(), to.toISOString()];
}

/** Quantas linhas caem em cada atalho de data (lista carregada inteira no navegador). */
export function presetCounts<T>(field: ListField<T>, rows: readonly T[], now?: Date) {
  const out: Record<string, number> = {};
  for (const p of DATE_PRESETS) {
    const b = dateBounds(p.value, now)!;
    let n = 0;
    for (const r of rows) {
      const d = field.date?.(r);
      if (!d) continue;
      const day = localDay(d);
      if (day >= b[0] && day <= b[1]) n++;
    }
    out[p.value] = n;
  }
  return out;
}

/** Dia local de uma data ISO completa, ou a própria data se já vier AAAA-MM-DD. */
function localDay(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : isoDay(new Date(v));
}

/* ------------------------------------------------------------------ filtros */

export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function rowValues<T>(f: ListField<T>, row: T): string[] {
  const v = f.value?.(row);
  if (v == null || v === '') return [];
  return typeof v === 'string' ? [v] : [...v];
}

/** A linha passa no filtro deste campo? (campo sem escolha = passa) */
export function matchField<T>(f: ListField<T>, row: T, chosen: string[] | undefined, now?: Date) {
  if (!chosen?.length || f.server) return true;
  if (f.kind === 'date') {
    const b = dateBounds(chosen[0], now);
    if (!b) return true;
    const d = f.date?.(row);
    if (!d) return false;
    const day = localDay(d);
    return day >= b[0] && day <= b[1];
  }
  const vals = rowValues(f, row);
  return chosen.some((c) => vals.includes(c));
}

export function matchAll<T>(
  fields: readonly ListField<T>[],
  row: T,
  filters: Filters,
  skip?: string,
  now?: Date,
) {
  return fields.every((f) => f.key === skip || matchField(f, row, filters[f.key], now));
}

/** Tira campos vazios, para comparar e guardar filtros sem ruído. */
export function cleanFilters(f: Filters): Filters {
  const out: Filters = {};
  for (const k of Object.keys(f).sort()) if (f[k]?.length) out[k] = [...f[k]!].sort();
  return out;
}

export function sameFilters(a: Filters, b: Filters) {
  return JSON.stringify(cleanFilters(a)) === JSON.stringify(cleanFilters(b));
}

/** Opções do campo com quantas linhas cada uma teria (respeitando os outros filtros). */
export function optionCounts<T>(
  field: ListField<T>,
  rows: readonly T[],
  fields: readonly ListField<T>[],
  filters: Filters,
): (FieldOption & { count: number })[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!matchAll(fields, row, filters, field.key)) continue;
    for (const v of new Set(rowValues(field, row))) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const base: readonly FieldOption[] =
    field.options ??
    [...counts.keys()]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((v) => ({ value: v, label: v }));
  return base.map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
}

export function chipText<T>(field: ListField<T>, chosen: string[] | undefined) {
  if (field.kind === 'date') return dateLabel(chosen?.[0]);
  if (!chosen?.length) return 'Todos';
  const label = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v;
  return chosen.length === 1 ? label(chosen[0]!) : `${label(chosen[0]!)} +${chosen.length - 1}`;
}

/** Filtros dos campos feitos no servidor: decidem o que precisa ser recarregado. */
export function serverFilters<T>(fields: readonly ListField<T>[], filters: Filters): Filters {
  const out: Filters = {};
  for (const f of fields) if (f.server && filters[f.key]?.length) out[f.key] = filters[f.key]!;
  return out;
}

/* ------------------------------------------------------------------ escolher campo */

/**
 * Campos da barra de cada lista, guardados no navegador (`cm-lv-campos:<lista>`):
 * `pins` = campos que a pessoa pôs na barra (na ordem em que escolheu), `unpins` = campos que
 * ela tirou (inclusive os fixos da tela) e `uses` = quantas vezes escolheu cada um.
 */
export interface FieldPrefs {
  pins?: string[];
  unpins?: string[];
  uses?: Record<string, number>;
}

/** Usou três vezes: o campo sobe sozinho para "Mais usados". */
export const USES_TO_FAVORITE = 3;

/** O campo fica na barra? Escolhido pela pessoa, ou fixo da tela que ela não tirou. */
export function onBar<T>(f: ListField<T>, p: FieldPrefs) {
  if (p.pins?.includes(f.key)) return true;
  return !!f.pinned && !p.unpins?.includes(f.key);
}

/** O campo fica em "Mais usados"? Está na barra ou (sem a pessoa ter tirado) é muito usado. */
export function isFavorite<T>(f: ListField<T>, p: FieldPrefs) {
  if (onBar(f, p)) return true;
  return !p.unpins?.includes(f.key) && (p.uses?.[f.key] ?? 0) >= USES_TO_FAVORITE;
}

/** Põe o campo na barra (vai para o fim dos escolhidos; o fixo da tela volta ao lugar dele). */
export function addToBar<T>(f: ListField<T>, p: FieldPrefs): FieldPrefs {
  const unpins = (p.unpins ?? []).filter((k) => k !== f.key);
  if (onBar(f, { ...p, unpins })) return { ...p, unpins };
  return { ...p, pins: [...(p.pins ?? []), f.key], unpins };
}

/** Tira o campo da barra (e de "Mais usados", até a pessoa escolher de novo). */
export function removeFromBar<T>(f: ListField<T>, p: FieldPrefs): FieldPrefs {
  const pins = (p.pins ?? []).filter((k) => k !== f.key);
  const unpins = (p.unpins ?? []).filter((k) => k !== f.key);
  return { ...p, pins, unpins: [...unpins, f.key] };
}

/** Alfinete do seletor de campo: põe ou tira da barra. */
export function toggleBar<T>(f: ListField<T>, p: FieldPrefs): FieldPrefs {
  return onBar(f, p) ? removeFromBar(f, p) : addToBar(f, p);
}

/**
 * Chips da barra, na ordem: fixos da tela, os que a pessoa escolheu (na ordem da escolha) e,
 * por último, campos fora da barra que estão com filtro (vindo de uma aba, por exemplo).
 */
export function barKeys<T>(fields: readonly ListField<T>[], p: FieldPrefs, filters: Filters) {
  const known = new Set(fields.map((f) => f.key));
  const fixed = fields.filter((f) => f.pinned && onBar(f, p)).map((f) => f.key);
  const mine = [...new Set(p.pins ?? [])].filter((k) => known.has(k) && !fixed.includes(k));
  const taken = new Set([...fixed, ...mine]);
  const active = fields.filter((f) => !taken.has(f.key) && filters[f.key]?.length);
  return [...fixed, ...mine, ...active.map((f) => f.key)];
}

export function countUse(key: string, p: FieldPrefs): FieldPrefs {
  return { ...p, uses: { ...p.uses, [key]: (p.uses?.[key] ?? 0) + 1 } };
}

/** Tipo do campo como aparece ao lado do nome. */
export const fieldKind = <T>(f: ListField<T>) => (f.kind === 'date' ? 'data' : 'opções');

/** Campos que batem com a busca pelo título, separados em mais usados e demais. */
export function groupFields<T>(fields: readonly ListField<T>[], p: FieldPrefs, term: string) {
  const t = fold(term.trim());
  const list = t ? fields.filter((f) => fold(f.label).includes(t)) : [...fields];
  return {
    favorites: list.filter((f) => isFavorite(f, p)),
    others: list.filter((f) => !isFavorite(f, p)),
  };
}
