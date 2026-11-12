import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ORDER_CHANNELS, ORDER_STATUSES, ordersLimitedToOwn } from '@comandou/shared';
import { CashService } from '../cash/cash.service';
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  BlockWhenBilling,
  CurrentTenant,
  CurrentUser,
  RequirePermission,
} from '../common/decorators';
import { requireKey, validIdempotencyKey } from '../common/idempotency';
import {
  Adjust,
  CreateOrder,
  EditOrderItems,
  money,
  Payment,
  reason,
  Transition,
  uuid,
} from '../common/schemas';
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
  /** Só os pedidos lançados por quem pede (app do garçom: "Meus pedidos"). */
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Concluídos com saldo a pagar ("a receber" ou aguardando o acerto do entregador). */
  openBalance: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Prontos para levar à mesa (app do garçom). */
  toServe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Cancelados com Pix a devolver (aviso do PDV). */
  pixRefund: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const Refund = z.object({ cashSessionId: uuid, amount: money, reason });

/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
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
  @BlockWhenBilling()
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

  /** O garçom só pede cancelamento (com motivo); quem gere pedidos faz as demais transições. */
  @Post(':id/status')
  @RequirePermission('orders:write')
  async status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Transition)) b: z.infer<typeof Transition>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ctx = ctxOf(t, u, req);
    if (ordersLimitedToOwn(u.role)) {
      if (b.to !== 'cancel_requested')
        throw new ForbiddenException('O garçom só pode solicitar o cancelamento');
      await this.orders.get(ctx, id); // fora do alcance do garçom: 404
    }
    return this.orders.transition(ctx, id, b.to, b);
  }

  /** Pedido de mesa entregue na mesa ("Entreguei"). Pago, conclui; ver OrdersService.markServed. */
  @Post(':id/served')
  @RequirePermission('orders:write')
  @HttpCode(200)
  served(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.markServed(ctxOf(t, u, req), id);
  }

  @Patch(':id/adjustments')
  @RequirePermission('orders:manage')
  adjust(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Adjust)) b: z.infer<typeof Adjust>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.adjust(ctxOf(t, u, req), id, b);
  }

  /**
   * Edita os itens do pedido (acrescentar, quantidade, observação, tirar). Tirar e diminuir
   * exigem `orders:cancel` (conferido no serviço).
   */
  @Patch(':id/items')
  @RequirePermission('orders:manage')
  editItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(EditOrderItems)) b: z.infer<typeof EditOrderItems>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.editItems(ctxOf(t, u, req), id, b);
  }

  /** Cancela um item do pedido (com motivo). Exige gerente. */
  @Post(':id/items/:itemId/cancel')
  @RequirePermission('orders:cancel')
  cancelItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body(new ZodPipe(z.object({ reason: z.string().trim().max(300).optional() })))
    b: { reason?: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.orders.cancelItem(ctxOf(t, u, req), id, itemId, b.reason);
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

/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
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
