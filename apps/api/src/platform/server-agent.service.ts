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

/** Última versão publicada no GitHub (consulta pública, guardada por 10 minutos). */
@Injectable()
export class ReleaseFeed {
  private cache?: { at: number; value: LatestRelease };
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Separado para os testes trocarem por uma resposta fixa. */
  fetchLatest = async (): Promise<LatestRelease> => {
    const res = await fetch(
      `https://api.github.com/repos/${this.env.UPDATE_RELEASES_REPO}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'comandou-painel' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    const r = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string };
    if (!r.tag_name || !/^v\d+\.\d+\.\d+$/.test(r.tag_name))
      throw new Error('release sem versão válida');
    return { version: r.tag_name, url: r.html_url ?? '', publishedAt: r.published_at ?? null };
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
