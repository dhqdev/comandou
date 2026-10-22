import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { MessagingService } from './messaging.service';

const template = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,512}$/, 'nome do modelo: letras minúsculas, números e _')
  .nullable();

const Settings = z
  .object({
    enabled: z.boolean(),
    phoneNumberId: z
      .string()
      .trim()
      .regex(/^[0-9]{5,30}$/, 'ID do número (só dígitos), como aparece no painel da Meta')
      .nullable(),
    token: z.string().trim().min(20).max(1000).regex(/^\S+$/, 'token sem espaços').nullable(),
    language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'idioma, ex.: pt_BR'),
    templateReady: template,
    templateDispatched: template,
    provider: z.enum(['baileys', 'meta_cloud']),
    textReady: z.string().trim().min(1).max(1000),
    textDispatched: z.string().trim().min(1).max(1000),
    notifyReady: z.boolean(),
    notifyDispatched: z.boolean(),
  })
  .partial();

/** WhatsApp do restaurante (Baileys por QR Code ou API oficial da Meta) e histórico de avisos. */
@Controller({ path: 'messaging', version: '1' })
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('settings')
  @RequirePermission('messaging:manage')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.messaging.getSettings(ctxOf(t, u));
  }

  @Put('settings')
  @RequirePermission('messaging:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.messaging.saveSettings(ctxOf(t, u, req), b);
  }

  /** Conexão do WhatsApp por QR Code (Baileys): situação e QR atual. */
  @Get('session')
  @RequirePermission('messaging:manage')
  session(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.messaging.session(ctxOf(t, u));
  }

  @Post('session/connect')
  @HttpCode(200)
  @RequirePermission('messaging:manage')
  connect(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.messaging.connect(ctxOf(t, u, req));
  }

  @Post('session/logout')
  @HttpCode(200)
  @RequirePermission('messaging:manage')
  logout(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.messaging.disconnect(ctxOf(t, u, req));
  }

  @Get('messages')
  @RequirePermission('messaging:manage')
  list(
    @Query(new ZodPipe(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })))
    f: { limit: number },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.messaging.list(ctxOf(t, u), f.limit);
  }

  @Post('test')
  @HttpCode(202)
  @RequirePermission('messaging:manage')
  test(
    @Body(new ZodPipe(z.object({ phone: z.string().trim().min(8).max(30) }))) b: { phone: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.messaging.sendTest(ctxOf(t, u), b.phone);
  }

  @Post('messages/:id/retry')
  @HttpCode(202)
  @RequirePermission('messaging:manage')
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.messaging.retry(ctxOf(t, u), id);
  }
}
