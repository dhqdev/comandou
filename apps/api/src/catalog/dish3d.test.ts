import { describe, expect, it } from 'vitest';
import {
  buildDish,
  buildsAsLathe,
  cameraElevation,
  normalizeShape,
  readGlbJson,
  writeGlb,
  type BuiltMesh,
} from './dish3d';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);

interface Accessor {
  bufferView: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}
interface Gltf {
  asset: { version: string };
  meshes: {
    primitives: { attributes: Record<string, number>; indices: number; material: number }[];
  }[];
  accessors: Accessor[];
  bufferViews: { byteOffset: number; byteLength: number }[];
  images: { bufferView: number; mimeType: string }[];
  materials: { doubleSided: boolean }[];
}

/** Lê o GLB de volta e confere as contas: tamanhos, índices e números. */
function inspect(glb: Buffer) {
  expect(glb.toString('latin1', 0, 4)).toBe('glTF');
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  const jsonLen = glb.readUInt32LE(12);
  expect(jsonLen % 4).toBe(0);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a);
  const binLen = glb.readUInt32LE(20 + jsonLen);
  expect(glb.readUInt32LE(24 + jsonLen)).toBe(0x004e4942);
  const bin = glb.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  expect(28 + jsonLen + binLen).toBe(glb.length);
  const j = readGlbJson(glb) as unknown as Gltf;
  expect(j.asset.version).toBe('2.0');
  const view = (i: number) => {
    const v = j.bufferViews[i]!;
    expect(v.byteOffset % 4).toBe(0);
    expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(bin.length);
    return bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  };
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of j.meshes[0]!.primitives) {
    const pos = j.accessors[p.attributes.POSITION!]!;
    const idx = j.accessors[p.indices]!;
    const raw = view(idx.bufferView);
    const ids = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    expect(ids.length).toBe(idx.count);
    expect(Math.max(...ids)).toBeLessThan(pos.count);
    const fr = view(pos.bufferView);
    const f = new Float32Array(fr.buffer.slice(fr.byteOffset, fr.byteOffset + fr.length));
    expect(f.every(Number.isFinite)).toBe(true);
    minY = Math.min(minY, pos.min![1]!);
    maxY = Math.max(maxY, pos.max![1]!);
    if (p.attributes.TEXCOORD_0 !== undefined) {
      const ur = view(j.accessors[p.attributes.TEXCOORD_0]!.bufferView);
      const uv = new Float32Array(ur.buffer.slice(ur.byteOffset, ur.byteOffset + ur.length));
      // A foto inteira, sem sair dela (fora dela a borda esticaria).
      expect(uv.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  }
  return { j, minY, maxY };
}

/** Normais pela ordem dos vértices: quanto da superfície olha para cima / para fora. */
function facing(mesh: BuiltMesh, part: number) {
  const p = mesh.parts[part]!;
  let up = 0;
  let out = 0;
  let n = 0;
  for (let i = 0; i < p.idx.length; i += 3) {
    const [a, b, c] = [p.idx[i]! * 3, p.idx[i + 1]! * 3, p.idx[i + 2]! * 3];
    const u = [p.pos[b]! - p.pos[a]!, p.pos[b + 1]! - p.pos[a + 1]!, p.pos[b + 2]! - p.pos[a + 2]!];
    const v = [p.pos[c]! - p.pos[a]!, p.pos[c + 1]! - p.pos[a + 1]!, p.pos[c + 2]! - p.pos[a + 2]!];
    const nx = u[1]! * v[2]! - u[2]! * v[1]!;
    const ny = u[2]! * v[0]! - u[0]! * v[2]!;
    const nz = u[0]! * v[1]! - u[1]! * v[0]!;
    if (Math.hypot(nx, ny, nz) < 1e-12) continue;
    const cx = p.pos[a]! + p.pos[b]! + p.pos[c]!;
    const cz = p.pos[a + 2]! + p.pos[b + 2]! + p.pos[c + 2]!;
    up += Math.sign(ny);
    out += Math.sign(nx * cx + nz * cz);
    n++;
  }
  return { up: up / n, out: out / n };
}

describe('Item em 3D pela foto (dish3d)', () => {
  it('prato de lado (45°): GLB válido, foto embutida, base no chão e do tamanho real', () => {
    const s = normalizeShape({
      kind: 'plate',
      view: 'angle',
      box: { x0: 0.08, y0: 0.2, x1: 0.92, y1: 0.86 },
      food: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.7 },
      diameterCm: 26,
      heightCm: 3,
      foodHeightCm: 4,
    });
    expect(buildsAsLathe(s)).toBe(false);
    const mesh = buildDish(s, 1024, 768);
    const glb = writeGlb(mesh, { bytes: JPEG, mime: 'image/jpeg' }, 'Parmegiana');
    const { j, minY, maxY } = inspect(glb);
    expect(j.images[0]!.mimeType).toBe('image/jpeg');
    expect(j.materials.every((m) => m.doubleSided)).toBe(true);
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeGreaterThan(0.04);
    expect(maxY).toBeLessThan(0.07);
    expect(mesh.size.width).toBeCloseTo(0.26, 5);
    // A comida (em cima) olha para cima; a louça embaixo fecha o prato.
    expect(facing(mesh, 0).up).toBeGreaterThan(0.95);
  });

  it('copo de lado: perfil girado, paredes para fora e tampas no lugar', () => {
    const s = normalizeShape({
      kind: 'glass',
      view: 'side',
      box: { x0: 0.35, y0: 0.1, x1: 0.65, y1: 0.9 },
      diameterCm: 8,
      heightCm: 14,
    });
    expect(buildsAsLathe(s)).toBe(true);
    const mesh = buildDish(s, 768, 1024);
    const { minY, maxY } = inspect(writeGlb(mesh, { bytes: JPEG, mime: 'image/png' }));
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(0.14, 5);
    expect(facing(mesh, 0).out).toBeGreaterThan(0.95);
    expect(facing(mesh, 1).up).toBeGreaterThan(0.95);
    expect(facing(mesh, 2).up).toBeLessThan(-0.95);
  });

  it('o que a IA mandar errado vira uma forma que dá para montar', () => {
    const s = normalizeShape({
      kind: 'nave' as never,
      view: 'cima' as never,
      box: 'oops' as never,
      diameterCm: 900,
      heightCm: -3,
      foodHeightCm: Number.NaN,
      profile: [[1, 2]] as never,
    });
    expect(s.kind).toBe('other');
    expect(s.view).toBe('angle');
    expect(s.diameterCm).toBe(60);
    expect(s.heightCm).toBe(0.5);
    expect(s.profile).toBeNull();
    expect(s.box.x1 - s.box.x0).toBeGreaterThan(0.5);
    inspect(writeGlb(buildDish(s, 800, 800), { bytes: JPEG, mime: 'image/jpeg' }));
    // Caixa minúscula e invertida também não quebra.
    const tiny = normalizeShape({ box: { x0: 0.5, y0: 0.5, x1: 0.49, y1: 0.52 } });
    expect(tiny.box.x1 - tiny.box.x0).toBeGreaterThan(0.5);
  });

  it('perfil da IA: ordenado da base ao topo, preso entre 0 e 1', () => {
    const s = normalizeShape({
      kind: 'stack',
      view: 'side',
      profile: [
        [1, 0.3],
        [0.05, 0.85],
        [0.5, 1.4],
      ],
    });
    expect(s.profile).toEqual([
      [0, 0.85],
      [0.5, 1],
      [1, 0.3],
    ]);
  });

  it('ângulo da câmera sai do formato da caixa do prato', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    // Borda redonda: de cima a caixa é quadrada; a 30° fica com metade da altura.
    expect(deg(cameraElevation(100, 100, 0))).toBeCloseTo(90, 0);
    expect(deg(cameraElevation(100, 50, 0))).toBeCloseTo(30, 0);
    // Parede alta (tigela) ocupa parte da altura: o ângulo é menor que sem parede.
    expect(cameraElevation(100, 60, 0.6)).toBeLessThan(cameraElevation(100, 60, 0));
  });
});
