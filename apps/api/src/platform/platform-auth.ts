import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { DUMMY_HASH, verifyPassword } from '../auth/password';
import { hashToken } from '../auth/session.service';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { classifyHost } from '../tenancy/host';
import { PlatformDb, platformAudit } from './platform-db.service';
import { verifyTotp } from './totp';

export const PLATFORM_COOKIE = 'cm_admin';
/** O cookie do painel só vai para as rotas do painel. */
export const PLATFORM_COOKIE_PATH = '/api/v1/platform';

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

declare module 'express' {
  interface Request {
    platformAdmin?: PlatformAdmin;
  }
}

export const totpContext = (adminId: string) => `platform-totp:${adminId}`;

interface AdminRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  totp_secret_enc: Buffer;
  totp_last_step: string;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  /**
   * Senha + código de 6 dígitos do aplicativo autenticador. Mesma resposta para qualquer falha
   * (e-mail, senha ou código), tempo parecido e auditoria de cada tentativa.
   */
  async login(
    email: string,
    password: string,
    code: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date; admin: { id: string; name: string } }> {
    const recent = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log
        WHERE action = 'platform.login_failed' AND data->>'email' = $1
          AND created_at > now() - make_interval(mins => $2)`,
      [email, this.env.AUTH_ACCOUNT_LOCK_MINUTES],
    );
    if (recent[0].n >= this.env.AUTH_ACCOUNT_LOCK_THRESHOLD)
      throw new ThrottlerException(
        'Muitas tentativas recusadas para esta conta. Aguarde alguns minutos.',
      );
    const rows = await this.db.query<AdminRow>(
      `SELECT id, name, email::text AS email, password_hash, totp_secret_enc, totp_last_step
         FROM platform_admins WHERE email = $1 AND disabled_at IS NULL`,
      [email],
    );
    const a = rows[0];
    const passOk = await verifyPassword(password, a?.password_hash ?? DUMMY_HASH);
    let step: number | null = null;
    if (a && passOk && this.env.INTEGRATIONS_KEY) {
      const secret = open(this.env.INTEGRATIONS_KEY, a.totp_secret_enc, totpContext(a.id));
      step = verifyTotp(secret, code);
    }

    return this.db
      .tx(async (c) => {
        // Código já usado (mesmo passo de 30 s ou anterior) também é recusado.
        const accepted =
          a && step !== null
            ? (
                await c.query(
                  `UPDATE platform_admins SET totp_last_step = $2, last_login_at = now()
                  WHERE id = $1 AND totp_last_step < $2 RETURNING id`,
                  [a.id, step],
                )
              ).rowCount === 1
            : false;
        if (!accepted) {
          await platformAudit(c, {
            adminId: a?.id ?? null,
            action: 'platform.login_failed',
            entity: 'platform_admin',
            data: { email, reason: !a || !passOk ? 'credentials' : 'code' },
            ip: meta.ip,
          });
          return null;
        }
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + this.env.PLATFORM_SESSION_TTL_HOURS * 3600_000);
        const s = await c.query<{ id: string }>(
          `INSERT INTO platform_sessions (admin_id, token_hash, expires_at, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [
            a!.id,
            hashToken(token),
            expiresAt,
            meta.ip ?? null,
            meta.userAgent?.slice(0, 300) ?? null,
          ],
        );
        await platformAudit(c, {
          adminId: a!.id,
          action: 'platform.login',
          entity: 'platform_session',
          entityId: s.rows[0].id,
          ip: meta.ip,
        });
        return { token, expiresAt, admin: { id: a!.id, name: a!.name } };
      })
      .then((r) => {
        if (!r) throw new UnauthorizedException('E-mail, senha ou código inválidos');
        return r;
      });
  }

  /** Sessão válida, não revogada, dentro do prazo e usada há menos de PLATFORM_IDLE_MINUTES. */
  async validate(token: string): Promise<PlatformAdmin | null> {
    if (!token || token.length > 100) return null;
    const rows = await this.db.query<{
      session_id: string;
      id: string;
      email: string;
      name: string;
      last_seen_at: Date;
    }>(
      `SELECT s.id AS session_id, a.id, a.email::text AS email, a.name, s.last_seen_at
         FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND a.disabled_at IS NULL
          AND s.last_seen_at > now() - make_interval(mins => $2)`,
      [hashToken(token), this.env.PLATFORM_IDLE_MINUTES],
    );
    const r = rows[0];
    if (!r) return null;
    if (Date.now() - r.last_seen_at.getTime() > 30_000)
      await this.db.query(`UPDATE platform_sessions SET last_seen_at = now() WHERE id = $1`, [
        r.session_id,
      ]);
    return { id: r.id, email: r.email, name: r.name, sessionId: r.session_id };
  }

  async logout(admin: PlatformAdmin, ip?: string) {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE platform_sessions SET revoked_at = now() WHERE id = $1`, [
        admin.sessionId,
      ]);
      await platformAudit(c, {
        adminId: admin.id,
        action: 'platform.logout',
        entity: 'platform_session',
        entityId: admin.sessionId,
        ip,
      });
    });
  }
}

/**
 * O painel só existe em admin.<domínio base> e com o pool da plataforma configurado.
 * Em qualquer outro host (inclusive o de um restaurante) as rotas respondem 404.
 */
@Injectable()
export class PlatformHostGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const host = classifyHost(req.hostname, this.env.COMANDOU_BASE_DOMAIN);
    if (!this.db.enabled || host.kind !== 'platform-admin') throw new NotFoundException();
    return true;
  }
}

@Injectable()
export class PlatformSessionGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[PLATFORM_COOKIE];
    const admin = token ? await this.auth.validate(token) : null;
    if (!admin) throw new UnauthorizedException('Sessão do painel necessária');
    req.platformAdmin = admin;
    return true;
  }
}
