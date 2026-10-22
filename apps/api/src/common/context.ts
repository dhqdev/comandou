import type { Request } from 'express';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Contexto de uma requisição autenticada, passado aos serviços de domínio. */
export interface Ctx {
  tenantId: string;
  /** null quando quem age é o cliente final pelo cardápio online (sem login). */
  userId: string | null;
  user: AuthenticatedUser;
  ip?: string;
}

/**
 * Ator do cardápio online. Não tem login nem permissões: as rotas públicas só chamam regras que
 * não dependem de papel (criar pedido sem desconto, cancelar o próprio pedido em análise).
 */
export const ONLINE_CUSTOMER: AuthenticatedUser = {
  id: '',
  name: 'Cliente (cardápio online)',
  email: '',
  role: 'waiter',
  sessionId: '',
};

export function onlineCtx(tenantId: string, req?: Request): Ctx {
  return { tenantId, userId: null, user: ONLINE_CUSTOMER, ip: req?.ip };
}

export function ctxOf(tenant: ResolvedTenant, user: AuthenticatedUser, req?: Request): Ctx {
  return { tenantId: tenant.id, userId: user.id, user, ip: req?.ip };
}
