import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { createClient } from 'redis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Janela fixa no Redis, atômica (um script por chamada). Conta acertos em KEYS[1] e, ao passar
 * do limite, marca KEYS[2] como bloqueada por blockDuration. Retorna em milissegundos.
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {hits, ttl, 1, blocked} end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

/**
 * Limite de requisições compartilhado entre réplicas da API. Sem Redis disponível (queda ou
 * timeout), cai para o contador em memória de cada réplica em vez de derrubar a API ou liberar
 * tudo: o limite fica, no pior caso, multiplicado pelo número de réplicas.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');
  private readonly fallback = new ThrottlerStorageService();
  private readonly client: ReturnType<typeof createClient>;
  private warned = false;

  constructor(
    url: string,
    private readonly prefix = 'cm:throttle:',
  ) {
    this.client = createClient({
      url,
      socket: { connectTimeout: 2000, reconnectStrategy: (n) => Math.min(n * 200, 5000) },
      disableOfflineQueue: true,
    });
    this.client.on('error', (e: Error) => this.warn(e));
    // Não esperamos a conexão: enquanto o Redis não responde, vale o contador em memória.
    this.client.connect().catch((e: Error) => this.warn(e));
  }

  private warn(e: Error) {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(`Redis indisponível para o limite de requisições: ${e.message}`);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.client.isReady) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    try {
      const base = `${this.prefix}${throttlerName}:${key}`;
      const r = (await this.client.eval(SCRIPT, {
        keys: [base, `${base}:block`],
        arguments: [String(ttl), String(limit), String(blockDuration || ttl)],
      })) as number[];
      this.warned = false;
      const [hits, ttlMs, blocked, blockMs] = r.map(Number);
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: blocked === 1 ? Math.max(1, Math.ceil(blockMs / 1000)) : 0,
      };
    } catch (e) {
      this.warn(e as Error);
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  async close() {
    await this.client.quit().catch(() => undefined);
    this.fallback.onApplicationShutdown();
  }
}
