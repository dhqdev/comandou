import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ChannelMetrics } from './channel-metrics';

/** Grava a contagem por hora a cada minuto (e ao desligar). */
export const USAGE_FLUSH_MS = 60_000;
const BATCH = 1000;

/**
 * Leva para o banco central (channel_usage) o que a ChannelMetrics contou: chamadas por endpoint e
 * resultado, pollings, acks, eventos e consultas por pedido. É o que o Super Admin mostra contra as
 * regras de uso indevido do iFood. Cada réplica soma a sua parte; se o banco falhar, a contagem
 * volta para a memória e vai na próxima vez.
 */
@Injectable()
export class ChannelUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ChannelsUsage');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly metrics: ChannelMetrics,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), USAGE_FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush();
  }

  async flush() {
    const rows = this.metrics.drain();
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      try {
        await this.db.queryUnscoped('SELECT app_channel_usage_add($1::jsonb)', [
          JSON.stringify(part),
        ]);
      } catch (e) {
        this.metrics.restore(rows.slice(i));
        this.logger.warn(`uso dos aplicativos não gravado: ${(e as Error).message}`);
        return;
      }
    }
  }
}
