import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipTenant } from '../common/decorators';
import { HealthChecks } from './checks.service';

@Controller({ path: 'health', version: '1' })
@SkipTenant()
@SkipThrottle()
export class HealthController {
  constructor(private readonly checks: HealthChecks) {}

  /** Liveness: o processo responde. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: só o banco é obrigatório (sem ele nada funciona). Redis fora deixa filas e tempo
   * real entre réplicas degradados, mas o caixa e os pedidos continuam: aparece como "degraded"
   * sem tirar a API do balanceador. Não expõe detalhes internos.
   */
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([this.checks.database(), this.checks.redis()]);
    const checks = { database, redis };
    if (database !== 'ok') throw new ServiceUnavailableException({ status: 'error', checks });
    return { status: redis === 'error' ? 'degraded' : 'ok', checks };
  }
}
