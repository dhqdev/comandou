import { describe, expect, it } from 'vitest';
import {
  chipText,
  dateBounds,
  matchAll,
  optionCounts,
  sameFilters,
  serverFilters,
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
});
