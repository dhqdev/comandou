import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AiAgentService } from './ai-agent.service';

/** Tipos aceitos no cardápio do restaurante (a API confere a assinatura do arquivo). */
const MENU_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const text = (max: number) => z.string().trim().max(max).nullable();

const Settings = z
  .object({
    whatsappEnabled: z.boolean(),
    agentName: z.string().trim().max(30).nullable(),
    tone: z.enum(['friendly', 'formal', 'fun']),
    greeting: text(300),
    about: text(1500),
    rules: text(1000),
    handoffMessage: text(300),
    suggestItems: z.boolean(),
    showPrices: z.boolean(),
    sendStoreLink: z.boolean(),
    replyWhen: z.enum(['always', 'open']),
    takeReservations: z.boolean(),
    sendPdfs: z.boolean(),
  })
  .partial();

const Visible = z.union([
  z.object({ ids: z.array(uuid).min(1).max(1000), visible: z.boolean() }),
  z.object({ all: z.literal(true), visible: z.boolean() }),
]);

const Test = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === 'user', 'a última mensagem é do cliente'),
  draft: Settings.optional(),
});

/**
 * IA do restaurante no painel do gerente: como ela atende, quais itens do cardápio ela enxerga
 * e um teste de conversa como se fosse um cliente.
 */
@Controller({ path: 'ai-agent', version: '1' })
export class AiAgentController {
  constructor(private readonly agent: AiAgentService) {}

  @Get()
  @RequirePermission('settings:manage')
  overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agent.overview(ctxOf(t, u));
  }

  @Put()
  @RequirePermission('settings:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.save(ctxOf(t, u), b);
  }

  @Get('menu')
  @RequirePermission('settings:manage')
  menu(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agent.menuItems(ctxOf(t, u));
  }

  @Put('menu')
  @RequirePermission('settings:manage')
  visible(
    @Body(new ZodPipe(Visible)) b: z.infer<typeof Visible>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.setVisible(ctxOf(t, u), b);
  }

  /** Prévia do calendário de reservas em PDF que a IA manda no WhatsApp. */
  @Get('pdf/calendar')
  @RequirePermission('settings:manage')
  async calendarPdf(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.agent.calendarPdf(ctxOf(t, u));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="calendario-reservas.pdf"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(f.data));
  }

  /** Arquivos do cardápio que o restaurante subiu para a IA mandar no WhatsApp. */
  @Get('menu-files')
  @RequirePermission('settings:manage')
  menuFiles(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agent.listMenuFiles(ctxOf(t, u));
  }

  /** Sobe um arquivo do cardápio: o corpo é o próprio PDF ou foto (JPEG/PNG). */
  @Post('menu-files')
  @RequirePermission('settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  addMenuFile(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('name', new ZodPipe(z.string().trim().max(120).optional())) name: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const contentType = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!MENU_TYPES.has(contentType) || !Buffer.isBuffer(body) || !body.length)
      throw new UnprocessableEntityException('Envie o cardápio em PDF ou foto (JPEG ou PNG)');
    return this.agent.addMenuFile(ctxOf(t, u, req), {
      data: body,
      contentType,
      name: name || 'Cardápio',
    });
  }

  @Delete('menu-files/:id')
  @RequirePermission('settings:manage')
  removeMenuFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.agent.removeMenuFile(ctxOf(t, u, req), id);
  }

  /** O arquivo para o gerente conferir (abre no navegador). */
  @Get('menu-files/:id')
  @RequirePermission('settings:manage')
  async menuFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.agent.menuFile(ctxOf(t, u), id);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="cardapio.${f.contentType === 'application/pdf' ? 'pdf' : f.contentType === 'image/png' ? 'png' : 'jpg'}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.bytes);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  test(
    @Body(new ZodPipe(Test)) b: z.infer<typeof Test>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.test(ctxOf(t, u), b);
  }
}
