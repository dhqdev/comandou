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
  StatusChange,
  SubscriptionChange,
} from './platform.schemas';
import { Actor, PlatformService } from './platform.service';

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
