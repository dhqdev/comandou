import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { QueueService } from '../queue/queue.service';

export type CheckState = 'ok' | 'error' | 'disabled';

/** Saúde das dependências, sem detalhes internos (mensagens de erro ficam só no log). */
@Injectable()
export class HealthChecks {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
  ) {}

  async database(): Promise<CheckState> {
    try {
      await this.db.ping();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async redis(): Promise<CheckState> {
    const r = await this.queue.ping();
    return r === null ? 'disabled' : r ? 'ok' : 'error';
  }

  async whatsappGateway(): Promise<CheckState> {
    if (!this.env.WHATSAPP_GATEWAY_URL) return 'disabled';
    try {
      const res = await fetch(`${this.env.WHATSAPP_GATEWAY_URL.replace(/\/+$/, '')}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
