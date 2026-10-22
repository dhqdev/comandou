import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { ENV, Env } from '../config/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Todo trabalho carrega o restaurante. O consumidor revalida tudo no banco com esse tenant. */
export interface TenantJob {
  tenantId: string;
  [key: string]: unknown;
}

export interface JobOptions {
  /** Id determinístico: o mesmo trabalho não entra duas vezes na fila enquanto existir. */
  jobId?: string;
  delayMs?: number;
  attempts?: number;
}

/** O BullMQ usa ioredis, que não lê "url" nas opções: convertemos a URL em host/porta/senha. */
export function redisConnection(url: string) {
  const u = new URL(url);
  const db = u.pathname.replace('/', '');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

type Handler = (data: TenantJob, attempt: number, final: boolean) => Promise<void>;

/**
 * Filas de trabalho (BullMQ/Redis). A fila só transporta "o que fazer" (tipo + ids); o estado
 * oficial fica no Postgres. Sem REDIS_URL (desenvolvimento), os trabalhos rodam no próprio
 * processo, com as mesmas tentativas, para o sistema funcionar sem Redis.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<string, Handler>();
  private queue?: Queue;
  private worker?: Worker;
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.REDIS_URL) {
      this.queue = new Queue('jobs', {
        connection: redisConnection(env.REDIS_URL),
        prefix: env.QUEUE_PREFIX,
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      });
    }
  }

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  async add(name: string, data: TenantJob, opts: JobOptions = {}) {
    if (!UUID_RE.test(data.tenantId)) throw new Error('trabalho sem tenantId válido');
    // O BullMQ reserva ":" nas chaves do Redis.
    if (opts.jobId?.includes(':')) throw new Error('jobId não pode conter ":"');
    const attempts = opts.attempts ?? 5;
    if (this.queue) {
      await this.queue.add(name, data, {
        jobId: opts.jobId,
        delay: opts.delayMs,
        attempts,
        backoff: { type: 'exponential', delay: 2000 },
      });
      return;
    }
    this.runInline(name, data, 1, attempts, opts.delayMs ?? 0);
  }

  private runInline(
    name: string,
    data: TenantJob,
    attempt: number,
    attempts: number,
    delay: number,
  ) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.closed) return;
      const h = this.handlers.get(name);
      if (!h) return this.logger.error(`sem consumidor para ${name}`);
      h(data, attempt, attempt >= attempts).catch((err: Error) => {
        this.logger.warn(`${name} falhou (tentativa ${attempt}): ${err.message}`);
        if (attempt < attempts)
          this.runInline(name, data, attempt + 1, attempts, 2000 * 2 ** (attempt - 1));
      });
    }, delay);
    this.timers.add(t);
  }

  get usesRedis(): boolean {
    return !!this.queue;
  }

  /** Redis responde? (sem Redis configurado: null) */
  async ping(): Promise<boolean | null> {
    if (!this.queue) return null;
    try {
      const client = await this.queue.client;
      return (await Promise.race([
        (client as unknown as { ping(): Promise<string> }).ping().then((r) => r === 'PONG'),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ])) as boolean;
    } catch {
      return false;
    }
  }

  /** Trabalhos por situação (monitoramento). Sem Redis, só os que estão rodando no processo. */
  async counts(): Promise<Record<string, number>> {
    if (!this.queue) return { inline: this.timers.size };
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  }

  onApplicationBootstrap() {
    if (!this.queue || !this.env.QUEUE_WORKERS) return;
    this.worker = new Worker(
      'jobs',
      async (job: Job<TenantJob>) => {
        const h = this.handlers.get(job.name);
        if (!h) throw new Error(`sem consumidor para ${job.name}`);
        if (!UUID_RE.test(job.data?.tenantId)) throw new Error('trabalho sem tenantId válido');
        const attempts = job.opts.attempts ?? 1;
        await h(job.data, job.attemptsMade + 1, job.attemptsMade + 1 >= attempts);
      },
      {
        connection: redisConnection(this.env.REDIS_URL!),
        prefix: this.env.QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`${job?.name} falhou (tentativa ${job?.attemptsMade}): ${err.message}`),
    );
  }

  async onModuleDestroy() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    await this.worker?.close();
    await this.queue?.close();
  }
}
