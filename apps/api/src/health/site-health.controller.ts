import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentTenant, Public } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import type { ResolvedTenant } from '../tenancy/tenant.types';

/**
 * Teste de ponta a ponta de UM restaurante, usado pelo painel Super Admin para saber se cada
 * site está no ar: o Host chega pelo Traefik, o restaurante é resolvido (suspenso dá 403) e o
 * banco dele responde. Público e sem detalhes, como o /health/ready.
 */
@Controller({ path: 'health/site', version: '1' })
@Public()
@SkipThrottle()
export class SiteHealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async site(@CurrentTenant() t: ResolvedTenant) {
    try {
      await this.db.queryTenantDb(t.id, 'SELECT 1', []);
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    }
    return { status: 'ok' };
  }
}
