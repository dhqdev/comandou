import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Role } from '@comandou/shared';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { memberships, sessions, users } from '../database/schema';
import type { AuthenticatedUser } from '../tenancy/tenant.types';

export const SESSION_COOKIE = 'cm_sid';

/** Renova a sessão lembrada no máximo uma vez por dia (não escreve no banco a cada clique). */
const RENEW_EVERY_MS = 86_400_000;

/** Opções do cookie de sessão do restaurante (host-only: não vai para outros subdomínios). */
export const sessionCookieOptions = (env: Env, expires: Date) =>
  ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    expires,
  }) as const;

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Sessões opacas: o cookie carrega um token aleatório de 256 bits; o banco guarda só o SHA-256.
 * A tabela sessions tem RLS, então um token emitido para o restaurante A não é encontrado
 * quando a requisição chega pelo host do restaurante B.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(
    tx: Tx,
    tenantId: string,
    userId: string,
    meta: { ip?: string; userAgent?: string; supportAdminName?: string; remember?: boolean },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    // Acesso de suporte dura no máximo 2 horas e nunca fica lembrado.
    const remember = !!meta.remember && !meta.supportAdminName;
    const hours = meta.supportAdminName
      ? Math.min(2, this.env.SESSION_TTL_HOURS)
      : remember
        ? this.env.SESSION_REMEMBER_DAYS * 24
        : this.env.SESSION_TTL_HOURS;
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    await tx.insert(sessions).values({
      tenantId,
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      supportAdminName: meta.supportAdminName ?? null,
      remember,
    });
    return { token, expiresAt };
  }

  /**
   * Sessão válida para o restaurante, ou null. Sessão lembrada que foi usada vem com `renewedUntil`
   * (o prazo andou para frente e o cookie precisa ser regravado com a data nova). Só renova quem
   * consegue regravar o cookie (`renew`, a requisição HTTP); o tempo real só confere.
   */
  async validate(
    tenantId: string,
    token: string,
    renew = false,
  ): Promise<(AuthenticatedUser & { renewedUntil?: Date }) | null> {
    if (!token || token.length > 100) return null;
    return this.db.withTenant({ tenantId }, async (tx) => {
      const rows = await tx
        .select({
          sessionId: sessions.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          lastSeenAt: sessions.lastSeenAt,
          supportAdminName: sessions.supportAdminName,
          expiresAt: sessions.expiresAt,
          remember: sessions.remember,
        })
        .from(sessions)
        .innerJoin(
          memberships,
          and(eq(memberships.tenantId, sessions.tenantId), eq(memberships.userId, sessions.userId)),
        )
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hashToken(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
            eq(memberships.status, 'active'),
            isNull(users.disabledAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const full = this.env.SESSION_REMEMBER_DAYS * 86_400_000;
      const renewedUntil =
        renew && row.remember && row.expiresAt.getTime() - Date.now() < full - RENEW_EVERY_MS
          ? new Date(Date.now() + full)
          : undefined;
      if (renewedUntil || Date.now() - row.lastSeenAt.getTime() > 60_000) {
        await tx
          .update(sessions)
          .set(
            renewedUntil
              ? { lastSeenAt: new Date(), expiresAt: renewedUntil }
              : { lastSeenAt: new Date() },
          )
          .where(eq(sessions.id, row.sessionId));
      }
      return {
        renewedUntil,
        id: row.userId,
        name: row.name,
        email: row.email,
        role: row.role as Role,
        sessionId: row.sessionId,
        supportAdminName: row.supportAdminName,
      };
    });
  }

  async revoke(tx: Tx, sessionId: string): Promise<void> {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }
}
