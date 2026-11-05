import type { TableShape } from '../../lib/types';

/** Uma cadeira desenhada em volta da mesa (centro, rotação em graus e largura). */
export interface ChairSpot {
  x: number;
  y: number;
  rot: number;
  w: number;
}

/** Mais que isso não cabe no desenho: o resto vira "+N" na legenda. */
export const MAX_DRAWN_CHAIRS = 12;

/** Área de desenho: retangular para mesas compridas, quadrada para as outras. */
export function viewBoxOf(shape: TableShape) {
  return shape === 'rect' ? { w: 160, h: 100 } : { w: 100, h: 100 };
}

/** Tampo da mesa dentro da área de desenho. */
export function tableTop(shape: TableShape) {
  if (shape === 'round') return { x: 22, y: 22, w: 56, h: 56 };
  if (shape === 'rect') return { x: 22, y: 27, w: 116, h: 46 };
  return { x: 25, y: 25, w: 50, h: 50 };
}

/** Distribui `n` cadeiras ao longo de um lado (de `from` até `from + len`). */
function along(n: number, from: number, len: number) {
  return Array.from({ length: n }, (_, j) => from + ((j + 0.5) * len) / n);
}

const chairW = (n: number, len: number) => Math.max(7, Math.min(16, len / Math.max(n, 1) - 4));

/**
 * Onde desenhar cada cadeira: em círculo na redonda, nos quatro lados na quadrada e
 * nos lados compridos (e nas pontas, quando sobra) na retangular.
 */
export function chairSpots(shape: TableShape, seats: number): ChairSpot[] {
  const n = Math.max(0, Math.min(MAX_DRAWN_CHAIRS, Math.floor(seats)));
  if (n === 0) return [];
  const top = tableTop(shape);

  if (shape === 'round') {
    const r = top.w / 2 + 11;
    const w = Math.max(8, Math.min(16, (2 * Math.PI * r) / n - 5));
    return Array.from({ length: n }, (_, i) => {
      const deg = -90 + (i * 360) / n;
      const rad = (deg * Math.PI) / 180;
      return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad), rot: deg + 90, w };
    });
  }

  // Quantas cadeiras em cada lado: cima, baixo, esquerda, direita.
  let sides: [number, number, number, number];
  if (shape === 'rect') {
    const ends = n % 2 === 1 ? 1 : n >= 8 ? 2 : 0;
    const long = n - ends;
    sides = [Math.ceil(long / 2), Math.floor(long / 2), ends === 2 ? 1 : 0, ends >= 1 ? 1 : 0];
  } else {
    sides = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) sides[(i % 4) as 0 | 1 | 2 | 3] += 1;
  }
  const [up, down, left, right] = sides;
  const gap = 9;
  return [
    ...along(up, top.x, top.w).map((x) => ({ x, y: top.y - gap, rot: 0, w: chairW(up, top.w) })),
    ...along(down, top.x, top.w).map((x) => ({
      x,
      y: top.y + top.h + gap,
      rot: 180,
      w: chairW(down, top.w),
    })),
    ...along(left, top.y, top.h).map((y) => ({
      x: top.x - gap,
      y,
      rot: 270,
      w: chairW(left, top.h),
    })),
    ...along(right, top.y, top.h).map((y) => ({
      x: top.x + top.w + gap,
      y,
      rot: 90,
      w: chairW(right, top.h),
    })),
  ];
}
