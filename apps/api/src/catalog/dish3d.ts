/**
 * Item em 3D a partir de uma foto, montado aqui no servidor (sem serviço de 3D de fora).
 *
 * A IA barata do OpenRouter só lê a foto e devolve a forma (DishShape: que recipiente é, de que
 * ângulo foi tirada, onde ele e a comida estão na foto, diâmetro e altura). Este arquivo monta o
 * modelo com isso: um prato/tigela (de cima ou de 45°) ou um copo/lanche (de lado) por revolução,
 * com a própria foto projetada como textura, e grava o GLB (glTF 2.0 binário) que o
 * <model-viewer> do cardápio mostra e põe na mesa pela câmera. A base fica em y = 0, em metros.
 *
 * Sem dependências: geometria em Float32Array e o GLB escrito à mão (JSON + BIN).
 */

import type { SilRow } from './cutout';

export type DishKind = 'plate' | 'bowl' | 'glass' | 'cup' | 'stack' | 'slice' | 'box' | 'other';
export type DishView = 'top' | 'angle' | 'side';

/** Retângulo na foto, de 0 a 1 (x da esquerda, y de cima). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DishShape {
  kind: DishKind;
  view: DishView;
  /** O recipiente inteiro (prato, tigela, copo) ou, sem recipiente, a comida. */
  box: Box;
  /** Só a comida, dentro do prato (null = cobre o prato todo). */
  food: Box | null;
  diameterCm: number;
  heightCm: number;
  /** Quanto a comida sobe acima do fundo do prato. */
  foodHeightCm: number;
  /** Perfil de lado (altura 0–1 a partir da base, raio 0–1); null = o padrão do tipo. */
  profile: [number, number][] | null;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function cleanBox(b: Partial<Box> | null | undefined, fallback: Box): Box {
  if (!b) return fallback;
  let x0 = clamp(fin(b.x0, fallback.x0), 0, 1);
  let x1 = clamp(fin(b.x1, fallback.x1), 0, 1);
  let y0 = clamp(fin(b.y0, fallback.y0), 0, 1);
  let y1 = clamp(fin(b.y1, fallback.y1), 0, 1);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  // Caixa minúscula (a IA errou): volta para a padrão.
  if (x1 - x0 < 0.08 || y1 - y0 < 0.05) return fallback;
  return { x0, y0, x1, y1 };
}

/** Perfis de lado de cada tipo (altura, raio), da base ao topo. */
export const DEFAULT_PROFILE: Record<DishKind, [number, number][]> = {
  glass: [
    [0, 0.72],
    [0.04, 0.76],
    [0.5, 0.88],
    [0.97, 1],
    [1, 1],
  ],
  cup: [
    [0, 0.72],
    [0.08, 0.84],
    [0.6, 0.95],
    [1, 1],
  ],
  stack: [
    [0, 0.86],
    [0.08, 0.98],
    [0.35, 1],
    [0.62, 0.98],
    [0.82, 0.88],
    [0.94, 0.62],
    [1, 0.2],
  ],
  other: [
    [0, 0.82],
    [0.12, 0.98],
    [0.55, 0.96],
    [0.85, 0.74],
    [1, 0.3],
  ],
  plate: [
    [0, 0.8],
    [1, 1],
  ],
  bowl: [
    [0, 0.5],
    [0.5, 0.85],
    [1, 1],
  ],
  slice: [
    [0, 0.9],
    [0.6, 1],
    [1, 0.7],
  ],
  box: [
    [0, 0.9],
    [1, 1],
  ],
};

/**
 * Deixa a forma que a IA mandou dentro do que dá para montar: caixas na foto, tamanhos de
 * comida de verdade (3 a 60 cm) e um perfil que sobe da base ao topo.
 */
export function normalizeShape(raw: Partial<DishShape> & Record<string, unknown>): DishShape {
  const kinds: DishKind[] = ['plate', 'bowl', 'glass', 'cup', 'stack', 'slice', 'box', 'other'];
  const views: DishView[] = ['top', 'angle', 'side'];
  const kind = kinds.includes(raw.kind as DishKind) ? (raw.kind as DishKind) : 'other';
  const view = views.includes(raw.view as DishView) ? (raw.view as DishView) : 'angle';
  const box = cleanBox(raw.box as Box | undefined, { x0: 0.1, y0: 0.12, x1: 0.9, y1: 0.88 });
  const food = raw.food ? cleanBox(raw.food as Box, box) : null;
  const tall = kind === 'glass' || kind === 'cup' || kind === 'stack';
  const diameterCm = clamp(fin(raw.diameterCm, tall ? 9 : 26), 3, 60);
  const heightCm = clamp(fin(raw.heightCm, tall ? 12 : kind === 'bowl' ? 8 : 4), 0.5, 45);
  const foodHeightCm = clamp(fin(raw.foodHeightCm, kind === 'plate' ? 3 : 2), 0, 25);
  let profile: [number, number][] | null = null;
  if (Array.isArray(raw.profile)) {
    const pts = (raw.profile as unknown[])
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .map(([h, r]) => [clamp(fin(h, 0), 0, 1), clamp(fin(r, 0.5), 0.02, 1)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    if (pts.length >= 2 && pts[0]![0] <= 0.15 && pts[pts.length - 1]![0] >= 0.85) {
      pts[0]![0] = 0;
      pts[pts.length - 1]![0] = 1;
      profile = pts.slice(0, 24);
    }
  }
  return { kind, view, box, food, diameterCm, heightCm, foodHeightCm, profile };
}

/** Montagem de lado (copo, xícara, lanche alto) ou de cima (prato, tigela, porção). */
export const buildsAsLathe = (s: DishShape) =>
  s.view === 'side' ||
  ((s.kind === 'glass' || s.kind === 'cup' || s.kind === 'stack') && s.view !== 'top');

/**
 * Com o item recortado da foto, monta pela silhueta: além de copo, xícara e lanche, o "outro"
 * visto de lado ou inclinado (porção na cestinha, sorvete na casquinha). Prato, tigela, fatia e
 * embalagem seguem montados de cima.
 */
export const usesSilhouette = (s: DishShape) =>
  buildsAsLathe(s) || (s.kind === 'other' && s.view !== 'top');

/* ------------------------------------------------------------------ malha */

interface Part {
  pos: number[];
  uv: number[] | null;
  idx: number[];
  material: number;
}

const newPart = (material: number, textured: boolean): Part => ({
  pos: [],
  uv: textured ? [] : null,
  idx: [],
  material,
});

/** Grade em anéis (raio × volta) com tampa no centro: a superfície de cima e as paredes. */
function ringGrid(
  part: Part,
  rings: { r: number; y: number }[],
  segs: number,
  at: (x: number, y: number, z: number) => [number, number] | null,
  center?: (x: number, y: number, z: number) => [number, number, number],
  /** Inverte a frente dos triângulos (perfil girado de baixo para cima: frente para fora). */
  flip = false,
) {
  const base = part.pos.length / 3;
  for (const ring of rings) {
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x0 = Math.cos(a) * ring.r;
      const z0 = Math.sin(a) * ring.r;
      const [x, y, z] = center ? center(x0, ring.y, z0) : [x0, ring.y, z0];
      part.pos.push(x, y, z);
      if (part.uv) {
        const uv = at(x, y, z) ?? [0.5, 0.5];
        part.uv.push(uv[0], uv[1]);
      }
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = base + i * row + s;
      const b = a + row;
      // Frente: anel de dentro para fora vira para cima; de cima para baixo, para fora.
      if (flip) part.idx.push(a, b, a + 1, a + 1, b, b + 1);
      else part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

/** Normais suaves: soma a normal de cada triângulo nos vértices dele. */
function normalsOf(pos: number[], idx: number[]): number[] {
  const n = new Array<number>(pos.length).fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] = n[k]! + nx;
      n[k + 1] = n[k + 1]! + ny;
      n[k + 2] = n[k + 2]! + nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i] = n[i]! / l;
    n[i + 1] = n[i + 1]! / l;
    n[i + 2] = n[i + 2]! / l;
  }
  return n;
}

/**
 * Ângulo da câmera (rad, 90° = de cima) pela caixa do recipiente: a borda redonda vira uma
 * elipse de altura 2·a·sen(e), e as paredes (altura h, raio R) somam h/R·a·cos(e) embaixo.
 */
export function cameraElevation(boxW: number, boxH: number, wallOverRadius: number): number {
  const target = boxH / Math.max(boxW / 2, 1e-6);
  let lo = (5 * Math.PI) / 180;
  let hi = Math.PI / 2;
  const f = (e: number) => 2 * Math.sin(e) + wallOverRadius * Math.cos(e);
  if (target <= f(lo)) return lo;
  if (target >= f(hi)) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface BuiltMesh {
  parts: Part[];
  /** Cor de cada material (o 0 usa a foto como textura). */
  colors: [number, number, number, number][];
  /** Medidas do modelo pronto, em metros. */
  size: { width: number; height: number };
}

const SEGS = 72;

/** Prato, tigela ou porção vistos de cima ou de lado (45°): a foto projetada de cima. */
function buildTop(s: DishShape, w: number, h: number): BuiltMesh {
  const R = s.diameterCm / 200;
  const bowl = s.kind === 'bowl';
  const wallH = bowl
    ? Math.max(0.03, s.heightCm / 100)
    : Math.min(0.025, s.heightCm / 100) || 0.018;
  const boxW = (s.box.x1 - s.box.x0) * w;
  const boxH = (s.box.y1 - s.box.y0) * h;
  const floorY = bowl ? wallH * 0.82 : 0.011;
  const rimY = bowl ? wallH : 0.019;
  const fromAbove = s.view === 'top';
  const e = fromAbove ? Math.PI / 2 : cameraElevation(boxW, boxH, rimY / R);
  const sinE = Math.sin(e);
  const cosE = Math.cos(e);
  // Câmera ortográfica: na foto, x anda k px por metro; a profundidade z desce sen(e) e a altura y
  // sobe cos(e). De cima, a borda é a elipse da caixa (kz próprio, aceita o prato meio oval).
  const k = boxW / 2 / R;
  const kz = fromAbove ? boxH / 2 / R : k;
  const cx = s.box.x0 * w + boxW / 2;
  // Topo da caixa = a borda de trás (z = -R, y = rimY).
  const v0 = s.box.y0 * h + kz * R * sinE + k * rimY * cosE;
  // Ponto do mundo (m) → ponto da foto (0–1). Atrás e por baixo (fora da foto): espelha a frente.
  const project = (x: number, y: number, z: number, mirror: boolean): [number, number] => {
    const zz = mirror ? Math.abs(z) : z;
    const u = cx + k * x;
    const v = v0 + kz * zz * sinE - k * y * cosE;
    return [clamp(u / w, 0, 1), clamp(v / h, 0, 1)];
  };

  // Comida: domo no lugar dela. A base fica abaixo do meio da caixa da comida (a altura levanta a
  // comida na foto em hf·cos(e)).
  const hf = s.foodHeightCm / 100;
  const f = s.food ?? s.box;
  const fax = ((f.x1 - f.x0) * w) / 2;
  const fcxPx = (f.x0 + f.x1) * 0.5 * w;
  const fcyPx = (f.y0 + f.y1) * 0.5 * h + 0.5 * hf * k * cosE;
  const floorR = bowl ? R * 0.94 : R * 0.8;
  const Rf = clamp(fax / k, R * 0.15, floorR * 0.98);
  const fcx = clamp((fcxPx - cx) / k, -(floorR - Rf), floorR - Rf);
  const fcz = clamp(
    (fcyPx - v0 + k * floorY * cosE) / Math.max(kz * sinE, 1e-6),
    -(floorR - Rf),
    floorR - Rf,
  );

  /** Altura da superfície de cima (fundo, borda e a comida por cima). */
  const surface = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    let y: number;
    if (bowl) {
      // Comida enchendo a tigela, encostando na borda.
      const t = clamp((r - floorR) / (R - floorR), 0, 1);
      y = floorY + (rimY - floorY) * t * t;
    } else {
      const t = clamp((r - floorR) / (R * 0.97 - floorR), 0, 1);
      // Aba do prato subindo até a borda e arredondando para fora.
      y =
        r > R * 0.97
          ? rimY - (rimY - 0.009) * ((r - R * 0.97) / (R * 0.03))
          : floorY + (rimY - floorY) * Math.sin((t * Math.PI) / 2);
    }
    const d = Math.hypot(x - fcx, z - fcz);
    if (hf > 0 && d < Rf) {
      const k = 1 - (d / Rf) ** 2;
      y += hf * Math.pow(k, 0.7);
    }
    return y;
  };

  const top = newPart(0, true);
  const N = 40;
  const rings: { r: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) rings.push({ r: (i / N) * R, y: 0 });
  ringGrid(
    top,
    rings,
    SEGS,
    (x, y, z) => project(x, y, z, false),
    (x, _y, z) => [x, surface(x, z), z],
  );

  // Por fora: a borda desce até o pé e fecha embaixo (tigela com a foto; prato branco).
  const wall = newPart(bowl ? 0 : 1, bowl);
  const edgeY = surface(R, 0);
  const wallRings = bowl
    ? [
        { r: R, y: edgeY },
        { r: R * 0.98, y: wallH * 0.7 },
        { r: R * 0.88, y: wallH * 0.38 },
        { r: R * 0.7, y: wallH * 0.12 },
        { r: R * 0.5, y: 0 },
        { r: 0, y: 0 },
      ]
    : [
        { r: R, y: edgeY },
        { r: R * 0.99, y: 0.006 },
        { r: R * 0.84, y: 0.002 },
        { r: R * 0.8, y: 0 },
        { r: 0, y: 0 },
      ];
  ringGrid(wall, wallRings, SEGS, (x, y, z) => project(x, y, z, true));
  return {
    parts: [top, wall],
    colors: [
      [1, 1, 1, 1],
      [0.94, 0.93, 0.91, 1],
    ],
    size: { width: R * 2, height: rimY + hf },
  };
}

/** Copo, xícara, lanche ou bolo de lado: o perfil girado em volta do eixo, foto em volta. */
function buildLathe(s: DishShape, w: number, h: number): BuiltMesh {
  const profile = s.profile ?? DEFAULT_PROFILE[s.kind];
  const H = s.heightCm / 100;
  const R = s.diameterCm / 200;
  const bx0 = s.box.x0 * w;
  const bx1 = s.box.x1 * w;
  const by0 = s.box.y0 * h;
  const by1 = s.box.y1 * h;
  const cx = (bx0 + bx1) / 2;
  const half = (bx1 - bx0) / 2;
  const maxR = Math.max(...profile.map((p) => p[1]));
  // Ponto do mundo → foto: de lado, x vira horizontal e y vertical (atrás repete a frente).
  const project = (x: number, y: number): [number, number] => {
    const u = cx + (x / (R * maxR)) * half;
    const v = by1 - (y / H) * (by1 - by0);
    return [u / w, v / h];
  };
  // Mais anéis onde o perfil curva: interpola em 28 alturas.
  const rings: { r: number; y: number }[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let j = 0;
    while (j < profile.length - 2 && profile[j + 1]![0] < t) j++;
    const [h0, r0] = profile[j]!;
    const [h1, r1] = profile[j + 1]!;
    const k = h1 > h0 ? (t - h0) / (h1 - h0) : 0;
    rings.push({ r: (r0 + (r1 - r0) * clamp(k, 0, 1)) * R, y: t * H });
  }
  const side = newPart(0, true);
  ringGrid(side, rings, SEGS, (x, y) => project(x, y), undefined, true);
  // Tampas: em cima pega a cor da borda de cima da foto; embaixo fecha com a de baixo.
  const top = newPart(0, true);
  const topR = rings[rings.length - 1]!.r;
  if (topR > 0.002)
    ringGrid(
      top,
      [
        { r: topR, y: H },
        { r: 0, y: H },
      ],
      SEGS,
      () => project(0, H * 0.97),
      undefined,
      true,
    );
  const bottom = newPart(0, true);
  ringGrid(
    bottom,
    [
      { r: 0, y: 0 },
      { r: rings[0]!.r, y: 0 },
    ],
    SEGS,
    () => project(0, H * 0.03),
    undefined,
    true,
  );
  return {
    parts: [side, top, bottom].filter((p) => p.idx.length > 0),
    colors: [[1, 1, 1, 1]],
    size: { width: R * maxR * 2, height: H },
  };
}

/**
 * Lanche, copo ou bolo pela silhueta recortada da foto (cutout.ts): cada linha da foto vira um
 * anel com a largura que o item tem ali, então o modelo tem o formato do lanche (pão de cima
 * redondo, recheio saindo, pão de baixo) e não um cilindro. A foto vai na frente e se repete
 * atrás; a textura já vem com o fundo trocado pela cor da borda do item.
 */
function buildSilhouette(s: DishShape, rows: SilRow[]): BuiltMesh {
  const H = s.heightCm / 100;
  const R = s.diameterCm / 200;
  const half = (r: SilRow) => (r.right - r.left) / 2;
  const maxHalf = Math.max(...rows.map(half));
  const vBottom = rows[0]!.v;
  const vTop = rows[rows.length - 1]!.v;
  const span = Math.max(vBottom - vTop, 1e-6);
  // Um anel a cada linha (até 48), da base ao topo, e uma ponta no centro de cima.
  const steps = Math.min(48, rows.length - 1);
  const at = (t: number) => {
    const f = t * (rows.length - 1);
    const i = Math.min(rows.length - 2, Math.floor(f));
    const k = f - i;
    const a = rows[i]!;
    const b = rows[i + 1]!;
    return {
      v: a.v + (b.v - a.v) * k,
      left: a.left + (b.left - a.left) * k,
      right: a.right + (b.right - a.right) * k,
    };
  };
  const rings: { r: number; y: number; row: SilRow; uv: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const row = at(i / steps);
    const r = Math.max((half(row) / maxHalf) * R, R * 0.01);
    rings.push({ r, y: (vBottom - row.v) / span, row, uv: 1 });
  }
  // O topo fecha numa cúpula baixa (sem tampa chata nem bico): a linha mais alta vai até o centro.
  const last = rings[rings.length - 1]!;
  const dome = Math.min(0.04, (last.r / R) * 0.12);
  for (let i = 1; i <= 6; i++) {
    const f = 1 - i / 6;
    rings.push({ r: last.r * f, y: 1 + dome * (1 - f * f), row: last.row, uv: f });
  }
  const top = rings[rings.length - 1]!.y;
  for (const ring of rings) ring.y = (ring.y / top) * H;
  const side = newPart(0, true);
  const segs = SEGS;
  for (const ring of rings) {
    const cu = (ring.row.left + ring.row.right) / 2;
    const hu = half(ring.row) * 0.96 * ring.uv;
    // Na cúpula a foto vem um pouco para dentro do pão (a linha da borda é a mais clara).
    const v = ring.row.v + (1 - ring.uv) * 0.02;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      side.pos.push(Math.cos(a) * ring.r, ring.y, Math.sin(a) * ring.r);
      side.uv!.push(clamp(cu + Math.cos(a) * hu, 0, 1), clamp(v, 0, 1));
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < segs; k++) {
      const a = i * row + k;
      const b = a + row;
      side.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // Embaixo fecha reto, com a cor do pé do item.
  const first = rings[0]!;
  const bottom = newPart(0, true);
  const bu = (first.row.left + first.row.right) / 2;
  ringGrid(
    bottom,
    [
      { r: 0, y: first.y },
      { r: first.r, y: first.y },
    ],
    segs,
    (x) => [
      clamp(bu + (x / Math.max(first.r, 1e-6)) * half(first.row) * 0.9, 0, 1),
      clamp(first.row.v - 0.01, 0, 1),
    ],
    undefined,
    true,
  );
  return {
    parts: [side, bottom],
    colors: [[1, 1, 1, 1]],
    size: { width: R * 2, height: H },
  };
}

/**
 * Monta a malha do item pela forma lida na foto (w × h = tamanho da foto em px). Com a
 * silhueta recortada, lanche, copo e bolo seguem o contorno do item.
 */
export function buildDish(s: DishShape, w: number, h: number, sil?: SilRow[] | null): BuiltMesh {
  const hasSil = !!sil && sil.length >= 6;
  if (hasSil && usesSilhouette(s)) return buildSilhouette(s, sil);
  return buildsAsLathe(s) ? buildLathe(s, w, h) : buildTop(s, w, h);
}

/* ------------------------------------------------------------------ GLB */

const pad4 = (n: number) => (n + 3) & ~3;

/**
 * Escreve o GLB (glTF 2.0 binário): uma malha com as partes, a foto embutida como textura do
 * material 0 (JPEG ou PNG, os dois que todo visualizador lê) e as outras cores lisas.
 */
export function writeGlb(
  mesh: BuiltMesh,
  image: { bytes: Buffer; mime: 'image/jpeg' | 'image/png' },
  name = 'Prato',
): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const addView = (buf: Buffer, target?: number) => {
    const at = offset;
    chunks.push(buf);
    const padded = pad4(buf.length);
    if (padded > buf.length) chunks.push(Buffer.alloc(padded - buf.length));
    offset += padded;
    views.push({
      buffer: 0,
      byteOffset: at,
      byteLength: buf.length,
      ...(target ? { target } : {}),
    });
    return views.length - 1;
  };
  const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
  const primitives: Record<string, unknown>[] = [];
  for (const p of mesh.parts) {
    const count = p.pos.length / 3;
    if (count > 65_535) throw new Error('malha grande demais');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, p.pos[i + k]!);
        max[k] = Math.max(max[k]!, p.pos[i + k]!);
      }
    const attrs: Record<string, number> = {};
    accessors.push({
      bufferView: addView(f32(p.pos), 34962),
      componentType: 5126,
      count,
      type: 'VEC3',
      min,
      max,
    });
    attrs.POSITION = accessors.length - 1;
    accessors.push({
      bufferView: addView(f32(normalsOf(p.pos, p.idx)), 34962),
      componentType: 5126,
      count,
      type: 'VEC3',
    });
    attrs.NORMAL = accessors.length - 1;
    if (p.uv) {
      accessors.push({
        bufferView: addView(f32(p.uv), 34962),
        componentType: 5126,
        count,
        type: 'VEC2',
      });
      attrs.TEXCOORD_0 = accessors.length - 1;
    }
    accessors.push({
      bufferView: addView(Buffer.from(new Uint16Array(p.idx).buffer), 34963),
      componentType: 5123,
      count: p.idx.length,
      type: 'SCALAR',
    });
    primitives.push({
      attributes: attrs,
      indices: accessors.length - 1,
      material: p.material,
      mode: 4,
    });
  }
  const imageView = addView(image.bytes);
  const materials = mesh.colors.map((c, i) => ({
    name: i === 0 ? 'foto' : 'louça',
    pbrMetallicRoughness: {
      ...(i === 0 ? { baseColorTexture: { index: 0 } } : { baseColorFactor: c }),
      metallicFactor: 0,
      roughnessFactor: i === 0 ? 0.62 : 0.35,
    },
    // As duas faces: nenhuma parte some se o visualizador olhar por dentro (borda, copo vazado).
    doubleSided: true,
  }));
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'Comandou (foto → 3D)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
    materials,
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imageView, mimeType: image.mime }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = pad4(jsonBuf.length);
  if (jsonPadded > jsonBuf.length)
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPadded - jsonBuf.length, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // JSON
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // BIN
  return Buffer.concat([head, jh, jsonBuf, bh, bin]);
}

/** Lê o JSON de um GLB (para conferir o que foi montado). */
export function readGlbJson(glb: Buffer): Record<string, unknown> {
  if (glb.toString('latin1', 0, 4) !== 'glTF') throw new Error('não é GLB');
  const len = glb.readUInt32LE(12);
  return JSON.parse(glb.toString('utf8', 20, 20 + len)) as Record<string, unknown>;
}
