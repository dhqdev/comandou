/**
 * Recorte do item na foto, para o 3D seguir o formato do lanche (e não um bloco com o fundo).
 *
 * Um modelo pequeno de "objeto principal da foto" (U²-Netp, 4,5 MB, Apache 2.0, em
 * assets/ai/models) roda aqui mesmo em WebAssembly (onnxruntime-web, sem dependência nativa e sem
 * gastar IA paga). Ele devolve um mapa 320 × 320 de quanto cada ponto é o item; daqui sai:
 *   - a máscara do item principal (a peça que mais cai na caixa que a IA leu);
 *   - a silhueta, linha por linha, que vira o perfil do lanche/copo girado (dish3d.ts);
 *   - a textura com o fundo trocado pela cor da borda do item, para nenhum pedaço do fundo escuro
 *     aparecer nas laterais e embaixo do modelo.
 *
 * As contas (máscara, silhueta, fundo) são puras e testadas; o modelo roda numa linha separada
 * (cutout.worker.ts) para não segurar as outras respostas da API.
 */

export const SAL = 320;

/** Máscara do item em grade própria (1 = item), cobrindo a foto inteira. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

/** Retângulo na foto, de 0 a 1. */
export interface NBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Rgba = Uint8Array | Uint8ClampedArray;

/** Foto (RGBA) → entrada do modelo: 3 × 320 × 320, normalizada como no treino (ImageNet). */
export function modelInput(rgba: Rgba, w: number, h: number): Float32Array {
  const out = new Float32Array(3 * SAL * SAL);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < SAL; y++) {
    const sy = Math.min(h - 1, ((y + 0.5) * h) / SAL - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < SAL; x++) {
      const sx = Math.min(w - 1, ((x + 0.5) * w) / SAL - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      for (let c = 0; c < 3; c++) {
        const a = rgba[(y0 * w + x0) * 4 + c]!;
        const b = rgba[(y0 * w + x1) * 4 + c]!;
        const d = rgba[(y1 * w + x0) * 4 + c]!;
        const e = rgba[(y1 * w + x1) * 4 + c]!;
        const v = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        out[c * SAL * SAL + y * SAL + x] = (v / 255 - mean[c]!) / std[c]!;
      }
    }
  }
  return out;
}

/** Peças ligadas (4 vizinhos) da máscara: rótulo de cada ponto (0 = fundo) e tamanho de cada peça. */
function components(m: Mask) {
  const label = new Int32Array(m.w * m.h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (!m.data[i] || label[i]) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % m.w;
      const y = (p - x) / m.w;
      const next = [x > 0 ? p - 1 : -1, x < m.w - 1 ? p + 1 : -1, y > 0 ? p - m.w : -1];
      next.push(y < m.h - 1 ? p + m.w : -1);
      for (const q of next)
        if (q >= 0 && m.data[q] && !label[q]) {
          label[q] = id;
          stack.push(q);
        }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/** Fecha os buracos (fundo que não encosta na borda da foto vira item). */
function fillHoles(m: Mask) {
  const out = new Uint8Array(m.data.length).fill(1);
  const stack: number[] = [];
  const push = (p: number) => {
    if (out[p] && !m.data[p]) {
      out[p] = 0;
      stack.push(p);
    }
  };
  for (let x = 0; x < m.w; x++) {
    push(x);
    push((m.h - 1) * m.w + x);
  }
  for (let y = 0; y < m.h; y++) {
    push(y * m.w);
    push(y * m.w + m.w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % m.w;
    const y = (p - x) / m.w;
    if (x > 0) push(p - 1);
    if (x < m.w - 1) push(p + 1);
    if (y > 0) push(p - m.w);
    if (y < m.h - 1) push(p + m.w);
  }
  return { ...m, data: out };
}

/**
 * Mapa do modelo (0–1 ou qualquer escala) → máscara do item principal. Fica com a peça que mais
 * cai dentro da caixa que a IA leu (o lanche, não a batata do lado); sem caixa, a maior. Devolve
 * null quando o recorte não serve (quase nada, ou quase a foto inteira): aí o 3D é montado como
 * antes, pela caixa.
 */
export function maskFromSaliency(
  sal: Float32Array,
  box: NBox | null,
  /** Corta o que sai muito da caixa (o lanche encostado na batata e no molho). */
  clip = false,
): Mask | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of sal) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi - lo > 0.2)) return null;
  const raw: Mask = { w: SAL, h: SAL, data: new Uint8Array(SAL * SAL) };
  for (let i = 0; i < sal.length; i++) raw.data[i] = (sal[i]! - lo) / (hi - lo) >= 0.5 ? 1 : 0;
  if (clip && box) {
    const mx = (box.x1 - box.x0) * 0.08;
    const my = (box.y1 - box.y0) * 0.08;
    for (let i = 0; i < raw.data.length; i++) {
      const x = ((i % SAL) + 0.5) / SAL;
      const y = (Math.floor(i / SAL) + 0.5) / SAL;
      if (x < box.x0 - mx || x > box.x1 + mx || y < box.y0 - my || y > box.y1 + my) raw.data[i] = 0;
    }
  }
  const { label, sizes } = components(raw);
  if (sizes.length < 2) return null;
  const score = new Float64Array(sizes.length);
  for (let i = 0; i < label.length; i++) {
    const id = label[i]!;
    if (!id) continue;
    const x = ((i % SAL) + 0.5) / SAL;
    const y = (Math.floor(i / SAL) + 0.5) / SAL;
    const inBox = !box || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
    // Fora da caixa conta pouco: desempata entre peças, sem trocar a principal.
    score[id] = score[id]! + (inBox ? 1 : 0.01);
  }
  let best = 1;
  for (let id = 2; id < sizes.length; id++) if (score[id]! > score[best]!) best = id;
  const one: Mask = { w: SAL, h: SAL, data: new Uint8Array(SAL * SAL) };
  for (let i = 0; i < label.length; i++) one.data[i] = label[i] === best ? 1 : 0;
  const filled = fillHoles(one);
  const area = filled.data.reduce((a, v) => a + v, 0) / filled.data.length;
  if (area < 0.02 || area > 0.94) return null;
  return filled;
}

/** Caixa (0–1) do que é item na máscara. */
export function maskBox(m: Mask): NBox | null {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.data[y * m.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x0: x0 / m.w, y0: y0 / m.h, x1: (x1 + 1) / m.w, y1: (y1 + 1) / m.h };
}

/** Junta uma elipse (caixa do prato) à máscara: o prato inteiro conta como item. */
export function withEllipse(m: Mask, b: NBox): Mask {
  const data = m.data.slice();
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const rx = (b.x1 - b.x0) / 2;
  const ry = (b.y1 - b.y0) / 2;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const dx = ((x + 0.5) / m.w - cx) / rx;
      const dy = ((y + 0.5) / m.h - cy) / ry;
      if (dx * dx + dy * dy <= 1) data[y * m.w + x] = 1;
    }
  return { ...m, data };
}

/** Uma linha da silhueta: altura na foto (0–1, de cima) e o trecho do item nela (0–1). */
export interface SilRow {
  v: number;
  left: number;
  right: number;
}

/**
 * Silhueta do item, de baixo para cima: em cada linha, o trecho contínuo que passa pelo eixo do
 * item (a asa da caneca ou a batata encostada ficam de fora). As pontas finas de sombra embaixo
 * saem; a largura é suavizada para o perfil não sair serrilhado.
 */
export function silhouette(
  m: Mask,
  /** Copo e xícara: a largura é a do lado mais estreito do eixo (a asa não entra). */
  symmetric = false,
): SilRow[] | null {
  // Eixo: a coluna do meio do item (mediana dos pontos), firme contra a asa de um lado só.
  const cols = new Float64Array(m.w);
  let total = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.data[y * m.w + x]) {
        cols[x] = cols[x]! + 1;
        total++;
      }
  if (!total) return null;
  let acc = 0;
  let axis = 0;
  for (let x = 0; x < m.w; x++) {
    acc += cols[x]!;
    if (acc >= total / 2) {
      axis = x;
      break;
    }
  }
  /** Em cada linha, o trecho contínuo do item que passa mais perto do eixo. */
  const runsAt = (ax: number) => {
    const out: { y: number; l: number; r: number }[] = [];
    for (let y = 0; y < m.h; y++) {
      const row = y * m.w;
      let start = -1;
      for (let d = 0; d < m.w && start < 0; d++) {
        if (ax - d >= 0 && m.data[row + ax - d]) start = ax - d;
        else if (ax + d < m.w && m.data[row + ax + d]) start = ax + d;
      }
      if (start < 0) continue;
      let l = start;
      let r = start;
      while (l > 0 && m.data[row + l - 1]) l--;
      while (r < m.w - 1 && m.data[row + r + 1]) r++;
      out.push({ y, l, r: r + 1 });
    }
    return out;
  };
  // A mediana das colunas puxa para o lado da asa; o meio de cada linha (mediana) não.
  const mids = runsAt(axis)
    .map((r) => (r.l + r.r) / 2)
    .sort((a, b) => a - b);
  const center = mids.length ? mids[Math.floor(mids.length / 2)]! : axis + 0.5;
  const rows = runsAt(Math.min(m.w - 1, Math.max(0, Math.floor(center)))).map((r) => {
    if (!symmetric) return r;
    const half = Math.max(0.5, Math.min(center - r.l, r.r - center));
    return { y: r.y, l: center - half, r: center + half };
  });
  if (rows.length < 6) return null;
  const width = (i: number) => rows[i]!.r - rows[i]!.l;
  const max = Math.max(...rows.map((_, i) => width(i)));
  // Sombra e migalha embaixo: corta enquanto a linha for bem mais estreita que o item.
  let end = rows.length - 1;
  while (end > rows.length / 2 && width(end) < max * 0.3) end--;
  let begin = 0;
  // Palito, folhinha ou espuma fina em cima: começa onde o item já tem corpo.
  while (begin < end / 2 && width(begin) < max * 0.12) begin++;
  const kept = rows.slice(begin, end + 1);
  if (kept.length < 6) return null;
  // Média móvel de 5 linhas nas bordas.
  const smooth = kept.map((row, i) => {
    let l = 0;
    let r = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(kept.length - 1, i + 2); k++) {
      l += kept[k]!.l;
      r += kept[k]!.r;
      n++;
    }
    return { v: (row.y + 0.5) / m.h, left: l / n / m.w, right: r / n / m.w };
  });
  return smooth.reverse();
}

/**
 * Troca o fundo da foto pela cor do item mais perto (espalha a borda do item para fora, em
 * camadas). A textura continua a mesma foto onde é item; fora dele, nenhum fundo escuro aparece
 * nas laterais, atrás e embaixo do modelo.
 */
export function bleedBackground(rgba: Rgba, w: number, h: number, m: Mask): Uint8Array {
  // Cores na grade da máscara: média do item em cada célula, espalhada para as vazias.
  const gw = m.w;
  const gh = m.h;
  const sum = new Float64Array(gw * gh * 3);
  const cnt = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / h));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / w));
      const g = gy * gw + gx;
      if (!m.data[g]) continue;
      const i = (y * w + x) * 4;
      sum[g * 3] = sum[g * 3]! + rgba[i]!;
      sum[g * 3 + 1] = sum[g * 3 + 1]! + rgba[i + 1]!;
      sum[g * 3 + 2] = sum[g * 3 + 2]! + rgba[i + 2]!;
      cnt[g] = cnt[g]! + 1;
    }
  }
  const col = new Float32Array(gw * gh * 3);
  const has = new Uint8Array(gw * gh);
  // Só as células bem dentro do item dão cor: na beirada a média já pega um pouco do fundo.
  for (let g = 0; g < gw * gh; g++) {
    if (!cnt[g]) continue;
    const x = g % gw;
    const y = (g - x) / gw;
    const inner =
      (x === 0 || m.data[g - 1]) &&
      (x === gw - 1 || m.data[g + 1]) &&
      (y === 0 || m.data[g - gw]) &&
      (y === gh - 1 || m.data[g + gw]);
    if (!inner) continue;
    for (let c = 0; c < 3; c++) col[g * 3 + c] = sum[g * 3 + c]! / cnt[g]!;
    has[g] = 1;
  }
  if (!has.some(Boolean)) return Uint8Array.from(rgba);
  let front: number[] = [];
  for (let g = 0; g < gw * gh; g++) if (has[g]) front.push(g);
  while (front.length) {
    const next: number[] = [];
    const seen = new Set<number>();
    for (const g of front) {
      const x = g % gw;
      for (const q of [x > 0 ? g - 1 : -1, x < gw - 1 ? g + 1 : -1, g - gw, g + gw])
        if (q >= 0 && q < gw * gh && !has[q] && !seen.has(q)) {
          seen.add(q);
          next.push(q);
        }
    }
    for (const q of next) {
      const x = q % gw;
      let n = 0;
      const c3 = [0, 0, 0];
      for (const p of [x > 0 ? q - 1 : -1, x < gw - 1 ? q + 1 : -1, q - gw, q + gw])
        if (p >= 0 && p < gw * gh && has[p]) {
          for (let c = 0; c < 3; c++) c3[c] = c3[c]! + col[p * 3 + c]!;
          n++;
        }
      for (let c = 0; c < 3; c++) col[q * 3 + c] = c3[c]! / n;
    }
    for (const q of next) has[q] = 1;
    front = next;
  }
  const out = Uint8Array.from(rgba);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / h));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / w));
      const g = gy * gw + gx;
      if (m.data[g]) continue;
      const i = (y * w + x) * 4;
      out[i] = col[g * 3]!;
      out[i + 1] = col[g * 3 + 1]!;
      out[i + 2] = col[g * 3 + 2]!;
      out[i + 3] = 255;
    }
  }
  return out;
}
