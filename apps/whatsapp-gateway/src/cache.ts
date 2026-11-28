/**
 * Cache em memória no formato que o Baileys pede (`CacheStore`), com prazo e limite de itens.
 *
 * Um por restaurante, guardado na sessão (não no socket): quando a conexão cai e volta, os
 * contadores de "pedir a mensagem de novo" e a lista de aparelhos de cada cliente continuam. Sem
 * isso o Baileys cria um cache novo a cada socket, perde as tentativas de reenvio no meio (a
 * mensagem do cliente fica "aguardando" para sempre) e consulta os aparelhos de todo mundo de
 * novo a cada religação, o que pesa com centenas de restaurantes.
 */
export class MemoryCache {
  private readonly map = new Map<string, { v: unknown; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.until <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.v as T;
  }

  set<T>(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { v: value, until: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  del(key: string): void {
    this.map.delete(key);
  }

  flushAll(): void {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/** Caches de uma sessão (restaurante) que sobrevivem às religações. */
export interface SessionCaches {
  /** tentativas de reenvio por mensagem (o Baileys desiste depois de algumas) */
  msgRetry: MemoryCache;
  /** aparelhos de cada contato (evita consultar de novo a cada envio e religação) */
  devices: MemoryCache;
}

export const newSessionCaches = (): SessionCaches => ({
  msgRetry: new MemoryCache(60 * 60_000, 5_000),
  devices: new MemoryCache(5 * 60_000, 5_000),
});
