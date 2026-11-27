import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { shrink } from '../birthdays/birthday-image';
import { decodeImage } from '../store/media-thumbs';
import { bleedBackground, maskFromSaliency, modelInput, type Mask, type NBox } from './cutout';

/**
 * Recorte da foto para o 3D (cutout.ts): abre a foto, roda o modelo numa linha separada, monta a
 * máscara e a textura com o fundo trocado. Qualquer falha devolve null e o 3D sai como antes.
 */

/** Lado maior da textura do modelo: o cardápio mostra o 3D pequeno, 1280 px sobra. */
const TEXTURE_MAX = 1280;

type JpegEnc = typeof import('@jsquash/jpeg/encode.js');
let jpegEnc: Promise<JpegEnc> | null = null;
const encoder = () =>
  (jpegEnc ??= (async () => {
    const m = (await import('@jsquash/jpeg/encode.js')) as JpegEnc;
    const mod = new WebAssembly.Module(
      readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
    );
    await m.init(mod as never);
    return m;
  })().catch((e: unknown) => {
    jpegEnc = null;
    throw e;
  }));

/* ------------------------------------------------- linha separada do modelo */

const WORKER_JS = join(__dirname, 'cutout.worker.js');
let worker: Worker | null = null;
let idle: NodeJS.Timeout | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (s: Float32Array) => void; fail: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(WORKER_JS);
  w.on('message', (m: { id: number; sal?: Float32Array; error?: string }) => {
    const p = waiting.get(m.id);
    waiting.delete(m.id);
    if (!p) return;
    if (m.sal) p.ok(m.sal);
    else p.fail(new Error(m.error ?? 'recorte falhou'));
  });
  const drop = (e: Error) => {
    worker = null;
    for (const p of waiting.values()) p.fail(e);
    waiting.clear();
  };
  w.on('error', drop);
  w.on('exit', () => drop(new Error('linha do recorte saiu')));
  // Depois dos ouvintes (ouvir mensagem segura o processo de novo): a linha não prende a saída.
  w.unref();
  worker = w;
  return w;
}

/** Roda o modelo: na linha separada (build), ou aqui mesmo nos testes e no `pnpm dev`. */
async function saliency(input: Float32Array): Promise<Float32Array> {
  if (!existsSync(WORKER_JS)) {
    const { runCutoutModel } = await import('./cutout-model');
    return runCutoutModel(input);
  }
  // Muita gente montando 3D junto: quem passa da fila monta como antes, sem esperar.
  if (waiting.size >= 4) throw new Error('fila do recorte cheia');
  const w = getWorker();
  if (idle) clearTimeout(idle);
  const id = ++seq;
  const out = new Promise<Float32Array>((ok, fail) => {
    waiting.set(id, { ok, fail });
    setTimeout(() => {
      if (waiting.delete(id)) fail(new Error('recorte demorou demais'));
    }, 30_000).unref();
  });
  w.postMessage({ id, input }, [input.buffer as ArrayBuffer]);
  try {
    return await out;
  } finally {
    // Dois minutos sem uso: a linha sai e devolve a memória do modelo.
    idle = setTimeout(() => {
      if (!waiting.size) void worker?.terminate();
    }, 120_000);
    idle.unref();
  }
}

export interface Cutout {
  /** A textura (JPEG) com o fundo trocado pela cor da borda do item. */
  texture: Buffer;
  width: number;
  height: number;
  mask: Mask;
}

/**
 * Recorta o item da foto. `keep` (opcional) junta uma área que sempre conta como item, como a
 * elipse do prato, para o fundo trocado nunca comer a louça.
 */
export async function cutPhoto(
  photo: { bytes: Buffer; mime: string },
  box: NBox | null,
  opts: { clip?: boolean; keep?: (m: Mask) => Mask } = {},
): Promise<Cutout | null> {
  const img = await decodeImage(photo.mime, photo.bytes);
  const mask0 = maskFromSaliency(
    await saliency(modelInput(img.data, img.width, img.height)),
    box,
    opts.clip,
  );
  if (!mask0) return null;
  const mask = opts.keep ? opts.keep(mask0) : mask0;
  const small = shrink(img.width, img.height, img.data, TEXTURE_MAX);
  const pixels = bleedBackground(small.data, small.width, small.height, mask);
  const jpeg = await (
    await encoder()
  ).default(
    {
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      width: small.width,
      height: small.height,
      colorSpace: 'srgb',
    } as ImageData,
    { quality: 86 },
  );
  // A máscara que vale para o formato é a do item (sem a elipse): é dela que sai a silhueta.
  return { texture: Buffer.from(jpeg), width: small.width, height: small.height, mask: mask0 };
}
