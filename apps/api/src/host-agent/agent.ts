import { DockerClient, demuxLogs } from './docker';
import { Updater } from './updater';
import { cpuCount, CpuTimes, cpuPercent, HostReader, parseCpu } from './proc';

export interface Sample {
  at: number;
  cpu: number;
  mem: number;
  rxBps: number;
  txBps: number;
}

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string>;
}
interface DockerService {
  ID: string;
  Version: { Index: number };
  UpdatedAt: string;
  Spec: {
    Name: string;
    Labels?: Record<string, string>;
    Mode: { Replicated?: { Replicas: number }; Global?: object };
    TaskTemplate: { ContainerSpec: { Image: string }; ForceUpdate?: number };
  };
  UpdateStatus?: { State?: string; Message?: string };
}
interface DockerTask {
  ServiceID: string;
  DesiredState: string;
  Status: { State: string; Err?: string; Timestamp?: string };
}

export const CLEANUP_TARGETS = ['containers', 'images', 'unused-images', 'build-cache'] as const;
export type CleanupTarget = (typeof CLEANUP_TARGETS)[number];

const SERVICE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/;
const shortImage = (img: string) => img.replace(/@sha256:[a-f0-9]+$/, '');

/**
 * O agente do servidor: amostras de CPU/memória/rede a cada 10 s (últimos 30 min), situação dos
 * contêineres e serviços do Swarm e as ações permitidas. Roda num serviço próprio, só na rede
 * interna, com token.
 */
export class HostAgent {
  readonly history: Sample[] = [];
  readonly updater: Updater;
  private last?: { cpu: CpuTimes; rx: number; tx: number; at: number };
  private containerMem = new Map<string, number>();
  private timers: NodeJS.Timeout[] = [];
  cores = 1;
  steal = 0;

  constructor(
    readonly host = new HostReader(),
    readonly docker = new DockerClient(),
    readonly maxSamples = 180,
  ) {
    this.updater = new Updater(docker);
  }

  start() {
    void this.sample();
    void this.sampleContainers();
    this.timers.push(setInterval(() => void this.sample(), 10_000));
    this.timers.push(setInterval(() => void this.sampleContainers(), 30_000));
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  async sample(): Promise<void> {
    try {
      const stat = await this.host.stat();
      const cpu = parseCpu(stat);
      this.cores = cpuCount(stat);
      const mem = await this.host.meminfo();
      const net = await this.host.net().catch(() => ({ rx: 0, tx: 0 }));
      const at = Date.now();
      if (this.last) {
        const secs = Math.max((at - this.last.at) / 1000, 0.001);
        const c = cpuPercent(this.last.cpu, cpu);
        this.steal = c.steal;
        this.history.push({
          at,
          cpu: c.busy,
          mem: mem.total ? Math.round((mem.used / mem.total) * 1000) / 10 : 0,
          rxBps: Math.max(0, Math.round((net.rx - this.last.rx) / secs)),
          txBps: Math.max(0, Math.round((net.tx - this.last.tx) / secs)),
        });
        if (this.history.length > this.maxSamples) this.history.shift();
      }
      this.last = { cpu, rx: net.rx, tx: net.tx, at };
    } catch {
      /* próxima amostra tenta de novo */
    }
  }

  /** Memória de cada contêiner rodando (leitura única, sem esperar a janela de CPU). */
  async sampleContainers(): Promise<void> {
    try {
      const list = await this.docker.call<DockerContainer[]>('GET', '/containers/json');
      const next = new Map<string, number>();
      const queue = [...list];
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const s = await this.docker
            .call<{
              memory_stats?: { usage?: number; stats?: { inactive_file?: number } };
            }>('GET', `/containers/${c.Id}/stats?stream=false&one-shot=true`, undefined, {
              timeoutMs: 5000,
            })
            .catch(() => null);
          const m = s?.memory_stats;
          if (m?.usage) next.set(c.Id, m.usage - (m.stats?.inactive_file ?? 0));
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      this.containerMem = next;
    } catch {
      /* Docker indisponível: a tela mostra o erro no status */
    }
  }

  async status() {
    const [mem, load, uptime, hostname, disks] = await Promise.all([
      this.host.meminfo(),
      this.host.load(),
      this.host.uptime(),
      this.host.hostname(),
      this.host.disks().catch(() => []),
    ]);
    const now = this.history.at(-1);
    let docker: Awaited<ReturnType<HostAgent['dockerStatus']>> | { error: string };
    try {
      docker = await this.dockerStatus();
    } catch (e) {
      docker = { error: (e as Error).message };
    }
    return {
      at: new Date().toISOString(),
      host: {
        // O hostname do /proc é o do contêiner; o nome do nó vem do Docker.
        hostname: ('nodeName' in docker && docker.nodeName) || hostname,
        uptimeSec: uptime,
        cores: this.cores,
        load,
        cpu: { percent: now?.cpu ?? null, steal: this.steal },
        memory: mem,
        disks,
        network: { rxBps: now?.rxBps ?? null, txBps: now?.txBps ?? null },
      },
      history: this.history,
      docker,
    };
  }

  private async dockerStatus() {
    const [info, containers, services, tasks] = await Promise.all([
      this.docker.call<{
        ServerVersion: string;
        Name?: string;
        Swarm?: { LocalNodeState?: string; ControlAvailable?: boolean };
      }>('GET', '/info'),
      this.docker.call<DockerContainer[]>('GET', '/containers/json?all=1'),
      this.docker.call<DockerService[]>('GET', '/services').catch(() => [] as DockerService[]),
      this.docker.call<DockerTask[]>('GET', '/tasks').catch(() => [] as DockerTask[]),
    ]);
    const svc = services
      .map((s) => {
        const mine = tasks.filter((t) => t.ServiceID === s.ID);
        const running = mine.filter((t) => t.Status.State === 'running').length;
        const failing = mine
          .filter(
            (t) => t.DesiredState === 'shutdown' && ['failed', 'rejected'].includes(t.Status.State),
          )
          .sort((a, b) => (b.Status.Timestamp ?? '').localeCompare(a.Status.Timestamp ?? ''))[0];
        return {
          id: s.ID,
          name: s.Spec.Name,
          stack: s.Spec.Labels?.['com.docker.stack.namespace'] ?? null,
          image: shortImage(s.Spec.TaskTemplate.ContainerSpec.Image),
          mode: s.Spec.Mode.Global ? 'global' : 'replicated',
          desired: s.Spec.Mode.Replicated?.Replicas ?? null,
          running,
          updatedAt: s.UpdatedAt,
          updateState: s.UpdateStatus?.State ?? null,
          lastError: failing?.Status.Err ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const list = containers
      .map((c) => ({
        id: c.Id.slice(0, 12),
        name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        service: c.Labels['com.docker.swarm.service.name'] ?? null,
        image: shortImage(c.Image),
        state: c.State,
        status: c.Status,
        createdAt: new Date(c.Created * 1000).toISOString(),
        memoryBytes: this.containerMem.get(c.Id) ?? null,
      }))
      .sort(
        (a, b) =>
          Number(b.state === 'running') - Number(a.state === 'running') ||
          a.name.localeCompare(b.name),
      );
    return {
      version: info.ServerVersion,
      nodeName: info.Name ?? null,
      swarm: info.Swarm?.LocalNodeState === 'active',
      manager: !!info.Swarm?.ControlAvailable,
      containers: {
        total: list.length,
        running: list.filter((c) => c.state === 'running').length,
        list,
      },
      services: svc,
    };
  }

  /** Espaço do Docker (pode levar alguns segundos: o Docker calcula os tamanhos). */
  async diskUsage() {
    const df = await this.docker.call<{
      LayersSize?: number;
      Images?: { Size: number; SharedSize: number; Containers: number }[];
      Containers?: { SizeRw?: number; State: string }[];
      Volumes?: { UsageData?: { Size: number; RefCount: number } }[];
      BuildCache?: { Size: number; InUse: boolean; Shared: boolean }[];
    }>('GET', '/system/df', undefined, { timeoutMs: 120_000 });
    const images = df.Images ?? [];
    const sum = (a: number[]) => a.reduce((x, y) => x + Math.max(y, 0), 0);
    const stopped = (df.Containers ?? []).filter((c) => c.State !== 'running');
    return {
      images: {
        count: images.length,
        size: df.LayersSize ?? sum(images.map((i) => i.Size)),
        unused: images.filter((i) => i.Containers === 0).length,
        reclaimable: sum(
          images.filter((i) => i.Containers === 0).map((i) => i.Size - i.SharedSize),
        ),
      },
      containers: {
        count: df.Containers?.length ?? 0,
        stopped: stopped.length,
        reclaimable: sum(stopped.map((c) => c.SizeRw ?? 0)),
      },
      volumes: {
        count: df.Volumes?.length ?? 0,
        size: sum((df.Volumes ?? []).map((v) => v.UsageData?.Size ?? 0)),
      },
      buildCache: {
        count: df.BuildCache?.length ?? 0,
        reclaimable: sum(
          (df.BuildCache ?? []).filter((b) => !b.InUse && !b.Shared).map((b) => b.Size),
        ),
      },
    };
  }

  /** Limpeza segura: nunca toca volumes (dados) nem nada em uso. */
  async cleanup(targets: CleanupTarget[]) {
    const out: { target: CleanupTarget; reclaimed: number; removed: number; error?: string }[] = [];
    const order = CLEANUP_TARGETS.filter((t) => targets.includes(t)); // contêineres antes das imagens
    for (const target of order) {
      try {
        if (target === 'containers') {
          const r = await this.docker.call<{
            SpaceReclaimed: number;
            ContainersDeleted: string[] | null;
          }>('POST', '/containers/prune');
          out.push({
            target,
            reclaimed: r.SpaceReclaimed,
            removed: r.ContainersDeleted?.length ?? 0,
          });
        } else if (target === 'images' || target === 'unused-images') {
          const dangling = target === 'images' ? 'true' : 'false';
          const filters = encodeURIComponent(JSON.stringify({ dangling: [dangling] }));
          const r = await this.docker.call<{
            SpaceReclaimed: number;
            ImagesDeleted: unknown[] | null;
          }>('POST', `/images/prune?filters=${filters}`, undefined, { timeoutMs: 300_000 });
          out.push({ target, reclaimed: r.SpaceReclaimed, removed: r.ImagesDeleted?.length ?? 0 });
        } else {
          const r = await this.docker.call<{
            SpaceReclaimed: number;
            CachesDeleted: string[] | null;
          }>('POST', '/build/prune', undefined, { timeoutMs: 300_000 });
          out.push({ target, reclaimed: r.SpaceReclaimed, removed: r.CachesDeleted?.length ?? 0 });
        }
      } catch (e) {
        out.push({ target, reclaimed: 0, removed: 0, error: (e as Error).message });
      }
    }
    return out;
  }

  /** Reinicia as tarefas de um serviço do Swarm (mesmo efeito de `docker service update --force`). */
  async restartService(name: string) {
    if (!SERVICE_RE.test(name)) throw new Error('nome de serviço inválido');
    const s = await this.docker.call<DockerService>('GET', `/services/${encodeURIComponent(name)}`);
    const spec = { ...s.Spec } as DockerService['Spec'];
    spec.TaskTemplate = {
      ...spec.TaskTemplate,
      ForceUpdate: (spec.TaskTemplate.ForceUpdate ?? 0) + 1,
    };
    await this.docker.call('POST', `/services/${s.ID}/update?version=${s.Version.Index}`, spec);
    return { service: s.Spec.Name };
  }

  /** Últimas linhas do log de um serviço (máx. 1000 linhas / 256 KB). */
  async serviceLogs(name: string, tail: number) {
    if (!SERVICE_RE.test(name)) throw new Error('nome de serviço inválido');
    const n = Math.min(Math.max(Math.floor(tail) || 200, 10), 1000);
    const buf = await this.docker.call<Buffer>(
      'GET',
      `/services/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&timestamps=1&tail=${n}`,
      undefined,
      { raw: true, timeoutMs: 15_000 },
    );
    const text = demuxLogs(buf);
    return { service: name, text: text.length > 262_144 ? text.slice(-262_144) : text };
  }
}
