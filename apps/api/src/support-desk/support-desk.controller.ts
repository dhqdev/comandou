import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
  SkipTenant,
} from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import { checkFile, sendFile } from '../store-chat/store-chat.controller';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { SupportDeskService } from './support-desk.service';

const Message = z.object({
  body: z.string().max(2000).default(''),
  fileId: z.string().uuid().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
});
const Before = z.string().datetime({ offset: true });
const Dim = z.coerce.number().int().min(1).max(8192).optional();
const ListQuery = z.enum(['open', 'closed', 'all']).default('all');
const Search = z.string().trim().max(60).optional();
const Status = z.object({ status: z.enum(['open', 'closed']) });

/**
 * Lado do restaurante: o dono ou o gerente (quem vê o plano) fala com a Comandou. Funciona com o
 * restaurante bloqueado pela cobrança, para dar para pedir ajuda.
 */
@Controller({ path: 'help/chat', version: '1' })
@RequirePermission('plan:read')
@AllowWhenBlocked()
export class HelpChatController {
  constructor(private readonly svc: SupportDeskService) {}

  @Get()
  state(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.state('tenant', t.id);
  }

  @Get('unread')
  unread(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.tenantUnread(t.id);
  }

  @Get('messages')
  older(@Query('before', new ZodPipe(Before)) before: string, @CurrentTenant() t: ResolvedTenant) {
    return this.svc.older('tenant', t.id, before);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('messages')
  send(
    @Body(new ZodPipe(Message)) b: z.infer<typeof Message>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.svc.send('tenant', t.id, { userId: u.id, name: u.name }, b);
  }

  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post('files')
  upload(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(Dim)) width: number | undefined,
    @Query('h', new ZodPipe(Dim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    return this.svc.upload('tenant', t.id, { ...checkFile(body, type), width, height });
  }

  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get('files/:id')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.svc.file(t.id, id));
  }

  @Post('read')
  @HttpCode(200)
  read(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.read('tenant', t.id);
  }
}

/** Painel Super Admin › Conversas: responde os restaurantes. */
@Controller({ path: 'platform/support', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformSupportController {
  constructor(private readonly svc: SupportDeskService) {}

  @Get()
  list(
    @Query('status', new ZodPipe(ListQuery)) status: 'open' | 'closed' | 'all',
    @Query('q', new ZodPipe(Search)) term: string | undefined,
  ) {
    return this.svc.list({ status, q: term || undefined });
  }

  @Get('unread')
  unread() {
    return this.svc.adminUnread();
  }

  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get('files/:id')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.svc.file(null, id));
  }

  @Get(':tenantId')
  detail(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return this.svc.detail(tenantId);
  }

  @Get(':tenantId/messages')
  older(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Query('before', new ZodPipe(Before)) before: string,
  ) {
    return this.svc.older('admin', tenantId, before);
  }

  @Post(':tenantId/messages')
  async send(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body(new ZodPipe(Message)) b: z.infer<typeof Message>,
    @Req() req: Request,
  ) {
    await this.svc.assertTenant(tenantId);
    const a = req.platformAdmin!;
    return this.svc.send('admin', tenantId, { adminId: a.id, name: a.name }, b);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':tenantId/files')
  async upload(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(Dim)) width: number | undefined,
    @Query('h', new ZodPipe(Dim)) height: number | undefined,
  ) {
    await this.svc.assertTenant(tenantId);
    return this.svc.upload('admin', tenantId, { ...checkFile(body, type), width, height });
  }

  @Post(':tenantId/read')
  @HttpCode(200)
  read(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return this.svc.read('admin', tenantId);
  }

  @Patch(':tenantId')
  status(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body(new ZodPipe(Status)) b: z.infer<typeof Status>,
  ) {
    return this.svc.setStatus(tenantId, b.status);
  }
}
