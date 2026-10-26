import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { CourierPayService, PayRule, TaxRegime, TaxSettings } from './courier-pay.service';
import { DeliveryService } from './delivery.service';

const Month = z.object({
  month: z.string().regex(/^(20\d\d)-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM'),
});
const Day = z.string().regex(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'dia inválido');
/** Bônus (+) ou vale/desconto (−) no repasse. */
const Adjust = z
  .string()
  .regex(/^-?\d{1,7}(\.\d{1,2})?$/, 'valor inválido')
  .default('0');
const Preview = z.object({ courierId: uuid, until: Day.optional(), adjustments: Adjust });
const Pay = Preview.extend({
  method: z.enum(['cash', 'pix', 'transfer', 'other']),
  notes: z.string().trim().max(300).nullable().optional(),
  toFinance: z.boolean().default(true),
});
const CourierPay = z.object({
  taxRegime: TaxRegime.optional(),
  payRule: PayRule.nullable().optional(),
  pixKey: z.string().trim().max(140).nullable().optional(),
});

/**
 * Ganhos e repasses dos entregadores. Valores e impostos são do dono e do financeiro
 * (finance:read / finance:write); o entregador vê só a própria central.
 */
@Controller({ version: '1' })
export class CourierPayController {
  constructor(
    private readonly pay: CourierPayService,
    private readonly delivery: DeliveryService,
  ) {}

  @Get('courier-pay/settings')
  @RequirePermission('finance:read')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.pay.settings(ctxOf(t, u));
  }

  @Put('courier-pay/settings')
  @RequirePermission('finance:write')
  saveSettings(
    @Body(new ZodPipe(z.object({ rule: PayRule, taxes: TaxSettings })))
    b: { rule: z.infer<typeof PayRule>; taxes: z.infer<typeof TaxSettings> },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.saveSettings(ctxOf(t, u, req), b);
  }

  /** Recalcula as corridas ainda não pagas com a regra atual. */
  @Post('courier-pay/recalculate')
  @RequirePermission('finance:write')
  recalculate(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.recalculatePending(ctxOf(t, u, req));
  }

  @Patch('courier-pay/couriers/:id')
  @RequirePermission('finance:write')
  updateCourier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CourierPay)) b: z.infer<typeof CourierPay>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.updateCourier(ctxOf(t, u, req), id, b);
  }

  @Get('courier-pay/report')
  @RequirePermission('finance:read')
  report(
    @Query(new ZodPipe(Month)) m: z.infer<typeof Month>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.report(ctxOf(t, u), m.month);
  }

  @Post('courier-pay/preview')
  @RequirePermission('finance:write')
  preview(
    @Body(new ZodPipe(Preview)) b: z.infer<typeof Preview>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.preview(ctxOf(t, u), b.courierId, b.until, b.adjustments);
  }

  @Post('courier-pay/payouts')
  @RequirePermission('finance:write')
  payout(
    @Body(new ZodPipe(Pay)) b: z.infer<typeof Pay>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.pay(ctxOf(t, u, req), b);
  }

  /** Central do entregador com login. */
  @Get('deliveries/my-earnings')
  @RequirePermission('delivery:operate')
  mine(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.pay.myEarnings(ctxOf(t, u));
  }

  /** Central do entregador pelo link (sem login). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('courier-app/:token/earnings')
  async linkEarnings(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    const { courier } = await this.delivery.courierCtx(t.id, token);
    return this.pay.earningsByCourier(t.id, courier.id);
  }
}
