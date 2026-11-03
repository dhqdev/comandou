import { Body, Controller, HttpCode, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { bearerMatches } from '../common/bearer';
import { Public, SkipCsrf, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { WhatsAppInboundService } from './whatsapp-inbound.service';

export const InboundBody = z.object({
  tenantId: z.string().uuid(),
  id: z.string().min(1).max(128),
  jid: z.string().regex(/^[0-9]{5,20}@(s\.whatsapp\.net|lid)$/),
  from: z
    .string()
    .regex(/^[0-9]{5,20}$/)
    .nullable(),
  kind: z.enum([
    'text',
    'image',
    'audio',
    'video',
    'document',
    'sticker',
    'location',
    'contact',
    'other',
  ]),
  text: z.string().max(4000),
  pushName: z.string().max(100).nullable(),
  timestamp: z.coerce.date(),
});

/**
 * Mensagens que os clientes mandam para o WhatsApp do restaurante. Só o gateway (rede interna)
 * chama, com o mesmo token que a API usa para falar com ele. Sem o token configurado, 404.
 */
@Controller({ path: 'internal/whatsapp', version: '1' })
@SkipTenant()
@Public()
@SkipCsrf() // sem cookie: a autenticação é o token interno
@SkipThrottle()
export class WhatsAppInternalController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly inbound: WhatsAppInboundService,
  ) {}

  @Post('inbound')
  @HttpCode(202)
  receive(@Req() req: Request, @Body(new ZodPipe(InboundBody)) b: z.infer<typeof InboundBody>) {
    if (!bearerMatches(req, this.env.WHATSAPP_GATEWAY_TOKEN)) throw new NotFoundException();
    return this.inbound.receive(b);
  }
}
