import { Document, Logger, NodeIO, Verbosity } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  draco,
  getBounds,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { unzipSync } from 'fflate';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { posix } from 'node:path';
import sharp from 'sharp';

/**
 * Estúdio 3D do Comandou: pega o modelo que veio do escaneamento (ou da IA) e deixa ele leve para
 * abrir no celular do cliente. Tudo roda no próprio servidor, sem serviço de fora:
 * junta vértices repetidos, reduz a malha se ela for pesada demais, troca as texturas por WebP
 * menores, comprime a geometria (Draco) e põe o prato em pé no chão, no tamanho real.
 */

/** Limite do arquivo que vai para o cardápio (o mesmo da tabela product_models). */
export const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
/** Triângulos que um celular comum gira sem engasgar. */
export const MAX_TRIANGLES = 120_000;
/** Lado máximo das texturas; se o resultado passar do limite, tenta de novo com metade. */
const TEXTURE_SIZES = [2048, 1024, 512] as const;

export interface OptimizeOptions {
  /** Maior medida do prato, em centímetros. Sem ela, só corrige escala absurda (IA, unidade errada). */
  sizeCm?: number | null;
}

export interface OptimizeStats {
  inputBytes: number;
  outputBytes: number;
  trianglesBefore: number;
  trianglesAfter: number;
  textures: number;
  textureSize: number;
  /** Medidas finais (largura, altura, profundidade) em centímetros. */
  sizeCm: [number, number, number];
}

export class ModelInputError extends Error {}

let io: Promise<NodeIO> | null = null;
function getIO() {
  io ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptSimplifier.ready;
    return new NodeIO()
      .setLogger(new Logger(Verbosity.ERROR))
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
        'meshopt.decoder': MeshoptDecoder,
      });
  })();
  io.catch(() => (io = null));
  return io;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isGlb = (b: Uint8Array) =>
  b.length >= 12 && Buffer.from(b.buffer, b.byteOffset, 4).toString('latin1') === 'glTF';

/** Lê GLB, ou um .zip com um .gltf (e os .bin e texturas ao lado) ou com um .glb dentro. */
export async function readModel(input: Uint8Array): Promise<Document> {
  const nio = await getIO();
  try {
    if (isGlb(input)) return await nio.readBinary(input);
    if (!isZip(input)) throw new ModelInputError('Envie um arquivo .glb ou um .zip com o .gltf');
    const files = unzipSync(input);
    const names = Object.keys(files).filter((n) => !n.startsWith('__MACOSX/'));
    const glb = names.find((n) => n.toLowerCase().endsWith('.glb'));
    if (glb) return await nio.readBinary(files[glb]!);
    const gltf = names.find((n) => n.toLowerCase().endsWith('.gltf'));
    if (!gltf) throw new ModelInputError('O .zip não tem nenhum arquivo .gltf ou .glb');
    const dir = posix.dirname(gltf);
    const json = JSON.parse(Buffer.from(files[gltf]!).toString('utf8')) as {
      buffers?: { uri?: string }[];
      images?: { uri?: string }[];
    };
    const resources: Record<string, Uint8Array> = {};
    for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (!ref.uri || ref.uri.startsWith('data:')) continue;
      const path = posix.normalize(posix.join(dir, decodeURIComponent(ref.uri)));
      const bytes = files[path];
      if (!bytes) throw new ModelInputError(`Falta o arquivo ${ref.uri} dentro do .zip`);
      resources[ref.uri] = bytes;
    }
    return await nio.readJSON({ json: json as never, resources: resources as never });
  } catch (e) {
    if (e instanceof ModelInputError) throw e;
    throw new ModelInputError(`Não foi possível ler o modelo: ${(e as Error).message}`);
  }
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      if (mode !== 4 && mode !== 5 && mode !== 6) continue; // só triângulos
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
      n += mode === 4 ? Math.floor(count / 3) : Math.max(0, count - 2);
    }
  return n;
}

/**
 * Coloca o prato com a base no chão (y = 0), centralizado, e na escala certa. Escaneamentos já vêm
 * em metros; a IA costuma devolver o objeto com 1 a 2 "metros": aí vale o tamanho pedido
 * (ou 25 cm, um prato comum).
 */
export function placeOnGround(doc: Document, sizeCm?: number | null): [number, number, number] {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new ModelInputError('O modelo não tem nenhuma cena');
  const { min, max } = getBounds(scene);
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const largest = Math.max(...dims);
  if (!Number.isFinite(largest) || largest <= 0)
    throw new ModelInputError('O modelo está vazio (sem malha visível)');
  let target = sizeCm ? sizeCm / 100 : largest;
  if (!sizeCm && (largest > 1.5 || largest < 0.03)) target = 0.25;
  const s = target / largest;
  const wrap = doc
    .createNode('Comandou')
    .setScale([s, s, s])
    .setTranslation([-((min[0] + max[0]) / 2) * s, -min[1] * s, -((min[2] + max[2]) / 2) * s]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrap.addChild(child);
  }
  scene.addChild(wrap);
  return dims.map((d) => Math.round(d * s * 1000) / 10) as [number, number, number];
}

/** Modelo pronto para o cardápio: GLB leve, com Draco e texturas WebP. */
export async function optimizeModel(
  input: Uint8Array,
  opts: OptimizeOptions = {},
): Promise<{ glb: Buffer; stats: OptimizeStats }> {
  const nio = await getIO();
  const base = await readModel(input);
  const trianglesBefore = countTriangles(base);
  if (trianglesBefore === 0) throw new ModelInputError('O modelo não tem nenhuma malha');
  const sizeCm = placeOnGround(base, opts.sizeCm);
  await base.transform(dedup(), prune(), weld());
  if (countTriangles(base) > MAX_TRIANGLES)
    await base.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: MAX_TRIANGLES / countTriangles(base),
        error: 0.01,
      }),
    );
  const trianglesAfter = countTriangles(base);
  // Cada tentativa parte de uma cópia: reduzir a textura duas vezes perderia qualidade à toa.
  const geometry = await nio.writeBinary(base);
  for (const side of TEXTURE_SIZES) {
    const doc = await nio.readBinary(geometry);
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [side, side],
        quality: 82,
      }),
      draco({ method: 'edgebreaker' }),
    );
    const glb = Buffer.from(await nio.writeBinary(doc));
    if (glb.length <= MAX_OUTPUT_BYTES || side === TEXTURE_SIZES[TEXTURE_SIZES.length - 1]) {
      if (glb.length > MAX_OUTPUT_BYTES)
        throw new ModelInputError(
          'Mesmo reduzido, o modelo passou de 12 MB. Exporte com menos detalhe e envie de novo.',
        );
      return {
        glb,
        stats: {
          inputBytes: input.length,
          outputBytes: glb.length,
          trianglesBefore,
          trianglesAfter,
          textures: doc.getRoot().listTextures().length,
          textureSize: side,
          sizeCm,
        },
      };
    }
  }
  throw new Error('inalcançável');
}
