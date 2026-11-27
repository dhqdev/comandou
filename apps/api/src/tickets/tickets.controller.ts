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
  Put,
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
import type { Actor } from '../platform/platform.service';
import { checkFile, sendFile } from '../store-chat/store-chat.controller';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { PipelineService } from './pipeline.service';
import { PipelinePeriod } from './pipeline-usage';
import {
  AdminTicketBody,
  DecideBody,
  MoveBody,
  NewTicketBody,
  PatchTicketBody,
  PipelineSettingsBody,
  ReplyBody,
  TestGithubBody,
  TicketsService,
} from './tickets.service';

const FileName = z.string().trim().max(200).optional();
const Cancel = z.object({ reason: z.string().trim().max(500).optional() });
const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });
const who = (u: AuthenticatedUser) => ({ id: u.id, name: u.name, email: u.email });

/** Chamados do restaurante (tela Chamados): abrir, anexar fotos e vídeos, conversar, acompanhar. */
@Controller({ path: 'support', version: '1' })
@AllowWhenBlocked()
export class TenantTicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get('tickets')
  @RequirePermission('plan:read')
  list(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.listForTenant(t.id);
  }

  /** Novidades nos chamados (bolinha no menu). */
  @Get('tickets/unread')
  @RequirePermission('plan:read')
  unread(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.unreadForTenant(t.id);
  }

  @Post('tickets')
  @RequirePermission('plan:read')
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async create(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodPipe(NewTicketBody)) b: z.infer<typeof NewTicketBody>,
  ) {
    const row = await this.svc.create(t.id, who(u), b);
    return { id: row.id, number: row.number };
  }

  @Get('tickets/:id')
  @RequirePermission('plan:read')
  detail(@CurrentTenant() t: ResolvedTenant, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.detailForTenant(t.id, id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(200)
  @RequirePermission('plan:read')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  reply(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReplyBody)) b: z.infer<typeof ReplyBody>,
  ) {
    return this.svc.replyAsClient(t.id, who(u), id, { ...b, internal: false });
  }

  @Post('tickets/:id/cancel')
  @HttpCode(200)
  @RequirePermission('plan:read')
  cancel(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.cancelAsClient(t.id, who(u), id);
  }

  /** Foto ou vídeo do problema (o corpo é o próprio arquivo). */
  @Post('tickets/:id/files')
  @RequirePermission('plan:read')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  upload(
    @CurrentTenant() t: ResolvedTenant,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('name', new ZodPipe(FileName)) name: string | undefined,
  ) {
    return this.svc.upload(id, t.id, 'client', checkFile(body, type), name ?? '');
  }

  @Get('files/:fid')
  @RequirePermission('plan:read')
  async file(
    @CurrentTenant() t: ResolvedTenant,
    @Param('fid', new ParseUUIDPipe()) fid: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.svc.file(fid, t.id));
  }
}

/** Esteira de desenvolvimento no painel Super Admin. */
@Controller({ path: 'platform/tickets', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformTicketsController {
  constructor(
    private readonly svc: TicketsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Get()
  board(@Query('closed') closed?: string) {
    return this.svc.board(closed === '1');
  }

  @Get('settings')
  settings() {
    return this.svc.settings();
  }

  @Put('settings')
  saveSettings(
    @Body(new ZodPipe(PipelineSettingsBody)) b: z.infer<typeof PipelineSettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  test(@Body(new ZodPipe(TestGithubBody)) b: z.infer<typeof TestGithubBody>) {
    return this.svc.testGithub(b);
  }

  /** Roda a esteira agora (sem esperar a próxima volta). */
  @Post('run')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async run() {
    return { processed: await this.pipeline.tick() };
  }

  @Post()
  create(
    @Body(new ZodPipe(AdminTicketBody)) b: z.infer<typeof AdminTicketBody>,
    @Req() req: Request,
  ) {
    return this.svc.adminCreate(b, actor(req));
  }

  @Get('files/:fid')
  async file(
    @Param('fid', new ParseUUIDPipe()) fid: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.svc.file(fid, null));
  }

  /** Uso de IA da esteira (separado do uso dos restaurantes, que fica em Tokens de IA). */
  @Get('ai-usage')
  aiUsage(@Query('period') period?: string) {
    return this.svc.aiUsage(PipelinePeriod.parse(period));
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.adminDetail(id);
  }

  @Get(':id/diff')
  diff(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.diff(id);
  }

  @Post(':id/decide')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(DecideBody)) b: z.infer<typeof DecideBody>,
    @Req() req: Request,
  ) {
    return this.svc.decide(id, b, actor(req));
  }

  @Post(':id/messages')
  @HttpCode(200)
  message(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReplyBody)) b: z.infer<typeof ReplyBody>,
    @Req() req: Request,
  ) {
    return this.svc.adminMessage(id, b, actor(req));
  }

  @Patch(':id')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PatchTicketBody)) b: z.infer<typeof PatchTicketBody>,
    @Req() req: Request,
  ) {
    return this.svc.patch(id, b, actor(req));
  }

  @Post(':id/move')
  @HttpCode(200)
  move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(MoveBody)) b: z.infer<typeof MoveBody>,
    @Req() req: Request,
  ) {
    return this.svc.move(id, b.stage, actor(req));
  }

  @Post(':id/advance')
  @HttpCode(200)
  advance(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.svc.advance(id, actor(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Cancel)) b: z.infer<typeof Cancel>,
    @Req() req: Request,
  ) {
    return this.svc.cancel(id, b.reason, actor(req));
  }

  @Post(':id/files')
  upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('name', new ZodPipe(FileName)) name: string | undefined,
  ) {
    return this.svc.upload(id, null, 'admin', checkFile(body, type), name ?? '');
  }
}
