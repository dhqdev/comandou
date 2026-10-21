import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipTenant } from '../common/decorators';
import { DatabaseService } from '../database/database.service';

@Controller({ path: 'health', version: '1' })
@SkipTenant()
@SkipThrottle()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /** Liveness: o processo responde. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependências essenciais acessíveis. Não expõe detalhes internos. */
  @Get('ready')
  async ready() {
    try {
      await this.db.ping();
      return { status: 'ok', checks: { database: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'error' } });
    }
  }
}
