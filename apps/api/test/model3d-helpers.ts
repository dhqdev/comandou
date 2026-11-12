import { Document } from '@gltf-transform/core';
import sharp from 'sharp';

/** Esfera com `rings` × `segs` quadrados, raio `r` (em metros), fora da origem (como sai de um escaneamento). */
export async function sphereDoc(opts: {
  rings: number;
  segs: number;
  r: number;
  texture?: number;
}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= opts.rings; i++)
    for (let j = 0; j <= opts.segs; j++) {
      const th = (i / opts.rings) * Math.PI;
      const ph = (j / opts.segs) * Math.PI * 2;
      pos.push(
        opts.r * Math.sin(th) * Math.cos(ph) + 3,
        opts.r * Math.cos(th) + 5,
        opts.r * Math.sin(th) * Math.sin(ph),
      );
      uv.push(j / opts.segs, i / opts.rings);
    }
  const w = opts.segs + 1;
  for (let i = 0; i < opts.rings; i++)
    for (let j = 0; j < opts.segs; j++) {
      const a = i * w + j;
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer),
    )
    .setIndices(doc.createAccessor().setArray(new Uint32Array(idx)).setBuffer(buffer));
  if (opts.texture) {
    // Ruído: comprime mal em PNG, como a foto de um escaneamento.
    const px = Buffer.alloc(opts.texture * opts.texture * 3);
    for (let k = 0; k < px.length; k++) px[k] = (k * 2654435761) >>> 24;
    const png = await sharp(px, { raw: { width: opts.texture, height: opts.texture, channels: 3 } })
      .png()
      .toBuffer();
    const tex = doc.createTexture('cor').setImage(png).setMimeType('image/png');
    prim.setMaterial(doc.createMaterial('prato').setBaseColorTexture(tex));
  }
  const mesh = doc.createMesh('prato').addPrimitive(prim);
  doc.createScene('cena').addChild(doc.createNode('prato').setMesh(mesh));
  return doc;
}
