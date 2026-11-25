import { ForbiddenException } from '@nestjs/common';

/** Código da recusa no acesso de suporte (o app mostra a mensagem como veio). */
export const SUPPORT_BLOCKED = 'support_blocked';

/**
 * Acesso de suporte (sessão aberta pelo Super Admin, no máximo 2 horas): não cria nada que dure
 * depois dele. Senha, PIN, e-mail de entrada, pessoa nova na equipe ou administrador novo ficam
 * com o dono do restaurante.
 */
export function assertNotSupport(
  u: { supportAdminName?: string | null },
  what: string,
): void {
  if (u.supportAdminName)
    throw new ForbiddenException({
      message: `No acesso de suporte não dá para ${what}. Peça ao administrador do restaurante.`,
      code: SUPPORT_BLOCKED,
    });
}
