import { parentPort } from 'node:worker_threads';
import { runCutoutModel } from './cutout-model';

/**
 * Linha separada do recorte: recebe a entrada do modelo e devolve o mapa (cutout-run.ts). Um
 * pedido de cada vez (a sessão do modelo não roda dois juntos).
 */
let chain: Promise<unknown> = Promise.resolve();
parentPort?.on('message', (msg: { id: number; input: Float32Array }) => {
  chain = chain.then(() =>
    runCutoutModel(msg.input).then(
      (sal) => parentPort!.postMessage({ id: msg.id, sal }, [sal.buffer as ArrayBuffer]),
      (e: unknown) => parentPort!.postMessage({ id: msg.id, error: String(e) }),
    ),
  );
});
