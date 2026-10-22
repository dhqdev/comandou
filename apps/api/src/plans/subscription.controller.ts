import { Controller, Get } from '@nestjs/common';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { PlanService } from './plan.service';

/** Plano, situação da assinatura e uso do mês, para o restaurante acompanhar os limites. */
@Controller({ path: 'subscription', version: '1' })
export class SubscriptionController {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanService,
  ) {}

  @Get()
  @RequirePermission('plan:read')
  get(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => ({
      current: await this.plans.current(tx),
      usage: await this.plans.usageAll(tx),
    }));
  }
}
