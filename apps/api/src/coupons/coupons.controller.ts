import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { money, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from '../store/customers.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { CouponsService } from './coupons.service';

const nullText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const when = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .or(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
      .transform((v) => new Date(`${v}-03:00`).toISOString()),
  );
const CouponFields = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[A-Za-z0-9_\-\s]+$/, 'use letras, números, - e _'),
  title: z.string().trim().min(1).max(60),
  description: nullText(240),
  kind: z.enum(['percent', 'fixed', 'free_delivery']),
  value: money.nullable(),
  maxDiscount: money.nullable(),
  minOrder: money,
  startsAt: when,
  endsAt: when,
  maxUses: z.number().int().min(1).max(1_000_000).nullable(),
  perCustomer: z.number().int().min(1).max(1000),
  firstOrderOnly: z.boolean(),
  listed: z.boolean(),
  active: z.boolean(),
  imageId: uuid.nullable(),
  position: z.number().int().min(0).max(10_000),
});
const CouponCreate = CouponFields.partial({
  description: true,
  value: true,
  maxDiscount: true,
  minOrder: true,
  startsAt: true,
  endsAt: true,
  maxUses: true,
  perCustomer: true,
  firstOrderOnly: true,
  listed: true,
  active: true,
  imageId: true,
  position: true,
});
const CouponUpdate = CouponFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);
const PinParam = z.string().regex(/^[0-9]{6}$/, 'PIN com 6 números');
const StoreUse = z.object({ couponId: uuid });
const Check = z.object({
  code: z.string().trim().min(1).max(30),
  subtotal: money.optional(),
  deliveryFee: money.optional(),
  channel: z.enum(['delivery', 'pickup', 'table']).optional(),
});

/** Cupons da loja vistos pela equipe (Loja online › Cupons) e o uso no balcão pelo PIN. */
@Controller({ path: 'coupons', version: '1' })
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission('settings:manage', 'reports:read')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.coupons.list(ctxOf(t, u));
  }

  @Post()
  @RequirePermission('settings:manage')
  create(
    @Body(new ZodPipe(CouponCreate)) b: z.infer<typeof CouponCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.coupons.create(ctxOf(t, u, req), {
      description: null,
      value: null,
      maxDiscount: null,
      minOrder: '0.00',
      startsAt: null,
      endsAt: null,
      maxUses: null,
      perCustomer: 1,
      firstOrderOnly: false,
      listed: true,
      active: true,
      imageId: null,
      position: 0,
      ...b,
    });
  }

  @Patch(':id')
  @RequirePermission('settings:manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CouponUpdate)) b: z.infer<typeof CouponUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.coupons.update(ctxOf(t, u, req), id, b);
  }

  @Delete(':id')
  @RequirePermission('settings:manage')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.coupons.remove(ctxOf(t, u, req), id);
  }

  @Get(':id/uses')
  @RequirePermission('settings:manage', 'reports:read')
  uses(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.coupons.uses(ctxOf(t, u), id);
  }

  /** Balcão: cupons que o cliente do PIN ainda pode usar. */
  @Get('pin/:pin')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @RequirePermission('orders:manage')
  forPin(
    @Param('pin', new ZodPipe(PinParam)) pin: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.coupons.forPin(ctxOf(t, u), pin);
  }

  /** Balcão: registra o uso do cupom pelo PIN (o desconto é dado no caixa). */
  @Post('pin/:pin/use')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @RequirePermission('orders:manage')
  useAtStore(
    @Param('pin', new ZodPipe(PinParam)) pin: string,
    @Body(new ZodPipe(StoreUse)) b: z.infer<typeof StoreUse>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.coupons.useAtStore(ctxOf(t, u, req), pin, b.couponId);
  }
}

/** Aba Cupons do cardápio: a vitrine e a conferência de um código digitado. */
@Controller({ path: 'store/coupons', version: '1' })
export class StoreCouponsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly customers: CustomersService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get()
  async list(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    return this.coupons.publicList(t.id, c?.id ?? null);
  }

  /** Confere um código: se vale e quanto sai nesta sacola (o pedido confere de novo). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('check')
  @HttpCode(200)
  async check(
    @Body(new ZodPipe(Check)) b: z.infer<typeof Check>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    return this.coupons.publicCheck(
      t.id,
      c?.id ?? null,
      b.code,
      b.subtotal !== undefined ? Math.round(Number(b.subtotal) * 100) : null,
      b.deliveryFee !== undefined ? Math.round(Number(b.deliveryFee) * 100) : 0,
      b.channel ?? null,
    );
  }
}
