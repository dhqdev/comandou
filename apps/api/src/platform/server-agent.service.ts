import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';

/** Cliente do agente do servidor (serviço comandou-agent, só na rede interna). */
@Injectable()
export class ServerAgentClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return !!(this.env.HOST_AGENT_URL && this.env.HOST_AGENT_TOKEN);
  }

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000) {
    if (!this.enabled) throw new ServiceUnavailableException('Agente do servidor não instalado');
    let res: Response;
    try {
      res = await fetch(new URL(path, this.env.HOST_AGENT_URL), {
        method,
        headers: {
          Authorization: `Bearer ${this.env.HOST_AGENT_TOKEN}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BadGatewayException('Agente do servidor não respondeu');
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new BadGatewayException(data.message ?? `Agente respondeu ${res.status}`);
    return data;
  }
}

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
}

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
const byVersion = (a: string, b: string) => {
  const x = SEMVER.exec(a)!.slice(1).map(Number);
  const y = SEMVER.exec(b)!.slice(1).map(Number);
  return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
};
/** Imagens que toda versão publica; a versão só conta quando existe em todas. */
const IMAGES = ['api', 'web', 'backup', 'whatsapp-gateway'];

/**
 * Última versão publicada (guardada por 10 minutos). Primeiro pergunta às Releases do GitHub
 * (com UPDATE_GITHUB_TOKEN, se houver: obrigatório quando o repositório é privado). Se não der,
 * olha as próprias imagens no GHCR: a maior tag vX.Y.Z presente em todas. As imagens são o que a
 * atualização usa, então isso funciona mesmo com o repositório privado e sem token.
 */
@Injectable()
export class ReleaseFeed {
  private cache?: { at: number; value: LatestRelease };
  constructor(@Inject(ENV) private readonly env: Env) {}

  private get token() {
    return this.env.UPDATE_GITHUB_TOKEN;
  }

  private async fromReleases(): Promise<LatestRelease> {
    const res = await fetch(
      `https://api.github.com/repos/${this.env.UPDATE_RELEASES_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'comandou-painel',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404 || res.status === 401 || res.status === 403)
      throw new Error(
        this.token
          ? `GitHub respondeu ${res.status}: confira se o token tem acesso ao repositório`
          : `GitHub respondeu ${res.status} (repositório privado? configure UPDATE_GITHUB_TOKEN)`,
      );
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const r = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string };
    if (!r.tag_name || !SEMVER.test(r.tag_name)) throw new Error('release sem versão válida');
    return { version: r.tag_name, url: r.html_url ?? '', publishedAt: r.published_at ?? null };
  }

  /** Tags vX.Y.Z de uma imagem no GHCR (pública: token anônimo; privada: usuário + token). */
  private async ghcrTags(repo: string): Promise<string[]> {
    const auth: Record<string, string> = this.token
      ? { Authorization: `Basic ${Buffer.from(`token:${this.token}`).toString('base64')}` }
      : {};
    const t = await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull`, {
      headers: auth,
      signal: AbortSignal.timeout(10_000),
    });
    if (!t.ok) throw new Error(`GHCR respondeu ${t.status}`);
    const { token } = (await t.json()) as { token?: string };
    const res = await fetch(`https://ghcr.io/v2/${repo}/tags/list?n=10000`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(
        `GHCR respondeu ${res.status}${res.status === 401 || res.status === 403 ? ' (imagens privadas? configure UPDATE_GITHUB_TOKEN)' : ''}`,
      );
    const r = (await res.json()) as { tags?: string[] };
    return (r.tags ?? []).filter((x) => SEMVER.test(x));
  }

  private async fromImages(): Promise<LatestRelease> {
    if (!this.env.UPDATE_IMAGE_PREFIX.startsWith('ghcr.io/'))
      throw new Error('UPDATE_IMAGE_PREFIX precisa ser do GHCR (ghcr.io/dono/nome-)');
    const base = this.env.UPDATE_IMAGE_PREFIX.slice('ghcr.io/'.length);
    const lists = await Promise.all(IMAGES.map((i) => this.ghcrTags(`${base}${i}`)));
    const common = lists[0]!.filter((v) => lists.every((l) => l.includes(v))).sort(byVersion);
    const version = common.at(-1);
    if (!version) throw new Error('nenhuma versão publicada nas imagens');
    return {
      version,
      url: `https://github.com/${this.env.UPDATE_RELEASES_REPO}/releases/tag/${version}`,
      publishedAt: null,
    };
  }

  /** Separado para os testes trocarem por uma resposta fixa. */
  fetchLatest = async (): Promise<LatestRelease> => {
    try {
      return await this.fromReleases();
    } catch (e) {
      try {
        return await this.fromImages();
      } catch (e2) {
        throw new Error(`${(e as Error).message}; imagens: ${(e2 as Error).message}`);
      }
    }
  };

  async latest(): Promise<{ latest: LatestRelease | null; error?: string }> {
    if (this.cache && Date.now() - this.cache.at < 600_000) return { latest: this.cache.value };
    try {
      const value = await this.fetchLatest();
      this.cache = { at: Date.now(), value };
      return { latest: value };
    } catch (e) {
      return {
        latest: this.cache?.value ?? null,
        error: `Não consegui consultar a última versão: ${(e as Error).message}`,
      };
    }
  }
}
