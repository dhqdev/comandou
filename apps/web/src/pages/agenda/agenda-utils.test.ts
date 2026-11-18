import { describe, expect, it } from 'vitest';
import {
  AgendaEvent,
  layoutDay,
  monthGrid,
  onDay,
  presetOf,
  rangeOf,
  timeLabel,
  titleOf,
} from './agenda-utils';

const ev = (id: string, start: Date, end: Date, allDay = false): AgendaEvent => ({
  id,
  title: id,
  notes: null,
  startsAt: start.toISOString(),
  endsAt: end.toISOString(),
  allDay,
  tagId: null,
  done: false,
  remindAt: null,
  remindedAt: null,
  remindError: null,
});
const d = (h: number, m = 0, day = 18) => new Date(2026, 10, day, h, m);

describe('agenda', () => {
  it('mês: 6 semanas começando no domingo', () => {
    const g = monthGrid(new Date(2026, 10, 18));
    expect(g).toHaveLength(42);
    expect(g[0]!.getDay()).toBe(0);
    expect(g[0]!.getDate()).toBe(1); // 1º de novembro de 2026 é domingo
    const r = rangeOf('week', new Date(2026, 10, 18));
    expect(r.from.getDate()).toBe(15);
    expect(r.to.getDate()).toBe(22);
  });

  it('compromissos que se sobrepõem dividem a largura', () => {
    const placed = layoutDay(
      [ev('a', d(10), d(11)), ev('b', d(10, 30), d(11, 30)), ev('c', d(12), d(13))],
      d(0),
    );
    const by = Object.fromEntries(placed.map((p) => [p.ev.id, p]));
    expect(by.a).toMatchObject({ col: 0, cols: 2, top: 600, bottom: 660 });
    expect(by.b).toMatchObject({ col: 1, cols: 2 });
    expect(by.c).toMatchObject({ col: 0, cols: 1 });
  });

  it('o que atravessa a meia-noite aparece nos dois dias, cortado', () => {
    const late = ev('x', d(23), d(1, 0, 19));
    expect(onDay(late, d(0))).toBe(true);
    expect(onDay(late, d(0, 0, 19))).toBe(true);
    expect(layoutDay([late], d(0, 0, 19))[0]).toMatchObject({ top: 0, bottom: 60 });
    expect(onDay(ev('y', d(0, 0, 20), d(23, 59, 20), true), d(0, 0, 19))).toBe(false);
  });

  it('lembrete: reconhece a opção salva e o horário escolhido à mão', () => {
    expect(presetOf(d(14), d(13, 30), false)).toBe('30');
    expect(presetOf(d(0), d(8), true)).toBe('-480');
    expect(presetOf(d(0), d(18, 0, 17), true)).toBe('360');
    expect(presetOf(d(14), d(9, 15), false)).toBe('custom');
    expect(presetOf(d(14), null, false)).toBe('');
  });

  it('títulos e horários', () => {
    expect(titleOf('month', d(0))).toBe('Novembro de 2026');
    expect(titleOf('week', d(0))).toBe('15 – 21 de nov. de 2026');
    expect(titleOf('week', d(0), true)).toBe('Novembro 2026');
    expect(timeLabel(ev('a', d(10), d(11, 30)))).toBe('10:00 – 11:30');
    expect(timeLabel(ev('a', d(0), d(23, 59), true))).toBe('Dia todo');
  });
});
