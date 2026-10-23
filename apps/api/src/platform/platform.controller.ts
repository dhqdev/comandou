import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import {
  PLATFORM_COOKIE,
  PLATFORM_COOKIE_PATH,
  PlatformAuthService,
  PlatformHostGuard,
  PlatformSessionGuard,
} from './platform-auth';
import {
  LoginInput,
  NewPlan,
  NewTenant,
  PlanBody,
  RenameTenant,
  ResetPassword,
  RevokeSessions,
  ServerCleanup,
  ServiceName,
  SystemUpdate,
  StatusChange,
  SubscriptionChange,
  SupportAccess,
} from './platform.schemas';
import { Actor, PlatformService } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import { ReleaseFeed, ServerAgentClient } from './server-agent.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });

/** Login do painel: só em admin.<domínio base>, com senha e código do autenticador. */
@Controller({ path: 'platform/auth', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
export class PlatformAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: PlatformAuthService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: (ctx) => ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit ?? 5,
    },
  })
  async login(
    @Body(new ZodPipe(LoginInput)) b: z.infer<typeof LoginInput>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(b.email, b.password, b.code, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.cookie(PLATFORM_COOKIE, r.token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: PLATFORM_COOKIE_PATH,
      expires: r.expiresAt,
    });
    return { admin: r.admin, expiresAt: r.expiresAt };
  }

  @Get('me')
  @UseGuards(PlatformSessionGuard)
  me(@Req() req: Request) {
    const a = req.platformAdmin!;
    return { admin: { id: a.id, name: a.name, email: a.email } };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(PlatformSessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.platformAdmin!, req.ip);
    res.clearCookie(PLATFORM_COOKIE, { path: PLATFORM_COOKIE_PATH });
  }
}

@Controller({ path: 'platform', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('tenants')
  tenants(@Query('search') search?: string, @Query('status') status?: string) {
    return this.svc.listTenants({
      search: search?.trim().slice(0, 80) || undefined,
      status: status && /^[a-z]{3,20}$/.test(status) ? status : undefined,
    });
  }

  @Post('tenants')
  createTenant(@Body(new ZodPipe(NewTenant)) b: z.infer<typeof NewTenant>, @Req() req: Request) {
    return this.svc.createTenant(b, actor(req));
  }

  @Get('tenants/:id')
  tenant(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.tenant(id);
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StatusChange)) b: z.infer<typeof StatusChange>,
    @Req() req: Request,
  ) {
    return this.svc.setStatus(id, b, actor(req));
  }

  @Put('tenants/:id/subscription')
  setSubscription(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SubscriptionChange)) b: z.infer<typeof SubscriptionChange>,
    @Req() req: Request,
  ) {
    return this.svc.setSubscription(id, b, actor(req));
  }

  @Get('consumption')
  consumption() {
    return this.svc.consumption();
  }

  @Get('tenants/:id/insights')
  insights(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.insights(id);
  }

  @Get('tenants/:id/team')
  team(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.team(id);
  }

  /** Link de uso único para abrir o sistema do restaurante já logado (acesso de suporte). */
  @Post('tenants/:id/access')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  access(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SupportAccess)) b: z.infer<typeof SupportAccess>,
    @Req() req: Request,
  ) {
    return this.svc.supportAccess(id, b.userId, actor(req));
  }

  @Post('tenants/:id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RevokeSessions)) b: z.infer<typeof RevokeSessions>,
    @Req() req: Request,
  ) {
    return this.svc.revokeSessions(id, b.userId, actor(req));
  }

  @Post('tenants/:id/password')
  @HttpCode(200)
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ResetPassword)) b: z.infer<typeof ResetPassword>,
    @Req() req: Request,
  ) {
    return this.svc.resetPassword(id, b.userId, b.password, actor(req));
  }

  @Put('tenants/:id/name')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RenameTenant)) b: z.infer<typeof RenameTenant>,
    @Req() req: Request,
  ) {
    return this.svc.renameTenant(id, b.name, actor(req));
  }

  @Post('tenants/:id/domains/:domainId/remove')
  @HttpCode(200)
  removeDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @Req() req: Request,
  ) {
    return this.svc.removeDomain(id, domainId, actor(req));
  }

  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Post('plans')
  createPlan(@Body(new ZodPipe(NewPlan)) b: z.infer<typeof NewPlan>, @Req() req: Request) {
    return this.svc.createPlan(b, actor(req));
  }

  @Put('plans/:id')
  updatePlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PlanBody)) b: z.infer<typeof PlanBody>,
    @Req() req: Request,
  ) {
    return this.svc.updatePlan(id, b, actor(req));
  }

  @Get('audit')
  audit(@Query('tenantId') tenantId?: string, @Query('limit') limit?: string) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return this.svc.audit({
      tenantId: tenantId && uuid.test(tenantId) ? tenantId : undefined,
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });
  }

  @Get('backups')
  backups() {
    return this.svc.backups();
  }
}

/**
 * Servidor (VM): situação, limpeza, reinício de serviço e logs, pelo agente do servidor.
 * Ações que mudam algo ficam na auditoria da plataforma.
 */
@Controller({ path: 'platform/server', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformServerController {
  constructor(
    private readonly agent: ServerAgentClient,
    private readonly db: PlatformDb,
    private readonly releases: ReleaseFeed,
  ) {}

  private audit(req: Request, action: string, data: Record<string, unknown>) {
    return this.db.tx((c) =>
      platformAudit(c, {
        adminId: req.platformAdmin!.id,
        action: `platform.server.${action}`,
        entity: 'server',
        data,
        ip: req.ip,
      }),
    );
  }

  @Get()
  async status() {
    if (!this.agent.enabled) return { enabled: false };
    return { enabled: true, ...(await this.agent.call<object>('GET', '/v1/status')) };
  }

  @Get('disk')
  disk() {
    return this.agent.call('GET', '/v1/disk', undefined, 130_000);
  }

  @Post('cleanup')
  @HttpCode(200)
  async cleanup(
    @Body(new ZodPipe(ServerCleanup)) b: z.infer<typeof ServerCleanup>,
    @Req() req: Request,
  ) {
    const r = await this.agent.call<{ results: { target: string; reclaimed: number }[] }>(
      'POST',
      '/v1/cleanup',
      b,
      320_000,
    );
    await this.audit(req, 'cleanup', {
      targets: b.targets,
      reclaimed: r.results.reduce((s, x) => s + x.reclaimed, 0),
    });
    return r;
  }

  /** Última versão publicada e andamento da atualização em curso (se houver). */
  @Get('update')
  async updateInfo() {
    const [feed, job] = await Promise.all([
      this.releases.latest(),
      this.agent.enabled
        ? this.agent.call<{ job: unknown }>('GET', '/v1/update').catch(() => ({ job: null }))
        : Promise.resolve({ job: null }),
    ]);
    return { ...feed, job: job.job };
  }

  /** Troca a tag das imagens do Comandou nos serviços (migração primeiro). Ver agente/updater.ts. */
  @Post('update')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async update(
    @Body(new ZodPipe(SystemUpdate)) b: z.infer<typeof SystemUpdate>,
    @Req() req: Request,
  ) {
    const r = await this.agent.call<{ job: { steps: { service: string; from: string }[] } }>(
      'POST',
      '/v1/update',
      b,
      60_000,
    );
    await this.audit(req, 'system_update_started', {
      version: b.version,
      services: r.job.steps.map((s) => `${s.service}:${s.from}`),
    });
    return r;
  }

  @Post('services/:name/restart')
  @HttpCode(200)
  async restart(@Param('name', new ZodPipe(ServiceName)) name: string, @Req() req: Request) {
    const r = await this.agent.call('POST', `/v1/services/${encodeURIComponent(name)}/restart`);
    await this.audit(req, 'service_restarted', { service: name });
    return r;
  }

  @Get('services/:name/logs')
  async logs(
    @Param('name', new ZodPipe(ServiceName)) name: string,
    @Query('tail') tail: string | undefined,
    @Req() req: Request,
  ) {
    const n = Math.min(Math.max(Number(tail) || 200, 10), 1000);
    const r = await this.agent.call(
      'GET',
      `/v1/services/${encodeURIComponent(name)}/logs?tail=${n}`,
    );
    await this.audit(req, 'logs_viewed', { service: name });
    return r;
  }
}
