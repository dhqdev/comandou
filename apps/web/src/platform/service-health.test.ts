import { describe, expect, it } from 'vitest';
import { servicesWithProblem, serviceLevel } from './service-health';
import type { ServerService } from './types';

const svc = (over: Partial<ServerService>): ServerService =>
  ({
    id: 'x',
    name: 'comandou-api',
    stack: 'comandou',
    image: 'comandou-api:0.245.0',
    mode: 'replicated',
    desired: 1,
    running: 1,
    updatedAt: '2026-11-24T00:00:00Z',
    updateState: null,
    lastError: null,
    taskState: 'running',
    ...over,
  }) as ServerService;

describe('situação dos serviços (Status e Infraestrutura)', () => {
  it('a migração que terminou bem (0 de 1 rodando) não é alerta', () => {
    const migrate = svc({ name: 'comandou-migrate', running: 0, taskState: 'complete' });
    expect(serviceLevel(migrate)).toBe('ok');
    expect(servicesWithProblem([migrate])).toEqual([]);
  });

  it('a migração que falhou e um serviço parado são alerta', () => {
    const failed = svc({ name: 'comandou-migrate', running: 0, taskState: 'failed' });
    const down = svc({ name: 'comandou-api', desired: 2, running: 0, taskState: 'failed' });
    const half = svc({ name: 'comandou-web', desired: 2, running: 1 });
    expect(serviceLevel(failed)).toBe('bad');
    expect(serviceLevel(half)).toBe('warn');
    expect(servicesWithProblem([failed, down, half]).map((s) => s.name)).toEqual([
      'comandou-migrate',
      'comandou-api',
      'comandou-web',
    ]);
  });

  it('serviço desligado de propósito (0 réplicas) e global não entram', () => {
    expect(servicesWithProblem([svc({ desired: 0, running: 0 })])).toEqual([]);
    expect(servicesWithProblem([svc({ mode: 'global', desired: null, running: 1 })])).toEqual([]);
  });
});
