import type { DockerClient } from './docker';

/**
 * Atualização do sistema pelo painel: troca só a TAG das imagens do próprio Comandou nos
 * serviços do Swarm (migração primeiro, depois os demais, o agente por último). Nunca muda a
 * imagem em si: o repositório fica o que já está no serviço, então não dá para colocar uma
 * imagem de outro lugar. Cada serviço usa o rollback do Swarm se a nova versão não subir.
 */
export const VERSION_RE = /^v\d+\.\d+\.\d+$/;

interface Svc {
  ID: string;
  Version: { Index: number };
  Spec: {
    Name: string;
    Labels?: Record<string, string>;
    Mode: { Replicated?: { Replicas: number }; Global?: object };
    TaskTemplate: { ContainerSpec: { Image: string }; ForceUpdate?: number };
    UpdateConfig?: {
      FailureAction?: string;
      Monitor?: number;
      Order?: string;
      Parallelism?: number;
    };
  };
  UpdateStatus?: { State?: string; Message?: string };
}
interface Task {
  CreatedAt?: string;
  Status: { State: string; Err?: string };
  Spec?: { ContainerSpec?: { Image?: string } };
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'failed';
export interface UpdateStep {
  service: string;
  from: string;
  to: string;
  status: StepStatus;
  message?: string;
  /** Imagem completa que o serviço vai usar (repositório atual + tag nova). */
  image: string;
}
export interface UpdateJob {
  id: string;
  version: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'failed';
  message?: string;
  steps: UpdateStep[];
}

const split = (image: string) => {
  const clean = image.replace(/@sha256:[a-f0-9]+$/, '');
  const i = clean.lastIndexOf(':');
  const slash = clean.lastIndexOf('/');
  return i > slash
    ? { repo: clean.slice(0, i), tag: clean.slice(i + 1) }
    : { repo: clean, tag: 'latest' };
};

export interface UpdaterOptions {
  prefix?: string;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  selfName?: () => Promise<string | null>;
}

export class Updater {
  private job: UpdateJob | null = null;
  private readonly prefix: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly docker: Pick<DockerClient, 'call'>,
    private readonly opts: UpdaterOptions = {},
  ) {
    this.prefix = opts.prefix ?? process.env.AGENT_IMAGE_PREFIX ?? 'ghcr.io/dhqdev/comandou-';
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = opts.pollMs ?? 3000;
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  }

  current() {
    return this.job;
  }

  /** Nome do serviço em que este agente roda (para atualizá-lo por último). */
  private async self(): Promise<string | null> {
    if (this.opts.selfName) return this.opts.selfName();
    const id = process.env.HOSTNAME;
    if (!id) return null;
    try {
      const c = await this.docker.call<{ Config?: { Labels?: Record<string, string> } }>(
        'GET',
        `/containers/${encodeURIComponent(id)}/json`,
      );
      return c.Config?.Labels?.['com.docker.swarm.service.name'] ?? null;
    } catch {
      return null;
    }
  }

  /** Serviços que seriam atualizados, na ordem em que seriam. */
  async plan(version: string): Promise<UpdateStep[]> {
    if (!VERSION_RE.test(version)) throw new Error('versão inválida (use o formato v1.2.3)');
    const services = await this.docker.call<Svc[]>('GET', '/services');
    const self = await this.self();
    const rank = (s: Svc) => (s.Spec.Name === self ? 2 : /migrate/i.test(s.Spec.Name) ? 0 : 1);
    return services
      .filter((s) => s.Spec.TaskTemplate.ContainerSpec.Image.startsWith(this.prefix))
      .sort((a, b) => rank(a) - rank(b) || a.Spec.Name.localeCompare(b.Spec.Name))
      .map((s): UpdateStep => {
        const { repo, tag } = split(s.Spec.TaskTemplate.ContainerSpec.Image);
        return {
          service: s.Spec.Name,
          from: tag,
          to: version,
          image: `${repo}:${version}`,
          status: tag === version ? 'skipped' : 'pending',
          message: tag === version ? 'já está nesta versão' : undefined,
        };
      });
  }

  async start(version: string): Promise<UpdateJob> {
    if (this.job?.status === 'running') throw new Error('já existe uma atualização em andamento');
    const steps = await this.plan(version);
    if (!steps.some((s) => s.status === 'pending'))
      throw new Error('o sistema já está nesta versão');
    // Antes de mexer em qualquer serviço: a imagem dessa versão precisa existir no registro.
    for (const s of steps.filter((x) => x.status === 'pending')) {
      const image = s.image;
      await this.docker
        .call('GET', `/distribution/${image}/json`, undefined, { timeoutMs: 30_000 })
        .catch((e: Error) => {
          throw new Error(`a imagem ${image} não está disponível: ${e.message}`);
        });
    }
    const job: UpdateJob = {
      id: Math.random().toString(36).slice(2, 10),
      version,
      startedAt: new Date().toISOString(),
      status: 'running',
      steps,
    };
    this.job = job;
    void this.run(job).catch((e: Error) => {
      job.status = 'failed';
      job.message = e.message;
      job.finishedAt = new Date().toISOString();
    });
    return job;
  }

  private async run(job: UpdateJob) {
    const self = await this.self();
    for (const step of job.steps) {
      if (step.status !== 'pending') continue;
      step.status = 'running';
      const isSelf = step.service === self;
      try {
        await this.apply(step, step.image, isSelf);
        step.status = 'ok';
        if (isSelf) step.message = 'o agente reinicia agora; confira a versão em alguns segundos';
      } catch (e) {
        step.status = 'failed';
        step.message = (e as Error).message;
        job.status = 'failed';
        job.message = `Parou em ${step.service}: ${step.message}`;
        for (const rest of job.steps) if (rest.status === 'pending') rest.status = 'skipped';
        job.finishedAt = new Date().toISOString();
        return;
      }
    }
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  }

  private async apply(step: UpdateStep, image: string, isSelf: boolean) {
    const s = await this.docker.call<Svc>('GET', `/services/${encodeURIComponent(step.service)}`);
    const spec = structuredClone(s.Spec);
    spec.TaskTemplate.ContainerSpec.Image = image;
    const migrate = /migrate/i.test(step.service);
    if (!migrate) {
      // Se a versão nova não subir, o Swarm volta sozinho para a anterior.
      spec.UpdateConfig = {
        ...spec.UpdateConfig,
        FailureAction: 'rollback',
        Monitor: spec.UpdateConfig?.Monitor || 15_000_000_000,
      };
    }
    const startedAt = Date.now();
    await this.docker.call('POST', `/services/${s.ID}/update?version=${s.Version.Index}`, spec);
    if (isSelf) return;
    while (Date.now() - startedAt < this.timeoutMs) {
      await this.sleep(this.pollMs);
      if (migrate) {
        const tasks = await this.docker.call<Task[]>(
          'GET',
          `/tasks?filters=${encodeURIComponent(JSON.stringify({ service: [step.service] }))}`,
        );
        const mine = tasks
          .filter((t) => t.Spec?.ContainerSpec?.Image?.startsWith(image))
          .sort((a, b) => (b.CreatedAt ?? '').localeCompare(a.CreatedAt ?? ''))[0];
        if (mine?.Status.State === 'complete') return;
        if (mine && ['failed', 'rejected'].includes(mine.Status.State))
          throw new Error(`migração falhou: ${mine.Status.Err ?? mine.Status.State}`);
        continue;
      }
      const now = await this.docker.call<Svc>('GET', `/services/${s.ID}`);
      const st = now.UpdateStatus?.State;
      if (st === 'completed') return;
      if (st && /rollback|paused/.test(st))
        throw new Error(`a versão nova não subiu; o Swarm voltou para a anterior (${st})`);
    }
    throw new Error('demorou demais para atualizar');
  }
}
