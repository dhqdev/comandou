/**
 * Aplicativo "Comandou Impressão" (tools/print-agent): instaladores e código de conexão.
 * Os instaladores são gerados pelo GitHub Actions (workflow "Aplicativo de impressão") e ficam
 * na Release "impressora" do repositório. Quem hospeda em outro lugar troca o endereço com
 * VITE_PRINT_AGENT_DOWNLOAD_URL.
 */
import type { PrintAgent } from '../lib/types';

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

export type PrintHealthState = 'ok' | 'no-printer' | 'offline' | 'none';

/**
 * Situação da impressão do restaurante, a partir dos computadores conectados:
 * - ok: algum computador online com impressora principal (versão antiga, sem lista: conta como ok)
 * - no-printer: online, mas ninguém escolheu a impressora no aplicativo (os trabalhos esperam)
 * - offline: tem computador, mas nenhum online agora
 * - none: nenhum computador ativo
 */
export function printHealth(agents: PrintAgent[] | null | undefined): {
  state: PrintHealthState;
  online: PrintAgent[];
  ready: PrintAgent[];
} {
  const active = (agents ?? []).filter((a) => a.active);
  const online = active.filter((a) => a.online);
  const ready = online.filter((a) => a.printers === null || mainPrinter(a) !== null);
  const state: PrintHealthState = !active.length
    ? 'none'
    : ready.length
      ? 'ok'
      : online.length
        ? 'no-printer'
        : 'offline';
  return { state, online, ready };
}

/** Impressora principal escolhida no aplicativo (null = não escolheu ou não informa). */
export function mainPrinter(a: PrintAgent) {
  const p = a.printers?.find((x) => x.target === null && x.kind !== 'none');
  return p ?? null;
}
