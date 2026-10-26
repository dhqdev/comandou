import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { money, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { LoyaltyService } from './loyalty.service';

const positiveMoney = money.refine((v) => Number(v) > 0, 'valor precisa ser maior que zero');

const Settings = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['points', 'stamps']),
    pointsPerReal: positiveMoney.refine((v) => Number(v) <= 100, 'no máximo 100 pontos por real'),
    stampMinOrder: money,
    expiryDays: z.number().int().min(7).max(1095).nullable(),
    countStaffOrders: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const RewardFields = z.object({
  name: z.string().trim().min(1).max(60),
  cost: z.number().int().min(1).max(100_000),
  kind: z.enum(['discount', 'product']),
  amount: positiveMoney.nullable(),
  productId: uuid.nullable(),
  active: z.boolean(),
  position: z.number().int().min(0).max(10_000),
});
const RewardCreate = RewardFields.partial({ active: true, position: true, amount: true, productId: true });
const RewardUpdate = RewardFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);
const Adjust = z.object({
  points: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, 'informe os pontos'),
  note: z.string().trim().min(3).max(120),
});

/** Programa de fidelidade visto pelo dono: regra, recompensas, relatório e ajustes. */
@Controller({ path: 'loyalty', version: '1' })
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @RequirePermission('settings:manage', 'reports:read')
  overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.loyalty.overview(ctxOf(t, u));
  }

  @Patch()
  @RequirePermission('settings:manage')
  update(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.loyalty.updateSettings(ctxOf(t, u, req), b);
  }

  @Post('rewards')
  @RequirePermission('settings:manage')
  createReward(
    @Body(new ZodPipe(RewardCreate)) b: z.infer<typeof RewardCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.loyalty.createReward(ctxOf(t, u, req), {
      ...b,
      amount: b.amount ?? null,
      productId: b.productId ?? null,
    });
  }

  @Patch('rewards/:id')
  @RequirePermission('settings:manage')
  updateReward(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RewardUpdate)) b: z.infer<typeof RewardUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.loyalty.updateReward(ctxOf(t, u, req), id, b);
  }

  @Delete('rewards/:id')
  @RequirePermission('settings:manage')
  deleteReward(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.loyalty.deleteReward(ctxOf(t, u, req), id);
  }

  @Get('report')
  @RequirePermission('reports:read', 'settings:manage')
  report(
    @Query('days') days: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const d = Math.min(365, Math.max(1, Number.parseInt(days ?? '30', 10) || 30));
    return this.loyalty.report(ctxOf(t, u), d);
  }

  @Get('customers/:id')
  @RequirePermission('customers:read')
  customer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.loyalty.customer(ctxOf(t, u), id);
  }

  @Post('customers/:id/adjust')
  @RequirePermission('customers:manage')
  adjust(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Adjust)) b: z.infer<typeof Adjust>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.loyalty.adjust(ctxOf(t, u, req), id, b.points, b.note);
  }
}
