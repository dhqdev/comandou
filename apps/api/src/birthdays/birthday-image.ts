import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { type ArtFonts, type ArtInput, birthdayArtSvg } from './birthday-art';
import { parseFont } from './font-metrics';

/**
 * Transforma a arte do parabéns (SVG de `birthday-art.ts`) em PNG, sem dependência nativa: o
 * resvg em WebAssembly desenha e as fontes vêm de assets/fonts (subconjunto latino da Inter, da
 * Pacifico e da Playfair Display, SIL OFL). A logo da loja costuma estar em WebP, que o resvg não
 * lê: o decodificador WebP (também WebAssembly) abre, reduzimos e regravamos em PNG.
 */

export const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_FILES = {
  body: 'Inter_500Medium.ttf',
  bold: 'Inter_800ExtraBold.ttf',
  script: 'Pacifico_400Regular.ttf',
  serif: 'PlayfairDisplay_700Bold_Italic.ttf',
} as const;

/** Logo maior que isso é reduzida antes de entrar na arte (o círculo tem ~220 px). */
const LOGO_MAX = 360;

type Resvg = typeof import('@resvg/resvg-wasm');
let engine: Promise<{ resvg: Resvg; buffers: Uint8Array[]; metrics: ArtFonts }> | null = null;

/** Liga o resvg e carrega as fontes uma vez por processo. */
function load() {
  engine ??= (async () => {
    const resvg = (await import('@resvg/resvg-wasm')) as Resvg;
    await resvg.initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const files = Object.entries(FONT_FILES).map(
      ([k, f]) => [k, readFileSync(join(FONTS_DIR, f))] as const,
    );
    return {
      resvg,
      buffers: files.map(([, b]) => new Uint8Array(b)),
      metrics: Object.fromEntries(files.map(([k, b]) => [k, parseFont(b)])) as ArtFonts,
    };
  })().catch((e: unknown) => {
    engine = null;
    throw e;
  });
  return engine;
}

/** Medidas das fontes da arte (para os testes e para montar o SVG). */
export async function artFonts() {
  return (await load()).metrics;
}

/** Desenha a arte e devolve o PNG. */
export async function renderBirthdayArt(a: ArtInput) {
  const e = await load();
  const svg = birthdayArtSvg(a, e.metrics);
  const r = new e.resvg.Resvg(svg, {
    font: { fontBuffers: e.buffers, defaultFontFamily: 'Inter', loadSystemFonts: false },
    fitTo: { mode: 'width', value: 1080 },
  } as ConstructorParameters<Resvg['Resvg']>[1]);
  const png = r.render().asPng();
  r.free();
  return Buffer.from(png);
}

/**
 * Desenha outro SVG com o mesmo motor e as mesmas fontes (o cartão do cardápio do WhatsApp,
 * `chat/wa-media.ts`) e devolve os pixels RGBA.
 */
export async function renderSvgPixels(svg: string, width: number) {
  const e = await load();
  const r = new e.resvg.Resvg(svg, {
    font: { fontBuffers: e.buffers, defaultFontFamily: 'Inter', loadSystemFonts: false },
    fitTo: { mode: 'width', value: width },
  } as ConstructorParameters<Resvg['Resvg']>[1]);
  const img = r.render();
  const out = { width: img.width, height: img.height, pixels: img.pixels };
  img.free();
  r.free();
  return out;
}

// ------------------------------------------------------------------ logo

/** PNG RGBA 8 bits a partir dos pixels (sem filtro; o deflate resolve). */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray) {
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reduz pela média da área (fica nítido, sem serrilhado). */
export function shrink(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  max: number,
) {
  const k = Math.max(width, height) / max;
  if (k <= 1) return { width, height, data: rgba };
  const w = Math.max(1, Math.round(width / k));
  const h = Math.max(1, Math.round(height / k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * k);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          const al = rgba[i + 3]!;
          // Cor pesada pela transparência: a borda da logo não fica com halo escuro.
          r += rgba[i]! * al;
          g += rgba[i + 1]! * al;
          b += rgba[i + 2]! * al;
          a += al;
          n++;
        }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

type WebpDecode = typeof import('@jsquash/webp/decode.js');
let webp: Promise<WebpDecode> | null = null;

async function decodeWebp(bytes: Buffer) {
  webp ??= (async () => {
    const m = (await import('@jsquash/webp/decode.js')) as WebpDecode;
    const wasm = readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'));
    await m.init(new WebAssembly.Module(wasm));
    return m;
  })().catch((e: unknown) => {
    webp = null;
    throw e;
  });
  const m = await webp;
  return m.default(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
  );
}

/**
 * A logo pronta para a arte (data URI). PNG e JPEG entram como estão; WebP é aberto e regravado
 * em PNG, reduzido. Logo que não abre fica de fora (a arte usa as iniciais da loja).
 */
export async function logoForArt(m: { type: string; bytes: Buffer } | null | undefined) {
  if (!m?.bytes?.length) return null;
  try {
    if (m.type === 'image/png' || m.type === 'image/jpeg')
      return `data:${m.type};base64,${m.bytes.toString('base64')}`;
    if (m.type !== 'image/webp') return null;
    const img = await decodeWebp(m.bytes);
    const s = shrink(img.width, img.height, img.data, LOGO_MAX);
    return `data:image/png;base64,${encodePng(s.width, s.height, s.data).toString('base64')}`;
  } catch {
    return null;
  }
}
