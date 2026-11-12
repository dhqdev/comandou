import { NodeIO } from '@gltf-transform/core';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { sphereDoc } from '../../test/model3d-helpers';
import { describe, expect, it } from 'vitest';
import { countTriangles, ModelInputError, optimizeModel, readModel } from './optimize';

const io = new NodeIO();

describe('optimizeModel', () => {
  it('reduz malha e textura, comprime e põe o prato no chão em tamanho de prato', async () => {
    // 2 m de diâmetro (escala de IA), 160 mil triângulos e textura de 4096 px.
    const doc = await sphereDoc({ rings: 200, segs: 400, r: 1, texture: 4096 });
    const input = await io.writeBinary(doc);
    expect(countTriangles(doc)).toBeGreaterThan(150_000);

    const { glb, stats } = await optimizeModel(input);
    expect(stats.trianglesAfter).toBeLessThanOrEqual(120_000);
    expect(stats.outputBytes).toBe(glb.length);
    expect(glb.length).toBeLessThan(input.length / 3);
    expect(Math.max(...stats.sizeCm)).toBeCloseTo(25, 0);

    const out = await readModel(glb);
    const used = out
      .getRoot()
      .listExtensionsUsed()
      .map((e) => e.extensionName);
    expect(used).toEqual(
      expect.arrayContaining(['KHR_draco_mesh_compression', 'EXT_texture_webp']),
    );
    const meta = await sharp(Buffer.from(out.getRoot().listTextures()[0]!.getImage()!)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(2048);
  }, 120_000);

  it('respeita o tamanho pedido em centímetros e a escala real de um escaneamento', async () => {
    const scan = await io.writeBinary(await sphereDoc({ rings: 16, segs: 32, r: 0.09 }));
    expect(Math.max(...(await optimizeModel(scan)).stats.sizeCm)).toBeCloseTo(18, 0);
    expect(Math.max(...(await optimizeModel(scan, { sizeCm: 30 })).stats.sizeCm)).toBeCloseTo(
      30,
      0,
    );
  });

  it('lê um .zip com .gltf, .bin e textura separados', async () => {
    const doc = await sphereDoc({ rings: 16, segs: 32, r: 0.1, texture: 64 });
    const { json, resources } = await io.writeJSON(doc, { basename: 'prato' });
    const files: Record<string, Uint8Array> = {
      'export/prato.gltf': strToU8(JSON.stringify(json)),
    };
    for (const [name, bytes] of Object.entries(resources)) files[`export/${name}`] = bytes;
    const { stats } = await optimizeModel(zipSync(files));
    expect(stats.textures).toBe(1);
    expect(stats.trianglesAfter).toBeGreaterThan(0);
  });

  it('recusa o que não é modelo, zip sem gltf e zip com arquivo faltando', async () => {
    await expect(optimizeModel(Buffer.from('não é um modelo'))).rejects.toBeInstanceOf(
      ModelInputError,
    );
    await expect(optimizeModel(zipSync({ 'leia.txt': strToU8('oi') }))).rejects.toThrow(
      /não tem nenhum arquivo .gltf/,
    );
    const { json } = await io.writeJSON(await sphereDoc({ rings: 4, segs: 8, r: 0.1 }));
    await expect(
      optimizeModel(zipSync({ 'a.gltf': strToU8(JSON.stringify(json)) })),
    ).rejects.toThrow(/Falta o arquivo/);
  });
});
