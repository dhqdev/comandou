import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SAL,
  bleedBackground,
  maskBox,
  maskFromSaliency,
  modelInput,
  silhouette,
  withEllipse,
  type Mask,
} from './cutout';
import { cutPhoto } from './cutout-run';
import { buildDish, normalizeShape, readGlbJson, usesSilhouette, writeGlb } from './dish3d';

/** Mapa do modelo desenhado à mão: 1 dentro das formas, 0 fora. */
function draw(...shapes: ((x: number, y: number) => boolean)[]) {
  const sal = new Float32Array(SAL * SAL);
  for (let y = 0; y < SAL; y++)
    for (let x = 0; x < SAL; x++)
      if (shapes.some((f) => f((x + 0.5) / SAL, (y + 0.5) / SAL))) sal[y * SAL + x] = 1;
  return sal;
}
const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;
const area = (m: Mask) => m.data.reduce((a, v) => a + v, 0) / m.data.length;

describe('Recorte do item na foto (cutout)', () => {
  it('fica com a peça principal (a da caixa da IA) e fecha os buracos', () => {
    // Lanche no meio com um buraco (reflexo) e uma batata solta no canto.
    const sal = draw(ellipse(0.5, 0.5, 0.3, 0.25), ellipse(0.88, 0.88, 0.1, 0.1));
    for (let y = 150; y < 170; y++) for (let x = 150; x < 170; x++) sal[y * SAL + x] = 0;
    const m = maskFromSaliency(sal, { x0: 0.2, y0: 0.25, x1: 0.8, y1: 0.75 })!;
    expect(m).not.toBeNull();
    expect(m.data[160 * SAL + 160]).toBe(1);
    expect(m.data[Math.floor(0.88 * SAL) * SAL + Math.floor(0.88 * SAL)]).toBe(0);
    const b = maskBox(m)!;
    expect(b.x0).toBeCloseTo(0.2, 1);
    expect(b.x1).toBeCloseTo(0.8, 1);
    // A caixa aponta a batata: ela vira a principal.
    const fries = maskFromSaliency(sal, { x0: 0.78, y0: 0.78, x1: 0.98, y1: 0.98 })!;
    expect(maskBox(fries)!.x0).toBeGreaterThan(0.75);
  });

  it('recorte que não serve volta null (o 3D sai como antes)', () => {
    expect(maskFromSaliency(new Float32Array(SAL * SAL), null)).toBeNull();
    expect(
      maskFromSaliency(
        draw(() => true),
        null,
      ),
    ).toBeNull();
    expect(maskFromSaliency(draw(ellipse(0.5, 0.5, 0.03, 0.03)), null)).toBeNull();
  });

  it('com clip, o que encosta no lanche fora da caixa sai', () => {
    // Lanche colado na cestinha de batata à direita.
    const sal = draw(ellipse(0.35, 0.5, 0.2, 0.2), rect(0.5, 0.3, 0.9, 0.7));
    const loose = maskFromSaliency(sal, { x0: 0.15, y0: 0.3, x1: 0.55, y1: 0.7 })!;
    const clipped = maskFromSaliency(sal, { x0: 0.15, y0: 0.3, x1: 0.55, y1: 0.7 }, true)!;
    expect(maskBox(loose)!.x1).toBeGreaterThan(0.85);
    expect(maskBox(clipped)!.x1).toBeLessThan(0.6);
  });

  it('silhueta de baixo para cima, sem a asa da caneca nem o palito', () => {
    const mug = draw(
      rect(0.35, 0.2, 0.6, 0.9), // corpo
      rect(0.6, 0.25, 0.75, 0.3), // asa: em cima
      rect(0.7, 0.25, 0.75, 0.6), // asa: lado
      rect(0.6, 0.55, 0.75, 0.6), // asa: embaixo
      rect(0.47, 0.05, 0.48, 0.2), // palito
    );
    const m = maskFromSaliency(mug, null)!;
    const rows = silhouette(m, true)!;
    expect(rows[0]!.v).toBeGreaterThan(rows[rows.length - 1]!.v);
    for (const r of rows) {
      expect(r.right - r.left).toBeLessThan(0.27);
      expect(r.right).toBeLessThan(0.62);
    }
    // O palito fino em cima não vira um bico no modelo.
    expect(rows[rows.length - 1]!.v).toBeGreaterThan(0.18);
    // Sem simetria (lanche), a largura é a da linha inteira que passa pelo eixo.
    const burger = silhouette(maskFromSaliency(draw(ellipse(0.5, 0.5, 0.3, 0.2)), null)!)!;
    const widest = Math.max(...burger.map((r) => r.right - r.left));
    expect(widest).toBeCloseTo(0.6, 1);
  });

  it('o fundo vira a cor do item; o item fica igual', () => {
    const w = 64;
    const h = 64;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const inside = ((x - 32) / 16) ** 2 + ((y - 32) / 16) ** 2 <= 1;
      rgba.set(inside ? [200, 120, 40, 255] : [10, 10, 12, 255], i * 4);
    }
    const m = maskFromSaliency(draw(ellipse(0.5, 0.5, 0.25, 0.25)), null)!;
    const out = bleedBackground(rgba, w, h, m);
    // Canto (fundo escuro) agora tem a cor do pão.
    expect(out[0]).toBeGreaterThan(150);
    expect(out[2]).toBeLessThan(80);
    // Centro do item: o mesmo pixel.
    const c = (32 * w + 32) * 4;
    expect([...out.subarray(c, c + 4)]).toEqual([200, 120, 40, 255]);
    // O prato inteiro (elipse da caixa) conta como item.
    expect(area(withEllipse(m, { x0: 0, y0: 0, x1: 1, y1: 1 }))).toBeGreaterThan(0.75);
  });

  it('lanche pela silhueta: GLB válido, no chão, do tamanho pedido e com o formato dela', () => {
    // Pão de cima redondo e mais largo que o de baixo.
    const m = maskFromSaliency(
      draw(ellipse(0.5, 0.4, 0.32, 0.22), rect(0.25, 0.4, 0.75, 0.7)),
      null,
    )!;
    const rows = silhouette(m)!;
    const s = normalizeShape({ kind: 'stack', view: 'angle', diameterCm: 12, heightCm: 10 });
    expect(usesSilhouette(s)).toBe(true);
    expect(usesSilhouette({ ...s, kind: 'other' })).toBe(true);
    expect(usesSilhouette({ ...s, kind: 'plate' })).toBe(false);
    const mesh = buildDish(s, 640, 480, rows);
    expect(mesh.size.width).toBeCloseTo(0.12, 5);
    const side = mesh.parts[0]!;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    let topR = 0;
    for (let i = 0; i < side.pos.length; i += 3) {
      const y = side.pos[i + 1]!;
      const r = Math.hypot(side.pos[i]!, side.pos[i + 2]!);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxR = Math.max(maxR, r);
      if (y >= 0.1 - 1e-6) topR = Math.max(topR, r);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(0.1, 5);
    expect(maxR).toBeCloseTo(0.06, 3);
    // Fecha no centro em cima (sem tampa chata larga).
    expect(topR).toBeLessThan(0.002);
    expect(side.uv!.every((v) => v >= 0 && v <= 1)).toBe(true);
    const glb = writeGlb(mesh, {
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
    });
    expect(readGlbJson(glb).asset).toMatchObject({ version: '2.0' });
  });

  it('entrada do modelo: 3 × 320 × 320 normalizada', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    const x = modelInput(rgba, 4, 4);
    expect(x.length).toBe(3 * SAL * SAL);
    expect(x[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
  });

  it('foto de verdade: recorta o lanche do fundo escuro e da mesa', async () => {
    const photo = join(
      __dirname,
      '..',
      '..',
      '..',
      'web',
      'public',
      'site',
      'food',
      'burger-crispy.webp',
    );
    const cut = await cutPhoto(
      { bytes: readFileSync(photo), mime: 'image/webp' },
      { x0: 0.1, y0: 0.08, x1: 0.9, y1: 0.85 },
      { clip: true },
    );
    expect(cut).not.toBeNull();
    const at = (x: number, y: number) =>
      cut!.mask.data[Math.floor(y * SAL) * SAL + Math.floor(x * SAL)];
    expect(at(0.5, 0.5)).toBe(1); // recheio
    expect(at(0.5, 0.2)).toBe(1); // pão de cima
    expect(at(0.05, 0.05)).toBe(0); // fundo escuro
    expect(at(0.5, 0.95)).toBe(0); // mesa
    expect(cut!.texture.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // O canto escuro da textura virou cor de lanche (nada de fundo preto no modelo).
    const rows = silhouette(cut!.mask)!;
    const widest = Math.max(...rows.map((r) => r.right - r.left));
    expect(widest).toBeGreaterThan(0.6);
    expect(widest).toBeLessThan(0.85);
  }, 60_000);
});
