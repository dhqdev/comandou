// Saídas de impressão do agente, sem dependências.
//
// Uma impressora é descrita por um texto:
//   tcp://IP:PORTA       impressora térmica em rede (porta 9100)
//   printer:NOME         impressora instalada no sistema (USB): no Windows vai direto para o
//                        spooler em modo RAW; no macOS/Linux, pelo CUPS (lp -o raw)
//   file:/caminho        arquivo ou dispositivo (ex.: /dev/usb/lp0)
//   stdout               mostra no terminal (testes sem impressora)
//   none                 não imprime (o trabalho é confirmado e descartado)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toEscPos } from './escpos.mjs';

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

/** Valida e separa "tcp://IP:PORTA". */
export function parseTcp(spec) {
  const m = /^tcp:\/\/([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(spec.trim());
  if (!m) return null;
  const port = Number(m[2] ?? 9100);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/** Texto curto para mostrar ao usuário. */
export function describePrinter(spec) {
  if (!spec || spec === 'none') return 'Não imprimir';
  if (spec === 'stdout') return 'Terminal';
  if (spec.startsWith('printer:')) return spec.slice(8);
  if (spec.startsWith('tcp://')) return `Rede ${spec.slice(6)}`;
  if (spec.startsWith('file:')) return spec.slice(5);
  return spec;
}

function sendTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(10_000, () => sock.destroy(new Error('A impressora de rede não respondeu')));
    sock.once('error', (e) =>
      reject(
        e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH'
          ? new Error(`Impressora ${host}:${port} fora do ar ou IP errado`)
          : e,
      ),
    );
    sock.once('connect', () => sock.end(data));
    sock.once('close', (hadError) => (hadError ? undefined : resolve()));
  });
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.on('data', (d) => (err += d));
    p.once('error', reject);
    p.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `código ${code}`)),
    );
  });
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
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("PRINTER_NOT_FOUND");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Comandou";
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
[ComandouRaw]::Send($env:COMANDOU_PRINTER, [IO.File]::ReadAllBytes($env:COMANDOU_FILE))
`;

async function sendSystemPrinter(name, data) {
  const dir = await mkdtemp(join(tmpdir(), 'comandou-'));
  const file = join(dir, `${randomUUID()}.bin`);
  try {
    await writeFile(file, data);
    if (process.platform === 'win32') {
      const ps1 = join(dir, 'raw.ps1');
      await writeFile(ps1, WIN_RAW_PS1, 'utf8');
      await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
        { COMANDOU_PRINTER: name, COMANDOU_FILE: file },
      ).catch((e) => {
        throw /PRINTER_NOT_FOUND/.test(e.message)
          ? new Error(`Impressora "${name}" não encontrada no Windows`)
          : e;
      });
    } else {
      await run('lp', ['-d', name, '-o', 'raw', file]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Imprime `text` (já formatado em colunas) na impressora descrita por `spec`. */
export async function printText(spec, text) {
  if (!spec || spec === 'none') return;
  if (spec === 'stdout') {
    process.stdout.write(`\n----- impressão -----\n${text}\n---------------------\n`);
    return;
  }
  const data = toEscPos(text);
  if (spec.startsWith('tcp://')) {
    const t = parseTcp(spec);
    if (!t) throw new Error(`Endereço de impressora inválido: ${spec}`);
    return sendTcp(t.host, t.port, data);
  }
  if (spec.startsWith('printer:')) return sendSystemPrinter(spec.slice(8), data);
  if (spec.startsWith('file:')) return appendFile(spec.slice(5), data);
  throw new Error(`Impressora não suportada: ${spec}`);
}

/** Página de teste local (não passa pelo Comandou). */
export function testPageText(label) {
  const now = new Date().toLocaleString('pt-BR');
  return [
    '              COMANDOU',
    '         Teste de impressao',
    '-'.repeat(42),
    `Impressora: ${label}`.slice(0, 42),
    `Data: ${now}`,
    'Acentos: ção ã é ê í ó õ ú Ç',
    '-'.repeat(42),
    'Se voce consegue ler isto, esta pronta!',
  ].join('\n');
}
