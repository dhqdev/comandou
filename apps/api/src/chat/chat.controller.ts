import {
  Body,
  Controller,
  Delete,
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
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser } from '../common/decorators';
import { one } from '../common/sql';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { mediaUrl } from '../store/store.service';
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_TENANT,
  sniff,
} from '../store/store.controller';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AiService } from './ai.service';
import { ChatService, REACTIONS } from './chat.service';

const name = z.string().trim().min(1).max(60);
const optDesc = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const Direct = z.object({ userId: uuid });
const NewConversation = z.object({
  kind: z.enum(['group', 'channel']),
  name,
  description: optDesc,
  memberIds: z.array(uuid).max(200).default([]),
});
const ConversationPatch = z
  .object({
    name: name.optional(),
    description: optDesc,
    muted: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), 'nada para atualizar');
const Members = z.object({ userIds: z.array(uuid).min(1).max(200) });
const NewMessage = z.object({
  body: z.string().max(4000).default(''),
  imageId: uuid.nullable().optional(),
  replyTo: uuid.nullable().optional(),
  mentions: z.array(uuid).max(50).optional(),
});
const EditMessage = z.object({ body: z.string().trim().min(1).max(4000) });
const Reaction = z.object({ emoji: z.enum(REACTIONS) });
const NewPost = z.object({
  body: z.string().trim().min(1).max(2000),
  imageId: uuid.nullable().optional(),
});
const NewComment = z.object({ body: z.string().trim().min(1).max(1000) });
const Pin = z.object({ pinned: z.boolean() });
const ReadNotices = z.object({ ids: z.array(uuid).max(200).optional() });
const Before = z.string().datetime({ offset: true }).optional();
const Search = z.string().trim().min(2).max(80);
const Ask = z.object({
  content: z.string().trim().min(1).max(2000),
  screen: z
    .string()
    .max(120)
    .regex(/^\/[\w\-/çãéíóúâêô]*$/i)
    .nullable()
    .optional(),
});

/**
 * Chat interno da equipe (todas as pessoas logadas do restaurante, sem permissão extra) e o
 * assistente de IA. Quem participa de cada conversa é conferido no serviço.
 */
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly ai: AiService,
    private readonly db: DatabaseService,
  ) {}

  @Get('summary')
  summary(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.summary(ctxOf(t, u));
  }

  @Get('people')
  people(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.people(ctxOf(t, u));
  }

  @Get('conversations')
  conversations(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.conversations(ctxOf(t, u));
  }

  @Get('channels')
  channels(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.openChannels(ctxOf(t, u));
  }

  @Post('conversations/direct')
  @HttpCode(200)
  direct(
    @Body(new ZodPipe(Direct)) b: z.infer<typeof Direct>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.direct(ctxOf(t, u), b.userId);
  }

  @Post('conversations')
  create(
    @Body(new ZodPipe(NewConversation)) b: z.infer<typeof NewConversation>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.create(ctxOf(t, u), b);
  }

  @Get('conversations/:id')
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.detail(ctxOf(t, u), id);
  }

  @Patch('conversations/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ConversationPatch)) b: z.infer<typeof ConversationPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.update(ctxOf(t, u), id, b);
  }

  @Post('conversations/:id/join')
  @HttpCode(200)
  join(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.join(ctxOf(t, u), id);
  }

  @Post('conversations/:id/leave')
  @HttpCode(200)
  leave(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.leave(ctxOf(t, u), id);
  }

  @Post('conversations/:id/members')
  @HttpCode(200)
  addMembers(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Members)) b: z.infer<typeof Members>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.addMembers(ctxOf(t, u), id, b.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  removeMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.removeMember(ctxOf(t, u), id, userId);
  }

  @Get('conversations/:id/messages')
  messages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before', new ZodPipe(Before)) before: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.messages(ctxOf(t, u), id, before);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  send(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NewMessage)) b: z.infer<typeof NewMessage>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.send(ctxOf(t, u), id, b);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.read(ctxOf(t, u), id);
  }

  @Post('conversations/:id/typing')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  typing(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.typing(ctxOf(t, u), id);
  }

  @Patch('messages/:id')
  edit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(EditMessage)) b: z.infer<typeof EditMessage>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.edit(ctxOf(t, u), id, b.body);
  }

  @Delete('messages/:id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.remove(ctxOf(t, u), id);
  }

  @Post('messages/:id/react')
  @HttpCode(200)
  react(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reaction)) b: z.infer<typeof Reaction>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.react(ctxOf(t, u), id, b.emoji);
  }

  @Get('search')
  search(
    @Query('q', new ZodPipe(Search)) term: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.search(ctxOf(t, u), term);
  }

  /** Foto no chat ou no mural: qualquer pessoa da equipe envia (mesmas regras das fotos da loja). */
  @Post('media')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async upload(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const mime = (type ?? '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime) || !Buffer.isBuffer(body))
      throw new UnprocessableEntityException('Envie a imagem em WebP, JPEG ou PNG');
    if (body.length === 0 || body.length > MAX_IMAGE_BYTES)
      throw new UnprocessableEntityException('Imagem vazia ou maior que 3 MB');
    if (sniff(body) !== mime)
      throw new UnprocessableEntityException('O arquivo não é uma imagem válida');
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM media`);
      if (n!.n >= MAX_IMAGES_PER_TENANT)
        throw new UnprocessableEntityException('Limite de imagens atingido; apague fotos antigas');
      return (await one<{ id: string }>(
        tx,
        `INSERT INTO media (tenant_id, content_type, bytes, size, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, mime, body, body.length, u.id],
      ))!;
    });
    return { id: row.id, url: mediaUrl(row.id) };
  }

  // ---------- mural ----------

  @Get('posts')
  posts(
    @Query('before', new ZodPipe(Before)) before: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.posts(ctxOf(t, u), before);
  }

  @Post('posts')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  post(
    @Body(new ZodPipe(NewPost)) b: z.infer<typeof NewPost>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.post(ctxOf(t, u), b);
  }

  @Post('posts/:id/react')
  @HttpCode(200)
  reactPost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Reaction)) b: z.infer<typeof Reaction>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.reactPost(ctxOf(t, u), id, b.emoji);
  }

  @Post('posts/:id/pin')
  @HttpCode(200)
  pinPost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Pin)) b: z.infer<typeof Pin>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.pinPost(ctxOf(t, u), id, b.pinned);
  }

  @Get('posts/:id/comments')
  comments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.comments(ctxOf(t, u), id);
  }

  @Post('posts/:id/comments')
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  comment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NewComment)) b: z.infer<typeof NewComment>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.comment(ctxOf(t, u), id, b.body);
  }

  @Delete('comments/:id')
  removeComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.removeComment(ctxOf(t, u), id);
  }

  @Delete('posts/:id')
  removePost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.removePost(ctxOf(t, u), id);
  }

  // ---------- avisos ----------

  @Get('notices')
  notices(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.chat.notices(ctxOf(t, u));
  }

  @Post('notices/read')
  @HttpCode(200)
  readNotices(
    @Body(new ZodPipe(ReadNotices)) b: z.infer<typeof ReadNotices>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.chat.readNotices(ctxOf(t, u), b.ids);
  }

  // ---------- assistente de IA ----------

  @Get('ai')
  aiStatus(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.ai.status(ctxOf(t, u));
  }

  @Delete('ai/messages')
  aiClear(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.ai.clear(ctxOf(t, u));
  }

  /**
   * Pergunta ao assistente. A resposta chega em pedaços (text/event-stream): `delta` com o
   * texto, `done` com a mensagem gravada e o uso do mês, ou `error`.
   */
  @Post('ai/messages')
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async aiAsk(
    @Body(new ZodPipe(Ask)) b: z.infer<typeof Ask>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const prepared = await this.ai.prepare(ctxOf(t, u, req), b.content, b.screen ?? null, t.name);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    try {
      const done = await this.ai.run(prepared, (d) => send('delta', { text: d }), abort.signal);
      send('done', done);
    } catch (e) {
      send('error', { message: (e as Error).message || 'Falha ao responder' });
    }
    res.end();
  }
}
