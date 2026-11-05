import { describe, expect, it } from 'vitest';
import { chairSpots, MAX_DRAWN_CHAIRS, tableTop, viewBoxOf } from './table-layout';

describe('chairSpots', () => {
  it('desenha uma cadeira por lugar, até o limite', () => {
    expect(chairSpots('round', 4)).toHaveLength(4);
    expect(chairSpots('square', 6)).toHaveLength(6);
    expect(chairSpots('rect', 7)).toHaveLength(7);
    expect(chairSpots('rect', 30)).toHaveLength(MAX_DRAWN_CHAIRS);
    expect(chairSpots('square', 0)).toHaveLength(0);
  });

  it('mantém as cadeiras dentro da área de desenho e fora do tampo', () => {
    for (const shape of ['round', 'square', 'rect'] as const) {
      const box = viewBoxOf(shape);
      const top = tableTop(shape);
      for (let n = 1; n <= MAX_DRAWN_CHAIRS; n++) {
        for (const c of chairSpots(shape, n)) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.y).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(box.w);
          expect(c.y).toBeLessThan(box.h);
          const inside =
            shape === 'round'
              ? Math.hypot(c.x - 50, c.y - 50) < top.w / 2
              : c.x > top.x && c.x < top.x + top.w && c.y > top.y && c.y < top.y + top.h;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it('na quadrada, divide os lugares entre os quatro lados', () => {
    const rots = chairSpots('square', 4)
      .map((c) => c.rot)
      .sort((a, b) => a - b);
    expect(rots).toEqual([0, 90, 180, 270]);
  });
});
