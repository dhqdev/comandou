import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BLOCK_LABELS } from '@comandou/shared';
import type { Request } from 'express';
import { ALLOW_BLOCKED, SKIP_TENANT } from '../common/decorators';
import { BillingService } from './billing.service';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Último guard: restaurante bloqueado pela cobrança (pagamento não confirmado ou contrato vencido)
 * só consegue ler, entrar e pagar. Pedidos novos (no sistema e na loja online), cadastros e
 * qualquer outra gravação devolvem 403 com code "billing_blocked". Nada é apagado.
 */
@Injectable()
export class BillingGuard implements CanActivate {
  constructor(
    private readonly billing: BillingService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method) || !req.tenant) return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TENANT, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_BLOCKED, targets)) return true;
    const reason = await this.billing.blockOf(req.tenant.id);
    if (!reason) return true;
    throw new ForbiddenException({
      code: 'billing_blocked',
      reason,
      message:
        reason === 'payment'
          ? 'Sistema bloqueado: pagamento da assinatura não confirmado. Pague em Assinatura para liberar na hora.'
          : `Sistema bloqueado: ${BLOCK_LABELS[reason]}. Assine o contrato novo para liberar.`,
    });
  }
}
