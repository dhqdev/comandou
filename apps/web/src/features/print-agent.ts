/**
 * Aplicativo "Comandou Impressão" (tools/print-agent): instaladores e código de conexão.
 * Os instaladores são gerados pelo GitHub Actions (workflow "Aplicativo de impressão") e ficam
 * na Release "impressora" do repositório. Quem hospeda em outro lugar troca o endereço com
 * VITE_PRINT_AGENT_DOWNLOAD_URL.
 */
export const PRINT_AGENT_DOWNLOAD_BASE = (
  (import.meta.env.VITE_PRINT_AGENT_DOWNLOAD_URL as string | undefined) ||
  'https://github.com/dhqdev/comandou/releases/download/impressora'
).replace(/\/+$/, '');

export type DesktopOs = 'windows' | 'mac' | 'linux';

export const PRINT_AGENT_DOWNLOADS: Record<
  DesktopOs,
  { label: string; file: string; note: string }
> = {
  windows: {
    label: 'Windows',
    file: 'Comandou-Impressao-Setup.exe',
    note: 'Windows 10 ou 11 (Intel, AMD ou ARM)',
  },
  mac: { label: 'macOS', file: 'Comandou-Impressao.dmg', note: 'Intel e Apple Silicon' },
  linux: { label: 'Linux', file: 'Comandou-Impressao.AppImage', note: 'AppImage (x64)' },
};

export const downloadUrl = (os: DesktopOs) =>
  `${PRINT_AGENT_DOWNLOAD_BASE}/${PRINT_AGENT_DOWNLOADS[os].file}`;

export function detectOs(ua = navigator.userAgent): DesktopOs {
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'windows';
}

function base64url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mesmo formato de tools/print-agent/core.mjs (parseConnectionCode). */
export function connectionCode(origin: string, token: string, name?: string) {
  return `CMD1-${base64url(JSON.stringify({ u: origin, t: token, n: name }))}`;
}

export const appLink = (code: string) =>
  `comandou-impressao://conectar?codigo=${encodeURIComponent(code)}`;
