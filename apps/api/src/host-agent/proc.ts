import { readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Leitura do /proc e do disco do SERVIDOR (não do contêiner): o agente monta o /proc do host em
 * HOST_PROC (padrão /host/proc) e a raiz do host, só leitura, em HOST_ROOT (padrão /host/root).
 * Funções de parse puras para teste; nada aqui altera o servidor.
 */

export interface CpuTimes {
  idle: number;
  total: number;
  steal: number;
}

/** Primeira linha de /proc/stat ("cpu  user nice system idle iowait irq softirq steal ..."). */
export function parseCpu(stat: string): CpuTimes {
  const line = stat.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) throw new Error('/proc/stat sem linha cpu');
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = v;
  return {
    idle: idle + iowait,
    steal,
    total: user + nice + system + idle + iowait + irq + softirq + steal,
  };
}

export function cpuCount(stat: string): number {
  return stat.split('\n').filter((l) => /^cpu\d+ /.test(l)).length || 1;
}

/** Percentual de uso entre duas leituras (0–100, uma casa). */
export function cpuPercent(a: CpuTimes, b: CpuTimes): { busy: number; steal: number } {
  const total = b.total - a.total;
  if (total <= 0) return { busy: 0, steal: 0 };
  const r = (n: number) => Math.round(n * 1000) / 10;
  return { busy: r(1 - (b.idle - a.idle) / total), steal: r((b.steal - a.steal) / total) };
}

export interface Memory {
  total: number;
  available: number;
  used: number;
  swapTotal: number;
  swapUsed: number;
}

/** /proc/meminfo em bytes. "Usada" = total − disponível (cache não conta como uso). */
export function parseMeminfo(text: string): Memory {
  const kb = (k: string) => {
    const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : 0;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const swapTotal = kb('SwapTotal');
  return {
    total,
    available,
    used: total - available,
    swapTotal,
    swapUsed: swapTotal - kb('SwapFree'),
  };
}

export interface NetTotals {
  rx: number;
  tx: number;
}

/** Soma de /proc/<pid>/net/dev, sem lo e sem interfaces virtuais do Docker. */
export function parseNetDev(text: string): NetTotals {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest) continue;
    const iface = name!.trim();
    if (iface === 'lo' || /^(veth|docker|br-|vxlan|cali|flannel)/.test(iface)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    rx += f[0] ?? 0;
    tx += f[8] ?? 0;
  }
  return { rx, tx };
}

export function parseLoad(text: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = text.trim().split(/\s+/).slice(0, 3).map(Number);
  return [a, b, c];
}

export interface DiskUsage {
  mount: string;
  total: number;
  free: number;
}

export class HostReader {
  constructor(
    readonly procDir = process.env.HOST_PROC ?? '/host/proc',
    readonly rootDir = process.env.HOST_ROOT ?? '/host/root',
  ) {}

  private read(path: string) {
    return readFile(join(this.procDir, path), 'utf8');
  }

  stat = () => this.read('stat');
  meminfo = async () => parseMeminfo(await this.read('meminfo'));
  load = async () => parseLoad(await this.read('loadavg'));
  uptime = async () => Math.floor(Number((await this.read('uptime')).split(' ')[0]));
  hostname = async () =>
    (await this.read('sys/kernel/hostname').catch(() => 'servidor')).trim() || 'servidor';
  /** Rede do host: /proc/1/net é a do PID 1 do servidor (o /proc/net seria a do contêiner). */
  net = async () => parseNetDev(await this.read('1/net/dev'));

  async disks(): Promise<DiskUsage[]> {
    const s = await statfs(this.rootDir);
    return [{ mount: '/', total: s.blocks * s.bsize, free: s.bavail * s.bsize }];
  }
}
