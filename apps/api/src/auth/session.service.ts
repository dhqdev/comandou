import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Role } from '@comandou/shared';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { memberships, sessions, users } from '../database/schema';
import type { AuthenticatedUser } from '../tenancy/tenant.types';

export const SESSION_COOKIE = 'cm_sid';

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
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3600_000);
    await tx.insert(sessions).values({
      tenantId,
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return { token, expiresAt };
  }

  async validate(tenantId: string, token: string): Promise<AuthenticatedUser | null> {
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
      if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
        await tx
          .update(sessions)
          .set({ lastSeenAt: new Date() })
          .where(eq(sessions.id, row.sessionId));
      }
      return {
        id: row.userId,
        name: row.name,
        email: row.email,
        role: row.role as Role,
        sessionId: row.sessionId,
      };
    });
  }

  async revoke(tx: Tx, sessionId: string): Promise<void> {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }
}
