import type { DockerClient } from './docker';

/**
 * Componentes da VM e versões: cada serviço do Swarm com a versão real do que roda dentro
 * (lida da imagem: PG_VERSION, REDIS_VERSION, NGINX_VERSION, NODE_VERSION, rótulo OCI) e se o
 * registro tem uma compilação nova da MESMA tag (ex.: postgres:16-alpine 16.4 → 16.6).
 *
 * Atualizar aqui só serve para imagens de terceiros (Postgres, Redis, Traefik...) e só troca
 * para a compilação nova da mesma tag: nunca muda de versão principal (Postgres 16 → 17 exige
 * migrar os dados). As imagens do Comandou mudam pelo "Atualizar sistema".
 */
interface Svc {
  ID: string;
  Version: { Index: number };
  Spec: {
    Name: string;
    Labels?: Record<string, string>;
    TaskTemplate: { ContainerSpec: { Image: string }; ForceUpdate?: number };
    UpdateConfig?: { FailureAction?: string; Monitor?: number };
  };
  UpdateStatus?: { State?: string; Message?: string };
}
interface ImageInspect {
  RepoDigests?: string[];
  Created?: string;
  Config?: { Env?: string[] | null; Labels?: Record<string, string> | null };
}

const STACK_LABEL = 'com.docker.stack.namespace';
/** Stacks que o instalador do Comandou cria além da principal. */
const EXTRA_STACKS = ['traefik', 'crowdsec'];

export function splitImage(image: string) {
  const at = image.indexOf('@');
  const digest = at >= 0 ? image.slice(at + 1) : null;
  const clean = at >= 0 ? image.slice(0, at) : image;
  const i = clean.lastIndexOf(':');
  const slash = clean.lastIndexOf('/');
  return i > slash
    ? { repo: clean.slice(0, i), tag: clean.slice(i + 1), digest }
    : { repo: clean, tag: 'latest', digest };
}

const NAMES: [RegExp, string][] = [
  [/comandou-api$/, 'Comandou API'],
  [/comandou-web$/, 'Comandou Web'],
  [/comandou-backup$/, 'Comandou Backup'],
  [/comandou-whatsapp-gateway$/, 'Comandou WhatsApp'],
  [/(^|\/)postgres$/, 'PostgreSQL'],
  [/(^|\/)redis$/, 'Redis'],
  [/(^|\/)traefik$/, 'Traefik'],
  [/crowdsec$/, 'CrowdSec'],
  [/pgbouncer$/, 'PgBouncer'],
  [/(^|\/)nginx$/, 'Nginx'],
  [/portainer/, 'Portainer'],
];
export const productOf = (repo: string) =>
  NAMES.find(([re]) => re.test(repo))?.[1] ?? repo.split('/').pop() ?? repo;

/** Variáveis que as imagens oficiais trazem com a versão do programa. */
const RUNTIME_ENV: [string, string][] = [
  ['PG_VERSION', 'PostgreSQL'],
  ['PG_MAJOR', 'PostgreSQL'],
  ['REDIS_VERSION', 'Redis'],
  ['NGINX_VERSION', 'Nginx'],
  ['NODE_VERSION', 'Node.js'],
  ['YARN_VERSION', 'Yarn'],
  ['PYTHON_VERSION', 'Python'],
  ['ALPINE_VERSION', 'Alpine'],
];

/** Versões de dentro da imagem (uma por programa) e a versão principal do componente. */
export function versionsFromImage(product: string, tag: string, img: ImageInspect | null) {
  const env = new Map(
    (img?.Config?.Env ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]),
  );
  const runtimes: { name: string; version: string }[] = [];
  for (const [key, name] of RUNTIME_ENV) {
    const v = env.get(key);
    if (v && !runtimes.some((r) => r.name === name)) runtimes.push({ name, version: v });
  }
  const label = img?.Config?.Labels?.['org.opencontainers.image.version'];
  const own = runtimes.find((r) => r.name === product)?.version;
  const version = /^Comandou/.test(product)
    ? tag
    : (own ?? (label && label !== 'latest' ? label : null) ?? tag);
  return { version, runtimes: runtimes.filter((r) => r.name !== product) };
}

export interface Component {
  service: string;
  stack: string | null;
  product: string;
  image: string;
  tag: string;
  version: string;
  runtimes: { name: string; version: string }[];
  builtAt: string | null;
  comandou: boolean;
  canUpdate: boolean;
  updateState: string | null;
  update: { status: 'current' | 'available' | 'unknown' | 'managed'; error?: string };
}

export class Components {
  private cache = new Map<string, { at: number; digest: string | null; error?: string }>();

  constructor(
    private readonly docker: Pick<DockerClient, 'call'>,
    private readonly ownStack: () => Promise<string | null>,
    private readonly prefix = process.env.AGENT_IMAGE_PREFIX ?? 'ghcr.io/dhqdev/comandou-',
    private readonly now = () => Date.now(),
  ) {}

  private async allowedStacks() {
    const own = await this.ownStack();
    return new Set([...(own ? [own] : []), ...EXTRA_STACKS]);
  }

  /** Digest da tag no registro (pergunta pelo próprio Docker; guardado por 1 hora). */
  private async remoteDigest(ref: string, fresh: boolean) {
    const hit = this.cache.get(ref);
    if (hit && !fresh && this.now() - hit.at < 3_600_000) return hit;
    let entry: { at: number; digest: string | null; error?: string };
    try {
      const r = await this.docker.call<{ Descriptor?: { digest?: string } }>(
        'GET',
        `/distribution/${ref}/json`,
        undefined,
        { timeoutMs: 20_000 },
      );
      entry = { at: this.now(), digest: r.Descriptor?.digest ?? null };
    } catch (e) {
      entry = { at: this.now(), digest: null, error: (e as Error).message };
    }
    this.cache.set(ref, entry);
    return entry;
  }

  async list(fresh = false) {
    const [services, allowed] = await Promise.all([
      this.docker.call<Svc[]>('GET', '/services'),
      this.allowedStacks(),
    ]);
    const out: Component[] = [];
    const queue = services.filter((s) => !s.Spec.Labels?.['comandou.pinned-version']);
    const work = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const full = s.Spec.TaskTemplate.ContainerSpec.Image;
        const { repo, tag, digest } = splitImage(full);
        const product = productOf(repo);
        const comandou = full.startsWith(this.prefix);
        const img = await this.docker
          .call<ImageInspect>(
            'GET',
            `/images/${digest ? `${repo}@${digest}` : `${repo}:${tag}`}/json`,
          )
          .catch(() => null);
        const { version, runtimes } = versionsFromImage(product, tag, img);
        const stack = s.Spec.Labels?.[STACK_LABEL] ?? null;
        let update: Component['update'] = { status: 'managed' };
        if (!comandou) {
          const local = digest
            ? [digest]
            : (img?.RepoDigests ?? []).map((d) => d.slice(d.indexOf('@') + 1));
          const remote = await this.remoteDigest(`${repo}:${tag}`, fresh);
          update = !remote.digest
            ? { status: 'unknown', error: remote.error ?? 'registro sem resposta' }
            : local.includes(remote.digest)
              ? { status: 'current' }
              : local.length
                ? { status: 'available' }
                : { status: 'unknown', error: 'imagem local sem digest' };
        }
        out.push({
          service: s.Spec.Name,
          stack,
          product,
          image: `${repo}:${tag}`,
          tag,
          version,
          runtimes,
          builtAt: img?.Created ?? null,
          comandou,
          canUpdate: !comandou && !!stack && allowed.has(stack),
          updateState: s.UpdateStatus?.State ?? null,
          update,
        });
      }
    };
    await Promise.all(Array.from({ length: 4 }, work));
    const [version, agent] = await Promise.all([
      this.docker
        .call<{
          Version?: string;
          ApiVersion?: string;
          Os?: string;
          Arch?: string;
          KernelVersion?: string;
          Components?: { Name: string; Version: string }[];
        }>('GET', '/version')
        .catch(() => null),
      Promise.resolve({ node: process.versions.node, openssl: process.versions.openssl }),
    ]);
    return {
      checkedAt: new Date(this.now()).toISOString(),
      engine: version
        ? {
            version: version.Version ?? null,
            api: version.ApiVersion ?? null,
            components: (version.Components ?? []).map((c) => ({
              name: c.Name,
              version: c.Version,
            })),
          }
        : null,
      agent,
      components: out.sort(
        (a, b) =>
          Number(b.comandou) - Number(a.comandou) ||
          (a.stack ?? '').localeCompare(b.stack ?? '') ||
          a.service.localeCompare(b.service),
      ),
    };
  }

  /** Troca o serviço para a compilação nova da mesma tag (com rollback do Swarm se não subir). */
  async update(name: string) {
    const s = await this.docker.call<Svc>('GET', `/services/${encodeURIComponent(name)}`);
    const full = s.Spec.TaskTemplate.ContainerSpec.Image;
    if (full.startsWith(this.prefix))
      throw new Error('o Comandou atualiza pelo botão "Atualizar sistema"');
    if (s.Spec.Labels?.['comandou.pinned-version']) throw new Error('cópia de versão antiga');
    const stack = s.Spec.Labels?.[STACK_LABEL] ?? null;
    if (!stack || !(await this.allowedStacks()).has(stack))
      throw new Error('serviço fora das stacks do Comandou');
    const { repo, tag, digest } = splitImage(full);
    const remote = await this.remoteDigest(`${repo}:${tag}`, true);
    if (!remote.digest) throw new Error(`não consegui consultar o registro: ${remote.error ?? ''}`);
    if (digest === remote.digest) throw new Error('já está na compilação mais nova desta tag');
    const spec = structuredClone(s.Spec);
    spec.TaskTemplate.ContainerSpec.Image = `${repo}:${tag}@${remote.digest}`;
    spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    spec.UpdateConfig = {
      ...spec.UpdateConfig,
      FailureAction: 'rollback',
      Monitor: spec.UpdateConfig?.Monitor || 15_000_000_000,
    };
    await this.docker.call('POST', `/services/${s.ID}/update?version=${s.Version.Index}`, spec);
    this.cache.delete(`${repo}:${tag}`);
    return { service: s.Spec.Name, image: `${repo}:${tag}`, to: remote.digest };
  }
}
