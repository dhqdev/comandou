import { AsyncLocalStorage } from 'node:async_hooks';
import { ServiceUnavailableException } from '@nestjs/common';

export class TenantBusy extends ServiceUnavailableException {
  constructor() {
    super('Muitas operações ao mesmo tempo neste restaurante. Tente de novo em instantes.');
  }
}

interface Lane {
  active: number;
  waiting: (() => void)[];
}

/**
 * Limite de transações simultâneas por restaurante (bulkhead). Um restaurante com muito
 * movimento, ou com uma tela que dispara consultas pesadas, espera na fila dele em vez de
 * ocupar todas as conexões do pool que os outros restaurantes também usam.
 *
 * Chamadas aninhadas (withTenant dentro de withTenant do mesmo restaurante) não pegam outra
 * vaga: senão a de dentro poderia esperar pela de fora, que nunca termina.
 */
export class TenantLimiter {
  private readonly lanes = new Map<string, Lane>();
  private readonly inside = new AsyncLocalStorage<Set<string>>();

  constructor(
    private readonly max: number,
    private readonly waitMs: number,
  ) {}

  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const held = this.inside.getStore();
    if (!this.max || held?.has(tenantId)) return fn();
    await this.acquire(tenantId);
    try {
      return await this.inside.run(new Set(held).add(tenantId), fn);
    } finally {
      this.release(tenantId);
    }
  }

  /** Em uso agora por um restaurante (testes e métricas). */
  active(tenantId: string): number {
    return this.lanes.get(tenantId)?.active ?? 0;
  }

  private acquire(tenantId: string): Promise<void> {
    let lane = this.lanes.get(tenantId);
    if (!lane) {
      lane = { active: 0, waiting: [] };
      this.lanes.set(tenantId, lane);
    }
    if (lane.active < this.max) {
      lane.active++;
      return Promise.resolve();
    }
    const l = lane;
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = l.waiting.indexOf(grant);
        if (i >= 0) l.waiting.splice(i, 1);
        reject(new TenantBusy());
      }, this.waitMs);
      timer.unref?.();
      l.waiting.push(grant);
    });
  }

  private release(tenantId: string) {
    const lane = this.lanes.get(tenantId);
    if (!lane) return;
    const next = lane.waiting.shift();
    // A vaga passa direto para quem espera (active não muda).
    if (next) return next();
    lane.active--;
    if (lane.active <= 0) this.lanes.delete(tenantId);
  }
}
