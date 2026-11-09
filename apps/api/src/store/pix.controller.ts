import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  RequirePermission,
} from '../common/decorators';
import { requireKey } from '../common/idempotency';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { PixService } from './pix.service';

const Approve = z.object({ cashSessionId: uuid.optional() });
const Reject = z.object({ reason: z.string().trim().min(3).max(200) });

/**
 * Comprovantes do Pix pelo cardápio, para a equipe: abrir o arquivo, aprovar (o Pix entra no
 * caixa) ou recusar (o cliente vê o motivo e pode mandar outro).
 */
@AllowWhenBlocked()
@Controller({ path: 'orders/:id/pix-receipts', version: '1' })
export class PixReceiptsController {
  constructor(private readonly pix: PixService) {}

  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get(':receiptId/file')
  @RequirePermission('orders:manage')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.pix.file(ctxOf(t, u), id, receiptId);
    res.setHeader('Content-Type', f.contentType);
    // Privado: nada de cache compartilhado; o navegador da equipe guarda por um tempo.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprovante-pix.${f.contentType === 'application/pdf' ? 'pdf' : f.contentType.split('/')[1]}"`,
    );
    res.setHeader('Content-Length', String(f.bytes.length));
    res.end(f.bytes);
  }

  /** Aprova: o que falta pagar entra como Pix no caixa informado. Exige `Idempotency-Key`. */
  @Post(':receiptId/approve')
  @HttpCode(200)
  @RequirePermission('payments:create')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @Body(new ZodPipe(Approve)) b: z.infer<typeof Approve>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pix.approve(ctxOf(t, u, req), id, receiptId, b, requireKey(key));
  }

  @Post(':receiptId/reject')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @Body(new ZodPipe(Reject)) b: z.infer<typeof Reject>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pix.reject(ctxOf(t, u, req), id, receiptId, b.reason);
  }
}
