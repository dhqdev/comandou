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

  @Get('courier-pay/calendar')
  @RequirePermission('finance:read')
  calendar(
    @Query(new ZodPipe(Month)) m: z.infer<typeof Month>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.calendar(ctxOf(t, u), m.month);
  }

  @Get('courier-pay/calendar/day')
  @RequirePermission('finance:read')
  calendarDay(
    @Query(new ZodPipe(z.object({ day: Day }))) d: { day: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.calendarDay(ctxOf(t, u), d.day);
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

  /**
   * Prévia do app de um entregador da equipe (Equipe › Abrir): o administrador vê o que ele vê
   * no app (corridas, disponíveis com o ganho pela regra dele, perfil e ganhos). Só leitura e só
   * de quem gerencia a equipe; as ações do app continuam presas ao login de cada entregador.
   */
  @Get('deliveries/preview/:userId')
  @RequirePermission('users:manage')
  async appPreview(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const ctx = ctxOf(t, u);
    const home = await this.delivery.previewHome(ctx, userId);
    const [available, profile, earnings] = await Promise.all([
      this.delivery.available(ctx, home.courier.id),
      this.delivery.profile(ctx, home.courier.id),
      this.pay.earningsByCourier(t.id, home.courier.id),
    ]);
    return { ...home, courier: { name: home.courier.name }, available, profile, earnings };
  }

  @Get('deliveries/preview/:userId/history')
  @RequirePermission('users:manage')
  async appPreviewHistory(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query(new ZodPipe(z.object({ before: z.coerce.date().optional() }))) f: { before?: Date },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const ctx = ctxOf(t, u);
    const { courier } = await this.delivery.previewHome(ctx, userId);
    return this.delivery.history(ctx, f.before ?? null, courier.id);
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
