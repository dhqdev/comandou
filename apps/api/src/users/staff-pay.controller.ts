import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { STAFF_PAY_METHODS } from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { StaffPayService, StaffRule } from './staff-pay.service';

const Month = z.object({
  month: z.string().regex(/^(20\d\d)-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM'),
});
const Day = z.string().regex(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'dia inválido');
/** Bônus (+) ou vale/desconto (−). */
const Adjust = z
  .string()
  .regex(/^-?\d{1,7}(\.\d{1,2})?$/, 'valor inválido')
  .default('0');
const Preview = z.object({
  from: Day.optional(),
  to: Day.optional(),
  days: z.number().int().min(0).max(62).optional(),
  adjustments: Adjust,
});
const Pay = Preview.extend({
  method: z.enum(STAFF_PAY_METHODS),
  notes: z.string().trim().max(300).nullable().optional(),
  /** true = pago hoje; false = conta a pagar no Financeiro com vencimento em `dueDate`. */
  paidNow: z.boolean().default(true),
  dueDate: Day.optional(),
});
const Rule = z.object({
  rule: StaffRule,
  pixKey: z.string().trim().max(140).nullable().optional(),
});

/**
 * Pagamento da equipe (Equipe › Pagamentos). Valores são do dono e do financeiro
 * (finance:read / finance:write); cada pessoa vê só o próprio perfil (`staff-pay/me`).
 */
@Controller({ version: '1' })
export class StaffPayController {
  constructor(private readonly pay: StaffPayService) {}

  /** O próprio perfil: qualquer pessoa da equipe logada (o garçom no app dele). */
  @Get('staff-pay/me')
  me(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.pay.me(ctxOf(t, u));
  }

  @Get('staff-pay')
  @RequirePermission('finance:read')
  overview(
    @Query(new ZodPipe(Month)) qy: z.infer<typeof Month>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.overview(ctxOf(t, u), qy.month);
  }

  @Post('staff-pay/:userId/preview')
  @RequirePermission('finance:read')
  preview(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(Preview)) b: z.infer<typeof Preview>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.preview(ctxOf(t, u), userId, b);
  }

  @Put('staff-pay/:userId/rule')
  @RequirePermission('finance:write')
  saveRule(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(Rule)) b: z.infer<typeof Rule>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.saveRule(ctxOf(t, u, req), userId, b);
  }

  @Get('staff-pay/:userId/payouts')
  @RequirePermission('finance:read')
  history(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.pay.history(ctxOf(t, u), userId);
  }

  @Post('staff-pay/:userId/payouts')
  @RequirePermission('finance:write')
  create(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(Pay)) b: z.infer<typeof Pay>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.pay(ctxOf(t, u, req), userId, b);
  }
}
