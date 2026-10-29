import { describe, expect, it } from 'vitest';
import { notesFor, renderPattern, SOUND_INFO, TONE_INFO } from './sounds';

describe('renderPattern', () => {
  it('gera amostras audíveis e dentro do limite', () => {
    const out = renderPattern([{ at: 0, freq: 880, dur: 0.2 }], 0.7);
    expect(out.length).toBeGreaterThan(8000);
    const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('normaliza: todo timbre sai com o mesmo pico no mesmo volume', () => {
    const peaks = TONE_INFO.filter((t) => t.tone !== 'gravado').map((t) =>
      renderPattern(notesFor('order', t.tone), 0.5).reduce((m, x) => Math.max(m, Math.abs(x)), 0),
    );
    for (const p of peaks) expect(p).toBeCloseTo(0.45, 2);
  });

  it('termina em silêncio (sem estalo no fim)', () => {
    for (const { kind } of SOUND_INFO) {
      const out = renderPattern(notesFor(kind), 1);
      expect(Math.abs(out[out.length - 1])).toBeLessThan(0.02);
    }
  });
});

describe('notesFor', () => {
  it('som gravado sem gravação cai no padrão do aviso', () => {
    expect(notesFor('kitchen', 'gravado')).toEqual(notesFor('kitchen'));
    expect(notesFor('kitchen', 'marimba')).not.toEqual(notesFor('kitchen'));
  });
});
