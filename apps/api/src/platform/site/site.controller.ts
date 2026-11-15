import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../../common/decorators';
import { ENV, Env } from '../../config/env';
import { classifyHost } from '../../tenancy/host';
import { clientIp } from '../../common/throttle-tracker';
import { ZodPipe } from '../../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform-auth';
import type { Actor } from '../platform.service';
import { PreviewBody, SiteSettingsBody, TestEmailBody, TrialBody } from './site.schemas';
import { SiteService } from './site.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });

/**
 * Site público (comandou.com), sem login: configuração da página, prévia do site do restaurante
 * e a criação do teste. Atende em qualquer endereço do Comandou; os limites são por IP.
 */
@Controller({ path: 'public/site', version: '1' })
@SkipTenant()
@Public()
export class PublicSiteController {
  constructor(
    private readonly svc: SiteService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async config(@Req() req: Request) {
    // A página pergunta se este endereço é o do site (domínio base) ou o de um restaurante com
    // domínio próprio curto (pizzaria.com), que também tem só dois nomes.
    const site = classifyHost(req.hostname, this.env.COMANDOU_BASE_DOMAIN).kind === 'platform';
    return { site, ...(await this.svc.config()) };
  }

  @Post('preview')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  preview(@Body(new ZodPipe(PreviewBody)) b: z.infer<typeof PreviewBody>) {
    return this.svc.preview(b.url);
  }

  /** Cada IP tenta no máximo 6 cadastros por hora (além do limite por dia do painel). */
  @Post('trials')
  @Throttle({ default: { ttl: 3_600_000, limit: 6 } })
  create(@Body(new ZodPipe(TrialBody)) b: z.infer<typeof TrialBody>, @Req() req: Request) {
    if (b.company) throw new UnprocessableEntityException('Cadastro inválido');
    return this.svc.create(b, clientIp(req) || undefined);
  }

  @Get('trials/:token')
  @Throttle({ default: { ttl: 60_000, limit: 90 } })
  status(@Param('token') token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnprocessableEntityException('Token inválido');
    return this.svc.status(token);
  }
}

/** Super Admin › Site: cadastro pelo site, e-mail de boas-vindas e os testes criados. */
@Controller({ path: 'platform/site', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformSiteController {
  constructor(private readonly svc: SiteService) {}

  @Get()
  async overview() {
    const [settings, trials] = await Promise.all([this.svc.settings(), this.svc.trials()]);
    return { settings, trials };
  }

  @Put('settings')
  save(
    @Body(new ZodPipe(SiteSettingsBody)) b: z.infer<typeof SiteSettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post('test-email')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  test(@Body(new ZodPipe(TestEmailBody)) b: z.infer<typeof TestEmailBody>) {
    return this.svc.testEmail(b.to);
  }

  @Get('email-preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  emailPreview() {
    return this.svc.emailPreview();
  }
}
