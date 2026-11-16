import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { MenuImportService } from './menu-import.service';

const Link = z.object({ url: z.string().trim().min(4).max(2000) });
const Text = z.object({ text: z.string().trim().min(10).max(12_000) });
const Photo = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
});

const TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'application/pdf']);

/** Importar o cardápio com IA (foto ou PDF). Quem salva os itens é o cadastro normal do cardápio. */
@Controller({ path: 'menu-import', version: '1' })
export class MenuImportController {
  constructor(private readonly service: MenuImportService) {}

  @Get()
  @RequirePermission('catalog:write')
  status(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.service.status(ctxOf(t, u));
  }

  /** O corpo é o próprio arquivo: foto já reduzida pelo navegador ou PDF, até 3 MB. */
  @Post('analyze')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @RequirePermission('catalog:write')
  analyze(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('loja') store: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!TYPES.has(mime) || !Buffer.isBuffer(body))
      throw new UnprocessableEntityException('Envie uma foto (JPG, PNG, WebP) ou um PDF');
    return this.service.analyze(ctxOf(t, u, req), body, mime, store === '1');
  }

  /** Primeiros passos: lê o link do cardápio (site, cardápio digital) e monta loja e itens. */
  @Post('link')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @RequirePermission('catalog:write')
  link(
    @Body(new ZodPipe(Link)) b: z.infer<typeof Link>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.fromLink(ctxOf(t, u, req), b.url);
  }

  /** Primeiros passos: cardápio descrito em texto (um item por linha, com o preço). */
  @Post('text')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @RequirePermission('catalog:write')
  text(
    @Body(new ZodPipe(Text)) b: z.infer<typeof Text>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.fromText(ctxOf(t, u, req), b.text);
  }

  /** Foto do link (logo, capa, item) para o navegador reduzir e guardar. */
  @Get('image')
  @Throttle({ default: { ttl: 60_000, limit: 240 } })
  @RequirePermission('catalog:write')
  async image(@Query('url') url: string | undefined, @Res() res: Response) {
    if (!url || url.length > 2000)
      throw new UnprocessableEntityException('Endereço da foto inválido');
    const img = await this.service.image(url);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Content-Length', String(img.body.length));
    res.end(img.body);
  }

  /** Foto ilustrativa criada pela IA para um item sem foto. */
  @Post('photo')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @RequirePermission('catalog:write')
  async photo(
    @Body(new ZodPipe(Photo)) b: z.infer<typeof Photo>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const img = await this.service.photo(ctxOf(t, u, req), b);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(img.body.length));
    res.end(img.body);
  }

  /** O site montado pela IA no comandou.com (teste criado pelo site). */
  @Get('site-draft')
  @RequirePermission('settings:manage')
  siteDraft(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.service.siteDraft(ctxOf(t, u));
  }

  /** Dados do cadastro do restaurante (painel do Comandou) para preencher a loja. */
  @Get('signup')
  @RequirePermission('settings:manage')
  signup(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.service.signup(ctxOf(t, u));
  }
}
