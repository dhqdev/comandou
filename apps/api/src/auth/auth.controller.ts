import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentTenant, CurrentUser, Public } from '../common/decorators';
import { one } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { DUMMY_HASH, verifyPassword } from './password';
import { hashToken, SESSION_COOKIE, SessionService } from './session.service';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
type LoginInput = z.infer<typeof LoginSchema>;
const SupportSchema = z.object({ token: z.string().min(20).max(100) });

interface LoginRow {
  user_id: string;
  name: string;
  password_hash: string;
  role: string;
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: (ctx) => ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit ?? 5,
    },
  })
  async login(
    @Body(new ZodPipe(LoginSchema)) body: LoginInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Bloqueio por conta (antes de conferir a senha): vale para qualquer e-mail, exista ou não,
    // então não revela quais contas existem.
    const failures = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const r = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM audit_log
          WHERE tenant_id = $1 AND action = 'auth.login_failed' AND data->>'email' = $2
            AND created_at > now() - make_interval(mins => $3)`,
        [tenant.id, body.email, this.env.AUTH_ACCOUNT_LOCK_MINUTES],
      );
      return r?.n ?? 0;
    });
    if (failures >= this.env.AUTH_ACCOUNT_LOCK_THRESHOLD)
      throw new ThrottlerException(
        'Muitas tentativas com senha errada para esta conta. Aguarde alguns minutos.',
      );

    const rows = await this.db.queryUnscoped<LoginRow>(
      'SELECT user_id, name, password_hash, role FROM app_find_login($1, $2)',
      [tenant.id, body.email],
    );
    const row = rows[0];
    const valid = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);

    if (!row || !valid) {
      // Auditoria da falha em transação própria (a exceção abaixo não pode desfazê-la).
      await this.db.withTenant({ tenantId: tenant.id }, (tx) =>
        this.audit.record(tx, {
          tenantId: tenant.id,
          action: 'auth.login_failed',
          entity: 'user',
          data: { email: body.email },
          ip: req.ip,
        }),
      );
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    return this.db.withTenant({ tenantId: tenant.id, userId: row.user_id }, async (tx) => {
      const s = await this.sessions.create(tx, tenant.id, row.user_id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: row.user_id,
        action: 'auth.login',
        entity: 'user',
        entityId: row.user_id,
        ip: req.ip,
      });
      // Cookie host-only (sem Domain): não é compartilhado entre subdomínios de restaurantes.
      res.cookie(SESSION_COOKIE, s.token, {
        httpOnly: true,
        secure: this.env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        expires: s.expiresAt,
      });
      return { user: { id: row.user_id, name: row.name, role: row.role }, expiresAt: s.expiresAt };
    });
  }

  /**
   * Acesso de suporte: troca o token de uso único gerado no painel Super Admin por uma sessão.
   * O token só vale no restaurante para o qual foi gerado (o restaurante vem do host), por
   * 2 minutos e uma única vez. A sessão dura no máximo 2 horas e fica marcada como suporte.
   */
  @Public()
  @Post('support')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async support(
    @Body(new ZodPipe(SupportSchema)) body: z.infer<typeof SupportSchema>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const [row] = await this.db.queryUnscoped<{ user_id: string; admin_name: string }>(
      'SELECT user_id, admin_name FROM app_consume_support_token($1, $2)',
      [tenant.id, hashToken(body.token)],
    );
    if (!row) throw new UnauthorizedException('Link de acesso inválido ou vencido');
    return this.db.withTenant({ tenantId: tenant.id, userId: row.user_id }, async (tx) => {
      const s = await this.sessions.create(tx, tenant.id, row.user_id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        supportAdminName: row.admin_name,
      });
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: row.user_id,
        action: 'auth.support_login',
        entity: 'user',
        entityId: row.user_id,
        data: { by: 'platform', admin: row.admin_name },
        ip: req.ip,
      });
      res.cookie(SESSION_COOKIE, s.token, {
        httpOnly: true,
        secure: this.env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        expires: s.expiresAt,
      });
      return { expiresAt: s.expiresAt };
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser, @CurrentTenant() tenant: ResolvedTenant) {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
      },
      support: user.supportAdminName ? { adminName: user.supportAdminName } : null,
      permissions: DEFAULT_ROLE_PERMISSIONS[user.role],
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.withTenant({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      await this.sessions.revoke(tx, user.sessionId);
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.logout',
        entity: 'session',
        entityId: user.sessionId,
        ip: req.ip,
      });
    });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}

/** Contexto público do restaurante (nome) para a tela de login. Não exige sessão. */
@Controller({ path: 'tenant', version: '1' })
export class TenantInfoController {
  @Public()
  @Get()
  info(@CurrentTenant() tenant: ResolvedTenant) {
    return { slug: tenant.slug, name: tenant.name };
  }
}
