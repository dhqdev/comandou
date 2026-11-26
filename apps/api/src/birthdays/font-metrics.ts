/**
 * Largura do texto pela própria fonte TrueType (tabelas cmap formato 4 e hmtx), para a arte do
 * aniversário caber na imagem: o nome do cliente encolhe até caber, sem cortar letra. Não lê
 * kerning (a diferença é pequena; quem usa deixa uma folga).
 */
export interface FontMetrics {
  /** Unidades por em (2048 na Inter, 1000 na Pacifico). */
  unitsPerEm: number;
  /** Largura de um caractere em unidades da fonte, ou null se a fonte não tem o desenho dele. */
  advance(codePoint: number): number | null;
}

function tables(b: Buffer) {
  const n = b.readUInt16BE(4);
  const out = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    out.set(b.toString('latin1', r, r + 4), {
      offset: b.readUInt32BE(r + 8),
      length: b.readUInt32BE(r + 12),
    });
  }
  return out;
}

/** Lê as medidas de uma fonte TrueType (.ttf). */
export function parseFont(b: Buffer): FontMetrics {
  const t = tables(b);
  const head = t.get('head');
  const hhea = t.get('hhea');
  const hmtx = t.get('hmtx');
  const cmap = t.get('cmap');
  if (!head || !hhea || !hmtx || !cmap) throw new Error('fonte sem as tabelas de medida');
  const unitsPerEm = b.readUInt16BE(head.offset + 18);
  const numHMetrics = b.readUInt16BE(hhea.offset + 34);
  const widthOf = (gid: number) => b.readUInt16BE(hmtx.offset + Math.min(gid, numHMetrics - 1) * 4);

  // Subtabela Unicode BMP no formato 4 (Windows 3/1 ou Unicode 0/3).
  let sub = -1;
  const count = b.readUInt16BE(cmap.offset + 2);
  for (let i = 0; i < count; i++) {
    const r = cmap.offset + 4 + i * 8;
    const platform = b.readUInt16BE(r);
    const encoding = b.readUInt16BE(r + 2);
    const at = cmap.offset + b.readUInt32BE(r + 4);
    if (b.readUInt16BE(at) !== 4) continue;
    if ((platform === 3 && encoding === 1) || platform === 0) {
      sub = at;
      if (platform === 3) break;
    }
  }
  if (sub < 0) throw new Error('fonte sem mapa Unicode (cmap 4)');
  const segs = b.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;

  const glyph = (c: number) => {
    if (c > 0xffff) return 0;
    for (let i = 0; i < segs; i++) {
      if (b.readUInt16BE(ends + i * 2) < c) continue;
      const start = b.readUInt16BE(starts + i * 2);
      if (start > c) return 0;
      const delta = b.readInt16BE(deltas + i * 2);
      const rangeAt = ranges + i * 2;
      const range = b.readUInt16BE(rangeAt);
      if (range === 0) return (c + delta) & 0xffff;
      const g = b.readUInt16BE(rangeAt + range + (c - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const cache = new Map<number, number | null>();
  return {
    unitsPerEm,
    advance(c) {
      if (cache.has(c)) return cache.get(c)!;
      const g = glyph(c);
      const w = g === 0 ? null : widthOf(g);
      cache.set(c, w);
      return w;
    },
  };
}

/** Largura do texto em pixels no tamanho dado (caractere que a fonte não tem conta como "o"). */
export function textWidth(f: FontMetrics, text: string, size: number, letterSpacing = 0) {
  let units = 0;
  let n = 0;
  for (const ch of text) {
    units += f.advance(ch.codePointAt(0)!) ?? f.advance(0x6f) ?? f.unitsPerEm / 2;
    n++;
  }
  return (units / f.unitsPerEm) * size + Math.max(0, n - 1) * letterSpacing;
}

/** A fonte tem desenho para todos os caracteres (espaço incluso)? */
export const covers = (f: FontMetrics, text: string) =>
  [...text].every((ch) => f.advance(ch.codePointAt(0)!) !== null);
