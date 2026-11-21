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
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comandou</title>
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

// ------------------------------------------------------------------ atualização
/** "1.10.0" é mais nova que "1.9.2"? Compara número a número (sem letras). */
export function isNewer(latest, current) {
  const a = String(latest ?? '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const b = String(current ?? '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Arquivo da Release "impressora" que atualiza este sistema (nomes fixos do workflow). */
export function updateFile(platform, arch) {
  if (platform === 'win32') return 'Comandou-Impressao-Setup.exe';
  if (platform === 'darwin') return 'Comandou-Impressao.dmg';
  if (platform === 'linux')
    return arch === 'arm64' ? 'Comandou-Impressao-arm64.AppImage' : 'Comandou-Impressao.AppImage';
  return null;
}

// ------------------------------------------------------------------ impressora desligada
/**
 * MAC de um endereço IPv6 local no formato EUI-64, como o que o Windows guarda no "Local" da
 * impressora WSD (http://[fe80::e2bb:9eff:fe17:c57b%22]:80/WSD/DEVICE). Null se não der.
 */
export function macFromLinkLocal(location) {
  const m =
    /\[fe80::([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4})(?:%[^\]]*)?\]/i.exec(
      String(location ?? ''),
    );
  if (!m) return null;
  const hex = m
    .slice(1)
    .map((g) => g.padStart(4, '0'))
    .join('');
  if (hex.slice(6, 10).toLowerCase() !== 'fffe') return null;
  const first = (Number.parseInt(hex.slice(0, 2), 16) ^ 2).toString(16).padStart(2, '0');
  const bytes = [
    first,
    hex.slice(2, 4),
    hex.slice(4, 6),
    hex.slice(10, 12),
    hex.slice(12, 14),
    hex.slice(14, 16),
  ];
  return bytes.join('-').toUpperCase();
}

/** Onde perguntar se a impressora do sistema está ligada: IP da porta e endereço do "Local". */
export function printerEndpoints(host, location) {
  const out = [];
  if (host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host))
    for (const port of [9100, 631, 80]) out.push({ host, port });
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:\s]+)(?::(\d{1,5}))?/i.exec(String(location ?? ''));
  if (m) out.push({ host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2] ?? 80) });
  return out;
}

/**
 * Só dá a impressora como desligada depois de `needed` conferências seguidas sem resposta: uma
 * falha solta de Wi-Fi não vira alarme. Quando ela responde, volta na hora.
 */
export function confirmHealth(prev, result, needed = 2) {
  if (!result.off) return { ...result, misses: 0 };
  const misses = (prev?.misses ?? 0) + 1;
  if (misses >= needed) return { ...result, misses };
  return prev ? { ...prev, misses } : { ok: true, text: 'Conferindo a impressora…', misses };
}
