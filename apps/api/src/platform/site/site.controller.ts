import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
import {
  MENU_FILE_TYPES,
  SiteAiService,
  SiteAiSettingsBody,
  SiteAiSource,
  SiteSession,
  SiteStockBody,
  type SiteAiSettingsInput,
  type SiteAiSourceInput,
} from './site-ai.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });

/** Prévia de e-mail aberta como página no painel: só imagem e estilo, nenhum script. */
const EMAIL_PREVIEW_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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
    private readonly ai: SiteAiService,
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

  /**
   * Monta o site do restaurante com IA (só com Super Admin › Site › Site com IA ligado). Além deste
   * limite por minuto, cada visitante gera poucos sites por dia (painel).
   */
  @Post('ai')
  @HttpCode(200)
  @Throttle({ default: { ttl: 600_000, limit: 6 } })
  generate(@Body(new ZodPipe(SiteAiSource)) b: SiteAiSourceInput, @Req() req: Request) {
    return this.ai.generate(b, clientIp(req) || undefined);
  }

  /**
   * Cardápio enviado na janela de criar (foto ou PDF, até 3 MB, uma página por vez): a IA separa
   * itens e preços. `rascunho`: o token do cardápio já começado (página a mais). Conta no limite
   * de rascunhos por visitante e nos tokens do dia e do mês do site com IA.
   */
  @Post('menu')
  @HttpCode(200)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  menu(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('rascunho') claim: string | undefined,
    @Query('sessao') session: string | undefined,
    @Req() req: Request,
  ) {
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!MENU_FILE_TYPES.has(mime) || !Buffer.isBuffer(body))
      throw new UnprocessableEntityException('Envie uma foto (JPG, PNG, WebP) ou um PDF');
    if (claim !== undefined && !/^[A-Za-z0-9_-]{32}$/.test(claim))
      throw new UnprocessableEntityException('Rascunho inválido');
    return this.ai.readMenu(body, mime, clientIp(req) || undefined, {
      claim,
      session: SiteSession.safeParse(session).success ? session : undefined,
    });
  }

  /**
   * Estoque inicial sugerido pela IA para os itens do rascunho (cardápio enviado ou site
   * montado). Só para quem tem o token do rascunho; uma vez por item.
   */
  @Post('stock')
  @HttpCode(200)
  @Throttle({ default: { ttl: 600_000, limit: 12 } })
  stock(@Body(new ZodPipe(SiteStockBody)) b: z.infer<typeof SiteStockBody>) {
    return this.ai.suggestStock(b.claim);
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

  /**
   * Aba Criação do restaurante: quanto a IA gastou em cada etapa da criação pelo site (montar o
   * site, ler o cardápio, sugerir o estoque e os primeiros passos), pela chave do sistema.
   */
  @Get('creation/:tenantId')
  creation(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return this.svc.creation(tenantId);
  }

  @Get('email-preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Security-Policy', EMAIL_PREVIEW_CSP)
  emailPreview() {
    return this.svc.emailPreview();
  }

  @Post('customer-test-email')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  testCustomer(@Body(new ZodPipe(TestEmailBody)) b: z.infer<typeof TestEmailBody>) {
    return this.svc.testCustomerEmail(b.to);
  }

  @Get('customer-email-preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Security-Policy', EMAIL_PREVIEW_CSP)
  customerEmailPreview() {
    return this.svc.customerEmailPreview();
  }
}

/** Super Admin › Site › Site com IA: chave, modelo, limites de tokens e o consumo de cada site. */
@Controller({ path: 'platform/site-ai', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformSiteAiController {
  constructor(private readonly ai: SiteAiService) {}

  @Get()
  overview() {
    return this.ai.overview();
  }

  @Put('settings')
  save(@Body(new ZodPipe(SiteAiSettingsBody)) b: SiteAiSettingsInput, @Req() req: Request) {
    return this.ai.save(b, actor(req));
  }

  /** Gera um site de teste pelo painel (conta nos limites de tokens, não no do visitante). */
  @Post('try')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  try(@Body(new ZodPipe(SiteAiSource)) b: SiteAiSourceInput, @Req() req: Request) {
    return this.ai.generate(b, req.ip, actor(req));
  }

  @Get('generations/:id')
  draft(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.draft(id);
  }
}
