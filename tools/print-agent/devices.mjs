// Descoberta de impressoras para a tela "Adicionar impressora", sem dependências:
//   - portas seriais: Bluetooth pareado, RS-232 e adaptadores USB-serial (Windows, macOS, Linux)
//   - USB direto no Linux (/dev/usb/lp0)
//   - impressoras de rede (cabo ou Wi-Fi) com a porta 9100 aberta na rede local
import { readdir, readFile, realpath } from 'node:fs/promises';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { powershell } from './printers.mjs';

/**
 * @typedef {{ path: string, label: string, kind: 'bluetooth' | 'usb' | 'serial' }} SerialPortInfo
 * @typedef {{ path: string, label: string, kind: 'usb' | 'parallel' }} DirectDevice
 */

// Windows: nome amigável de cada porta COM e, no Bluetooth, o nome da impressora pareada.
// A porta Bluetooth "de entrada" (endereço 000000000000) não imprime e fica de fora.
const WIN_PORTS_PS1 = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$all = @(Get-CimInstance Win32_PnPEntity)
$bt = @{}
foreach ($d in $all) {
  if ([string]$d.PNPDeviceID -match '^BTHENUM\\\\DEV_([0-9A-F]{12})') { $bt[$matches[1]] = $d.Name }
}
$seen = @{}
$out = @()
foreach ($d in $all) {
  if ([string]$d.Name -match '\\((COM\\d+)\\)') {
    $port = $matches[1]
    $id = [string]$d.PNPDeviceID
    $label = ([string]$d.Name -replace '\\s*\\(COM\\d+\\)', '').Trim()
    $kind = 'serial'
    if ($id -match '^BTHENUM\\\\') {
      $kind = 'bluetooth'
      if ($id -match '&([0-9A-F]{12})_') {
        if ($matches[1] -eq '000000000000') { continue }
        if ($bt[$matches[1]]) { $label = $bt[$matches[1]] }
      }
    } elseif ($id -match '^(USB|FTDIBUS|USBSER)') { $kind = 'usb' }
    $seen[$port] = 1
    $out += [pscustomobject]@{ path = $port; label = $label; kind = $kind }
  }
}
foreach ($p in [System.IO.Ports.SerialPort]::GetPortNames()) {
  if (-not $seen[$p]) { $out += [pscustomobject]@{ path = $p; label = $p; kind = 'serial' } }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

const comNumber = (p) => Number(/\d+/.exec(p)?.[0] ?? 0);

async function windowsPorts() {
  const out = await powershell(WIN_PORTS_PS1, {}, 30_000);
  const list = JSON.parse(out.trim() || '[]');
  return (Array.isArray(list) ? list : [list])
    .filter((p) => p && /^COM\d+$/i.test(p.path))
    .map((p) => ({
      path: String(p.path).toUpperCase(),
      label: String(p.label || p.path).slice(0, 80),
      kind: p.kind === 'bluetooth' || p.kind === 'usb' ? p.kind : 'serial',
    }))
    .sort((a, b) => comNumber(a.path) - comNumber(b.path));
}

/** macOS: cada impressora Bluetooth pareada (com perfil serial) vira /dev/cu.NOME. */
export function macPortsFrom(names) {
  return names
    .filter(
      (n) =>
        n.startsWith('cu.') &&
        !/Bluetooth-Incoming-Port|debug-console|wlan-debug|BLTH|Bluetooth-Modem|^cu\.AirPods/i.test(
          n,
        ),
    )
    .map((n) => {
      const usb = /usbserial|usbmodem|wchusbserial|SLAB_USBtoUART|UART|usb/i.test(n);
      return {
        path: `/dev/${n}`,
        label: n.slice(3).replace(/-SerialPort$|-SPPDev$|-ESP32SPP$/i, ''),
        kind: usb ? 'usb' : 'bluetooth',
      };
    });
}

/** Nome do produto USB (Linux), subindo pelas pastas do dispositivo no /sys. */
async function linuxProduct(sysPath) {
  try {
    let dir = await realpath(sysPath);
    for (let i = 0; i < 5 && dir.length > 5; i++) {
      const name = await readFile(join(dir, 'product'), 'utf8').catch(() => '');
      if (name.trim()) return name.trim().slice(0, 60);
      dir = dirname(dir);
    }
  } catch {
    /* sem /sys */
  }
  return '';
}

async function linuxPorts(devNames) {
  const out = [];
  for (const n of devNames) {
    let kind;
    if (/^ttyUSB\d+$|^ttyACM\d+$/.test(n)) kind = 'usb';
    else if (/^rfcomm\d+$/.test(n)) kind = 'bluetooth';
    else if (/^ttyS\d+$/.test(n)) {
      // ttyS0–ttyS31 existem mesmo sem porta física: só as que têm UART de verdade (tipo ≠ 0).
      const type = await readFile(`/sys/class/tty/${n}/type`, 'utf8').catch(() => '0');
      if (Number(type.trim()) === 0) continue;
      kind = 'serial';
    } else continue;
    const product = kind === 'usb' ? await linuxProduct(`/sys/class/tty/${n}/device`) : '';
    out.push({
      path: `/dev/${n}`,
      label: product ? `${product} (${n})` : kind === 'bluetooth' ? `Bluetooth (${n})` : n,
      kind,
    });
  }
  return out;
}

/** Portas seriais deste computador (Bluetooth, USB-serial, RS-232). */
export async function listSerialPorts(platform = process.platform) {
  try {
    if (platform === 'win32') return await windowsPorts();
    const names = await readdir('/dev');
    if (platform === 'darwin') return macPortsFrom(names);
    return await linuxPorts(names.sort());
  } catch {
    return [];
  }
}

/** USB direto (/dev/usb/lp0) e paralela (/dev/lp0), só no Linux. */
export async function listDirectDevices(platform = process.platform) {
  if (platform !== 'linux') return [];
  const out = [];
  for (const n of await readdir('/dev/usb').catch(() => []))
    if (/^lp\d+$/.test(n)) {
      const product = await linuxProduct(`/sys/class/usbmisc/${n}/device`);
      out.push({
        path: `/dev/usb/${n}`,
        label: product ? `${product} (USB direto)` : `Impressora USB (${n})`,
        kind: 'usb',
      });
    }
  for (const n of await readdir('/dev').catch(() => []))
    if (/^lp\d+$/.test(n))
      out.push({ path: `/dev/${n}`, label: `Paralela (${n})`, kind: 'parallel' });
  return out;
}

// ------------------------------------------------------------------ rede

/** Redes locais (IPv4) deste computador, como "192.168.0" (/24 ao redor do próprio IP). */
export function localSubnets(ifaces = networkInterfaces()) {
  const nets = new Map();
  for (const list of Object.values(ifaces))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      const prefix = a.address.split('.').slice(0, 3).join('.');
      if (!nets.has(prefix)) nets.set(prefix, new Set());
      nets.get(prefix).add(a.address);
    }
  return [...nets].map(([prefix, own]) => ({ prefix, own: [...own] }));
}

/** A porta responde? Só abre e fecha a conexão: nada é enviado (não imprime nada). */
export function probe(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Título da página de configuração da impressora (Epson, Elgin e outras mostram o modelo). */
async function webTitle(host, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(timeoutMs) });
    const html = (await res.text()).slice(0, 65_536);
    const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(html);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

/**
 * Procura impressoras na rede local: quem tem a porta 9100 aberta (padrão das térmicas em rede,
 * com cabo ou Wi-Fi). 254 endereços por rede, em paralelo; leva poucos segundos.
 *
 * @param {{ port?: number, hosts?: string[], timeoutMs?: number, concurrency?: number,
 *   onProgress?: (done: number, total: number) => void }} [o]
 * @returns {Promise<{ host: string, port: number, name: string }[]>}
 */
export async function scanNetwork(o = {}) {
  const port = o.port ?? 9100;
  const hosts =
    o.hosts ??
    localSubnets().flatMap(({ prefix, own }) =>
      Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter((h) => !own.includes(h)),
    );
  const found = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      if (await probe(host, port, o.timeoutMs ?? 700)) found.push({ host, port, name: '' });
      o.onProgress?.(++done, hosts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 96, hosts.length) }, worker));
  await Promise.all(found.map(async (f) => (f.name = await webTitle(f.host))));
  const num = (h) => h.split('.').reduce((n, x) => n * 256 + Number(x || 0), 0);
  return found.sort((a, b) => num(a.host) - num(b.host));
}
