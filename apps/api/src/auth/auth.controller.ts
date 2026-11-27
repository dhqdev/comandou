import {
  Body,
  Controller,
  ForbiddenException,
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
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { newPassword } from '../common/schemas';
import { ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS, PIN_ROLES } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { AllowWhenBlocked, CurrentTenant, CurrentUser, Public } from '../common/decorators';
import { one } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { memberPhotoAt } from '../users/member-photo';
import { DUMMY_HASH, verifyPassword } from './password';
import { StaffPasswordResetService } from './password-reset.service';
import { RESET_REQUEST_LIMIT, RESET_STEP_LIMIT } from './reset-code';
import {
  PIN_DEVICE_COOKIE,
  PIN_DEVICE_LOCK_THRESHOLD,
  PIN_LOCK_MINUTES,
  PIN_LOCK_THRESHOLD,
  pinDeviceHash,
  pinHash,
} from './pin';
import { hashToken, SESSION_COOKIE, sessionCookieOptions, SessionService } from './session.service';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  /** Manter conectado neste aparelho (a tela marca por padrão). */
  remember: z.boolean().optional().default(false),
});
type LoginInput = z.infer<typeof LoginSchema>;
const PinLoginSchema = z.object({
  // 6 números; o de 4 (antes da 0.250) continua entrando até o gerente gerar um novo.
  pin: z.string().regex(/^[0-9]{4}([0-9]{2})?$/, 'PIN de 6 números'),
  /** Qual app está entrando: só aceita PIN de quem tem o papel daquele app. */
  app: z.enum(PIN_ROLES),
  remember: z.boolean().optional().default(true),
});
type PinLoginInput = z.infer<typeof PinLoginSchema>;
const SupportSchema = z.object({ token: z.string().min(20).max(100) });
const ResetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const ResetVerifySchema = ResetRequestSchema.extend({ code: z.string().trim().min(6).max(12) });
const ResetCompleteSchema = z.object({
  token: z.string().min(20).max(100),
  password: newPassword(),
  remember: z.boolean().optional().default(true),
});

interface LoginRow {
  user_id: string;
  name: string;
  password_hash: string;
  role: string;
}

@Controller({ path: 'auth', version: '1' })
@AllowWhenBlocked()
export class AuthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly resets: StaffPasswordResetService,
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
    // então não revela quais contas existem. Conta só as falhas depois da última senha
    // redefinida (pelo administrador ou pelo suporte): a senha nova entra na hora.
    const failures = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const r = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM audit_log
          WHERE tenant_id = $1 AND action = 'auth.login_failed' AND data->>'email' = $2
            AND created_at > now() - make_interval(mins => $3)
            AND created_at > coalesce(
                  (SELECT max(r.created_at) FROM audit_log r
                    WHERE r.tenant_id = $1 AND r.action = 'user.password_reset'
                      AND r.data->>'email' = $2),
                  '-infinity')`,
        [tenant.id, body.email, this.env.AUTH_ACCOUNT_LOCK_MINUTES],
      );
      return r?.n ?? 0;
    });
    if (failures >= this.env.AUTH_ACCOUNT_LOCK_THRESHOLD)
      throw new ThrottlerException(
        'Muitas tentativas com senha errada para esta conta. Aguarde alguns minutos.',
      );

    const rows = await this.db.queryTenantDb<LoginRow>(
      tenant.id,
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
        remember: body.remember,
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
      res.cookie(SESSION_COOKIE, s.token, sessionCookieOptions(this.env, s.expiresAt));
      return { user: { id: row.user_id, name: row.name, role: row.role }, expiresAt: s.expiresAt };
    });
  }

  /**
   * Entrada do garçom (/garcom) e do entregador (/entregas) só com o PIN de 6 números (o de 4,
   * de antes, ainda entra). O PIN é único no restaurante e identifica a pessoa; só vale no app do
   * papel dela.
   *
   * Limites: por IP, por aparelho (5 erros em 15 minutos travam só aquele aparelho) e, para
   * aparelhos que nunca entraram, o restaurante inteiro (10 erros em 15 minutos pausam a entrada
   * de aparelhos desconhecidos). O aparelho da equipe segue entrando durante a pausa.
   */
  @Public()
  @Post('pin')
  @HttpCode(200)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: (ctx) => ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit ?? 5,
    },
  })
  async pinLogin(
    @Body(new ZodPipe(PinLoginSchema)) body: PinLoginInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Aparelho: cookie próprio, sorteado na primeira tentativa. O erro conta por aparelho (5 em
    // 15 minutos trava só ele) e, para aparelho que nunca entrou, também no restaurante inteiro.
    // Aparelho que já entrou com PIN segue entrando quando um desconhecido trava o restaurante.
    let device = (req.cookies as Record<string, string> | undefined)?.[PIN_DEVICE_COOKIE];
    if (!device || !/^[A-Za-z0-9_-]{32,64}$/.test(device)) {
      device = randomBytes(24).toString('base64url');
      res.cookie(PIN_DEVICE_COOKIE, device, {
        ...sessionCookieOptions(this.env, new Date(Date.now() + 365 * 86_400_000)),
      });
    }
    const dev = pinDeviceHash(tenant.id, device);
    // Contar, conferir e gravar o erro na MESMA transação, uma tentativa por vez no restaurante:
    // muitas tentativas juntas não passam do limite lendo a contagem antes das outras gravarem.
    const found = await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      await one(tx, `SELECT pg_advisory_xact_lock(hashtext('comandou.pin:' || $1::text))`, [
        tenant.id,
      ]);
      const trusted = !!(await one(
        tx,
        `SELECT 1 FROM pin_devices WHERE device_hash = $1 AND trusted_until > now()`,
        [dev],
      ));
      const f = await one<{ device: number; unknown: number }>(
        tx,
        `SELECT count(*) FILTER (WHERE data->>'device' = $3)::int AS device,
                count(*) FILTER (WHERE coalesce(data->>'trusted', 'false') <> 'true')::int AS unknown
           FROM audit_log
          WHERE tenant_id = $1 AND action = 'auth.pin_failed'
            AND created_at > now() - make_interval(mins => $2)`,
        [tenant.id, PIN_LOCK_MINUTES, dev],
      );
      if ((f?.device ?? 0) >= PIN_DEVICE_LOCK_THRESHOLD) return 'device_locked' as const;
      if (!trusted && (f?.unknown ?? 0) >= PIN_LOCK_THRESHOLD) return 'locked' as const;
      const m = await one<{ user_id: string; name: string; role: string; shared: boolean }>(
        tx,
        `SELECT u.id AS user_id, u.name, m.role, app_member_account_shared(u.id) AS shared
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.pin_hash = $1 AND m.status = 'active' AND u.disabled_at IS NULL`,
        [pinHash(tenant.id, body.pin)],
      );
      // PIN de outro papel (o do entregador digitado no app do garçom) conta como errado.
      if (!m || m.role !== body.app) {
        await this.audit.record(tx, {
          tenantId: tenant.id,
          action: 'auth.pin_failed',
          entity: 'user',
          data: { app: body.app, device: dev, trusted },
          ip: req.ip,
        });
        return 'wrong' as const;
      }
      return m;
    });
    if (found === 'device_locked')
      throw new ThrottlerException(
        'Muitos PINs errados neste aparelho. Aguarde 15 minutos ou peça ajuda ao gerente.',
      );
    if (found === 'locked')
      throw new ThrottlerException(
        'Muitos PINs errados neste restaurante. Aguarde alguns minutos ou peça ajuda ao gerente.',
      );
    if (found === 'wrong') throw new UnauthorizedException('PIN incorreto');
    // PIN antigo de uma conta que também entra em outro restaurante: só com e-mail e senha (ver
    // SHARED_ACCOUNT_PIN_MESSAGE; o PIN daqui não pode abrir a conta que vale lá).
    if (found.shared)
      throw new ForbiddenException(
        'Esta conta também é usada em outro restaurante. Entre com o e-mail e a senha.',
      );
    return this.db.withTenant({ tenantId: tenant.id, userId: found.user_id }, async (tx) => {
      const s = await this.sessions.create(tx, tenant.id, found.user_id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        remember: body.remember,
      });
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: found.user_id,
        action: 'auth.login',
        entity: 'user',
        entityId: found.user_id,
        data: { by: 'pin' },
        ip: req.ip,
      });
      // Aparelho que entrou com PIN passa a ser conhecido do restaurante por 180 dias.
      await one(
        tx,
        `INSERT INTO pin_devices (tenant_id, device_hash, trusted_until)
         VALUES ($1, $2, now() + interval '180 days')
         ON CONFLICT (tenant_id, device_hash) DO UPDATE SET trusted_until = EXCLUDED.trusted_until
         RETURNING 1`,
        [tenant.id, dev],
      );
      res.cookie(SESSION_COOKIE, s.token, sessionCookieOptions(this.env, s.expiresAt));
      return {
        user: { id: found.user_id, name: found.name, role: found.role },
        expiresAt: s.expiresAt,
      };
    });
  }

  /**
   * Esqueci minha senha, passo 1: manda o código para o e-mail da conta. Mesma resposta exista a
   * conta ou não (ninguém descobre quem é da equipe).
   */
  @Public()
  @Post('password-reset/request')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_REQUEST_LIMIT } })
  requestReset(
    @Body(new ZodPipe(ResetRequestSchema)) b: z.infer<typeof ResetRequestSchema>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.resets.request(tenant, b.email, req.ip);
  }

  /** Passo 2: confere o código e devolve o token (uso único) da tela da senha nova. */
  @Public()
  @Post('password-reset/verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_STEP_LIMIT } })
  verifyReset(
    @Body(new ZodPipe(ResetVerifySchema)) b: z.infer<typeof ResetVerifySchema>,
    @CurrentTenant() tenant: ResolvedTenant,
  ) {
    return this.resets.verify(tenant, b.email, b.code);
  }

  /** Passo 3: grava a senha nova, tira a conta dos outros aparelhos e entra neste. */
  @Public()
  @Post('password-reset/complete')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: RESET_STEP_LIMIT } })
  async completeReset(
    @Body(new ZodPipe(ResetCompleteSchema)) b: z.infer<typeof ResetCompleteSchema>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.resets.complete(tenant, b.token, b.password, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      remember: b.remember,
    });
    res.cookie(
      SESSION_COOKIE,
      r.session.token,
      sessionCookieOptions(this.env, r.session.expiresAt),
    );
    return { user: r.user, expiresAt: r.session.expiresAt };
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
    const [row] = await this.db.queryTenantDb<{ user_id: string; admin_name: string }>(
      tenant.id,
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
      res.cookie(SESSION_COOKIE, s.token, sessionCookieOptions(this.env, s.expiresAt));
      return { expiresAt: s.expiresAt };
    });
  }

  /**
   * Entrada do cadastro pelo site: troca o link de uso único (válido por 1 hora, só neste
   * restaurante) por uma sessão normal do dono, para ele cair direto nos primeiros passos.
   */
  @Public()
  @Post('entry')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async entry(
    @Body(new ZodPipe(SupportSchema)) body: z.infer<typeof SupportSchema>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const [row] = await this.db.queryTenantDb<{ user_id: string }>(
      tenant.id,
      'SELECT user_id FROM app_consume_entry_token($1, $2)',
      [tenant.id, hashToken(body.token)],
    );
    if (!row) throw new UnauthorizedException('Link de acesso inválido ou vencido');
    return this.db.withTenant({ tenantId: tenant.id, userId: row.user_id }, async (tx) => {
      const s = await this.sessions.create(tx, tenant.id, row.user_id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        remember: true,
      });
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: row.user_id,
        action: 'auth.signup_entry',
        entity: 'user',
        entityId: row.user_id,
        data: { by: 'site' },
        ip: req.ip,
      });
      res.cookie(SESSION_COOKIE, s.token, sessionCookieOptions(this.env, s.expiresAt));
      return { expiresAt: s.expiresAt };
    });
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser, @CurrentTenant() tenant: ResolvedTenant) {
    // Foto do perfil (Conta › Meus dados): só a versão, para a tela montar a URL. Falhou a
    // leitura, a tela fica com as iniciais (entrar nunca depende da foto).
    const photoAt = await this.db
      .withTenant({ tenantId: tenant.id, userId: user.id }, (tx) => memberPhotoAt(tx, user.id))
      .catch(() => null);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
        photoAt,
      },
      support: user.supportAdminName
        ? {
            adminName: user.supportAdminName,
            // Ao encerrar o acesso de suporte, o navegador volta para o painel.
            adminHost: `admin.${this.env.COMANDOU_BASE_DOMAIN}`,
          }
        : null,
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
