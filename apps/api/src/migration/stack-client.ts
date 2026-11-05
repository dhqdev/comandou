import type { Hello, Manifest, ReceptionView } from './protocol';

/** O que a origem precisa do destino. Nos testes, uma implementação chama o serviço direto. */
export interface RemoteStack {
  hello(): Promise<Hello>;
  slugCheck(slug: string, tenantId: string): Promise<{ free: boolean; reason?: string }>;
  open(m: Manifest): Promise<{ id: string }>;
  putChunk(id: string, idx: number, data: Buffer): Promise<unknown>;
  view(id: string): Promise<ReceptionView>;
  install(id: string): Promise<ReceptionView>;
  activate(id: string): Promise<ReceptionView>;
  discard(id: string): Promise<ReceptionView>;
}

/**
 * Cliente HTTP do painel de destino (https://admin.<domínio de lá>/api/v1/platform/receive).
 * O token nunca vai para o log nem para a mensagem de erro.
 */
export class StackClient implements RemoteStack {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 60_000,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    raw?: Buffer,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/platform/receive${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': 'comandou-migracao',
          'X-Comandou-Request': '1',
          ...(raw
            ? { 'Content-Type': 'application/octet-stream' }
            : body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
        },
        body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const why = (e as Error).name === 'TimeoutError' ? 'não respondeu a tempo' : 'sem conexão';
      throw new Error(`Destino ${why} (${this.baseUrl})`);
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
    if (!res.ok) {
      const msg = Array.isArray(data.message) ? data.message.join('; ') : data.message;
      throw new Error(
        res.status === 404 && !msg
          ? `O destino não tem a migração de clientes (atualize a instalação de lá)`
          : `Destino respondeu ${res.status}${msg ? `: ${msg}` : ''}`,
      );
    }
    return data;
  }

  hello() {
    return this.call<Hello>('GET', '/hello');
  }
  slugCheck(slug: string, tenantId: string) {
    const q = new URLSearchParams({ slug, tenantId });
    return this.call<{ free: boolean; reason?: string }>('GET', `/check?${q}`);
  }
  open(m: Manifest) {
    return this.call<{ id: string }>('POST', '', m);
  }
  putChunk(id: string, idx: number, data: Buffer) {
    return this.call('PUT', `/${id}/chunks/${idx}`, undefined, data);
  }
  view(id: string) {
    return this.call<ReceptionView>('GET', `/${id}`);
  }
  install(id: string) {
    return this.call<ReceptionView>('POST', `/${id}/install`, {});
  }
  activate(id: string) {
    return this.call<ReceptionView>('POST', `/${id}/activate`, {});
  }
  discard(id: string) {
    return this.call<ReceptionView>('POST', `/${id}/discard`, {});
  }
}
