import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { PayCard, PayPix } from '../online-pay/online-pay.controller';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { requireKey } from '../common/idempotency';
import { money, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { checkReceipt } from '../store/pix.service';
import { ReceiptDim } from '../store/store.controller';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { TableSelfService } from './table-self.service';

const Presence = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
});
const Call = z.object({
  /** waiter = chamar o garçom; bill = pagar com o garçom (maquininha ou dinheiro). */
  kind: z.enum(['waiter', 'bill']).default('waiter'),
  presence: Presence.optional(),
});
const Approve = z.object({ cashSessionId: uuid });
/** O saldo que o cliente viu na tela (se a conta mudou, nada é cobrado) e onde ele está. */
const TableAmount = { amount: money, presence: Presence.optional() };
const TablePayPix = PayPix.extend({
  /** Nome de quem paga (o PagBank pede; na mesa o cliente não entrou na conta). */
  name: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[A-Za-zÀ-ÿ' .-]+$/, 'seu nome'),
  ...TableAmount,
});
const TablePayCard = PayCard.extend(TableAmount);
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const Reject = z.object({ reason: z.string().trim().min(3).max(200) });

/**
 * Cardápio da mesa (público, no host do restaurante): conta da comanda aberta, chamar o garçom e
 * o comprovante do Pix da conta inteira. A mesa vem do QR Code; quem lê o QR está sentado nela
 * (com a conferência de localização ligada, o chamado também confere).
 */
@Controller({ path: 'store/table/:tableId', version: '1' })
export class TableSelfController {
  constructor(private readonly svc: TableSelfService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('bill')
  bill(@Param('tableId') tableId: string, @CurrentTenant() t: ResolvedTenant) {
    return this.svc.bill(t.id, tableId);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('call')
  @HttpCode(200)
  call(
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(Call)) b: z.infer<typeof Call>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.svc.call(t.id, tableId, b.kind, b.presence, req.ip);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('call/cancel')
  @HttpCode(200)
  cancelCall(@Param('tableId') tableId: string, @CurrentTenant() t: ResolvedTenant) {
    return this.svc.cancelCall(t.id, tableId);
  }

  /** Comprovante do Pix da conta da mesa (foto ou PDF no corpo, até 3 MB). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('pix-receipt')
  @HttpCode(200)
  receipt(
    @Param('tableId') tableId: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(ReceiptDim)) width: number | undefined,
    @Query('h', new ZodPipe(ReceiptDim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const f = checkReceipt(body, type);
    return this.svc.submitReceipt(t.id, tableId, { ...f, width, height }, req.ip);
  }

  /**
   * Conta inteira da mesa pelo PagBank: Pix que confirma sozinho. CPF e e-mail de quem paga vão
   * só para o PagBank (não ficam no Comandou). Devolve a conta da mesa atualizada.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('pay/pix')
  @HttpCode(200)
  payPix(
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(TablePayPix)) b: z.infer<typeof TablePayPix>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.svc.payTab(t.id, tableId, { method: 'pix', ...b }, origin(req), req.ip);
  }

  /** Conta inteira da mesa no cartão de crédito pelo PagBank (cifrado no celular). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('pay/card')
  @HttpCode(200)
  payCard(
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(TablePayCard)) b: z.infer<typeof TablePayCard>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.svc.payTab(t.id, tableId, { method: 'card', ...b }, origin(req), req.ip);
  }

  /** "Pagar de outro jeito": o Pix da conta deixa de valer (a mesa paga com o garçom). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('pay/cancel')
  @HttpCode(200)
  cancelPay(@Param('tableId') tableId: string, @CurrentTenant() t: ResolvedTenant) {
    return this.svc.cancelTabPix(t.id, tableId);
  }
}

/**
 * Equipe: chamados das mesas (app do garçom, PDV e Salão) e os comprovantes do Pix da conta da
 * mesa para o caixa conferir.
 */
@Controller({ path: 'table-service', version: '1' })
export class TableServiceController {
  constructor(private readonly svc: TableSelfService) {}

  @Get('calls')
  @RequirePermission('tables:operate')
  calls(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.svc.calls(ctxOf(t, u));
  }

  @Post('calls/:id/answer')
  @HttpCode(200)
  @RequirePermission('tables:operate')
  answer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.svc.answer(ctxOf(t, u, req), id);
  }

  @Get('receipts')
  @RequirePermission('payments:create')
  receipts(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.svc.pendingReceipts(ctxOf(t, u));
  }

  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get('receipts/:id/file')
  @RequirePermission('payments:create')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.svc.receiptFile(ctxOf(t, u), id);
    res.setHeader('Content-Type', f.contentType);
    // Privado: nada de cache compartilhado; o navegador da equipe guarda por um tempo.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprovante-pix-mesa.${f.contentType === 'application/pdf' ? 'pdf' : f.contentType.split('/')[1]}"`,
    );
    res.end(f.bytes);
  }

  @Post('receipts/:id/approve')
  @HttpCode(200)
  @RequirePermission('payments:create')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Approve)) b: z.infer<typeof Approve>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.svc.approve(ctxOf(t, u, req), id, b.cashSessionId, requireKey(key));
  }

  @Post('receipts/:id/reject')
  @HttpCode(200)
  @RequirePermission('payments:create')
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reject)) b: z.infer<typeof Reject>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.svc.reject(ctxOf(t, u, req), id, b.reason);
  }
}
