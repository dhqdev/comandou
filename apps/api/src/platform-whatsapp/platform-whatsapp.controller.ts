import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import { PlatformWaMenuSettings } from './admin-menu-settings.service';
import { PlatformWhatsAppService } from './platform-whatsapp.service';

const Jid = z.string().regex(/^[0-9]{5,20}@(s\.whatsapp\.net|lid)$/, 'conversa inválida');
const Before = z.string().datetime({ offset: true }).optional();
const Search = z.string().trim().max(60).optional();
const Send = z
  .object({
    jid: Jid.optional(),
    phone: z.string().trim().min(8).max(30).optional(),
    text: z.string().trim().min(1, 'Escreva a mensagem').max(4000),
  })
  .refine((b) => !!b.jid !== !!b.phone, 'Informe a conversa ou o telefone');
const Id = z.string().uuid('id inválido');
const MenuSettings = z.object({
  enabled: z.boolean(),
  summaryHour: z.number().int().min(0).max(23).nullable(),
});
const Label = z.string().trim().max(60).nullable().optional();
const NewOperator = z.object({
  phone: z.string().trim().min(8).max(30),
  label: Label,
  adminId: z.string().uuid().optional(),
  alerts: z.boolean().optional(),
  summary: z.boolean().optional(),
});
const OperatorPatch = z.object({
  label: Label,
  alerts: z.boolean().optional(),
  summary: z.boolean().optional(),
});

/**
 * Super Admin › WhatsApp: o número do Comandou conectado pelo QR Code e as conversas dele.
 * Só o painel (host admin + sessão do Super Admin).
 */
@Controller({ path: 'platform/whatsapp', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class PlatformWhatsAppController {
  constructor(
    private readonly svc: PlatformWhatsAppService,
    private readonly menu: PlatformWaMenuSettings,
  ) {}

  @Get('session')
  session() {
    return this.svc.session();
  }

  @Post('session/connect')
  @HttpCode(200)
  connect(@Req() req: Request) {
    return this.svc.connect(req.platformAdmin!.id, req.ip ?? null);
  }

  @Post('session/logout')
  @HttpCode(200)
  logout(@Req() req: Request) {
    return this.svc.disconnect(req.platformAdmin!.id, req.ip ?? null);
  }

  @Get('chats')
  list(@Query('q', new ZodPipe(Search)) q: string | undefined) {
    return this.svc.list(q || undefined);
  }

  @Get('unread')
  unread() {
    return this.svc.unread();
  }

  @Get('chats/:jid')
  detail(@Param('jid', new ZodPipe(Jid)) jid: string) {
    return this.svc.detail(jid);
  }

  @Get('chats/:jid/messages')
  older(
    @Param('jid', new ZodPipe(Jid)) jid: string,
    @Query('before', new ZodPipe(Before)) before: string | undefined,
  ) {
    return this.svc.messages(jid, before);
  }

  @Post('chats/:jid/read')
  @HttpCode(200)
  read(@Param('jid', new ZodPipe(Jid)) jid: string) {
    return this.svc.read(jid);
  }

  /** Ritmo do próprio gateway já segura rajadas; aqui só evita clique repetido sem fim. */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('messages')
  send(@Body(new ZodPipe(Send)) b: z.infer<typeof Send>, @Req() req: Request) {
    const a = req.platformAdmin!;
    return this.svc.send({ id: a.id, name: a.name }, { jid: b.jid, phone: b.phone }, b.text);
  }

  /* ------------------------------------------------------------- menu do admin */

  @Get('menu')
  menuSettings() {
    return this.menu.get();
  }

  @Put('menu')
  saveMenu(@Body(new ZodPipe(MenuSettings)) b: z.infer<typeof MenuSettings>, @Req() req: Request) {
    return this.menu.save(b, { id: req.platformAdmin!.id, ip: req.ip ?? null });
  }

  @Post('menu/operators')
  addOperator(@Body(new ZodPipe(NewOperator)) b: z.infer<typeof NewOperator>, @Req() req: Request) {
    return this.menu.add(b, { id: req.platformAdmin!.id, ip: req.ip ?? null });
  }

  @Patch('menu/operators/:id')
  updateOperator(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(OperatorPatch)) b: z.infer<typeof OperatorPatch>,
    @Req() req: Request,
  ) {
    return this.menu.update(id, b, { id: req.platformAdmin!.id, ip: req.ip ?? null });
  }

  @Delete('menu/operators/:id')
  removeOperator(@Param('id', new ZodPipe(Id)) id: string, @Req() req: Request) {
    return this.menu.remove(id, { id: req.platformAdmin!.id, ip: req.ip ?? null });
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('menu/operators/:id/test')
  @HttpCode(200)
  testOperator(@Param('id', new ZodPipe(Id)) id: string) {
    return this.menu.test(id);
  }
}
