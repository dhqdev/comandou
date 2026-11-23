/**
 * Desenho do QR Code das mesas: bolinhas no lugar dos quadradinhos, "olhos" arredondados, a cor
 * do restaurante e, se ele tiver, a logo no meio. Puro (recebe a matriz pronta do `qrcode`),
 * para o teste conferir que o desenho continua lendo.
 *
 * Leitura garantida:
 * - com logo, a correção de erro é H (até 30% do código pode faltar) e o buraco da logo fica em
 *   ~5% da área, longe dos olhos e da faixa de tempo;
 * - margem branca de 4 módulos (o mínimo da norma) dentro do próprio desenho;
 * - a cor é sempre escura o bastante sobre o branco (quem chama passa um tom com contraste ≥ 4,5).
 */
export interface QrMatrix {
  size: number;
  get(row: number, col: number): boolean | number;
}

export type QrShape = 'dots' | 'square';

/** Margem branca em volta, em módulos. */
export const QUIET = 4;

/** O módulo cai num dos três olhos (7 × 7 nos cantos)? */
export function inFinder(size: number, r: number, c: number) {
  const near = (v: number) => v < 7;
  const far = (v: number) => v >= size - 7;
  return (near(r) && near(c)) || (near(r) && far(c)) || (far(r) && near(c));
}

/**
 * Lado do buraco da logo, em módulos (ímpar, para ficar no centro exato), já com a folga de um
 * módulo em volta. 0 = sem logo.
 */
export function logoHole(size: number) {
  let n = Math.floor(size * 0.24);
  if (n % 2 === 0) n -= 1;
  return n;
}

/** O módulo fica embaixo da logo (não é desenhado)? */
export function inHole(size: number, hole: number, r: number, c: number) {
  if (!hole) return false;
  const start = (size - hole) / 2;
  return r >= start && r < start + hole && c >= start && c < start + hole;
}

/** Os módulos que de fato vão para o papel (o teste lê esta mesma grade). */
export function drawnModules(m: QrMatrix, hole: number) {
  const out: boolean[][] = [];
  for (let r = 0; r < m.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < m.size; c++) row.push(!!m.get(r, c) && !inHole(m.size, hole, r, c));
    out.push(row);
  }
  return out;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
let clipSeq = 0;
const n2 = (v: number) => Math.round(v * 100) / 100;

/** Quadrado de cantos redondos como trecho de `path` (sentido horário). */
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return (
    `M${n2(x + r)} ${n2(y)}h${n2(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n2(h - 2 * r)}` +
    `a${r} ${r} 0 0 1 -${r} ${r}h-${n2(w - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}v-${n2(h - 2 * r)}` +
    `a${r} ${r} 0 0 1 ${r} -${r}z`
  );
}
/** O mesmo, no sentido contrário (para furar o anel do olho com `nonzero`). */
function roundRectCcw(x: number, y: number, w: number, h: number, r: number) {
  return (
    `M${n2(x + r)} ${n2(y)}a${r} ${r} 0 0 0 -${r} ${r}v${n2(h - 2 * r)}a${r} ${r} 0 0 0 ${r} ${r}` +
    `h${n2(w - 2 * r)}a${r} ${r} 0 0 0 ${r} -${r}v-${n2(h - 2 * r)}a${r} ${r} 0 0 0 -${r} -${r}z`
  );
}

export interface QrArtOptions {
  /** Cor dos módulos (escura). */
  color: string;
  /** Cor dos olhos (padrão: a mesma). */
  eyeColor?: string;
  shape?: QrShape;
  /** Imagem do meio (data: ou endereço). Sem ela, o código fica inteiro. */
  logo?: string | null;
  /** Texto para leitores de tela. */
  title?: string;
}

/**
 * SVG do QR. A matriz deve ter sido criada com correção H quando houver logo
 * (`errorCorrectionLevel: logo ? 'H' : 'M'`).
 */
export function qrArtSvg(m: QrMatrix, o: QrArtOptions) {
  const size = m.size;
  const shape = o.shape ?? 'dots';
  const hole = o.logo ? logoHole(size) : 0;
  const grid = drawnModules(m, hole);
  const eye = o.eyeColor ?? o.color;
  const view = size + QUIET * 2;
  let dots = '';
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      if (!grid[r]![c] || inFinder(size, r, c)) continue;
      dots +=
        shape === 'dots'
          ? `M${c + 0.5} ${r + 0.06}a.44 .44 0 1 1 0 .88a.44 .44 0 1 1 0 -.88z`
          : `M${c} ${r}h1v1h-1z`;
    }
  const corners: [number, number][] = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
  let eyes = '';
  for (const [r, c] of corners) {
    if (shape === 'dots') {
      eyes += roundRect(c, r, 7, 7, 2.2) + roundRectCcw(c + 1, r + 1, 5, 5, 1.4);
      eyes += roundRect(c + 2, r + 2, 3, 3, 1);
    } else {
      eyes += `M${c} ${r}h7v7h-7zM${c + 1} ${r + 1}v5h5v-5zM${c + 2} ${r + 2}h3v3h-3z`;
    }
  }
  let logo = '';
  if (o.logo && hole) {
    const start = (size - hole) / 2;
    const pad = 0.5;
    const box = hole - pad * 2;
    const id = `cm-qrl-${++clipSeq}`;
    logo =
      `<rect x="${start + pad}" y="${start + pad}" width="${box}" height="${box}" rx="${n2(box * 0.24)}" fill="#fff"/>` +
      `<clipPath id="${id}"><rect x="${start + pad + 0.5}" y="${start + pad + 0.5}" width="${box - 1}" height="${box - 1}" rx="${n2(box * 0.2)}"/></clipPath>` +
      `<image href="${esc(o.logo)}" x="${start + pad + 0.5}" y="${start + pad + 0.5}" width="${box - 1}" height="${box - 1}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
  }
  const title = o.title ? `<title>${esc(o.title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-QUIET} ${-QUIET} ${view} ${view}" role="img" shape-rendering="geometricPrecision">` +
    `${title}<rect x="${-QUIET}" y="${-QUIET}" width="${view}" height="${view}" fill="#fff"/>` +
    `<path d="${dots}" fill="${esc(o.color)}"/>` +
    `<path d="${eyes}" fill="${esc(eye)}" fill-rule="${shape === 'dots' ? 'nonzero' : 'evenodd'}"/>` +
    `${logo}</svg>`
  );
}
