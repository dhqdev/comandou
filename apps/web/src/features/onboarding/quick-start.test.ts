import { describe, expect, it } from 'vitest';
import { EMPTY_STORE, hoursLabel, mergeStore } from './quick-start';

describe('primeiros passos pelo cardápio', () => {
  it('horário em uma linha, juntando dias seguidos iguais (segunda primeiro)', () => {
    const h = (day: number, open = '18:00', close = '23:00') => ({ day, open, close });
    expect(hoursLabel([])).toBe('');
    expect(hoursLabel([1, 2, 3, 4, 5].map((d) => h(d)))).toBe('Seg a Sex 18:00–23:00');
    expect(hoursLabel([h(6, '11:00', '00:00'), h(0, '11:00', '00:00'), h(2), h(3)])).toBe(
      'Ter e Qua 18:00–23:00 · Sáb e Dom 11:00–00:00',
    );
    expect(hoursLabel([h(5, '11:00', '15:00'), h(5)])).toBe('Sex 11:00–15:00, 18:00–23:00');
  });

  it('juntando páginas: o primeiro valor encontrado fica e o resto completa', () => {
    const a = { ...EMPTY_STORE, whatsapp: '11988887777', brandColor: '#b71c1c' };
    const b = {
      ...EMPTY_STORE,
      whatsapp: '11000000000',
      address: 'Rua A, 10',
      hours: [{ day: 1, open: '18:00', close: '23:00' }],
    };
    expect(mergeStore(a, b)).toMatchObject({
      whatsapp: '11988887777',
      address: 'Rua A, 10',
      brandColor: '#b71c1c',
      hours: [{ day: 1, open: '18:00', close: '23:00' }],
    });
  });
});
