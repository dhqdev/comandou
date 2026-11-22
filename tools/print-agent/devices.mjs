// Descoberta de impressoras para a tela "Adicionar impressora", sem dependências:
//   - portas seriais: Bluetooth pareado, RS-232 e adaptadores USB-serial (Windows, macOS, Linux)
//   - USB direto no Linux (/dev/usb/lp0)
//   - impressoras de rede (cabo ou Wi-Fi) com a porta 9100 aberta na rede local
import { readdir, readFile, realpath } from 'node:fs/promises';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { browsePrinters } from './mdns.mjs';
import {
  normalizeMac,
  parseSpec,
  parseTcp,
  powershell,
  printText,
  run,
  withOptions,
} from './printers.mjs';

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

const ipNum = (h) => h.split('.').reduce((n, x) => n * 256 + Number(x || 0), 0) >>> 0;
const numIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const maskBits = (mask) =>
  String(mask ?? '')
    .split('.')
    .reduce((b, x) => b + (Number(x) >>> 0).toString(2).replace(/0/g, '').length, 0);

/**
 * Redes locais (IPv4) deste computador. O padrão é a /24 ao redor do próprio IP
 * ("192.168.0"); rede maior até /22 (até 1022 endereços, comum em roteador de provedor) entra
 * inteira em `range`. Rede maior que isso continua na /24 (procurar 65 mil endereços demora).
 */
export function localSubnets(ifaces = networkInterfaces()) {
  const nets = new Map();
  for (const list of Object.values(ifaces))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      const bits = a.netmask ? maskBits(a.netmask) : 24;
      const wide = bits >= 22 && bits < 24;
      const key = wide
        ? `${numIp((ipNum(a.address) & (~0 << (32 - bits))) >>> 0)}/${bits}`
        : a.address.split('.').slice(0, 3).join('.');
      if (!nets.has(key))
        nets.set(key, {
          prefix: a.address.split('.').slice(0, 3).join('.'),
          own: [],
          ...(wide
            ? {
                range: {
                  start: ((ipNum(a.address) & (~0 << (32 - bits))) >>> 0) + 1,
                  count: 2 ** (32 - bits) - 2,
                },
              }
            : {}),
        });
      nets.get(key).own.push(a.address);
    }
  return [...nets.values()];
}

/** Endereços a procurar em cada rede local, sem os do próprio computador. */
export function subnetHosts(nets = localSubnets()) {
  const out = new Set();
  for (const n of nets) {
    const list = n.range
      ? Array.from({ length: n.range.count }, (_, i) => numIp(n.range.start + i))
      : Array.from({ length: 254 }, (_, i) => `${n.prefix}.${i + 1}`);
    for (const h of list) if (!n.own.includes(h)) out.add(h);
  }
  return [...out];
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
 * Tabela ARP do sistema (IP → endereço físico), dos três formatos:
 *   Linux   /proc/net/arp     "192.168.0.50  0x1  0x2  00:11:22:33:44:55  *  eth0"
 *   Windows arp -a            "  192.168.0.50     00-11-22-33-44-55     dinâmico"
 *   macOS   arp -a -n         "? (192.168.0.50) at 0:11:22:33:44:55 on en0 ifscope [ethernet]"
 */
export function parseArp(text) {
  const out = new Map();
  const re =
    /(\d{1,3}(?:\.\d{1,3}){3})\)?\s+(?:at\s+|0x\w+\s+0x\w+\s+)?([0-9a-fA-F]{1,2}(?:[:-][0-9a-fA-F]{1,2}){5})/g;
  for (const m of String(text).matchAll(re)) {
    const mac = normalizeMac(m[2]);
    if (mac && !mac.startsWith('01-00-5E')) out.set(m[1], mac);
  }
  return out;
}

export async function arpTable(platform = process.platform) {
  try {
    if (platform === 'linux') return parseArp(await readFile('/proc/net/arp', 'utf8'));
    return parseArp(
      await run('arp', platform === 'win32' ? ['-a'] : ['-a', '-n'], { timeoutMs: 8000 }),
    );
  } catch {
    return new Map();
  }
}

/**
 * Procura impressoras na rede local, de dois jeitos ao mesmo tempo:
 *   - quem tem a porta 9100 aberta (padrão das térmicas em rede, com cabo ou Wi-Fi);
 *   - quem se anuncia como impressora pelo mDNS/Bonjour (nome e modelo de fábrica).
 * Também guarda o endereço físico (MAC) de cada uma, que segue igual se o IP mudar.
 *
 * @param {{ port?: number, hosts?: string[], timeoutMs?: number, concurrency?: number,
 *   mdns?: boolean, onProgress?: (done: number, total: number) => void }} [o]
 * @returns {Promise<{ host: string, port: number, name: string, mac?: string, via?: string }[]>}
 */
export async function scanNetwork(o = {}) {
  const port = o.port ?? 9100;
  const skipMdns = o.mdns === false || (o.hosts && o.mdns !== true);
  const bonjour = skipMdns ? Promise.resolve([]) : browsePrinters().catch(() => []);
  const hosts = [...(o.hosts ?? subnetHosts())];
  const found = new Map();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      if (await probe(host, port, o.timeoutMs ?? 700))
        found.set(host, { host, port, name: '', via: 'porta', raw: true });
      o.onProgress?.(++done, hosts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 96, hosts.length) }, worker));

  // Bonjour: dá o nome e o modelo; impressora de outra faixa (que não entrou na varredura) e
  // impressora só IPP/LPD (jato de tinta e laser sem porta 9100) também entram.
  const order = { 'pdl-datastream': 0, ipp: 1, printer: 2 };
  const announced = (await bonjour).sort((a, b) => order[a.service] - order[b.service]);
  for (const b of announced) {
    if (o.hosts && !o.hosts.includes(b.host)) continue;
    const cur = found.get(b.host);
    if (cur) {
      if (!cur.name || b.service === 'pdl-datastream') cur.name = b.name;
      cur.bonjour = { ...b.txt, ...cur.bonjour, ...(b.service === 'ipp' ? { rp: b.txt?.rp } : {}) };
    } else if (b.port && (await probe(b.host, b.port, 1200)))
      found.set(b.host, {
        host: b.host,
        port: b.port,
        name: b.name,
        via: 'bonjour',
        bonjour: b.txt,
        // Só IPP (631) ou LPD (515): não recebe texto direto, imprime pelo sistema.
        raw: b.service === 'pdl-datastream',
      });
  }
  const list = [...found.values()];
  await Promise.all(
    list.filter((f) => !f.name).map(async (f) => (f.name = await webTitle(f.host))),
  );
  const arp = o.hosts ? new Map() : await arpTable();
  for (const f of list) if (arp.has(f.host)) f.mac = arp.get(f.host);
  return list.sort((a, b) => ipNum(a.host) - ipNum(b.host));
}

/** Portas que as impressoras de rede costumam usar: RAW (9100–9102), LPD (515) e IPP (631). */
export const NETWORK_PORTS = [9100, 9101, 9102, 515, 631];

/** Testa um IP digitado: quais portas de impressora estão abertas e o MAC dele. */
export async function checkHost(host, ports = NETWORK_PORTS) {
  const open = [];
  await Promise.all(ports.map(async (p) => (await probe(host, p, 1500)) && open.push(p)));
  open.sort((a, b) => ports.indexOf(a) - ports.indexOf(b));
  const mac = (await arpTable()).get(host);
  return { host, open, raw: open.find((p) => p >= 9100 && p <= 9102) ?? null, mac: mac ?? null };
}

// ------------------------------------------------------------------ situação (ESC/POS)

/**
 * Lê as respostas do DLE EOT 1, 2 e 4 (situação, motivo de estar parada, sensor do papel).
 * Cada byte de situação tem os bits 1 e 4 ligados e 0 e 7 desligados; o que não bate é lixo.
 */
export function parseStatus(bytes) {
  const b = [...bytes].filter((x) => (x & 0x93) === 0x12);
  if (b.length < 3)
    return { answered: b.length > 0, online: b[0] !== undefined ? !(b[0] & 0x08) : null };
  const [printer, offline, paper] = b;
  return {
    answered: true,
    online: !(printer & 0x08),
    coverOpen: !!(offline & 0x04),
    paperOut: !!(paper & 0x60) || !!(offline & 0x20),
    paperLow: !!(paper & 0x0c),
    error: !!(offline & 0x40),
  };
}

/** Texto curto da situação, para a tela. */
export function statusText(s) {
  if (!s.reachable) return 'Fora do ar: não respondeu na rede.';
  if (!s.answered)
    return 'Ligada na rede. Ela não informa papel e tampa (normal em alguns modelos).';
  if (s.coverOpen) return 'Tampa aberta: feche a tampa.';
  if (s.paperOut) return 'Sem papel: troque a bobina.';
  if (s.error) return 'Com erro: desligue e ligue a impressora.';
  if (s.online === false) return 'Parada (offline): confira papel e tampa.';
  if (s.paperLow) return 'Pronta, mas o papel está acabando.';
  return 'Pronta para imprimir.';
}

/**
 * Pergunta à impressora de rede como ela está (papel, tampa, erro). Manda só os pedidos de
 * situação do ESC/POS, que não imprimem nada. Usado no botão "Ver situação".
 */
export function tcpStatus(host, port = 9100, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const got = [];
    let reachable = false;
    const s = net.connect({ host, port });
    const done = () => {
      s.destroy();
      clearTimeout(timer);
      resolve({ reachable, ...parseStatus(got) });
    };
    const timer = setTimeout(done, timeoutMs);
    s.once('connect', () => {
      reachable = true;
      s.write(Buffer.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04]));
    });
    s.on('data', (d) => {
      got.push(...d);
      if (got.length >= 3) done();
    });
    s.once('error', done);
  });
}

// ------------------------------------------------------------------ IP que mudou

/** Acha na rede a impressora com este MAC (o roteador deu outro IP para ela). */
export async function findByMac(mac, port = 9100, o = {}) {
  const want = normalizeMac(mac);
  if (!want) return null;
  // Primeiro a tabela ARP (instantâneo); se não estiver lá, procura na rede, o que enche a tabela.
  for (const [ip, m] of await arpTable())
    if (m === want && (await probe(ip, port, 1200))) return ip;
  await scanNetwork({ port, mdns: false, ...o });
  for (const [ip, m] of await arpTable())
    if (m === want && (await probe(ip, port, 1200))) return ip;
  return null;
}

const NETWORK_DOWN = /fora do ar|não respondeu|IP errado/;

/**
 * Imprime e, se a impressora de rede sumiu do IP de sempre, procura pelo MAC e imprime no IP
 * novo. `onMoved(antigo, novo)` recebe as duas impressoras para salvar a troca.
 */
export async function printResilient(
  spec,
  text,
  { onMoved, find = findByMac, print = printText, meta } = {},
) {
  try {
    return await print(spec, text, meta);
  } catch (e) {
    const { base, opts } = parseSpec(spec);
    const t = base.startsWith('tcp://') ? parseTcp(base) : null;
    if (!t || !opts.mac || !NETWORK_DOWN.test(e.message)) throw e;
    const ip = await find(opts.mac, t.port).catch(() => null);
    if (!ip || ip === t.host) throw e;
    const moved = withOptions(`tcp://${ip}:${t.port}`, opts);
    const r = await print(moved, text, meta);
    await onMoved?.(spec, moved);
    return r;
  }
}
