import { describe, expect, it } from 'vitest';
import {
  chipText,
  countUse,
  dateBounds,
  dateLabel,
  fieldKind,
  groupFields,
  isFavorite,
  matchAll,
  optionCounts,
  rangeValue,
  sameFilters,
  serverFilters,
  toggleFavorite,
  USES_TO_FAVORITE,
  type FieldPrefs,
  type ListField,
} from './list-view';

type Row = { status: string; tags: string[]; at: string };
const fields: ListField<Row>[] = [
  {
    key: 'status',
    label: 'Status',
    value: (r) => r.status,
    options: [
      { value: 'open', label: 'Aberto' },
      { value: 'paid', label: 'Pago' },
    ],
  },
  { key: 'tags', label: 'Tags', value: (r) => r.tags },
  { key: 'at', label: 'Data', kind: 'date', date: (r) => r.at },
];
const rows: Row[] = [
  { status: 'open', tags: ['a'], at: '2026-10-27' },
  { status: 'open', tags: ['b'], at: '2026-10-20' },
  { status: 'paid', tags: ['a', 'b'], at: '2026-09-30' },
];
const now = new Date(2026, 9, 27, 15);

describe('list-view', () => {
  it('calcula os períodos a partir de hoje', () => {
    expect(dateBounds('today', now)).toEqual(['2026-10-27', '2026-10-27']);
    expect(dateBounds('7d', now)).toEqual(['2026-10-21', '2026-10-27']);
    expect(dateBounds('month', now)).toEqual(['2026-10-01', '2026-10-27']);
    expect(dateBounds('last-month', now)).toEqual(['2026-09-01', '2026-09-30']);
    // 27/10/2026 é terça: a semana começa na segunda, 26/10.
    expect(dateBounds('week', now)).toEqual(['2026-10-26', '2026-10-27']);
    expect(dateBounds('3m', now)).toEqual(['2026-07-28', '2026-10-27']);
    expect(dateBounds('12m', now)).toEqual(['2025-10-28', '2026-10-27']);
    expect(dateBounds('year', now)).toEqual(['2026-01-01', '2026-10-27']);
    expect(dateBounds('range:2026-10-10:2026-10-01', now)).toEqual(['2026-10-01', '2026-10-10']);
    expect(dateBounds(undefined, now)).toBeNull();
  });

  it('filtra por várias escolhas, valores múltiplos e período', () => {
    const pick = (f: Record<string, string[]>) =>
      rows.filter((r) => matchAll(fields, r, f, undefined, now)).length;
    expect(pick({})).toBe(3);
    expect(pick({ status: ['open'] })).toBe(2);
    expect(pick({ status: ['open', 'paid'], tags: ['b'] })).toBe(2);
    expect(pick({ at: ['7d'] })).toBe(1);
    expect(pick({ at: ['last-month'], tags: ['a'] })).toBe(1);
  });

  it('conta as opções respeitando os outros filtros', () => {
    const c = optionCounts(fields[0]!, rows, fields, { tags: ['a'], status: ['open'] });
    expect(c).toEqual([
      { value: 'open', label: 'Aberto', count: 1 },
      { value: 'paid', label: 'Pago', count: 1 },
    ]);
    expect(optionCounts(fields[1]!, rows, fields, {}).map((o) => [o.value, o.count])).toEqual([
      ['a', 2],
      ['b', 2],
    ]);
  });

  it('compara filtros ignorando ordem e campos vazios', () => {
    expect(sameFilters({ status: ['paid', 'open'], tags: [] }, { status: ['open', 'paid'] })).toBe(
      true,
    );
    expect(sameFilters({ status: ['open'] }, {})).toBe(false);
  });

  it('mostra o texto do chip e separa o que vai ao servidor', () => {
    expect(chipText(fields[0]!, undefined)).toBe('Todos');
    expect(chipText(fields[0]!, ['open', 'paid'])).toBe('Aberto +1');
    expect(chipText(fields[2]!, ['today'])).toBe('Hoje');
    const server = [{ ...fields[2]!, server: true }, fields[0]!];
    expect(serverFilters(server, { at: ['today'], status: ['open'] })).toEqual({ at: ['today'] });
  });

  it('aceita De ou Até sozinhos no período livre', () => {
    expect(rangeValue('2026-10-20', '')).toBe('range:2026-10-20:');
    expect(rangeValue('', '2026-10-20')).toBe('range::2026-10-20');
    expect(rangeValue('2026-10-20', '2026-10-01')).toBe('range:2026-10-01:2026-10-20');
    expect(rangeValue('', '')).toBe('');
    const pick = (v: string) =>
      rows.filter((r) => matchAll(fields, r, { at: [v] }, undefined, now)).length;
    expect(pick('range:2026-10-20:')).toBe(2);
    expect(pick('range::2026-10-19')).toBe(1);
    expect(dateBounds('range::', now)).toBeNull();
    expect(dateLabel('range:2026-10-20:')).toBe('desde 20/10');
    expect(dateLabel('range::2026-10-20')).toBe('até 20/10');
    expect(dateLabel('range:2025-12-20:2026-01-10')).toBe('20/12/2025 a 10/01/2026');
    expect(dateLabel('garbage')).toBe('qualquer data');
  });
});

describe('escolher campo', () => {
  type R = { a: string };
  const fs: ListField<R>[] = [
    { key: 'data', label: 'Data', kind: 'date', pinned: true },
    { key: 'status', label: 'Status', pinned: true },
    { key: 'origem', label: 'Origem' },
    { key: 'mesa', label: 'Mesa' },
  ];

  it('começa com os fixos da tela em mais usados', () => {
    const g = groupFields(fs, {}, '');
    expect(g.favorites.map((f) => f.key)).toEqual(['data', 'status']);
    expect(g.others.map((f) => f.key)).toEqual(['origem', 'mesa']);
  });

  it('busca pelo título sem acento nem maiúscula', () => {
    expect(groupFields(fs, {}, 'ORIG').others.map((f) => f.key)).toEqual(['origem']);
    expect(groupFields(fs, {}, 'xyz').favorites).toEqual([]);
  });

  it('fixar e tirar troca o campo de grupo', () => {
    let p = toggleFavorite(fs[2]!, {});
    expect(isFavorite(fs[2]!, p)).toBe(true);
    p = toggleFavorite(fs[0]!, p);
    expect(isFavorite(fs[0]!, p)).toBe(false);
    p = toggleFavorite(fs[0]!, p);
    expect(isFavorite(fs[0]!, p)).toBe(true);
  });

  it('campo muito usado sobe sozinho, a menos que a pessoa tenha tirado', () => {
    let p: FieldPrefs = {};
    for (let i = 0; i < USES_TO_FAVORITE; i++) p = countUse('mesa', p);
    expect(isFavorite(fs[3]!, p)).toBe(true);
    p = toggleFavorite(fs[3]!, p);
    expect(isFavorite(fs[3]!, countUse('mesa', p))).toBe(false);
  });

  it('mostra o tipo do campo', () => {
    expect(fieldKind(fs[0]!)).toBe('data');
    expect(fieldKind(fs[1]!)).toBe('opções');
  });
});
