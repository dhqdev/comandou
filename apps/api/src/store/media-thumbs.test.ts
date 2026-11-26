import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../birthdays/birthday-image';
import { isThumbWidth, makeThumb, MediaMemory, ThumbQueue } from './media-thumbs';

const DEMO = join(__dirname, '..', '..', 'db', 'demo', 'fumaca');

/** Tamanho de um WebP pelo cabeçalho (VP8, VP8L ou VP8X). */
function webpSize(b: Buffer) {
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') {
    const n = b.readUInt32LE(21);
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
  }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

describe('miniaturas das fotos', () => {
  it('aceita só os tamanhos combinados', () => {
    expect(isThumbWidth(320)).toBe(true);
    expect(isThumbWidth(640)).toBe(true);
    expect(isThumbWidth(1600)).toBe(false);
  });

  it('reduz o WebP para o lado maior pedido e fica bem menor', async () => {
    const bytes = readFileSync(join(DEMO, 'porcao-rustica.webp'));
    const t = await makeThumb({ type: 'image/webp', bytes }, 320);
    expect(t.type).toBe('image/webp');
    expect(Math.max(webpSize(t.bytes).w, webpSize(t.bytes).h)).toBe(320);
    expect(t.bytes.length).toBeLessThan(bytes.length / 3);
  });

  it('abre PNG e devolve WebP', async () => {
    const w = 900;
    const h = 600;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = (i * 7) % 256;
      px[i * 4 + 1] = (i * 13) % 256;
      px[i * 4 + 2] = (i % w) % 256;
      px[i * 4 + 3] = 255;
    }
    const png = encodePng(w, h, px);
    const t = await makeThumb({ type: 'image/png', bytes: png }, 640);
    expect(t.type).toBe('image/webp');
    expect(webpSize(t.bytes)).toEqual({ w: 640, h: 427 });
  });

  it('abre JPEG', async () => {
    const enc = await import('@jsquash/jpeg/encode.js');
    await enc.init(
      new WebAssembly.Module(
        readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
      ),
    );
    const w = 1200;
    const h = 900;
    const px = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 31) % 256));
    const jpg = Buffer.from(
      await enc.default({ data: px, width: w, height: h, colorSpace: 'srgb' } as ImageData, {
        quality: 90,
      }),
    );
    const t = await makeThumb({ type: 'image/jpeg', bytes: jpg }, 320);
    expect(t.type).toBe('image/webp');
    expect(webpSize(t.bytes)).toEqual({ w: 320, h: 240 });
  });

  it('foto já pequena volta como está', async () => {
    const png = encodePng(200, 100, new Uint8Array(200 * 100 * 4).fill(200));
    const t = await makeThumb({ type: 'image/png', bytes: png }, 320);
    expect(t.bytes).toBe(png);
  });
});

describe('fila das miniaturas', () => {
  it('uma de cada vez, e o mesmo pedido em andamento não roda duas vezes', async () => {
    const q = new ThumbQueue(2, 1);
    let at = 0;
    let max = 0;
    let runs = 0;
    const job = () => async () => {
      runs++;
      max = Math.max(max, ++at);
      await new Promise((r) => setTimeout(r, 5));
      at--;
      return runs;
    };
    const [a, b, c] = await Promise.all([q.run('x', job()), q.run('x', job()), q.run('y', job())]);
    expect(a).toBe(b);
    expect(c).toBe(2);
    expect(max).toBe(1);
  });

  it('avisa quando a espera está cheia', () => {
    const q = new ThumbQueue(1, 1);
    const never = () => new Promise<void>(() => undefined);
    void q.run('a', never);
    expect(q.busy).toBe(false);
    void q.run('b', never);
    expect(q.busy).toBe(true);
  });
});

describe('fotos na memória', () => {
  const v = (n: number) => ({ type: 'image/webp', bytes: Buffer.alloc(n) });

  it('tira a menos usada quando passa do limite', () => {
    const m = new MediaMemory(30, 20);
    m.set('t1:a', v(10));
    m.set('t1:b', v(10));
    m.get('t1:a');
    m.set('t1:c', v(15));
    expect(m.get('t1:b')).toBeUndefined();
    expect(m.get('t1:a')).toBeDefined();
    expect(m.get('t1:c')).toBeDefined();
    expect(m.size).toBe(25);
  });

  it('não guarda foto grande demais e esquece um restaurante', () => {
    const m = new MediaMemory(100, 20);
    m.set('t1:a', v(30));
    expect(m.get('t1:a')).toBeUndefined();
    m.set('t1:b', v(10));
    m.set('t2:b', v(10));
    m.forgetTenant('t1');
    expect(m.get('t1:b')).toBeUndefined();
    expect(m.get('t2:b')).toBeDefined();
    expect(m.size).toBe(10);
  });
});
