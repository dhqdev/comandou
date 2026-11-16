import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Conversa com o ajudante da VM (scripts/vm.sh, no systemd do servidor, fora do Docker). O agente
 * não executa nada no servidor: só deixa o NOME de uma ação em `pedidos/` e lê o que o ajudante
 * escreve (`info.json` e `jobs/`). Quem decide o que roda é o vm.sh, com a lista fixa dele.
 */
export const VM_ACTIONS = [
  'check',
  'upgrade',
  'upgrade-security',
  'clean',
  'restart-docker',
  'reboot',
] as const;
export type VmAction = (typeof VM_ACTIONS)[number];
export const VM_CLEAN = ['apt', 'journal', 'logs', 'ram'] as const;
export type VmClean = (typeof VM_CLEAN)[number];

export interface VmJob {
  id: string;
  action: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  exitCode: number | null;
  targets?: string[];
}

const ID_RE = /^[a-z0-9-]{8,40}$/;
/** Trabalho "rodando" há mais que isso: a VM reiniciou no meio ou o ajudante caiu. */
const STALE_MS = 3 * 60 * 60_000;
/** Pedido parado na fila por mais que isso: o ajudante não está pegando os pedidos. */
const STUCK_MS = 2 * 60_000;

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

export class VmHelper {
  constructor(
    readonly dir = process.env.AGENT_VM_DIR ?? '/host/comandou-vm',
    private readonly now = () => Date.now(),
  ) {}

  private async pending(): Promise<(VmJob & { queuedAt: number })[]> {
    const names = await readdir(join(this.dir, 'pedidos')).catch(() => [] as string[]);
    const out: (VmJob & { queuedAt: number })[] = [];
    for (const n of names.filter((x) => x.endsWith('.req'))) {
      const p = join(this.dir, 'pedidos', n);
      const [text, st] = await Promise.all([
        readFile(p, 'utf8').catch(() => ''),
        stat(p).catch(() => null),
      ]);
      const [action = '?', ...targets] = text.trim().split(/\s+/);
      out.push({
        id: n.slice(0, -4),
        action,
        targets,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        message: 'na fila',
        exitCode: null,
        queuedAt: st?.mtimeMs ?? this.now(),
      });
    }
    return out;
  }

  async jobs(): Promise<VmJob[]> {
    const names = await readdir(join(this.dir, 'jobs')).catch(() => [] as string[]);
    const jobs = (
      await Promise.all(
        names
          .filter((n) => n.endsWith('.json'))
          .map((n) => readJson<VmJob>(join(this.dir, 'jobs', n))),
      )
    ).filter((j): j is VmJob => !!j && ID_RE.test(j.id));
    for (const j of jobs) {
      if (
        j.status === 'running' &&
        j.startedAt &&
        this.now() - Date.parse(j.startedAt) > STALE_MS
      ) {
        j.status = 'failed';
        j.message = 'sem resposta do servidor (a VM reiniciou no meio?)';
      }
    }
    return jobs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, 30);
  }

  async info() {
    const info = await readJson<Record<string, unknown>>(join(this.dir, 'info.json'));
    const [jobs, queue] = await Promise.all([this.jobs(), this.pending()]);
    const stuck = queue.some((q) => this.now() - q.queuedAt > STUCK_MS);
    return {
      installed: !!info,
      stuck,
      info,
      jobs: [...queue.map(({ queuedAt: _q, ...j }) => j), ...jobs],
    };
  }

  /** Deixa o pedido para o ajudante (um de cada vez: recusa se já tem algo na fila ou rodando). */
  async request(action: string, targets: string[] = []) {
    if (!(VM_ACTIONS as readonly string[]).includes(action)) throw new Error('ação desconhecida');
    const clean = targets.filter((t) => (VM_CLEAN as readonly string[]).includes(t));
    if (action === 'clean' && !clean.length) throw new Error('escolha o que limpar');
    if (!(await readJson(join(this.dir, 'info.json'))))
      throw new Error('o ajudante da VM não está instalado (rode o instalador no servidor)');
    const [queue, jobs] = await Promise.all([this.pending(), this.jobs()]);
    const busy = queue[0] ?? jobs.find((j) => j.status === 'running');
    if (busy)
      throw new Error(
        `espere terminar: ${busy.action} ainda está ${busy.status === 'pending' ? 'na fila' : 'rodando'}`,
      );
    const id = `${this.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const dir = join(this.dir, 'pedidos');
    await mkdir(dir, { recursive: true });
    const line = [action, ...(action === 'clean' ? clean : [])].join(' ');
    // Escreve com outro nome e só então renomeia: o systemd só vê o pedido completo.
    await writeFile(join(dir, `${id}.tmp`), `${line}\n`, { mode: 0o600 });
    await rename(join(dir, `${id}.tmp`), join(dir, `${id}.req`));
    return { id, action, targets: action === 'clean' ? clean : [] };
  }

  /** Um trabalho e o registro dele (no máx. os últimos 256 KB). */
  async job(id: string) {
    if (!ID_RE.test(id)) throw new Error('trabalho inválido');
    const job =
      (await readJson<VmJob>(join(this.dir, 'jobs', `${id}.json`))) ??
      (await this.pending()).find((j) => j.id === id) ??
      null;
    if (!job) throw new Error('trabalho não encontrado');
    let log = await readFile(join(this.dir, 'jobs', `${id}.log`), 'utf8').catch(() => '');
    if (log.length > 262_144) log = log.slice(-262_144);
    return { job, log };
  }
}
