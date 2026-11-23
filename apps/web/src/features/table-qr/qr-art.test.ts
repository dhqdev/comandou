import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { drawnModules, inFinder, logoHole, qrArtSvg, QUIET } from './qr-art';

/** Pinta a grade que vai para o papel (com a margem) e devolve o que um leitor lê dela. */
function readBack(grid: boolean[][], px = 6) {
  const size = grid.length + QUIET * 2;
  const w = size * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  grid.forEach((row, r) =>
    row.forEach((on, c) => {
      if (!on) return;
      for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
          const i = (((r + QUIET) * px + y) * w + (c + QUIET) * px + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  return jsQR(data, w, w)?.data ?? null;
}

const LINKS = [
  'https://pizzaria.comandou.com.br/mesa/7f3c2a8e-5b1d-4c9e-a2f0-1e6d8b4c3a90',
  'https://um-nome-de-restaurante-bem-comprido.comandou.com.br/mesa/7f3c2a8e-5b1d-4c9e-a2f0-1e6d8b4c3a90',
  'http://localhost:5173/mesa/1',
];

describe('QR das mesas', () => {
  it.each(LINKS)('continua lendo com o buraco da logo: %s', (link) => {
    const m = QRCode.create(link, { errorCorrectionLevel: 'H' }).modules;
    const grid = drawnModules(m, logoHole(m.size));
    expect(readBack(grid)).toBe(link);
  });

  it('o buraco da logo fica longe dos olhos e abaixo de 7% da área', () => {
    for (const link of LINKS) {
      const { size } = QRCode.create(link, { errorCorrectionLevel: 'H' }).modules;
      const hole = logoHole(size);
      expect(hole % 2).toBe(1);
      expect((hole * hole) / (size * size)).toBeLessThan(0.07);
      const start = (size - hole) / 2;
      for (let r = start; r < start + hole; r++)
        for (let c = start; c < start + hole; c++) expect(inFinder(size, r, c)).toBe(false);
    }
  });

  it('desenha bolinhas, olhos e a logo escapada', () => {
    const m = QRCode.create(LINKS[0]!, { errorCorrectionLevel: 'H' }).modules;
    const svg = qrArtSvg(m, { color: '#a32a00', logo: 'https://x.test/a.png?"><script>' });
    expect(svg).toContain('fill="#a32a00"');
    expect(svg).toContain('<image href="https://x.test/a.png?&quot;&gt;&lt;script&gt;"');
    expect(svg).not.toContain('<script>');
    const plain = qrArtSvg(m, { color: '#000', shape: 'square' });
    expect(plain).not.toContain('<image');
  });
});
