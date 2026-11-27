import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAL } from './cutout';

/** O modelo do recorte (U²-Netp, Apache 2.0): veja assets/ai/models/README.md. */
export const CUTOUT_MODEL = join(__dirname, '..', '..', 'assets', 'ai', 'models', 'u2netp.onnx');

type Ort = typeof import('onnxruntime-web');
type Session = import('onnxruntime-web').InferenceSession;

let session: Promise<{ ort: Ort; s: Session }> | null = null;

function load() {
  return (session ??= (async () => {
    const ort = (await import('onnxruntime-web')) as Ort;
    // Uma linha só: quem chama já roda isto fora da linha principal da API.
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    const s = await ort.InferenceSession.create(readFileSync(CUTOUT_MODEL));
    return { ort, s };
  })().catch((e: unknown) => {
    session = null;
    throw e;
  }));
}

/** Entrada 3 × 320 × 320 (modelInput) → mapa 320 × 320 de quanto cada ponto é o item. */
export async function runCutoutModel(input: Float32Array): Promise<Float32Array> {
  const { ort, s } = await load();
  const out = await s.run({
    [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SAL, SAL]),
  });
  const t = out[s.outputNames[0]!]!;
  return Float32Array.from(t.data as Float32Array);
}
