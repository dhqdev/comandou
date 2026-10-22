import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import type { DatabaseService } from '../database/database.service';
import type { QueueService } from '../queue/queue.service';
import { Metrics, MetricsMiddleware } from './metrics';

const db = {
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
  queryUnscoped: async () => [],
} as unknown as DatabaseService;
const queue = { counts: async () => ({}) } as unknown as QueueService;

function hit(metrics: Metrics, status: number, slug?: string) {
  const res = Object.assign(new EventEmitter(), { statusCode: status }) as unknown as Response;
  const req = {
    method: 'GET',
    baseUrl: '/api/v1',
    route: { path: '/products' },
    tenant: slug ? { id: 'x', slug, name: slug, status: 'provisioned' } : undefined,
  } as unknown as Request;
  new MetricsMiddleware(metrics).use(req, res, () => undefined);
  (res as unknown as EventEmitter).emit('finish');
}

describe('Métricas por restaurante', () => {
  it('desligadas por padrão: nenhum restaurante nos rótulos', async () => {
    const m = new Metrics(db, queue, { METRICS_PER_TENANT: false } as Env);
    hit(m, 200, 'divinamente');
    const text = await m.registry.metrics();
    expect(text).not.toContain('comandou_tenant_');
    expect(text).not.toContain('divinamente');
  });

  it('ligadas: contam requisições, tempo e 5xx por slug, sem rota', async () => {
    const m = new Metrics(db, queue, { METRICS_PER_TENANT: true } as Env);
    hit(m, 200, 'divinamente');
    hit(m, 500, 'divinamente');
    hit(m, 200, 'outro');
    hit(m, 200); // sem restaurante (ex.: painel ou health): fica fora
    const text = await m.registry.metrics();
    expect(text).toContain('comandou_tenant_http_requests_total{tenant="divinamente"} 2');
    expect(text).toContain('comandou_tenant_http_requests_total{tenant="outro"} 1');
    expect(text).toContain('comandou_tenant_http_server_errors_total{tenant="divinamente"} 1');
    expect(text).toMatch(/comandou_tenant_http_request_seconds_total\{tenant="divinamente"\} \d/);
    expect(text).not.toMatch(/comandou_tenant_[a-z_]+\{[^}]*route=/);
  });
});
