import type { Request } from 'express';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Contexto de uma requisição autenticada, passado aos serviços de domínio. */
export interface Ctx {
  tenantId: string;
  userId: string;
  user: AuthenticatedUser;
  ip?: string;
}

export function ctxOf(tenant: ResolvedTenant, user: AuthenticatedUser, req?: Request): Ctx {
  return { tenantId: tenant.id, userId: user.id, user, ip: req?.ip };
}
