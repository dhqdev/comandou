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
 * nada de usuário ou cliente final nos rótulos (privacidade e cardinalidade).
 * Exceção opcional (METRICS_PER_TENANT=true): três séries por restaurante, rotuladas só com o
 * slug (que já é público no endereço) e sem rota, para a cardinalidade crescer só com o número
 * de restaurantes.
 */
@Injectable()
export class Metrics {
  readonly registry = new Registry();
  readonly http = new Histogram({
    name: 'comandou_http_request_duration_seconds',
    help: 'Duração das requisições HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly errors = new Counter({
    name: 'comandou_http_server_errors_total',
    help: 'Respostas 5xx',
    labelNames: ['route'],
    registers: [this.registry],
  });

  /** Só existem com METRICS_PER_TENANT=true. */
  readonly tenant?: {
    requests: Counter<'tenant'>;
    seconds: Counter<'tenant'>;
    errors: Counter<'tenant'>;
  };

  constructor(db: DatabaseService, queue: QueueService, @Inject(ENV) env: Env) {
    if (env.METRICS_PER_TENANT) {
      const tenant = (name: string, help: string) =>
        new Counter({ name, help, labelNames: ['tenant'], registers: [this.registry] });
      this.tenant = {
        requests: tenant('comandou_tenant_http_requests_total', 'Requisições por restaurante'),
        seconds: tenant(
          'comandou_tenant_http_request_seconds_total',
          'Tempo somado das requisições por restaurante',
        ),
        errors: tenant('comandou_tenant_http_server_errors_total', 'Respostas 5xx por restaurante'),
      };
    }
    collectDefaultMetrics({ register: this.registry, prefix: 'comandou_' });
    new Gauge({
      name: 'comandou_db_pool_connections',
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
      name: 'comandou_queue_jobs',
      help: 'Trabalhos na fila por situação',
      labelNames: ['state'],
      registers: [this.registry],
      async collect() {
        const counts = await queue.counts().catch(() => ({}) as Record<string, number>);
        for (const [state, n] of Object.entries(counts)) this.set({ state }, n);
      },
    });
    // Para alertas de backup atrasado (0 = nunca houve um bem-sucedido).
    new Gauge({
      name: 'comandou_backup_last_success_timestamp_seconds',
      help: 'Horário (epoch) do último backup e do último teste de restauração bem-sucedidos',
      labelNames: ['kind'],
      registers: [this.registry],
      async collect() {
        const rows = await db
          .queryUnscoped<{ kind: string; last_ok_at: Date | null }>(
            'SELECT kind, last_ok_at FROM app_backup_status()',
            [],
          )
          .catch(() => []);
        for (const r of rows)
          this.set({ kind: r.kind }, r.last_ok_at ? r.last_ok_at.getTime() / 1000 : 0);
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
      const seconds = end({ method: req.method, route, status: String(res.statusCode) });
      if (res.statusCode >= 500) this.metrics.errors.inc({ route });
      const perTenant = this.metrics.tenant;
      // req.tenant só existe quando o host foi resolvido para um restaurante (pelo TenantGuard).
      if (perTenant && req.tenant) {
        const labels = { tenant: req.tenant.slug };
        perTenant.requests.inc(labels);
        perTenant.seconds.inc(labels, seconds);
        if (res.statusCode >= 500) perTenant.errors.inc(labels);
      }
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
