// Partes do aplicativo sem Electron (testadas em discovery.test.mjs).
import { QR_MARK } from '../escpos.mjs';

// ------------------------------------------------------------------ folha (impressora comum)
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** HTML da folha (testado à parte). O QR Code da NFC-e vira o endereço por escrito. */
export function documentHtml(text, { paper = 80 } = {}) {
  const lines = String(text)
    .split('\n')
    .map((l) => (l.startsWith(QR_MARK) ? `Consulte pelo QR Code: ${l.slice(QR_MARK.length)}` : l));
  const size = paper === 58 ? '9.5pt' : '10.5pt';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
@page { margin: 10mm; }
html, body { margin: 0; background: #fff; color: #000; }
pre { font: ${size}/1.35 "Consolas", "Menlo", "DejaVu Sans Mono", "Courier New", monospace;
  white-space: pre-wrap; word-break: break-word; margin: 0; }
</style></head><body><pre>${esc(lines.join('\n'))}</pre></body></html>`;
}

// ------------------------------------------------------------------ ícone do restaurante
export const DOT = {
  online: '#22c55e',
  connecting: '#f59e0b',
  offline: '#f59e0b',
  idle: '#9ca3af',
  unauthorized: '#ef4444',
};

/** ICO com o PNG dentro (aceito do Windows Vista em diante): serve para os atalhos. */
export function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ícone
  header.writeUInt16LE(1, 4); // uma imagem
  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0); // 0 = 256 px
  dir.writeUInt8(0, 1);
  dir.writeUInt8(0, 2);
  dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, dir, png]);
}
