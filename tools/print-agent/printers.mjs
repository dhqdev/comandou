// Saídas de impressão do agente, sem dependências.
//
// Uma impressora é descrita por um texto:
//   printer:NOME         impressora instalada no sistema (USB com driver, compartilhada na rede,
//                        paralela): no Windows vai direto para o spooler em modo RAW; no
//                        macOS/Linux, pelo CUPS (lp -o raw)
//   tcp://IP:PORTA       impressora térmica em rede, com cabo ou Wi-Fi (porta 9100)
//   serial:PORTA         porta serial: Bluetooth pareado (COM5, /dev/cu.MPT-II, /dev/rfcomm0),
//                        cabo RS-232 ou adaptador USB-serial (COM3, /dev/ttyUSB0)
//   ble:ID               Bluetooth de baixo consumo (BLE), sem porta COM: só no aplicativo de
//                        computador, que registra o transporte (registerTransport)
//   file:/dev/usb/lp0    USB direto no Linux, sem driver (ou qualquer arquivo, na linha de comando)
//   stdout               mostra no terminal (testes sem impressora)
//   none                 não imprime (o trabalho é confirmado e descartado)
//
// Ajustes opcionais no fim, como numa URL: "tcp://192.168.0.50:9100?papel=58&acentos=850".
//   papel=58             bobina de 58 mm (fonte menor para caber as 42 colunas)
//   acentos=850|ascii    outra página de código, ou sem acentos
//   baud=9600            velocidade da porta serial (padrão 9600; Bluetooth ignora)
//   modo=folha           impressora comum (jato de tinta, laser): o texto vai pelo driver do
//                        sistema, numa folha, em vez de ESC/POS (só no aplicativo de computador)
//   mac=00-11-22-33-44-55  endereço físico da impressora de rede: se o IP mudar, o aplicativo
//                        procura a impressora pela rede e segue imprimindo (devices.mjs)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toEscPos } from './escpos.mjs';
import { printerType, speaksEscPos } from './kinds.mjs';

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

/** Nome da variável de ambiente de um destino: "Chapa quente" → PRINTER_CHAPA_QUENTE. */
export function targetEnvName(target) {
  return (
    'PRINTER_' +
    target
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  );
}

/**
 * Separa a impressora dos ajustes: "tcp://1.2.3.4:9100?papel=58" →
 * { base: 'tcp://1.2.3.4:9100', opts: { paper: 58, codepage: '860', baud: 9600 } }.
 * Ajuste desconhecido ou inválido é ignorado (vale o padrão).
 */
export function parseSpec(spec) {
  const s = String(spec ?? '').trim();
  const q = s.lastIndexOf('?');
  let base = s;
  let raw = {};
  if (q > 0 && /^[a-z]+=[\w.-]*(&[a-z]+=[\w.-]*)*$/.test(s.slice(q + 1))) {
    base = s.slice(0, q);
    raw = Object.fromEntries(new URLSearchParams(s.slice(q + 1)));
  }
  const baud = Number(raw.baud);
  const mac = normalizeMac(raw.mac ?? '');
  return {
    base,
    opts: {
      paper: raw.papel === '58' ? 58 : 80,
      codepage: raw.acentos === '850' || raw.acentos === 'ascii' ? raw.acentos : '860',
      baud: BAUD_RATES.includes(baud) ? baud : 9600,
      ...(mac ? { mac } : {}),
      ...(raw.modo === 'folha' && base.startsWith('printer:') ? { mode: 'doc' } : {}),
    },
  };
}

/** "0:11:22:a:b:c" ou "00-11-22-0A-0B-0C" → "00-11-22-0A-0B-0C"; inválido ou vazio → "". */
export function normalizeMac(raw) {
  const parts = String(raw ?? '')
    .trim()
    .split(/[:-]/);
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-fA-F]{1,2}$/.test(p))) return '';
  const mac = parts.map((p) => p.padStart(2, '0').toUpperCase()).join('-');
  return mac === '00-00-00-00-00-00' || mac === 'FF-FF-FF-FF-FF-FF' ? '' : mac;
}

/** Junta impressora e ajustes, deixando de fora o que é padrão. */
export function withOptions(base, opts = {}) {
  const p = new URLSearchParams();
  if (opts.paper === 58) p.set('papel', '58');
  if (opts.codepage === '850' || opts.codepage === 'ascii') p.set('acentos', opts.codepage);
  if (base.startsWith('serial:') && BAUD_RATES.includes(opts.baud) && opts.baud !== 9600)
    p.set('baud', String(opts.baud));
  if (base.startsWith('tcp://') && normalizeMac(opts.mac)) p.set('mac', normalizeMac(opts.mac));
  if (base.startsWith('printer:') && opts.mode === 'doc') p.set('modo', 'folha');
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** Valida e separa "tcp://IP:PORTA" (aceita os ajustes no fim). */
export function parseTcp(spec) {
  const m = /^tcp:\/\/([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(parseSpec(spec).base);
  if (!m) return null;
  const port = Number(m[2] ?? 9100);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/** Porta serial aceita: COM1–COM256 no Windows, /dev/... no macOS e no Linux. */
export function validSerialPort(port) {
  return (
    /^COM\d{1,3}$/i.test(port) || (/^\/dev\/[A-Za-z0-9._/+-]+$/.test(port) && !port.includes('..'))
  );
}

/** Identificador de um aparelho BLE (endereço no Windows/Linux, UUID no macOS). */
export function validBleId(id) {
  return /^[A-Za-z0-9:_-]{1,64}$/.test(String(id ?? ''));
}

/** USB direto (sem driver) e porta paralela no Linux. */
export function validDirectDevice(path) {
  return /^\/dev\/(usb\/)?lp\d{1,2}$/.test(path);
}

/** Texto curto para mostrar ao usuário. */
export function describePrinter(spec) {
  if (!spec || spec === 'none') return 'Não imprimir';
  if (spec === 'stdout') return 'Terminal';
  const { base } = parseSpec(spec);
  if (base.startsWith('printer:')) return base.slice(8);
  if (base.startsWith('tcp://')) return `Rede ${base.slice(6)}`;
  if (base.startsWith('serial:')) return `Porta ${base.slice(7)}`;
  if (base.startsWith('file:')) return `USB direto ${base.slice(5)}`;
  if (base.startsWith('ble:')) return `Bluetooth BLE ${base.slice(4)}`;
  return spec;
}

function sendTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let connected = false;
    sock.setTimeout(10_000, () =>
      sock.destroy(
        new Error(
          connected
            ? `A impressora ${host}:${port} recebeu e não fechou a conexão. Confira se saiu antes de mandar de novo (é térmica de cupom?).`
            : `A impressora ${host}:${port} não respondeu. Ela está ligada e na mesma rede deste computador?`,
        ),
      ),
    );
    sock.once('error', (e) => {
      // Depois de conectar, o texto pode ter chegado: não manda de novo sozinho.
      if (connected) {
        e.sent = true;
        return reject(e);
      }
      reject(
        e.code === 'ECONNREFUSED' ||
          e.code === 'EHOSTUNREACH' ||
          e.code === 'ENETUNREACH' ||
          e.code === 'ETIMEDOUT'
          ? new Error(
              `Impressora ${host}:${port} fora do ar ou IP errado. Imprima a folha de autoteste para conferir o IP.`,
            )
          : e.code === 'ENOTFOUND'
            ? new Error(`Não achei "${host}" na rede. Use o IP da impressora (ex.: 192.168.0.50).`)
            : e,
      );
    });
    sock.once('connect', () => {
      connected = true;
      sock.end(data);
    });
    sock.once('close', (hadError) => (hadError ? undefined : resolve()));
  });
}

/** Roda um programa e devolve a saída; `timeoutMs` encerra se travar (ex.: Bluetooth longe). */
export function run(cmd, args, { env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill();
      reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          Object.assign(new Error((err || out).trim().split('\n').pop() || `código ${code}`), {
            exitCode: code,
          }),
        );
    });
  });
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

/** Roda um script do PowerShell (Windows) passando os dados por variáveis de ambiente. */
export async function powershell(script, env, timeoutMs) {
  const dir = await mkdtemp(join(tmpdir(), 'comandou-'));
  try {
    const ps1 = join(dir, 'script.ps1');
    // BOM: o PowerShell 5 lê o arquivo como UTF-8 (acentos nas mensagens e nos nomes).
    await writeFile(ps1, `﻿${script}`, 'utf8');
    return await run('powershell.exe', [...POWERSHELL, ps1], { env, timeoutMs });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Envio RAW para o spooler do Windows (winspool.drv), sem módulo nativo: o PowerShell compila
// uma classe pequena na hora. Funciona com impressoras USB instaladas pelo driver do fabricante
// (Elgin, Bematech, Epson, Daruma...) ou como "Generic / Text Only".
const WIN_RAW_PS1 = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ComandouRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] data, string doc) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("PRINTER_NOT_FOUND");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = String.IsNullOrEmpty(doc) ? "Comandou" : doc;
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Win32Exception();
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw new Win32Exception();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[ComandouRaw]::Send($env:COMANDOU_PRINTER, [IO.File]::ReadAllBytes($env:COMANDOU_FILE), $env:COMANDOU_DOC)
`;

// Porta serial no Windows (Bluetooth pareado, RS-232, USB-serial) pelo .NET do próprio sistema.
// Os erros saem com um código na frente para virar uma mensagem clara.
const WIN_SERIAL_PS1 = `$ErrorActionPreference = 'Stop'
$bytes = [IO.File]::ReadAllBytes($env:COMANDOU_FILE)
$p = New-Object System.IO.Ports.SerialPort($env:COMANDOU_PORT, [int]$env:COMANDOU_BAUD, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$p.Handshake = [System.IO.Ports.Handshake]::None
$p.DtrEnable = $true
$p.RtsEnable = $true
$p.WriteTimeout = 20000
try { $p.Open() } catch {
  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
  if ($e -is [System.UnauthorizedAccessException]) { [Console]::Error.WriteLine('PORT_BUSY') }
  elseif ($e.Message -match 'does not exist|não existe|nao existe') { [Console]::Error.WriteLine('PORT_MISSING') }
  else { [Console]::Error.WriteLine('PORT_OPEN ' + $e.Message) }
  exit 3
}
try {
  $p.Write($bytes, 0, $bytes.Length)
  $n = 0
  while ($p.BytesToWrite -gt 0 -and $n -lt 400) { Start-Sleep -Milliseconds 50; $n++ }
  Start-Sleep -Milliseconds 300
} catch {
  [Console]::Error.WriteLine('PORT_WRITE ' + $_.Exception.Message); exit 4
} finally { $p.Close() }
`;

// Documentos do Comandou na fila do Windows: "Comandou" (RAW e folha, 1.6 em diante) e
// "data_text_html..." (folha das versões até a 1.5, sem título).
const OURS = "'^(Comandou|data_text_html)'";

const WIN_SPOOL_PS1 = `$ErrorActionPreference = 'Stop'
$j = @(Get-PrintJob -PrinterName $env:COMANDOU_PRINTER | Where-Object { $_.DocumentName -match ${OURS} })
$e = @($j | Where-Object { [string]$_.JobStatus -match 'Error|Offline|PaperOut|Blocked|UserIntervention' })
Write-Output "$($j.Count) $($e.Count)"
`;

const WIN_PURGE_PS1 = `$ErrorActionPreference = 'Continue'
$n = 0
foreach ($p in ($env:COMANDOU_PRINTERS -split "\n" | Where-Object { $_ })) {
  try {
    Get-PrintJob -PrinterName $p -ErrorAction Stop | Where-Object { $_.DocumentName -match ${OURS} } |
      ForEach-Object { Remove-PrintJob -InputObject $_ -ErrorAction Stop; $n++ }
  } catch { [Console]::Error.WriteLine("$($p) - $($_.Exception.Message)") }
}
Write-Output $n
`;

// Tudo o que está na fila do Windows das impressoras escolhidas (do Comandou e dos outros
// programas), em JSON. A hora sai em ISO (o PowerShell 5 escreveria "/Date(...)/").
const WIN_SPOOL_LIST_PS1 = `$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.ArrayList
foreach ($p in ($env:COMANDOU_PRINTERS -split "\n" | Where-Object { $_ })) {
  try {
    foreach ($j in @(Get-PrintJob -PrinterName $p -ErrorAction Stop)) {
      $t = $null
      if ($j.SubmittedTime) { $t = $j.SubmittedTime.ToUniversalTime().ToString('o') }
      [void]$out.Add([pscustomobject]@{ printer = $p; id = [int]$j.Id; name = [string]$j.DocumentName; status = [string]$j.JobStatus; at = $t; pages = [int]$j.TotalPages })
    }
  } catch { [Console]::Error.WriteLine("$($p) - $($_.Exception.Message)") }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

// Apaga documentos pelo número na fila do Windows ("impressora<TAB>número" por linha).
const WIN_SPOOL_REMOVE_PS1 = `$ErrorActionPreference = 'Continue'
$n = 0
foreach ($l in ($env:COMANDOU_JOBS -split "\n" | Where-Object { $_ })) {
  $p, $id = $l -split "\t"
  try { Remove-PrintJob -PrinterName $p -ID ([int]$id) -ErrorAction Stop; $n++ }
  catch { [Console]::Error.WriteLine("$($p) $($id) - $($_.Exception.Message)") }
}
Write-Output $n
`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SPOOL_STATUS = [
  [/Error/i, 'Com erro'],
  [/PaperOut/i, 'Sem papel'],
  [/Offline/i, 'Impressora desligada'],
  [/UserIntervention|Blocked/i, 'Precisa de alguém na impressora'],
  [/Paused/i, 'Pausado'],
  [/Deleting|Deleted/i, 'Apagando'],
  [/Printing/i, 'Imprimindo'],
  [/Spooling/i, 'Preparando'],
  [/Printed|Complete/i, 'Impresso'],
];
/** Situação do documento na fila do Windows em português (JobStatus vem em inglês). */
export function spoolStatus(raw) {
  const s = String(raw ?? '');
  for (const [re, label] of SPOOL_STATUS) if (re.test(s)) return label;
  return 'Na fila';
}

/**
 * Lê a saída do WIN_SPOOL_LIST_PS1 (testada à parte). O documento do Comandou traz o id do
 * trabalho no nome; os dos outros programas vão só com nome, situação e hora.
 */
export function parseSpoolList(out) {
  let rows;
  try {
    rows = JSON.parse(String(out ?? '').trim() || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) rows = rows && typeof rows === 'object' ? [rows] : [];
  return rows
    .filter((r) => r && typeof r === 'object' && r.printer)
    .map((r) => {
      const name = String(r.name ?? '').slice(0, 120);
      const ours = new RegExp(OURS.slice(1, -1)).test(name);
      const at =
        typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at))
          ? new Date(r.at).toISOString()
          : null;
      return {
        printer: String(r.printer).slice(0, 120),
        spoolId: Number(r.id) || 0,
        name: name || 'Documento',
        jobId: ours ? (UUID.exec(name)?.[0]?.toLowerCase() ?? null) : null,
        status: spoolStatus(r.status),
        at,
        pages: Number.isFinite(Number(r.pages)) && Number(r.pages) > 0 ? Number(r.pages) : null,
        ours,
      };
    });
}

/** Tudo o que está na fila do Windows das impressoras `names`. Fora do Windows: null. */
export async function listSpool(names, platform = process.platform) {
  const list = [...new Set(names.filter(Boolean))];
  if (platform !== 'win32') return null;
  if (!list.length) return [];
  const out = await powershell(WIN_SPOOL_LIST_PS1, { COMANDOU_PRINTERS: list.join('\n') }, 30_000);
  return parseSpoolList(out);
}

/** Apaga documentos da fila do Windows ({ printer, spoolId }). Devolve quantos apagou. */
export async function removeSpool(docs, platform = process.platform) {
  if (platform !== 'win32' || !docs.length) return 0;
  const lines = docs.map((d) => `${d.printer}\t${d.spoolId}`).join('\n');
  const out = await powershell(WIN_SPOOL_REMOVE_PS1, { COMANDOU_JOBS: lines }, 60_000);
  return Number(String(out).trim().split(/\s+/).pop()) || 0;
}

/**
 * Comandas do Comandou paradas na fila do sistema de uma impressora: { count, error }.
 * Só no Windows; nos outros, null (não sabe).
 */
export async function spoolBacklog(name, platform = process.platform) {
  if (platform !== 'win32') return null;
  const out = await powershell(WIN_SPOOL_PS1, { COMANDOU_PRINTER: name }, 15_000);
  const [count, error] = String(out).trim().split(/\s+/).map(Number);
  return Number.isFinite(count) ? { count, error: Number.isFinite(error) ? error : 0 } : null;
}

/**
 * Apaga da fila do sistema os documentos do Comandou nas impressoras `names` (pedido da tela
 * Impressão). Documentos de outros programas ficam. Devolve quantos apagou.
 */
export async function purgeSpool(names, platform = process.platform) {
  const list = [...new Set(names.filter(Boolean))];
  if (platform !== 'win32' || !list.length) return 0;
  const out = await powershell(WIN_PURGE_PS1, { COMANDOU_PRINTERS: list.join('\n') }, 60_000);
  return Number(String(out).trim().split(/\s+/).pop()) || 0;
}

/**
 * Impressora de rede escolhida como térmica (texto direto na porta 9100) que, na verdade, é uma
 * jato de tinta ou laser instalada no Windows. A Epson, a HP e a Brother põem o fim do MAC no
 * nome ("EPSON17C57B (L4260 Series)"). Devolve o nome da instalada, ou null.
 */
export function installedTwinOf(spec, installed) {
  const { base, opts } = parseSpec(spec);
  if (!base.startsWith('tcp://') || !opts.mac) return null;
  const tail = opts.mac.replace(/-/g, '').slice(-6);
  const hit = installed.find(
    (p) =>
      p.name
        .toUpperCase()
        .replace(/[^0-9A-F]/g, '')
        .includes(tail) && !looksLikeReceipt(p.name, p.driver ?? ''),
  );
  return hit?.name ?? null;
}

async function withTempFile(data, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'comandou-'));
  const file = join(dir, `${randomUUID()}.bin`);
  try {
    await writeFile(file, data);
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function sendSystemPrinter(name, data, doc = 'Comandou') {
  await withTempFile(data, async (file) => {
    if (process.platform === 'win32') {
      await powershell(WIN_RAW_PS1, {
        COMANDOU_PRINTER: name,
        COMANDOU_FILE: file,
        COMANDOU_DOC: doc,
      }).catch((e) => {
        throw /PRINTER_NOT_FOUND/.test(e.message)
          ? new Error(
              `Impressora "${name}" não encontrada no Windows. Ela foi removida ou mudou de nome: escolha de novo.`,
            )
          : e;
      });
    } else {
      await run('lp', ['-d', name, '-t', doc, '-o', 'raw', file]).catch((e) => {
        throw /does not exist|não existe|Unknown destination/i.test(e.message)
          ? new Error(`Impressora "${name}" não encontrada no sistema. Escolha de novo.`)
          : e;
      });
    }
  });
}

/**
 * Comando de shell que configura a porta serial e manda o arquivo (macOS e Linux).
 * No Linux, o stty -F abre a porta sem esperar o sinal da impressora (clocal) e a configuração
 * fica valendo. No macOS a porta volta ao padrão quando fecha, então tudo acontece com ela
 * aberta no descritor 3.
 */
export function serialShell(platform) {
  return platform === 'darwin'
    ? 'exec 3<>"$DEV" && stty "$BAUD" raw -echo clocal -crtscts <&3 && cat "$FILE" >&3'
    : 'stty -F "$DEV" "$BAUD" raw -echo clocal -crtscts && cat "$FILE" > "$DEV"';
}

/** Mensagem clara para as falhas comuns da porta serial. */
export function serialError(port, e, platform = process.platform) {
  const m = String(e?.message ?? e);
  const bt = /rfcomm|bluetooth/i.test(port) || platform === 'darwin';
  if (e?.code === 'TIMEOUT')
    return `A ${port} não respondeu. A impressora está ligada${bt ? ', perto do computador e desconectada do celular' : ''}?`;
  if (/PORT_BUSY/.test(m))
    return `A ${port} está ocupada: feche o programa do fabricante (ou outro que use a impressora) e tente de novo. Se for Bluetooth, desligue e ligue a impressora.`;
  if (/PORT_MISSING|No such file|não existe|does not exist/i.test(m))
    return `A porta ${port} não existe mais. A impressora foi desconectada ou despareada: escolha de novo.`;
  if (/Permission denied|Operation not permitted|EACCES/i.test(m))
    return platform === 'linux'
      ? `Sem permissão para usar ${port}. No terminal rode: sudo usermod -aG dialout $USER (e lp, para USB direto) e entre de novo no computador.`
      : `Sem permissão para usar ${port}.`;
  if (/semaphore|semáforo|timeout|tempo limite/i.test(m))
    return `A ${port} não respondeu. A impressora está ligada e perto do computador? Se for Bluetooth, desconecte do celular.`;
  return `Falha na porta ${port}: ${m.replace(/^PORT_\w+\s*/, '')}`;
}

async function sendSerial(port, baud, data) {
  if (!validSerialPort(port)) throw new Error(`Porta serial inválida: ${port}`);
  await withTempFile(data, async (file) => {
    try {
      if (process.platform === 'win32')
        await powershell(
          WIN_SERIAL_PS1,
          { COMANDOU_PORT: port.toUpperCase(), COMANDOU_BAUD: String(baud), COMANDOU_FILE: file },
          45_000,
        );
      else
        await run('sh', ['-c', serialShell(process.platform)], {
          env: { DEV: port, BAUD: String(baud), FILE: file },
          timeoutMs: 30_000,
        });
    } catch (e) {
      throw new Error(serialError(port, e));
    }
  });
}

async function sendFile(path, data) {
  try {
    await appendFile(path, data);
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM')
      throw new Error(
        `Sem permissão para usar ${path}. No terminal rode: sudo usermod -aG lp $USER e entre de novo no computador.`,
      );
    if (e.code === 'ENOENT' || e.code === 'ENODEV' || e.code === 'ENXIO')
      throw new Error(`${path} não existe. A impressora USB está ligada e com o cabo conectado?`);
    throw e;
  }
}

/** @type {Map<string, (base: string, data: Buffer, opts: object) => Promise<void>>} */
const transports = new Map();

/**
 * Liga um jeito de imprimir que só existe no aplicativo de computador (ex.: "ble:", que usa o
 * Bluetooth do Chromium). Na linha de comando ele não existe e a impressão falha com aviso claro.
 */
export function registerTransport(prefix, send) {
  transports.set(prefix, send);
}

/** Logo do restaurante já em pontos (o aplicativo de computador prepara; a linha de comando não). */
let printLogo = null;

/** @param {{ width: number, height: number, data: Buffer } | null} img */
export function setPrintLogo(img) {
  printLogo = img ?? null;
}

/**
 * Imprime `text` (já formatado em colunas) na impressora descrita por `spec`. `meta.doc` é o nome
 * do documento na fila do sistema. Devolve { spooled: true } quando entregou à fila do sistema
 * (Windows, CUPS): a folha pode ainda estar lá, esperando a impressora.
 */
export async function printText(spec, text, meta = {}) {
  if (!spec || spec === 'none') return;
  if (spec === 'stdout') {
    process.stdout.write(`\n----- impressão -----\n${text}\n---------------------\n`);
    return;
  }
  const { base, opts } = parseSpec(spec);
  if (opts.mode === 'doc') {
    const doc = transports.get('doc');
    if (!doc)
      throw new Error('Impressora comum (folha) só funciona no aplicativo Comandou Impressão.');
    await doc(base, text, { ...opts, title: meta.doc });
    return { spooled: true };
  }
  const data = toEscPos(text, { ...opts, logo: printLogo });
  if (base.startsWith('tcp://')) {
    const t = parseTcp(base);
    if (!t) throw new Error(`Endereço de impressora inválido: ${base}`);
    return sendTcp(t.host, t.port, data);
  }
  if (base.startsWith('printer:')) {
    await sendSystemPrinter(base.slice(8), data, meta.doc || 'Comandou');
    return { spooled: true };
  }
  if (base.startsWith('serial:')) return sendSerial(base.slice(7), opts.baud, data);
  if (base.startsWith('file:')) return sendFile(base.slice(5), data);
  for (const [prefix, send] of transports)
    if (base.startsWith(prefix)) return send(base, data, opts);
  if (base.startsWith('ble:'))
    throw new Error(
      'Bluetooth BLE só funciona no aplicativo Comandou Impressão, não na linha de comando.',
    );
  throw new Error(`Impressora não suportada: ${base}`);
}

/**
 * Página de teste local (não passa pelo Comandou). A régua de 42 colunas e a linha de acentos
 * dizem, no próprio papel, o que ajustar.
 */
export function testPageText(label, spec = '') {
  const { opts } = parseSpec(spec);
  const now = new Date().toLocaleString('pt-BR');
  const ruler = '123456789012345678901234567890123456789012';
  const paper = opts.paper === 58 ? '58 mm' : '80 mm';
  const accents =
    opts.codepage === 'ascii' ? 'sem acentos' : opts.codepage === '850' ? 'CP850' : 'padrão';
  return [
    '              COMANDOU',
    '         Teste de impressão',
    '-'.repeat(42),
    `Impressora: ${label}`.slice(0, 42),
    `Papel: ${paper} - Acentos: ${accents}`,
    `Data: ${now}`,
    '-'.repeat(42),
    'Régua (deve caber numa linha só):',
    ruler,
    'Se quebrou em duas linhas: papel 58 mm.',
    '',
    'Acentos: ção ã é ê í ó õ ú Ç À',
    'Saíram símbolos no lugar dos acentos?',
    'Troque "Acentos" nos ajustes.',
    '-'.repeat(42),
    'Se você consegue ler isto, está pronta!',
  ].join('\n');
}

/**
 * A impressora do sistema é térmica de cupom? `driver` é o nome do driver (Windows) ou o
 * "make and model" do CUPS. Na dúvida (nome genérico sem driver conhecido), trata como térmica.
 */
export function looksLikeReceipt(name, driver = '') {
  return speaksEscPos(printerType(name, driver), !!driver);
}

/** Impressora que nem é de papel (PDF, OneNote, fax): fica de fora da busca. */
export const isVirtualPrinter = (name, driver = '') => printerType(name, driver) === 'virtual';
