// Impressora USB ligada no cabo mas ainda sem fila no sistema (sem driver): acha e instala
// sozinha, com o driver que já vem no sistema, para o aplicativo mandar os dados direto (RAW).
//   Windows  porta USB001… sem impressora → "Generic / Text Only" nessa porta
//   macOS    backend usb do CUPS          → fila RAW (lpadmin -m raw)
//   Linux    backend usb do CUPS          → fila RAW; sem CUPS, "USB direto" (/dev/usb/lp0)
import { existsSync } from 'node:fs';
import { powershell, run } from './printers.mjs';

/** @typedef {{ id: string, label: string, detail: string }} UsbCandidate */

const WIN_LIST_PS1 = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$used = @{}
foreach ($p in @(Get-Printer)) { $used[[string]$p.PortName] = 1 }
$free = @(Get-PrinterPort | Where-Object { $_.Name -match '^USB\\d{3}$' -and -not $used[[string]$_.Name] } | ForEach-Object { [string]$_.Name })
$devs = @(Get-CimInstance Win32_PnPEntity | Where-Object { [string]$_.PNPDeviceID -match '^USBPRINT\\\\' -and $_.Status -eq 'OK' } | ForEach-Object { [string]$_.Name })
ConvertTo-Json -InputObject @{ free = @($free); devices = @($devs) } -Compress
`;

/** Junta portas livres e aparelhos USB de impressão (o Windows não liga um ao outro de graça). */
export function windowsCandidates({ free = [], devices = [] }) {
  const ports = [...new Set(free.filter((p) => /^USB\d{3}$/.test(p)))].sort();
  return ports.map((port) => ({
    id: port,
    label: ports.length === 1 && devices.length === 1 ? devices[0] : `Impressora USB (${port})`,
    detail: `Ligada na porta ${port}, ainda sem driver`,
  }));
}

/** Linhas "direct usb://Marca/Modelo?serial=..." do backend usb do CUPS. */
export function cupsCandidates(backendOut, lpstatOut = '') {
  const installed = new Set(
    [...String(lpstatOut).matchAll(/:\s+(usb:\/\/\S+)/g)].map((m) => m[1].split('?')[0]),
  );
  const out = [];
  for (const line of String(backendOut).split('\n')) {
    const m = /^direct\s+(usb:\/\/[^\s"]+)\s+"([^"]*)"/.exec(line.trim());
    if (!m || !validCupsUri(m[1]) || installed.has(m[1].split('?')[0])) continue;
    const label = (
      m[2] && m[2] !== 'Unknown' ? m[2] : decodeURIComponent(m[1].slice(6).split('?')[0])
    )
      .replace(/\//g, ' ')
      .slice(0, 80);
    out.push({ id: m[1], label, detail: 'Ligada no cabo USB, ainda sem fila no sistema' });
  }
  return out;
}

export const validCupsUri = (uri) => /^usb:\/\/[A-Za-z0-9%._~\-/?=&+]{3,300}$/.test(uri);
export const validWinPort = (port) => /^USB\d{3}$/.test(port);

/** Nome da fila nova: só letras, números e "_" (o lpadmin e o Windows aceitam). */
export function queueName(label) {
  const n = String(label)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
  return `Comandou_${n || 'USB'}`;
}

const CUPS_USB = ['/usr/libexec/cups/backend/usb', '/usr/lib/cups/backend/usb'];

/** Impressoras USB no cabo que ainda não têm fila no sistema. */
export async function listUninstalledUsb(platform = process.platform) {
  try {
    if (platform === 'win32') {
      const out = await powershell(WIN_LIST_PS1, {}, 30_000);
      return windowsCandidates(JSON.parse(out.trim() || '{}'));
    }
    const backend = CUPS_USB.find((p) => existsSync(p));
    if (!backend) return [];
    // Rodar o backend sem argumentos só lista os aparelhos (não imprime nada).
    const list = await run(backend, [], { timeoutMs: 15_000 }).catch((e) => e.message ?? '');
    const installed = await run('lpstat', ['-v'], { timeoutMs: 8000 }).catch(() => '');
    return cupsCandidates(list, installed);
  } catch {
    return [];
  }
}

const WIN_INSTALL = (name, port) => `$ErrorActionPreference = 'Stop'
$d = 'Generic / Text Only'
if (-not (Get-PrinterDriver -Name $d -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name $d }
Add-Printer -Name '${name}' -DriverName $d -PortName '${port}'
`;

/** Comando do PowerShell que roda o script como administrador (o Windows pergunta antes). */
function elevated(script) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  return `$ErrorActionPreference = 'Stop'
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'
} catch { [Console]::Error.WriteLine('UAC_DENIED'); exit 5 }
exit $p.ExitCode
`;
}

/**
 * Instala a impressora como fila RAW e devolve o nome dela no sistema (vira "printer:NOME").
 * Pede a senha/permite de administrador só se precisar.
 */
export async function installUsb(id, label, platform = process.platform) {
  const name = queueName(label);
  if (platform === 'win32') {
    if (!validWinPort(id)) throw new Error('Porta USB inválida.');
    try {
      await powershell(WIN_INSTALL(name, id), {}, 60_000);
    } catch {
      // Conta sem permissão de administrador: pede pelo aviso do Windows.
      await powershell(elevated(WIN_INSTALL(name, id)), {}, 180_000).catch((e) => {
        throw new Error(
          /UAC_DENIED/.test(e.message)
            ? 'O Windows não deixou instalar: clique em Sim no aviso de permissão.'
            : `Não consegui instalar a impressora: ${e.message}`,
        );
      });
    }
    return name;
  }
  if (!validCupsUri(id)) throw new Error('Impressora USB inválida.');
  await lpadmin(
    ['-p', name, '-E', '-v', id, '-m', 'raw', '-o', 'printer-is-shared=false'],
    platform,
  );
  return name;
}

/** Roda o lpadmin; sem permissão, pede a senha de administrador do jeito do sistema. */
async function lpadmin(args, platform) {
  try {
    await run('lpadmin', args, { timeoutMs: 30_000 });
  } catch {
    // Nome e endereço já foram validados (sem aspas nem espaços), então podem ir dentro das aspas.
    const cmd = `lpadmin ${args.map((a) => `'${a}'`).join(' ')}`;
    const runAdmin =
      platform === 'darwin'
        ? run('osascript', ['-e', `do shell script "${cmd}" with administrator privileges`], {
            timeoutMs: 180_000,
          })
        : run('pkexec', ['lpadmin', ...args], { timeoutMs: 180_000 });
    await runAdmin.catch((e) => {
      throw new Error(
        /cancel|-128|126|dismissed/i.test(e.message) || e.exitCode === 126
          ? 'A instalação foi cancelada na janela da senha.'
          : `Não consegui instalar a impressora: ${e.message}`,
      );
    });
  }
}

export const validIp = (ip) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255);
export const validIppPath = (p) => /^[A-Za-z0-9._~\-/]{0,80}$/.test(p) && !p.includes('..');

const WIN_INSTALL_IPP = (name, url) => `$ErrorActionPreference = 'Stop'
Add-Printer -Name '${name}' -IppURL '${url}'
`;

/**
 * Impressora comum de rede (jato de tinta, laser, etiqueta): instala no sistema pelo IPP, com o
 * driver que já vem nele (Windows: "Microsoft IPP Class Driver"; macOS/Linux: IPP Everywhere,
 * sem driver do fabricante). Devolve o nome da impressora no sistema.
 */
export async function installNetwork(host, label, path = 'ipp/print', platform = process.platform) {
  if (!validIp(host)) throw new Error('Endereço de rede inválido.');
  const rp = String(path ?? '').replace(/^\/+/, '');
  if (!validIppPath(rp)) throw new Error('Endereço da impressora inválido.');
  const name = queueName(label);
  if (platform === 'win32') {
    const script = WIN_INSTALL_IPP(name, `http://${host}:631/${rp}`);
    try {
      await powershell(script, {}, 90_000);
    } catch {
      await powershell(elevated(script), {}, 180_000).catch((e) => {
        throw new Error(
          /UAC_DENIED/.test(e.message)
            ? 'O Windows não deixou instalar: clique em Sim no aviso de permissão.'
            : 'O Windows não conseguiu instalar sozinho. Abra Configurações › Impressoras e clique em Adicionar dispositivo.',
        );
      });
    }
    return name;
  }
  await lpadmin(
    [
      '-p',
      name,
      '-E',
      '-v',
      `ipp://${host}:631/${rp}`,
      '-m',
      'everywhere',
      '-o',
      'printer-is-shared=false',
    ],
    platform,
  );
  return name;
}

const WIN_DRIVERS_PS1 = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ports = @{}; foreach ($x in @(Get-PrinterPort)) { $ports[[string]$x.Name] = [string]$x.PrinterHostAddress }
$makers = @{}; foreach ($x in @(Get-PrinterDriver)) { $makers[[string]$x.Name] = [string]$x.Manufacturer }
$wmi = @{}; foreach ($x in @(Get-CimInstance Win32_Printer)) { $wmi[[string]$x.Name] = $x }
$out = @(Get-Printer | ForEach-Object {
  $w = $wmi[[string]$_.Name]
  $jobs = @(Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue).Count
  [pscustomobject]@{
    name = [string]$_.Name; driver = [string]$_.DriverName; port = [string]$_.PortName
    host = $ports[[string]$_.PortName]; maker = $makers[[string]$_.DriverName]
    shared = [bool]$_.Shared; share = [string]$_.ShareName; server = [string]$_.ComputerName
    location = [string]$_.Location; comment = [string]$_.Comment; status = [string]$_.PrinterStatus
    kind = [string]$_.Type; isDefault = [bool]$w.Default; offline = [bool]$w.WorkOffline
    error = [int]$w.DetectedErrorState; jobs = $jobs
    dpi = [int]$w.HorizontalResolution; caps = @($w.CapabilityDescriptions | ForEach-Object { [string]$_ })
    paper = @($w.PrinterPaperNames | Select-Object -First 12 | ForEach-Object { [string]$_ })
  }
})
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

/**
 * Windows: tudo o que o sistema sabe de cada impressora instalada (driver, porta, IP da porta,
 * fabricante, compartilhamento, padrão, situação, fila, resolução, papéis).
 */
export async function windowsPrinterDrivers() {
  try {
    const list = JSON.parse((await powershell(WIN_DRIVERS_PS1, {}, 30_000)).trim() || '[]');
    return new Map((Array.isArray(list) ? list : [list]).map((p) => [p.name, p]));
  } catch {
    return new Map();
  }
}
