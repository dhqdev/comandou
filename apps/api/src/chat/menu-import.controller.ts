import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { MenuImportService } from './menu-import.service';

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
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!TYPES.has(mime) || !Buffer.isBuffer(body))
      throw new UnprocessableEntityException('Envie uma foto (JPG, PNG, WebP) ou um PDF');
    return this.service.analyze(ctxOf(t, u, req), body, mime);
  }
}
