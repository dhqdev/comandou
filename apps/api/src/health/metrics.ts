import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  NestMiddleware,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { bearerMatches } from '../common/bearer';
import { Public, SkipTenant } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { QueueService } from '../queue/queue.service';

/**
 * Métricas no formato do Prometheus. Rótulos só com a ROTA (padrão, sem ids) e o status:
 * nada de restaurante, usuário ou cliente nos rótulos (privacidade e cardinalidade).
 */
@Injectable()
export class Metrics {
  readonly registry = new Registry();
  readonly http = new Histogram({
    name: 'pedemais_http_request_duration_seconds',
    help: 'Duração das requisições HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly errors = new Counter({
    name: 'pedemais_http_server_errors_total',
    help: 'Respostas 5xx',
    labelNames: ['route'],
    registers: [this.registry],
  });

  constructor(db: DatabaseService, queue: QueueService) {
    collectDefaultMetrics({ register: this.registry, prefix: 'pedemais_' });
    new Gauge({
      name: 'pedemais_db_pool_connections',
      help: 'Conexões do pool da API por situação',
      labelNames: ['state'],
      registers: [this.registry],
      collect() {
        this.set({ state: 'total' }, db.pool.totalCount);
        this.set({ state: 'idle' }, db.pool.idleCount);
        this.set({ state: 'waiting' }, db.pool.waitingCount);
      },
    });
    new Gauge({
      name: 'pedemais_queue_jobs',
      help: 'Trabalhos na fila por situação',
      labelNames: ['state'],
      registers: [this.registry],
      async collect() {
        const counts = await queue.counts().catch(() => ({}) as Record<string, number>);
        for (const [state, n] of Object.entries(counts)) this.set({ state }, n);
      },
    });
  }
}

/** Mede cada requisição pela rota registrada no Express (ex.: /api/v1/orders/:id). */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: Metrics) {}

  use(req: Request, res: Response, next: NextFunction) {
    const end = this.metrics.http.startTimer();
    res.on('finish', () => {
      const r = req.route as { path?: string } | undefined;
      const route = r?.path ? `${req.baseUrl}${r.path}` : 'unmatched';
      end({ method: req.method, route, status: String(res.statusCode) });
      if (res.statusCode >= 500) this.metrics.errors.inc({ route });
    });
    next();
  }
}

@Controller({ path: 'metrics', version: '1' })
@SkipTenant()
@Public()
@SkipThrottle()
export class MetricsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly metrics: Metrics,
  ) {}

  /** Só com METRICS_TOKEN configurado e enviado como Bearer; senão 404. */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async get(@Req() req: Request) {
    if (!bearerMatches(req, this.env.METRICS_TOKEN)) throw new NotFoundException();
    return this.metrics.registry.metrics();
  }
}
