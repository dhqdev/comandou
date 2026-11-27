import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { ItemAiService } from './item-ai.service';

const CreatePhoto = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const mimeOf = (type: string | undefined) => (type ?? '').split(';')[0]!.trim().toLowerCase();

/**
 * IA nos itens do cardápio: melhorar e criar a foto. O corpo das rotas de foto é
 * a própria foto (já reduzida pelo navegador), como na importação do cardápio.
 */
@Controller({ version: '1' })
export class ItemAiController {
  constructor(private readonly service: ItemAiService) {}

  @Get('catalog-ai')
  @RequirePermission('catalog:write')
  status(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.service.status(ctxOf(t, u));
  }

  /** Sugestão de retoque e dicas para a foto do item (o retoque é feito no navegador). */
  @Post('catalog-ai/photo/tips')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @RequirePermission('catalog:write')
  tips(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('item') item: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.service.photoTips(ctxOf(t, u, req), body, mimeOf(type), item ?? '');
  }

  /** A mesma foto com fundo limpo de estúdio, refeita pela IA de imagem. Devolve a foto. */
  @Post('catalog-ai/photo/clean')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @RequirePermission('catalog:write')
  async clean(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('item') item: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const img = await this.service.photoClean(ctxOf(t, u, req), body, mimeOf(type), item ?? '');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(img.body.length));
    res.end(img.body);
  }

  /** Foto do item criada do zero pela IA (nome e descrição). Devolve a foto. */
  @Post('catalog-ai/photo/create')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @RequirePermission('catalog:write')
  async create(
    @Body(new ZodPipe(CreatePhoto)) b: z.infer<typeof CreatePhoto>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const img = await this.service.photoCreate(ctxOf(t, u, req), b.name, b.description ?? '');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(img.body.length));
    res.end(img.body);
  }
}
