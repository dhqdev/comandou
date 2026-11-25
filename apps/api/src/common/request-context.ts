import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Requisição em andamento, para quem não recebe o `req` (ex.: a auditoria). Só leitura: nada aqui
 * decide permissão.
 */
const store = new AsyncLocalStorage<Request>();

export function requestContext(req: Request, _res: Response, next: NextFunction) {
  store.run(req, next);
}

/**
 * Nome do Super Admin quando a requisição vem de um acesso de suporte (sessão aberta pelo painel).
 * Vai junto em toda linha do histórico do restaurante, para não parecer que foi o dono.
 */
export function currentSupportAdmin(): string | null {
  const user = (store.getStore() as { user?: { supportAdminName?: string | null } } | undefined)
    ?.user;
  return user?.supportAdminName ?? null;
}
