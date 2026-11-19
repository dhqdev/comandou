// Bluetooth clássico: impressoras já pareadas que ainda não viraram porta serial.
//   Windows  pareada sem porta COM de saída → botão que abre a tela "Portas COM" do Bluetooth
//   Linux    pareada sem /dev/rfcommN      → cria a porta (rfcomm bind) e deixa fixa no início
//   macOS    pareada sem /dev/cu.NOME       → avisa (alguns modelos só falam BLE ou cabo)
import { readdir } from 'node:fs/promises';
import { powershell, run } from './printers.mjs';

/** @typedef {{ mac: string, name: string, printer: boolean }} PairedDevice */

export const validBtMac = (mac) => /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(String(mac));

// Aparelhos parecem impressora pelo tipo (classe "Imaging") ou pelo nome comum dos modelos.
const PRINTER_NAME =
  /print|impress|pos|mpt|pt-?\d|rpp|tm-|thermal|térmica|termica|bluetooth printer|inner|zjiang|goojprt|xprinter|knup|elgin|bematech|daruma|tanca|leopardo|sunmi|mtp/i;
export const looksLikePrinter = (name, cod = 0) =>
  ((cod >> 8) & 0x1f) === 6 || PRINTER_NAME.test(String(name));

const WIN_PAIRED_PS1 = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$all = @(Get-CimInstance Win32_PnPEntity)
$withCom = @{}
foreach ($d in $all) {
  $id = [string]$d.PNPDeviceID
  if ($id -match '^BTHENUM\\\\' -and [string]$d.Name -match '\\(COM\\d+\\)' -and $id -match '&([0-9A-F]{12})_') { $withCom[$matches[1]] = 1 }
}
$out = @()
foreach ($d in $all) {
  $id = [string]$d.PNPDeviceID
  if ($id -match '^BTHENUM\\\\DEV_([0-9A-F]{12})') {
    $mac = $matches[1]
    $cod = 0
    $p = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Bluetooth_ClassOfDevice'
    if ($p -and $p.Data) { $cod = [int]$p.Data }
    $out += [pscustomobject]@{ mac = $mac; name = [string]$d.Name; cod = $cod; com = [bool]$withCom[$mac] }
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

const colonMac = (hex) =>
  String(hex)
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '')
    .replace(/(..)(?!$)/g, '$1:');

/** Windows: lista do PowerShell → pareadas que ainda não têm porta COM. */
export function windowsPairedWithoutPort(list) {
  return (Array.isArray(list) ? list : [list])
    .filter((d) => d && !d.com && /^[0-9A-F]{12}$/i.test(d.mac))
    .map((d) => ({
      mac: colonMac(d.mac),
      name: String(d.name || 'Aparelho Bluetooth').slice(0, 80),
      printer: looksLikePrinter(d.name, Number(d.cod) || 0),
    }))
    .filter((d) => d.printer);
}

/** Linux: "Device AA:BB:CC:DD:EE:FF Nome" do bluetoothctl. */
export function parseBluetoothctl(out) {
  const list = [];
  for (const m of String(out).matchAll(/^Device\s+([0-9A-F:]{17})\s+(.+)$/gim))
    if (validBtMac(m[1].toUpperCase()))
      list.push({ mac: m[1].toUpperCase(), name: m[2].trim().slice(0, 80) });
  return list;
}

/** Linux: "rfcomm0: AA:BB:CC:DD:EE:FF channel 1 clean" → mapa MAC → número da porta. */
export function parseRfcomm(out) {
  const map = new Map();
  for (const m of String(out).matchAll(/^rfcomm(\d+):\s+([0-9A-F:]{17})/gim))
    map.set(m[2].toUpperCase(), Number(m[1]));
  return map;
}

async function linuxPaired() {
  let out = await run('bluetoothctl', ['devices', 'Paired'], { timeoutMs: 8000 }).catch(() => '');
  if (!/Device/.test(out))
    out = await run('bluetoothctl', ['paired-devices'], { timeoutMs: 8000 }).catch(() => '');
  const bound = parseRfcomm(await run('rfcomm', [], { timeoutMs: 5000 }).catch(() => ''));
  return parseBluetoothctl(out)
    .filter((d) => !bound.has(d.mac))
    .map((d) => ({ ...d, printer: looksLikePrinter(d.name) }));
}

async function macPaired() {
  const out = await run('system_profiler', ['SPBluetoothDataType', '-json'], {
    timeoutMs: 20_000,
  }).catch(() => '{}');
  const ports = (await readdir('/dev').catch(() => [])).filter((n) => n.startsWith('cu.'));
  const list = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object' && typeof v.device_address === 'string') {
        const mac = colonMac(v.device_address);
        const slug = k.replace(/[^A-Za-z0-9]/g, '');
        const hasPort = ports.some((p) => p.replace(/[^A-Za-z0-9]/g, '').includes(slug));
        if (validBtMac(mac) && !hasPort && looksLikePrinter(k, Number(v.device_classOfDevice) || 0))
          list.push({ mac, name: k.slice(0, 80), printer: true });
      } else walk(v);
    }
  };
  try {
    const data = JSON.parse(out).SPBluetoothDataType ?? [];
    for (const c of data) walk(c.device_connected ?? c.device_paired ?? []);
    for (const c of data) walk(c.device_not_connected ?? []);
  } catch {
    /* sem Bluetooth */
  }
  const seen = new Set();
  return list.filter((d) => !seen.has(d.mac) && seen.add(d.mac));
}

/** Impressoras Bluetooth pareadas que ainda não têm porta serial para imprimir. */
export async function listPairedWithoutPort(platform = process.platform) {
  try {
    if (platform === 'win32')
      return windowsPairedWithoutPort(
        JSON.parse((await powershell(WIN_PAIRED_PS1, {}, 30_000)).trim() || '[]'),
      );
    if (platform === 'linux') return await linuxPaired();
    if (platform === 'darwin') return await macPaired();
  } catch {
    /* sem Bluetooth */
  }
  return [];
}

/**
 * Linux: cria /dev/rfcommN para a impressora e deixa fixo (um serviço do systemd refaz a
 * ligação a cada início do computador). Pede a senha de administrador pelo pkexec.
 * @returns {Promise<string>} caminho da porta criada
 */
export async function bindRfcomm(mac) {
  mac = String(mac).toUpperCase();
  if (!validBtMac(mac)) throw new Error('Endereço Bluetooth inválido.');
  const bound = parseRfcomm(await run('rfcomm', [], { timeoutMs: 5000 }).catch(() => ''));
  if (bound.has(mac)) return `/dev/rfcomm${bound.get(mac)}`;
  const used = new Set(bound.values());
  const taken = (await readdir('/dev').catch(() => []))
    .map((n) => /^rfcomm(\d+)$/.exec(n)?.[1])
    .filter(Boolean)
    .map(Number);
  for (const n of taken) used.add(n);
  let n = 0;
  while (used.has(n)) n++;
  const unit = `comandou-rfcomm${n}.service`;
  // MAC e número já validados: o texto do script não tem nada vindo de fora além deles.
  const script = [
    `cat > /etc/systemd/system/${unit} <<'EOF'`,
    '[Unit]',
    `Description=Comandou Impressao: porta Bluetooth /dev/rfcomm${n}`,
    'After=bluetooth.service',
    'Requires=bluetooth.service',
    '[Service]',
    'Type=oneshot',
    'RemainAfterExit=yes',
    `ExecStart=/usr/bin/env rfcomm bind ${n} ${mac} 1`,
    `ExecStop=/usr/bin/env rfcomm release ${n}`,
    '[Install]',
    'WantedBy=multi-user.target',
    'EOF',
    'systemctl daemon-reload',
    `systemctl enable --now ${unit} || rfcomm bind ${n} ${mac} 1`,
  ].join('\n');
  try {
    await run('pkexec', ['sh', '-c', script], { timeoutMs: 180_000 });
  } catch (e) {
    throw new Error(
      e.exitCode === 126 || e.exitCode === 127
        ? 'A criação da porta foi cancelada na janela da senha.'
        : `Não consegui criar a porta Bluetooth: ${e.message}. No terminal: sudo rfcomm bind ${n} ${mac} 1`,
    );
  }
  return `/dev/rfcomm${n}`;
}
