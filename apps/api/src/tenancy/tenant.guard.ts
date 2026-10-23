import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tenantAcceptsTraffic } from '@comandou/shared';
import type { Request } from 'express';
import { SKIP_TENANT } from '../common/decorators';
import { TenantResolverService } from './tenant-resolver.service';

/**
 * 1º guard global: resolve o tenant pelo Host validado.
 * O Host apenas identifica o contexto; a autorização vem da sessão (SessionGuard).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT, [ctx.getHandler(), ctx.getClass()])
    ) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    const outcome = await this.resolver.resolve(req.hostname);
    if (!outcome.ok) {
      if (outcome.reason === 'invalid-host') throw new BadRequestException('Host inválido');
      throw new NotFoundException('Restaurante não encontrado');
    }
    if (!tenantAcceptsTraffic(outcome.tenant.status)) {
      // Suspenso pelo painel: login, sessões abertas, cardápio online e agentes ficam bloqueados.
      throw new ForbiddenException(
        outcome.tenant.status === 'suspended'
          ? { message: 'Restaurante suspenso', code: 'tenant_suspended' }
          : { message: 'Restaurante indisponível', code: 'tenant_unavailable' },
      );
    }
    req.tenant = outcome.tenant;
    return true;
  }
}
