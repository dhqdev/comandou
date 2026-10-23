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
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { requireKey } from '../common/idempotency';
import { Payment, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { TabsService } from './tabs.service';

const OpenTab = z.object({
  tableId: uuid.optional(),
  customerName: z.string().trim().max(80).optional(),
});
const TabPayment = Payment.extend({ orderIds: z.array(uuid).min(1).max(100).optional() });

@Controller({ path: 'tabs', version: '1' })
export class TabsController {
  constructor(private readonly tabs: TabsService) {}

  @Get()
  @RequirePermission('orders:read')
  list(
    @Query(new ZodPipe(z.object({ status: z.enum(['open', 'closed']).default('open') })))
    f: { status: 'open' | 'closed' },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.tabs.list(ctxOf(t, u), f.status);
  }

  @Get(':id')
  @RequirePermission('orders:read')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.tabs.get(ctxOf(t, u), id);
  }

  @Post()
  @RequirePermission('tables:operate')
  open(
    @Body(new ZodPipe(OpenTab)) b: z.infer<typeof OpenTab>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.open(ctxOf(t, u, req), b);
  }

  @Post(':id/bill-request')
  @RequirePermission('tables:operate')
  billRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ requested: z.boolean() }))) b: { requested: boolean },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.requestBill(ctxOf(t, u, req), id, b.requested);
  }

  @Post(':id/transfer')
  @RequirePermission('tables:operate')
  transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ tableId: uuid }))) b: { tableId: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.transfer(ctxOf(t, u, req), id, b.tableId);
  }

  /** Paga a comanda (inteira, parte do valor ou pedidos escolhidos). Exige `Idempotency-Key`. */
  @Post(':id/payments')
  @RequirePermission('payments:create')
  pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TabPayment)) b: z.infer<typeof TabPayment>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.pay(ctxOf(t, u, req), id, b, requireKey(key));
  }

  @Post(':id/close')
  @RequirePermission('payments:create')
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.close(ctxOf(t, u, req), id);
  }
}
