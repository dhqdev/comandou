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

export const DATE_PRESETS: FieldOption[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'last-month', label: 'Mês passado' },
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
    case 'month':
      return [isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), isoDay(today)];
    case 'last-month':
      return [
        isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        isoDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      ];
  }
  const m = /^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!m) return null;
  return m[1]! <= m[2]! ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function dateLabel(value: string | undefined) {
  if (!value) return 'qualquer data';
  const preset = DATE_PRESETS.find((p) => p.value === value);
  if (preset) return preset.label.toLowerCase();
  const b = dateBounds(value);
  if (!b) return 'qualquer data';
  return b[0] === b[1] ? fmtDay(b[0]) : `${fmtDay(b[0])} a ${fmtDay(b[1])}`;
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
