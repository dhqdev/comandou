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
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  BlockWhenBilling,
  CurrentTenant,
  CurrentUser,
  RequirePermission,
} from '../common/decorators';
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
/** Percentual da taxa de serviço ("10" ou "10.5"), de 0 a 30. */
const percent = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'percentual com até 2 casas')
  .refine((v) => Number(v) <= 30, 'no máximo 30%');
const ServiceFee = z.object({ percent: percent.nullable() });
const SalonSettings = z.object({ serviceFeePercent: percent });

/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
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
  @BlockWhenBilling()
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
    @Body(
      new ZodPipe(
        z.object({
          requested: z.boolean(),
          splitParts: z.number().int().min(1).max(20).nullish(),
        }),
      ),
    )
    b: { requested: boolean; splitParts?: number | null },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.requestBill(ctxOf(t, u, req), id, b.requested, b.splitParts ?? null);
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

  /** Liga, muda ou tira a taxa de serviço da comanda (o cliente pode recusar). */
  @Post(':id/service-fee')
  @RequirePermission('orders:manage')
  serviceFee(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ServiceFee)) b: z.infer<typeof ServiceFee>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.setServiceFee(ctxOf(t, u, req), id, b.percent);
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

/** Configuração do salão: taxa de serviço padrão das comandas novas. */
@Controller({ path: 'salon', version: '1' })
export class SalonController {
  constructor(private readonly tabs: TabsService) {}

  @Get('settings')
  @RequirePermission('orders:read')
  get(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.tabs.salonSettings(ctxOf(t, u));
  }

  @Patch('settings')
  @RequirePermission('settings:manage')
  save(
    @Body(new ZodPipe(SalonSettings)) b: z.infer<typeof SalonSettings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tabs.saveSalonSettings(ctxOf(t, u, req), b);
  }
}
