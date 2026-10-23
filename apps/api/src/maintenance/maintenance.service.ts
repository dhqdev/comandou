import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';

export interface PurgeResult {
  sessions: number;
  platformSessions: number;
  idempotencyKeys: number;
  deliveryLocations: number;
}

/**
 * Limpeza periódica de dados vencidos (função app_purge_expired, migração 0008): sessões
 * encerradas há mais de 90 dias, chaves de idempotência com mais de 30 dias e a última posição
 * do entregador 30 dias depois da entrega. Rodar em várias réplicas ao mesmo tempo é seguro.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  onApplicationBootstrap() {
    const minutes = this.env.MAINTENANCE_INTERVAL_MINUTES;
    if (!minutes) return;
    // Primeira execução um pouco depois de subir, para não competir com o início.
    this.first = setTimeout(() => void this.runSafely(), 5 * 60_000);
    this.timer = setInterval(() => void this.runSafely(), minutes * 60_000);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  /** Roda no banco central e em cada banco próprio de restaurante; devolve a soma. */
  async purge(): Promise<PurgeResult> {
    const total: PurgeResult = {
      sessions: 0,
      platformSessions: 0,
      idempotencyKeys: 0,
      deliveryLocations: 0,
    };
    const add = (r: PurgeResult) => {
      for (const k of Object.keys(total) as (keyof PurgeResult)[]) total[k] += Number(r[k] ?? 0);
    };
    const rows = await this.db.queryUnscoped<{ r: PurgeResult }>(
      'SELECT app_purge_expired() AS r',
      [],
    );
    add(rows[0].r);
    for (const d of await this.db.readyDatabases()) {
      try {
        const { rows: r } = await d.pool.query<{ r: PurgeResult }>(
          'SELECT app_purge_expired() AS r',
        );
        add(r[0].r);
      } catch (e) {
        this.logger.warn(`limpeza em ${d.dbName} falhou: ${(e as Error).message}`);
      }
    }
    return total;
  }

  private async runSafely() {
    try {
      const r = await this.purge();
      this.logger.log(`limpeza de dados vencidos: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`limpeza falhou: ${(e as Error).message}`);
    }
  }
}

@Module({ providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
