/**
 * Largura e altura de uma foto JPEG ou PNG lidas do próprio arquivo (sem biblioteca). Serve para
 * o servidor saber o formato da foto sem confiar no que o navegador mandou.
 */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = b.readUInt32BE(16);
    const height = b.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1]!;
    // Enchimento e marcadores sem tamanho.
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // fim ou começo dos dados antes do quadro
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const height = b.readUInt16BE(i + 5);
      const width = b.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}
