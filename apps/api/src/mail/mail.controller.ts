import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SkipCsrf, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import type { Actor } from '../platform/platform.service';
import { CalendarService } from './calendar.service';
import { INBOUND_MAX_BYTES, verifyInbound } from './inbound';
import {
  BookingPageBody,
  ContactBody,
  DeleteBody,
  DomainBody,
  DraftBody,
  EventBody,
  FlagsBody,
  FOLDERS,
  MailboxPatch,
  MailSettingsBody,
  NewMailboxBody,
  PublicBookingBody,
  RuleBody,
  TestSendBody,
} from './mail.schemas';
import { MailService } from './mail.service';
import { MailboxService } from './mailbox.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const uuid = () => new ParseUUIDPipe();

/** Nome de arquivo no cabeçalho de download: só ASCII no `filename`, o original em `filename*`. */
function disposition(kind: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Tipos que o navegador pode abrir direto sem risco de rodar nada (o resto baixa). */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

/** Super Admin › E-mail: caixas, envio, regras, contatos, agenda e agendamento. */
@Controller({ path: 'platform/mail', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class MailController {
  constructor(
    private readonly boxes: MailboxService,
    private readonly calendar: CalendarService,
  ) {}

  // ---- visão geral e configuração
  @Get()
  overview() {
    return this.boxes.overview();
  }

  @Get('unread')
  unread() {
    return this.boxes.unread();
  }

  @Put('settings')
  saveSettings(
    @Body(new ZodPipe(MailSettingsBody)) b: z.infer<typeof MailSettingsBody>,
    @Req() req: Request,
  ) {
    return this.boxes.saveSettings(b, actor(req));
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  test(@Body(new ZodPipe(TestSendBody)) b: z.infer<typeof TestSendBody>, @Req() req: Request) {
    return this.boxes.testSend(b.to, actor(req));
  }

  @Post('settings/inbound-secret')
  @HttpCode(200)
  inboundSecret(@Req() req: Request) {
    return this.boxes.rotateInboundSecret(origin(req), actor(req));
  }

  // ---- domínios e caixas
  @Post('domains')
  addDomain(@Body(new ZodPipe(DomainBody)) b: z.infer<typeof DomainBody>, @Req() req: Request) {
    return this.boxes.addDomain(b.domain, actor(req));
  }

  @Delete('domains/:id')
  removeDomain(@Param('id', uuid()) id: string, @Req() req: Request) {
    return this.boxes.removeDomain(id, actor(req));
  }

  @Get('domains/:id/dns')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  dns(@Param('id', uuid()) id: string) {
    return this.boxes.checkDns(id);
  }

  @Post('mailboxes')
  createMailbox(
    @Body(new ZodPipe(NewMailboxBody)) b: z.infer<typeof NewMailboxBody>,
    @Req() req: Request,
  ) {
    return this.boxes.createMailbox(b, actor(req));
  }

  @Patch('mailboxes/:id')
  updateMailbox(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(MailboxPatch)) b: z.infer<typeof MailboxPatch>,
    @Req() req: Request,
  ) {
    return this.boxes.updateMailbox(id, b, actor(req));
  }

  // ---- ler
  @Get('mailboxes/:id/threads')
  threads(
    @Param('id', uuid()) id: string,
    @Query('folder') folder: string | undefined,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
  ) {
    const f = folder === 'starred' ? 'starred' : FOLDERS.find((x) => x === folder);
    if (!f) throw new UnprocessableEntityException('Pasta inválida');
    const n = Number.parseInt(page ?? '0', 10);
    return this.boxes.threads(id, f, { q, page: Number.isFinite(n) ? n : 0 });
  }

  @Get('mailboxes/:id/threads/:threadId')
  thread(
    @Param('id', uuid()) id: string,
    @Param('threadId', uuid()) threadId: string,
    @Query('trash') trash: string | undefined,
  ) {
    return this.boxes.thread(id, threadId, trash === '1');
  }

  @Get('messages/:id/html')
  html(@Param('id', uuid()) id: string, @Query('images') images: string | undefined) {
    return this.boxes.messageHtml(id, images === '1');
  }

  @Get('attachments/:id')
  async attachment(
    @Param('id', uuid()) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.boxes.attachment(id);
    const type = f.content_type.split(';')[0]!.trim().toLowerCase();
    const inline = download !== '1' && INLINE_TYPES.has(type);
    // Fora da lista segura, o navegador só baixa (nunca abre HTML ou SVG vindos de fora).
    res.setHeader('Content-Type', inline ? type : 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition(inline ? 'inline' : 'attachment', f.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.data);
  }

  @Post('messages/flags')
  @HttpCode(200)
  flags(@Body(new ZodPipe(FlagsBody)) b: z.infer<typeof FlagsBody>) {
    return this.boxes.flag(b);
  }

  @Post('messages/delete')
  @HttpCode(200)
  destroy(@Body(new ZodPipe(DeleteBody)) b: z.infer<typeof DeleteBody>, @Req() req: Request) {
    return this.boxes.destroy(b.ids, actor(req));
  }

  // ---- escrever
  @Post('drafts')
  createDraft(@Body(new ZodPipe(DraftBody)) b: z.infer<typeof DraftBody>, @Req() req: Request) {
    return this.boxes.saveDraft(null, b, actor(req));
  }

  @Get('drafts/:id')
  draft(@Param('id', uuid()) id: string) {
    return this.boxes.draft(id);
  }

  @Put('drafts/:id')
  saveDraft(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(DraftBody)) b: z.infer<typeof DraftBody>,
    @Req() req: Request,
  ) {
    return this.boxes.saveDraft(id, b, actor(req));
  }

  /** Anexo: o corpo é o próprio arquivo (application/octet-stream) e o nome vem no cabeçalho. */
  @Post('drafts/:id/attachments')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  addAttachment(
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
    @Headers('x-file-name') name: string | undefined,
    @Headers('x-file-type') type: string | undefined,
  ) {
    if (!Buffer.isBuffer(body)) throw new UnprocessableEntityException('Envie o arquivo no corpo');
    let filename = 'anexo';
    try {
      filename = decodeURIComponent(name ?? '') || 'anexo';
    } catch {
      /* nome mal codificado: fica o padrão */
    }
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(type ?? '') ? type! : 'application/octet-stream';
    return this.boxes.addAttachment(id, { filename, contentType, data: body });
  }

  @Delete('drafts/:id/attachments/:attachmentId')
  removeAttachment(@Param('id', uuid()) id: string, @Param('attachmentId', uuid()) aid: string) {
    return this.boxes.removeAttachment(id, aid);
  }

  @Post('drafts/:id/send')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  send(@Param('id', uuid()) id: string, @Req() req: Request) {
    return this.boxes.sendDraft(id, actor(req));
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  retry(@Param('id', uuid()) id: string) {
    return this.boxes.retryMessage(id);
  }

  // ---- regras
  @Get('rules')
  rules() {
    return this.boxes.rules();
  }

  @Post('rules')
  createRule(@Body(new ZodPipe(RuleBody)) b: z.infer<typeof RuleBody>, @Req() req: Request) {
    return this.boxes.saveRule(null, b, actor(req));
  }

  @Put('rules/:id')
  saveRule(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(RuleBody)) b: z.infer<typeof RuleBody>,
    @Req() req: Request,
  ) {
    return this.boxes.saveRule(id, b, actor(req));
  }

  @Delete('rules/:id')
  deleteRule(@Param('id', uuid()) id: string, @Req() req: Request) {
    return this.boxes.deleteRule(id, actor(req));
  }

  // ---- contatos
  @Get('contacts')
  contacts(@Query('q') q: string | undefined, @Query('limit') limit: string | undefined) {
    const n = Number.parseInt(limit ?? '', 10);
    return this.boxes.contacts(q ?? '', Number.isFinite(n) ? n : 200);
  }

  @Post('contacts')
  createContact(@Body(new ZodPipe(ContactBody)) b: z.infer<typeof ContactBody>) {
    return this.boxes.saveContact(null, b);
  }

  @Put('contacts/:id')
  saveContact(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(ContactBody)) b: z.infer<typeof ContactBody>,
  ) {
    return this.boxes.saveContact(id, b);
  }

  @Delete('contacts/:id')
  deleteContact(@Param('id', uuid()) id: string) {
    return this.boxes.deleteContact(id);
  }

  // ---- envios do sistema
  @Get('outbox')
  outbox(@Query('status') status: string | undefined) {
    return this.boxes.outbox(status);
  }

  @Post('outbox/:id/retry')
  @HttpCode(200)
  retryOutbox(@Param('id', uuid()) id: string) {
    return this.boxes.retryOutbox(id);
  }

  @Post('outbox/:id/cancel')
  @HttpCode(200)
  cancelOutbox(@Param('id', uuid()) id: string) {
    return this.boxes.cancelOutbox(id);
  }

  // ---- agenda
  @Get('events')
  events(@Query('from') from: string, @Query('to') to: string) {
    const a = new Date(String(from));
    const b = new Date(String(to));
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()))
      throw new UnprocessableEntityException('Período inválido');
    return this.calendar.events(a, b);
  }

  @Post('events')
  createEvent(@Body(new ZodPipe(EventBody)) b: z.infer<typeof EventBody>, @Req() req: Request) {
    return this.calendar.saveEvent(null, b, actor(req));
  }

  @Put('events/:id')
  saveEvent(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(EventBody)) b: z.infer<typeof EventBody>,
    @Req() req: Request,
  ) {
    return this.calendar.saveEvent(id, b, actor(req));
  }

  @Delete('events/:id')
  cancelEvent(@Param('id', uuid()) id: string, @Req() req: Request) {
    return this.calendar.cancelEvent(id, actor(req));
  }

  // ---- páginas de agendamento
  @Get('booking-pages')
  pages() {
    return this.calendar.pages();
  }

  @Post('booking-pages')
  createPage(
    @Body(new ZodPipe(BookingPageBody)) b: z.infer<typeof BookingPageBody>,
    @Req() req: Request,
  ) {
    return this.calendar.savePage(null, b, actor(req));
  }

  @Put('booking-pages/:id')
  savePage(
    @Param('id', uuid()) id: string,
    @Body(new ZodPipe(BookingPageBody)) b: z.infer<typeof BookingPageBody>,
    @Req() req: Request,
  ) {
    return this.calendar.savePage(id, b, actor(req));
  }

  @Delete('booking-pages/:id')
  deletePage(@Param('id', uuid()) id: string, @Req() req: Request) {
    return this.calendar.deletePage(id, actor(req));
  }
}

/**
 * Entrada do Worker da Cloudflare (Email Routing): admin.<base>/api/v1/platform/mail/inbound.
 * Sem sessão e sem o cabeçalho anti-CSRF: vale a assinatura HMAC com o segredo criado no painel.
 * A resposta diz ao Worker se a mensagem foi guardada, se deve ser recusada ou encaminhada.
 */
@Controller({ path: 'platform/mail/inbound', version: '1' })
@SkipTenant()
@Public()
@SkipCsrf()
@UseGuards(PlatformHostGuard)
@Throttle({ default: { ttl: 60_000, limit: 600 } })
export class MailInboundController {
  constructor(
    private readonly mail: MailService,
    private readonly boxes: MailboxService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Headers('x-comandou-timestamp') timestamp: string | undefined,
    @Headers('x-comandou-from') from: string | undefined,
    @Headers('x-comandou-to') to: string | undefined,
    @Headers('x-comandou-signature') signature: string | undefined,
  ) {
    const secret = this.mail.inboundSecret(await this.mail.settingsRow());
    if (!secret || !Buffer.isBuffer(body) || !verifyInbound(secret, { timestamp, from, to, signature }, body))
      throw new ForbiddenException('Assinatura inválida');
    if (body.length > INBOUND_MAX_BYTES) throw new PayloadTooLargeException('E-mail grande demais');
    return this.boxes.receive(body, { from: from ?? '', to: to! });
  }
}

/** Página pública para marcar horário (https://<site>/agendar/<slug>), sem login. */
@Controller({ path: 'public/booking', version: '1' })
@SkipTenant()
@Public()
export class PublicBookingController {
  constructor(private readonly calendar: CalendarService) {}

  private slug(v: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(v))
      throw new UnprocessableEntityException('Endereço inválido');
    return v;
  }

  @Get(':slug')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  page(@Param('slug') slug: string) {
    return this.calendar.pageInfo(this.slug(slug));
  }

  @Get(':slug/slots')
  @Throttle({ default: { ttl: 60_000, limit: 90 } })
  slots(@Param('slug') slug: string, @Query('date') date: string) {
    return this.calendar.slots(this.slug(slug), String(date ?? ''));
  }

  /** Cada IP marca no máximo 6 horários por hora (além do limite por e-mail). */
  @Post(':slug')
  @Throttle({ default: { ttl: 3_600_000, limit: 6 } })
  book(
    @Param('slug') slug: string,
    @Body(new ZodPipe(PublicBookingBody)) b: z.infer<typeof PublicBookingBody>,
  ) {
    return this.calendar.book(this.slug(slug), b);
  }
}
