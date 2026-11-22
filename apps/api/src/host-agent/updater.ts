import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  DesiredState?: string;
  Status: { State: string; Err?: string };
  Spec?: { ContainerSpec?: { Image?: string } };
}

/** Estados do Swarm em que a troca de um serviço ficou no meio (nem concluída, nem desfeita). */
const HALFWAY = /^(updating|paused|rollback_started|rollback_paused)$/;

export type StepStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'failed';
export interface UpdateStep {
  service: string;
  from: string;
  to: string;
  status: StepStatus;
  message?: string;
  /** Imagem completa que o serviço vai usar (repositório atual + tag nova). */
  image: string;
  /** Quando este serviço começou a trocar (para a tela saber há quanto tempo está parado). */
  startedAt?: string;
}
export interface UpdateJob {
  id: string;
  version: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'failed';
  message?: string;
  steps: UpdateStep[];
  /** Limpeza feita ao fim da atualização (contêineres parados, imagens e volumes anônimos sem uso). */
  cleanup?: { target: string; reclaimed: number; removed: number; error?: string }[];
  /** Última vez que o agente conferiu o andamento (se parar de mudar, o agente travou ou caiu). */
  checkedAt?: string;
}

/** Atualização interrompida pelo painel ("Destravar e continuar"): o laço antigo para quieto. */
class Cancelled extends Error {}

const split = (image: string) => {
  const clean = image.replace(/@sha256:[a-f0-9]+$/, '');
  const i = clean.lastIndexOf(':');
  const slash = clean.lastIndexOf('/');
  return i > slash
    ? { repo: clean.slice(0, i), tag: clean.slice(i + 1) }
    : { repo: clean, tag: 'latest' };
};

/** Credencial do registro a partir do ambiente do agente (null se não configurada). */
export function registryAuthFromEnv(prefix: string, env = process.env): string | null {
  const user = env.AGENT_REGISTRY_USER;
  const token = env.AGENT_REGISTRY_TOKEN_FILE
    ? readFileSync(env.AGENT_REGISTRY_TOKEN_FILE, 'utf8').trim()
    : env.AGENT_REGISTRY_TOKEN;
  if (!user || !token) return null;
  const serveraddress = prefix.split('/')[0] || 'ghcr.io';
  return Buffer.from(JSON.stringify({ username: user, password: token, serveraddress })).toString(
    'base64url',
  );
}

export interface UpdaterOptions {
  prefix?: string;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  selfName?: () => Promise<string | null>;
  /**
   * Login do registro (X-Registry-Auth, base64 de {username, password, serveraddress}) para
   * imagens privadas no GHCR. Padrão: AGENT_REGISTRY_USER + AGENT_REGISTRY_TOKEN(_FILE).
   */
  registryAuth?: string | null;
  /** Roda quando todos os serviços, menos o agente, já estão saudáveis na versão nova. */
  cleanup?: () => Promise<NonNullable<UpdateJob['cleanup']>>;
  /**
   * Arquivo onde o andamento fica guardado, para sobreviver a um reinício do agente (sem ele, a
   * tela perdia a atualização e ninguém sabia onde tinha parado). null = só na memória.
   */
  stateFile?: string | null;
}

const defaultStateFile = () =>
  process.env.AGENT_UPDATE_STATE ??
  join(process.env.AGENT_VM_DIR ?? '/host/comandou-vm', 'atualizacao.json');

export class Updater {
  private job: UpdateJob | null = null;
  private readonly prefix: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly authHeaders: Record<string, string>;
  private readonly stateFile: string | null;
  private cancelled = new WeakSet<UpdateJob>();

  constructor(
    private readonly docker: Pick<DockerClient, 'call'>,
    private readonly opts: UpdaterOptions = {},
  ) {
    this.prefix = opts.prefix ?? process.env.AGENT_IMAGE_PREFIX ?? 'ghcr.io/dhqdev/comandou-';
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = opts.pollMs ?? 3000;
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    const auth =
      opts.registryAuth === undefined ? registryAuthFromEnv(this.prefix) : opts.registryAuth;
    this.authHeaders = auth ? { 'X-Registry-Auth': auth } : {};
    this.stateFile = opts.stateFile === undefined ? defaultStateFile() : opts.stateFile;
    this.job = this.load();
  }

  current() {
    return this.job;
  }

  /**
   * Andamento guardado antes de o agente reiniciar. "Rodando" no arquivo quer dizer que o agente
   * caiu no meio (ou é ele mesmo trocando de versão, o último passo): vira interrompida, e a tela
   * oferece continuar de onde parou.
   */
  private load(): UpdateJob | null {
    if (!this.stateFile) return null;
    try {
      const job = JSON.parse(readFileSync(this.stateFile, 'utf8')) as UpdateJob;
      if (!job?.id || !Array.isArray(job.steps)) return null;
      if (job.status === 'running') {
        const left = job.steps.filter((s) => s.status === 'pending' || s.status === 'running');
        const onlySelf = left.length === 1 && left[0] === job.steps[job.steps.length - 1];
        for (const s of left) s.status = onlySelf ? 'ok' : 'skipped';
        job.status = onlySelf ? 'done' : 'failed';
        if (!onlySelf)
          job.message = 'O agente reiniciou no meio da atualização. Toque em Continuar.';
        job.finishedAt = new Date().toISOString();
      }
      return job;
    } catch {
      return null;
    }
  }

  private save(job: UpdateJob) {
    if (!this.stateFile || job !== this.job) return;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(job));
      renameSync(tmp, this.stateFile);
    } catch {
      /* sem pasta gravável: segue só na memória */
    }
  }

  /**
   * Destravar: larga a atualização em curso (o laço antigo para no próximo passo, sem mexer em
   * mais nada) e começa de novo na mesma versão. O plano novo pula o que já está na versão nova e
   * refaz, com reinício forçado, o serviço que ficou no meio da troca.
   */
  async resume(version?: string): Promise<UpdateJob> {
    const target = version ?? this.job?.version;
    if (!target) throw new Error('não há atualização para continuar');
    const old = this.job;
    if (old?.status === 'running') {
      this.cancelled.add(old);
      old.status = 'failed';
      old.message = 'Interrompida pelo painel para destravar.';
      old.finishedAt = new Date().toISOString();
      for (const s of old.steps)
        if (s.status === 'running' || s.status === 'pending') s.status = 'skipped';
    }
    try {
      return await this.start(target);
    } catch (e) {
      // Nada mais para trocar: a troca que parecia parada já tinha terminado.
      if (old && /já está nesta versão/.test((e as Error).message)) {
        old.status = 'done';
        old.message = undefined;
        for (const s of old.steps) if (s.status === 'skipped') s.status = 'ok';
        this.save(old);
        return old;
      }
      if (old) this.save(old);
      throw e;
    }
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
    return (
      services
        // Cópias de versões antigas (versions.ts) ficam na versão delas.
        .filter((s) => !s.Spec.Labels?.['comandou.pinned-version'])
        .filter((s) => s.Spec.TaskTemplate.ContainerSpec.Image.startsWith(this.prefix))
        .sort((a, b) => rank(a) - rank(b) || a.Spec.Name.localeCompare(b.Spec.Name))
        .map((s): UpdateStep => {
          const { repo, tag } = split(s.Spec.TaskTemplate.ContainerSpec.Image);
          const step: UpdateStep = {
            service: s.Spec.Name,
            from: tag,
            to: version,
            image: `${repo}:${version}`,
            status: 'pending',
          };
          if (tag !== version) return step;
          // Já tem a versão nova escrita, mas a troca parou no meio: refaz (com reinício forçado).
          if (HALFWAY.test(s.UpdateStatus?.State ?? '')) {
            step.message = 'tinha parado no meio; refazendo';
            return step;
          }
          return { ...step, status: 'skipped', message: 'já está nesta versão' };
        })
    );
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
        .call('GET', `/distribution/${image}/json`, undefined, {
          timeoutMs: 30_000,
          headers: this.authHeaders,
        })
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
    this.save(job);
    void this.run(job).catch((e: Error) => {
      if (e instanceof Cancelled) return;
      job.status = 'failed';
      job.message = e.message;
      job.finishedAt = new Date().toISOString();
      this.save(job);
    });
    return job;
  }

  private async run(job: UpdateJob) {
    const self = await this.self();
    // O agente é o último e reinicia no meio da própria troca: a limpeza vem antes dele, depois
    // que cada serviço anterior confirmou a versão nova. Falha na limpeza não desfaz a atualização.
    let cleaned = false;
    const clean = async () => {
      if (cleaned || !this.opts.cleanup) return;
      cleaned = true;
      job.cleanup = await this.opts
        .cleanup()
        .catch((e: Error) => [{ target: 'limpeza', reclaimed: 0, removed: 0, error: e.message }]);
    };
    for (const step of job.steps) {
      if (step.status !== 'pending') continue;
      this.alive(job);
      const isSelf = step.service === self;
      if (isSelf) {
        await clean();
        // Antes de se trocar: o arquivo já diz "feito", porque o agente some no meio da troca.
        step.status = 'ok';
        step.message = 'o agente reinicia agora; confira a versão em alguns segundos';
        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        this.save(job);
        try {
          await this.apply(step, step.image, true, job);
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          step.status = 'failed';
          step.message = (e as Error).message;
          job.status = 'failed';
          job.message = `Parou em ${step.service}: ${step.message}`;
          this.save(job);
        }
        return;
      }
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      this.save(job);
      try {
        await this.apply(step, step.image, false, job);
        step.status = 'ok';
        this.save(job);
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        step.status = 'failed';
        step.message = (e as Error).message;
        job.status = 'failed';
        job.message = `Parou em ${step.service}: ${step.message}`;
        for (const rest of job.steps) if (rest.status === 'pending') rest.status = 'skipped';
        job.finishedAt = new Date().toISOString();
        this.save(job);
        return;
      }
    }
    this.alive(job);
    await clean();
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    this.save(job);
  }

  /** Para o laço de uma atualização largada pelo painel, e marca que o agente segue vivo. */
  private alive(job: UpdateJob) {
    if (this.cancelled.has(job)) throw new Cancelled('interrompida');
    job.checkedAt = new Date().toISOString();
  }

  /** Tarefas do serviço que deveriam estar rodando já estão de pé na imagem nova? */
  private async converged(name: string, image: string, replicas: number | undefined) {
    const tasks = await this.docker.call<Task[]>(
      'GET',
      `/tasks?filters=${encodeURIComponent(JSON.stringify({ service: [name], 'desired-state': ['running'] }))}`,
    );
    const live = tasks.filter((t) => (t.DesiredState ?? 'running') === 'running');
    const fresh = live.filter(
      (t) => t.Spec?.ContainerSpec?.Image?.startsWith(image) && t.Status.State === 'running',
    );
    return fresh.length > 0 && fresh.length === live.length && fresh.length >= (replicas ?? 1);
  }

  private async apply(step: UpdateStep, image: string, isSelf: boolean, job: UpdateJob) {
    const s = await this.docker.call<Svc>('GET', `/services/${encodeURIComponent(step.service)}`);
    this.alive(job);
    const spec = structuredClone(s.Spec);
    // Mesma imagem (retomando uma troca que parou no meio): sem forçar, o Swarm não faz nada.
    const same = spec.TaskTemplate.ContainerSpec.Image === image;
    spec.TaskTemplate.ContainerSpec.Image = image;
    if (same) spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    const migrate = /migrate/i.test(step.service);
    if (!migrate) {
      // Se a versão nova não subir, o Swarm volta sozinho para a anterior.
      spec.UpdateConfig = {
        ...spec.UpdateConfig,
        FailureAction: 'rollback',
        Monitor: spec.UpdateConfig?.Monitor || 15_000_000_000,
      };
    }
    let startedAt = Date.now();
    // A migração baixa a imagem e passa por todos os bancos de restaurante: tem mais tempo.
    const limit = migrate ? this.timeoutMs * 3 : this.timeoutMs;
    // Com login, o Swarm repassa a credencial aos nós (igual a `--with-registry-auth`).
    await this.docker.call('POST', `/services/${s.ID}/update?version=${s.Version.Index}`, spec, {
      headers: this.authHeaders,
    });
    if (isSelf) return;
    const replicas = spec.Mode.Replicated?.Replicas;
    let forced = false;
    for (;;) {
      if (Date.now() - startedAt >= limit) {
        if (migrate) break;
        // Tudo de pé na versão nova, só o Swarm que não marcou "concluído": segue em frente.
        if (await this.converged(step.service, image, replicas)) return;
        if (forced) break;
        // Travou no meio: um reinício forçado (o mesmo de reiniciar no Portainer) e mais um prazo.
        forced = true;
        const cur = await this.docker.call<Svc>('GET', `/services/${s.ID}`);
        const again = structuredClone(cur.Spec);
        again.TaskTemplate.ForceUpdate = (again.TaskTemplate.ForceUpdate ?? 0) + 1;
        step.message = 'demorou; reiniciando o serviço para destravar';
        await this.docker.call(
          'POST',
          `/services/${s.ID}/update?version=${cur.Version.Index}`,
          again,
          { headers: this.authHeaders },
        );
        startedAt = Date.now();
      }
      await this.sleep(this.pollMs);
      this.alive(job);
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
      if (st === 'completed') {
        if (forced) step.message = undefined;
        return;
      }
      if (st && /rollback|paused/.test(st))
        throw new Error(`a versão nova não subiu; o Swarm voltou para a anterior (${st})`);
    }
    throw new Error(
      migrate
        ? 'a migração ainda não terminou; veja os logs do serviço e tente atualizar de novo'
        : 'não terminou nem depois de reiniciar o serviço',
    );
  }
}
