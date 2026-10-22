import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '@comandou/shared';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { requireKey, validIdempotencyKey } from '../common/idempotency';
import { money, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { CashService } from './cash.service';

const Open = z.object({
  registerId: uuid,
  openingAmount: money,
  note: z.string().trim().max(200).optional(),
});
const Movement = z.object({
  kind: z.enum(['supply', 'withdrawal']),
  amount: money,
  note: z.string().trim().min(3).max(200),
});
const Close = z.object({
  counted: z.object(
    Object.fromEntries(PAYMENT_METHODS.map((m) => [m, money.optional()])) as Record<
      (typeof PAYMENT_METHODS)[number],
      z.ZodOptional<typeof money>
    >,
  ),
  note: z.string().trim().max(500).optional(),
});

@Controller({ path: 'cash/sessions', version: '1' })
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @RequirePermission('cash:operate', 'cash:close', 'reports:read')
  list(
    @Query(new ZodPipe(z.object({ status: z.enum(['open', 'closed']).optional() })))
    f: { status?: 'open' | 'closed' },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.cash.list(ctxOf(t, u), f.status);
  }

  @Get(':id')
  @RequirePermission('cash:operate', 'cash:close', 'reports:read')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.cash.get(ctxOf(t, u), id);
  }

  @Post()
  @RequirePermission('cash:operate')
  open(
    @Body(new ZodPipe(Open)) b: z.infer<typeof Open>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cash.open(ctxOf(t, u, req), b, validIdempotencyKey(key));
  }

  /** Suprimento ou sangria (dinheiro). Exige `Idempotency-Key`. */
  @Post(':id/movements')
  @RequirePermission('cash:operate')
  movement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Movement)) b: z.infer<typeof Movement>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cash.movement(ctxOf(t, u, req), id, b, requireKey(key));
  }

  /** Fechamento conferido. Exige `Idempotency-Key` e a permissão `cash:close`. */
  @Post(':id/close')
  @RequirePermission('cash:close')
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Close)) b: z.infer<typeof Close>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cash.close(ctxOf(t, u, req), id, b, requireKey(key));
  }
}
