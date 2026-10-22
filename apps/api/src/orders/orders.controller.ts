import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ORDER_CHANNELS, ORDER_STATUSES } from '@comandou/shared';
import { CashService } from '../cash/cash.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { requireKey, validIdempotencyKey } from '../common/idempotency';
import { Adjust, CreateOrder, money, Payment, reason, Transition, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { OrdersService } from './orders.service';

const ListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
  channel: z.enum(ORDER_CHANNELS).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const Refund = z.object({ cashSessionId: uuid, amount: money, reason });

@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly cash: CashService,
  ) {}

  @Get()
  @RequirePermission('orders:read')
  list(
    @Query(new ZodPipe(ListQuery)) f: z.infer<typeof ListQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.orders.list(ctxOf(t, u), f);
  }

  @Get(':id')
  @RequirePermission('orders:read')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.orders.get(ctxOf(t, u), id);
  }

  /** Cria pedido. Envie `Idempotency-Key` para que reenvios (rede instável) não dupliquem o pedido. */
  @Post()
  @RequirePermission('orders:write')
  create(
    @Body(new ZodPipe(CreateOrder)) b: z.infer<typeof CreateOrder>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.create(ctxOf(t, u, req), b, validIdempotencyKey(key));
  }

  @Post(':id/status')
  @RequirePermission('orders:write')
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Transition)) b: z.infer<typeof Transition>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.transition(ctxOf(t, u, req), id, b.to, b);
  }

  @Patch(':id/adjustments')
  @RequirePermission('orders:write')
  adjust(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Adjust)) b: z.infer<typeof Adjust>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.adjust(ctxOf(t, u, req), id, b);
  }

  @Post(':id/move')
  @RequirePermission('tables:operate')
  move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ tabId: uuid }))) b: { tabId: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.moveToTab(ctxOf(t, u, req), id, b.tabId);
  }

  /** Pagamento de um pedido. Exige caixa aberto e `Idempotency-Key`. */
  @Post(':id/payments')
  @RequirePermission('payments:create')
  pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Payment)) b: z.infer<typeof Payment>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cash.payOrder(ctxOf(t, u, req), id, b, requireKey(key));
  }
}

@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly cash: CashService) {}

  @Post(':id/refunds')
  @RequirePermission('payments:refund')
  refund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Refund)) b: z.infer<typeof Refund>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cash.refund(ctxOf(t, u, req), id, b, requireKey(key));
  }
}
