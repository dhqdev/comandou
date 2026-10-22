import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@comandou/shared';
import type { Request } from 'express';

/** Rota não exige tenant (ex.: health check da plataforma). */
export const SKIP_TENANT = 'cm:skip-tenant';
export const SkipTenant = () => SetMetadata(SKIP_TENANT, true);

/** Rota não exige sessão (ex.: login). Ainda exige tenant, salvo @SkipTenant. */
export const PUBLIC = 'cm:public';
export const Public = () => SetMetadata(PUBLIC, true);

export const PERMISSION = 'cm:permission';
/** Exige ao menos UMA das permissões informadas. */
export const RequirePermission = (...p: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSION, p);

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.tenant!;
});

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.user!;
});
