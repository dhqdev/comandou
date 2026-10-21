import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@pedemais/shared';
import type { Request } from 'express';

/** Rota não exige tenant (ex.: health check da plataforma). */
export const SKIP_TENANT = 'pm:skip-tenant';
export const SkipTenant = () => SetMetadata(SKIP_TENANT, true);

/** Rota não exige sessão (ex.: login). Ainda exige tenant, salvo @SkipTenant. */
export const PUBLIC = 'pm:public';
export const Public = () => SetMetadata(PUBLIC, true);

export const PERMISSION = 'pm:permission';
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION, p);

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.tenant!;
});

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.user!;
});
