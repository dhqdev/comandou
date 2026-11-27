import { readFileSync } from 'node:fs';
import { shrink } from '../birthdays/birthday-image';

/**
 * Miniaturas das fotos (GET /media/<id>?w=320|640). O cartão do cardápio, da Nova venda e do
 * garçom tem 100–300 px; baixar a original (até 1600 px) para cada um deixava a grade lenta,
 * principalmente no 4G. Aqui a original é aberta (WebP, JPEG ou PNG, tudo em WebAssembly, sem
 * dependência nativa), reduzida pela média da área e regravada em WebP.
 */

/** Lados maiores aceitos. Mudou aqui, mude o CHECK de media_thumbs.width (migração 0126). */
export const THUMB_WIDTHS = [320, 640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];
export const isThumbWidth = (n: number): n is ThumbWidth =>
  (THUMB_WIDTHS as readonly number[]).includes(n);

const QUALITY = 78;

type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
type Codec<T> = Promise<T> | null;

const wasm = (path: string) => new WebAssembly.Module(readFileSync(require.resolve(path)));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;

/** Carrega um codec uma vez por processo; se falhar, a próxima chamada tenta de novo. */
function lazy<T>(load: () => Promise<T>) {
  let p: Codec<T> = null;
  return () =>
    (p ??= load().catch((e: unknown) => {
      p = null;
      throw e;
    }));
}

type WebpDec = typeof import('@jsquash/webp/decode.js');
type WebpEnc = typeof import('@jsquash/webp/encode.js');
type JpegDec = typeof import('@jsquash/jpeg/decode.js');
type PngDec = typeof import('@jsquash/png/decode.js');

const webpDec = lazy(async () => {
  const m = (await import('@jsquash/webp/decode.js')) as WebpDec;
  await m.init(wasm('@jsquash/webp/codec/dec/webp_dec.wasm'));
  return m;
});
const webpEnc = lazy(async () => {
  const m = (await import('@jsquash/webp/encode.js')) as WebpEnc;
  await m.init(wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm'));
  return m;
});
const jpegDec = lazy(async () => {
  const m = (await import('@jsquash/jpeg/decode.js')) as JpegDec;
  await m.init(wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'));
  return m;
});
const pngDec = lazy(async () => {
  const m = (await import('@jsquash/png/decode.js')) as PngDec;
  await m.init(wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'));
  return m;
});

/** Abre WebP, JPEG ou PNG em RGBA (WebAssembly). */
export async function decodeImage(type: string, bytes: Buffer): Promise<Pixels> {
  if (type === 'image/webp') return (await webpDec()).default(buf(bytes));
  if (type === 'image/jpeg') return (await jpegDec()).default(buf(bytes));
  if (type === 'image/png') return (await pngDec()).default(buf(bytes));
  throw new Error(`tipo sem miniatura: ${type}`);
}

/**
 * A miniatura com o lado maior até `max`. Quando a original já é pequena, ou a reduzida não
 * ficaria menor em bytes, devolve a própria original (o cartão nunca recebe mais que hoje).
 */
export async function makeThumb(
  original: { type: string; bytes: Buffer },
  max: ThumbWidth,
): Promise<{ type: string; bytes: Buffer }> {
  const img = await decodeImage(original.type, original.bytes);
  if (Math.max(img.width, img.height) <= max) return original;
  const s = shrink(img.width, img.height, img.data, max);
  const out = await (
    await webpEnc()
  ).default(
    {
      data: new Uint8ClampedArray(s.data.buffer, s.data.byteOffset, s.data.byteLength),
      width: s.width,
      height: s.height,
      colorSpace: 'srgb',
    } as ImageData,
    { quality: QUALITY },
  );
  const bytes = Buffer.from(out);
  return bytes.length < original.bytes.length ? { type: 'image/webp', bytes } : original;
}

/**
 * Uma miniatura de cada vez: o WebAssembly roda na mesma linha do resto da API, então montar 40
 * de uma vez seguraria as outras respostas. Quem chega com a fila cheia recebe a original agora
 * (como antes) e a miniatura fica pronta para a próxima visita.
 */
export class ThumbQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxWaiting = 6,
    private readonly concurrency = 1,
  ) {}

  /** Já tem gente demais esperando: melhor servir a original agora. */
  get busy() {
    return this.waiting.length >= this.maxWaiting;
  }

  /** Roda `fn` na fila; a mesma chave em andamento devolve a mesma promessa. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const same = this.inFlight.get(key);
    if (same) return same as Promise<T>;
    const p = this.slot()
      .then(fn)
      .finally(() => {
        this.inFlight.delete(key);
        this.running--;
        this.waiting.shift()?.();
      });
    this.inFlight.set(key, p);
    return p;
  }

  private slot() {
    if (this.running < this.concurrency) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) =>
      this.waiting.push(() => {
        this.running++;
        resolve();
      }),
    );
  }
}

/**
 * Fotos já servidas, na memória do processo (as fotos nunca mudam: trocar a foto gera outro id).
 * O cardápio aberto por muitos clientes e os vários PDVs da loja deixam de ir ao banco a cada
 * foto, e não ocupam as vagas de transação do restaurante (TENANT_MAX_CONCURRENT_TX).
 */
export class MediaMemory {
  private readonly map = new Map<string, { type: string; bytes: Buffer }>();
  private total = 0;

  constructor(
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly maxItem = 1024 * 1024,
  ) {}

  get(key: string) {
    const v = this.map.get(key);
    if (!v) return undefined;
    // Mais usada vai para o fim (a que sai primeiro é a do começo).
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, v: { type: string; bytes: Buffer }) {
    if (v.bytes.length > this.maxItem || this.map.has(key)) return;
    this.map.set(key, v);
    this.total += v.bytes.length;
    for (const [k, old] of this.map) {
      if (this.total <= this.maxBytes) break;
      this.map.delete(k);
      this.total -= old.bytes.length;
    }
  }

  /** Limpar cache do restaurante (Super Admin) e testes. */
  forgetTenant(tenantId: string) {
    for (const [k, v] of this.map)
      if (k.startsWith(`${tenantId}:`)) {
        this.map.delete(k);
        this.total -= v.bytes.length;
      }
  }

  get size() {
    return this.total;
  }
}
