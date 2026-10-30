import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { sniff } from '../store/store.controller';
import {
  cookieOf,
  CUSTOMER_COOKIE,
  CustomersService,
  normalizePhone,
} from '../store/customers.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import {
  CHAT_IMAGE_TYPES,
  CHAT_VIDEO_TYPES,
  ChatIdentity,
  GUEST_COOKIE,
  GUEST_DAYS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_VIDEO_BYTES,
  sniffVideo,
  StoreChatService,
} from './store-chat.service';

const Message = z.object({
  body: z.string().max(2000).default(''),
  fileId: z.string().uuid().nullable().optional(),
  orderNumber: z.number().int().min(1).max(99_999_999).nullable().optional(),
});
const Start = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .max(25)
    .refine((v) => /^[0-9]{10,11}$/.test(normalizePhone(v)), 'Celular inválido (DDD + número)'),
});
const Before = z.string().datetime({ offset: true });
const Dim = z.coerce.number().int().min(1).max(8192).optional();
const ListQuery = z.enum(['open', 'closed', 'all']).default('open');
const Search = z.string().trim().max(60).optional();
const Status = z.object({ status: z.enum(['open', 'closed']) });

/** Confere tipo, tamanho e assinatura de uma foto ou vídeo enviado no corpo da requisição. */
export function checkFile(body: unknown, type: string | undefined) {
  const mime = (type ?? '').split(';')[0].trim().toLowerCase();
  const isVideo = CHAT_VIDEO_TYPES.has(mime);
  if ((!CHAT_IMAGE_TYPES.has(mime) && !isVideo) || !Buffer.isBuffer(body))
    throw new UnprocessableEntityException(
      'Envie uma foto (JPG, PNG, WebP) ou um vídeo (MP4, MOV)',
    );
  const max = isVideo ? MAX_CHAT_VIDEO_BYTES : MAX_CHAT_IMAGE_BYTES;
  if (body.length === 0 || body.length > max)
    throw new UnprocessableEntityException(
      isVideo ? 'Vídeo maior que 20 MB: grave um mais curto' : 'Foto vazia ou maior que 3 MB',
    );
  const real = isVideo ? sniffVideo(body) : sniff(body);
  if (!real || (isVideo ? !CHAT_VIDEO_TYPES.has(real) : real !== mime))
    throw new UnprocessableEntityException('O arquivo não é uma foto ou vídeo válido');
  return { mime: real, bytes: body };
}

/**
 * Entrega a foto/vídeo. Vídeo aceita pedaços (Range): o iPhone só toca vídeo que vem assim.
 * Privado: só o cliente da conversa e a equipe chegam aqui.
 */
export function sendFile(
  req: Request,
  res: Response,
  f: { contentType: string; bytes: Buffer },
): void {
  const total = f.bytes.length;
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : total - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : total - 1;
    start = Math.max(0, start);
    end = Math.min(end, total - 1);
    if (start > end || start >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    res.end(f.bytes.subarray(start, end + 1));
    return;
  }
  res.setHeader('Content-Length', String(total));
  res.end(f.bytes);
}

/**
 * Lado do cliente (/pedir): rotas públicas para o login da equipe. Quem identifica o cliente é o
 * cookie da conta (cm_cid) ou o cookie de visitante da conversa (cm_chat).
 */
@Controller({ path: 'store/chat', version: '1' })
export class PublicStoreChatController {
  constructor(
    private readonly chat: StoreChatService,
    private readonly customers: CustomersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async who(t: ResolvedTenant, req: Request): Promise<ChatIdentity> {
    const customer = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    return { customer, guestToken: cookieOf(req, GUEST_COOKIE) };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get()
  async state(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.chat.customerState(t.id, await this.who(t, req));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('unread')
  async unread(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.chat.customerUnread(t.id, await this.who(t, req));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('messages')
  async older(
    @Query('before', new ZodPipe(Before)) before: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.chat.customerOlder(t.id, await this.who(t, req), before);
  }

  /** Começa a conversa: visitante informa nome e celular (com conta, nada). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('start')
  @HttpCode(200)
  async start(
    @Body() raw: unknown,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const who = await this.who(t, req);
    const guest = who.customer ? undefined : new ZodPipe(Start).transform(raw);
    const r = await this.chat.start(
      t.id,
      who,
      guest && { name: guest.name, phone: normalizePhone(guest.phone) },
    );
    if (r.guestToken) {
      // Host-only, como o cookie da conta: a conversa é deste restaurante.
      res.cookie(GUEST_COOKIE, r.guestToken, {
        httpOnly: true,
        secure: this.env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: GUEST_DAYS * 86_400_000,
      });
      who.guestToken = r.guestToken;
    }
    return this.chat.customerState(t.id, who);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('messages')
  async send(
    @Body(new ZodPipe(Message)) b: z.infer<typeof Message>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.chat.customerSend(t.id, await this.who(t, req), b);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('files')
  async upload(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(Dim)) width: number | undefined,
    @Query('h', new ZodPipe(Dim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const f = checkFile(body, type);
    return this.chat.customerUpload(t.id, await this.who(t, req), { ...f, width, height });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Get('files/:id')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.chat.customerFile(t.id, await this.who(t, req), id));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post('read')
  @HttpCode(200)
  async read(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.chat.customerRead(t.id, await this.who(t, req));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post('typing')
  @HttpCode(200)
  async typing(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.chat.customerTyping(t.id, await this.who(t, req));
  }
}

/** Lado da equipe: quem cuida dos pedidos (PDV) responde os clientes. */
@Controller({ path: 'support/chats', version: '1' })
@RequirePermission('orders:manage')
export class SupportChatController {
  constructor(private readonly chat: StoreChatService) {}

  @Get()
  list(
    @Query('status', new ZodPipe(ListQuery)) status: 'open' | 'closed' | 'all',
    @Query('q', new ZodPipe(Search)) term: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.list(t.id, u.id, { status, q: term || undefined });
  }

  @Get('unread')
  unread(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.unread(t.id, u.id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get('files/:id')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendFile(req, res, await this.chat.staffFile(t.id, u.id, id));
  }

  @Get(':id')
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.detail(t.id, u.id, id);
  }

  @Get(':id/messages')
  older(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before', new ZodPipe(Before)) before: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.older(t.id, u.id, id, before);
  }

  @Post(':id/messages')
  send(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Message)) b: z.infer<typeof Message>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.staffSend(t.id, u.id, id, b);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':id/files')
  upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(Dim)) width: number | undefined,
    @Query('h', new ZodPipe(Dim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const f = checkFile(body, type);
    return this.chat.staffUpload(t.id, u.id, id, { ...f, width, height });
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.staffRead(t.id, u.id, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Post(':id/typing')
  @HttpCode(200)
  typing(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.staffTyping(t.id, id, u.name);
  }

  @Patch(':id')
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Status)) b: z.infer<typeof Status>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.setStatus(t.id, u.id, id, b.status);
  }
}
