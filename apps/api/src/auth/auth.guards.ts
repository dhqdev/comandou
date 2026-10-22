import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, roleHas } from '@pedemais/shared';
import type { Request } from 'express';
import { PERMISSION, PUBLIC, SKIP_TENANT } from '../common/decorators';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF para cookies de sessão:
 * - Métodos que alteram estado exigem o header X-PedeMais-Request (força preflight CORS,
 *   que a API não libera para outras origens).
 * - Se o navegador enviar Origin, ele precisa ter o mesmo host da requisição.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.get('x-pedemais-request') !== '1') {
      throw new ForbiddenException('Requisição sem cabeçalho de proteção');
    }
    const origin = req.get('origin');
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        throw new ForbiddenException('Origem inválida');
      }
      if (originHost !== req.hostname) throw new ForbiddenException('Origem não permitida');
    }
    return true;
  }
}

/** 2º guard: exige sessão válida PARA O TENANT resolvido pelo Host. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TENANT, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!req.tenant || !token) throw new UnauthorizedException('Sessão necessária');
    const user = await this.sessions.validate(req.tenant.id, token);
    if (!user) throw new UnauthorizedException('Sessão inválida ou expirada');
    req.user = user;
    return true;
  }
}

/** 3º guard: autorização por operação (@RequirePermission). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const perms = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!perms?.length) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user || !perms.some((p) => roleHas(req.user!.role, p))) {
      throw new ForbiddenException('Permissão insuficiente');
    }
    return true;
  }
}
