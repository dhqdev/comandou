import type { DockerClient } from './docker';
import { registryAuthFromEnv, VERSION_RE } from './updater';

/**
 * Versões antigas lado a lado (docs/versao-por-cliente.md). O sistema principal (api e web da
 * stack) fica sempre na versão mais nova; o restaurante que ainda não foi atualizado continua
 * na versão dele, servida por uma cópia da api e da web naquela versão. A cópia nasce do próprio
 * serviço principal (mesmas redes, segredos e variáveis), com:
 *  - a tag da versão antiga (o repositório da imagem nunca muda);
 *  - 1 réplica e o rótulo comandou.pinned-version (a atualização geral não mexe nela);
 *  - o serviço do Traefik com o nome da versão (comandou-api-v0-108-5) e sem roteadores próprios:
 *    quem manda cada restaurante para ela é o provider HTTP da API principal;
 *  - filas num prefixo próprio e as rotinas de fundo desligadas (cobrança, limpeza, pagamentos
 *    pelo app, lembretes da agenda e chamados rodam só no principal).
 */
export const PINNED_LABEL = 'comandou.pinned-version';

/** v0.108.5 -> v0-108-5 (vale em nome de serviço do Docker e do Traefik). */
export const versionSlug = (v: string) => v.replace(/\./g, '-');

/** Rotinas que só o sistema principal executa (0 desliga). */
export const PINNED_ENV: Record<string, string> = {
  MAINTENANCE_INTERVAL_MINUTES: '0',
  BILLING_INTERVAL_MINUTES: '0',
  ONLINE_PAY_INTERVAL_SECONDS: '0',
  AGENDA_INTERVAL_SECONDS: '0',
  TICKETS_PIPELINE_SECONDS: '0',
  TENANT_UPDATE_INTERVAL_SECONDS: '0',
};

interface Svc {
  ID: string;
  Version: { Index: number };
  Spec: {
    Name: string;
    Labels?: Record<string, string>;
    Mode: { Replicated?: { Replicas: number }; Global?: object };
    TaskTemplate: {
      ContainerSpec: { Image: string; Env?: string[]; Labels?: Record<string, string> };
      ForceUpdate?: number;
    };
    [k: string]: unknown;
  };
}
interface Task {
  Status: { State: string; Err?: string };
  DesiredState?: string;
}

export interface PinnedVersion {
  version: string;
  services: { name: string; role: 'api' | 'web'; running: number }[];
  /** Todos os serviços da versão com ao menos uma tarefa rodando. */
  ready: boolean;
}

const repoOf = (image: string) => {
  const clean = image.replace(/@sha256:[a-f0-9]+$/, '');
  const i = clean.lastIndexOf(':');
  return i > clean.lastIndexOf('/') ? clean.slice(0, i) : clean;
};

/** Nome do serviço do Traefik declarado nos rótulos (traefik.http.services.<nome>.…). */
export function traefikServiceOf(labels: Record<string, string> = {}): string | null {
  for (const k of Object.keys(labels)) {
    const m = /^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/.exec(k);
    if (m) return m[1]!;
  }
  return null;
}

/** Rótulos da cópia: serviço do Traefik renomeado, sem roteadores nem middlewares próprios. */
export function pinnedLabels(labels: Record<string, string>, version: string) {
  const base = traefikServiceOf(labels);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (/^traefik\.http\.(routers|middlewares)\./.test(k)) continue;
    if (k.startsWith('com.docker.stack.')) continue; // fora da stack: o deploy da stack não a apaga
    out[
      base
        ? k.replace(
            `traefik.http.services.${base}.`,
            `traefik.http.services.${base}-${versionSlug(version)}.`,
          )
        : k
    ] = v;
  }
  out[PINNED_LABEL] = version;
  return out;
}

/** Variáveis da cópia: as do principal + prefixo de fila próprio + rotinas de fundo desligadas. */
export function pinnedEnv(env: string[] = [], version: string) {
  const map = new Map<string, string>();
  for (const e of env) {
    const i = e.indexOf('=');
    if (i > 0) map.set(e.slice(0, i), e.slice(i + 1));
  }
  const prefix = map.get('QUEUE_PREFIX') || 'comandou';
  map.set('QUEUE_PREFIX', `${prefix}-${versionSlug(version)}`.slice(0, 40));
  for (const [k, v] of Object.entries(PINNED_ENV)) map.set(k, v);
  return [...map].map(([k, v]) => `${k}=${v}`);
}

export class PinnedVersions {
  private readonly prefix: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly authHeaders: Record<string, string>;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly docker: Pick<DockerClient, 'call'>,
    opts: {
      prefix?: string;
      sleep?: (ms: number) => Promise<void>;
      registryAuth?: string | null;
      pollMs?: number;
      timeoutMs?: number;
    } = {},
  ) {
    this.prefix = opts.prefix ?? process.env.AGENT_IMAGE_PREFIX ?? 'ghcr.io/dhqdev/comandou-';
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const auth =
      opts.registryAuth === undefined ? registryAuthFromEnv(this.prefix) : opts.registryAuth;
    this.authHeaders = auth ? { 'X-Registry-Auth': auth } : {};
    this.pollMs = opts.pollMs ?? 3000;
    this.timeoutMs = opts.timeoutMs ?? 4 * 60_000;
  }
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  /** Uma operação por vez (criar e apagar ao mesmo tempo daria nomes repetidos). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  /** api e web principais: imagem do Comandou, serviço do Traefik nos rótulos e sem versão fixa. */
  private async mains(): Promise<{ role: 'api' | 'web'; svc: Svc }[]> {
    const all = await this.docker.call<Svc[]>('GET', '/services');
    const out: { role: 'api' | 'web'; svc: Svc }[] = [];
    for (const role of ['api', 'web'] as const) {
      const svc = all.find(
        (s) =>
          !s.Spec.Labels?.[PINNED_LABEL] &&
          repoOf(s.Spec.TaskTemplate.ContainerSpec.Image) === `${this.prefix}${role}` &&
          !!traefikServiceOf(s.Spec.Labels),
      );
      if (!svc) throw new Error(`serviço principal da ${role} não encontrado`);
      out.push({ role, svc });
    }
    return out;
  }

  private async running(name: string) {
    const tasks = await this.docker.call<Task[]>(
      'GET',
      `/tasks?filters=${encodeURIComponent(JSON.stringify({ service: [name], 'desired-state': ['running'] }))}`,
    );
    return {
      running: tasks.filter((t) => t.Status.State === 'running').length,
      failed: tasks.find((t) => ['failed', 'rejected'].includes(t.Status.State)),
    };
  }

  /** Versões antigas no ar, com o que está rodando de cada uma. */
  async list(): Promise<PinnedVersion[]> {
    const all = await this.docker.call<Svc[]>('GET', '/services');
    const byVersion = new Map<string, PinnedVersion>();
    for (const s of all) {
      const v = s.Spec.Labels?.[PINNED_LABEL];
      if (!v) continue;
      const role = repoOf(s.Spec.TaskTemplate.ContainerSpec.Image).endsWith('web') ? 'web' : 'api';
      const { running } = await this.running(s.Spec.Name);
      const pv = byVersion.get(v) ?? { version: v, services: [], ready: true };
      pv.services.push({ name: s.Spec.Name, role, running });
      byVersion.set(v, pv);
    }
    for (const pv of byVersion.values())
      pv.ready =
        pv.services.some((s) => s.role === 'api') &&
        pv.services.some((s) => s.role === 'web') &&
        pv.services.every((s) => s.running > 0);
    return [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Garante a api e a web da versão no ar e espera as duas rodarem. Também na mesma versão do
   * principal: é criada antes de o principal atualizar, para segurar quem fica nela.
   */
  ensure(version: string): Promise<PinnedVersion | null> {
    return this.serial(async () => {
      if (!VERSION_RE.test(version)) throw new Error('versão inválida (use o formato v1.2.3)');
      const mains = await this.mains();
      const all = await this.docker.call<Svc[]>('GET', '/services');
      const names: string[] = [];
      for (const { role, svc } of mains) {
        const name = `${svc.Spec.Name}-${versionSlug(version)}`;
        names.push(name);
        if (all.some((s) => s.Spec.Name === name)) continue;
        const image = `${repoOf(svc.Spec.TaskTemplate.ContainerSpec.Image)}:${version}`;
        await this.docker
          .call('GET', `/distribution/${image}/json`, undefined, {
            timeoutMs: 30_000,
            headers: this.authHeaders,
          })
          .catch((e: Error) => {
            throw new Error(`a imagem ${image} não está disponível: ${e.message}`);
          });
        const spec = structuredClone(svc.Spec);
        spec.Name = name;
        spec.Labels = pinnedLabels(svc.Spec.Labels ?? {}, version);
        spec.Mode = { Replicated: { Replicas: 1 } };
        spec.TaskTemplate.ContainerSpec.Image = image;
        if (role === 'api')
          spec.TaskTemplate.ContainerSpec.Env = pinnedEnv(
            spec.TaskTemplate.ContainerSpec.Env,
            version,
          );
        const cl = spec.TaskTemplate.ContainerSpec.Labels;
        if (cl)
          for (const k of Object.keys(cl)) if (k.startsWith('com.docker.stack.')) delete cl[k];
        // Sem os apelidos de rede ("api", "web"): quem chama http://api:3000 na rede interna
        // (ex.: o gateway do WhatsApp) continua falando só com o principal.
        const nets = (spec.TaskTemplate as { Networks?: { Aliases?: string[] }[] }).Networks;
        for (const n of nets ?? []) delete n.Aliases;
        delete (spec as { Networks?: unknown }).Networks;
        delete spec.TaskTemplate.ForceUpdate;
        delete spec.UpdateConfig;
        delete spec.RollbackConfig;
        await this.docker.call('POST', '/services/create', spec, { headers: this.authHeaders });
      }
      const started = Date.now();
      for (;;) {
        const states = await Promise.all(names.map((n) => this.running(n)));
        if (states.every((s) => s.running > 0)) break;
        if (Date.now() - started > this.timeoutMs) {
          const f = states.find((s) => s.failed)?.failed;
          throw new Error(
            `a ${version} não subiu a tempo${f ? `: ${f.Status.Err ?? f.Status.State}` : ''}`,
          );
        }
        await this.sleep(this.pollMs);
      }
      return (await this.list()).find((v) => v.version === version) ?? null;
    });
  }

  /** Tira do ar a api e a web de uma versão antiga (quando nenhum restaurante usa mais). */
  remove(version: string): Promise<{ removed: string[] }> {
    return this.serial(async () => {
      if (!VERSION_RE.test(version)) throw new Error('versão inválida (use o formato v1.2.3)');
      const all = await this.docker.call<Svc[]>('GET', '/services');
      const removed: string[] = [];
      for (const s of all.filter((x) => x.Spec.Labels?.[PINNED_LABEL] === version)) {
        await this.docker.call('DELETE', `/services/${s.ID}`);
        removed.push(s.Spec.Name);
      }
      return { removed };
    });
  }
}
