import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BIRTHDAY_GIFT_KINDS, BIRTHDAY_THEMES } from '@comandou/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { BirthdaysService } from './birthdays.service';

const line = z.string().trim().min(1).max(48);
const giftText = z.string().trim().min(1).max(60);

/** O que muda a arte e o texto (usado no salvar, na prévia e no teste). */
const Draft = z.object({
  theme: z.enum(BIRTHDAY_THEMES),
  artLine: line,
  message: z
    .string()
    .trim()
    .max(900)
    .nullable()
    .transform((v) => v || null),
  giftKind: z.enum(BIRTHDAY_GIFT_KINDS),
  giftPoints: z.coerce.number().int().min(1).max(100_000).nullable(),
  giftText: giftText.nullable(),
  giftDays: z.coerce.number().int().min(0).max(60),
});

const Settings = Draft.extend({
  enabled: z.boolean(),
  sendHour: z.number().int().min(7).max(20),
})
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

/** Prévia pela URL da imagem: tudo opcional e em texto. */
const Preview = Draft.partial().extend({
  name: z.string().trim().max(40).optional(),
  giftPoints: z.coerce.number().int().min(1).max(100_000).optional(),
  giftText: giftText.optional(),
});

const Test = Draft.partial().extend({ phone: z.string().trim().min(8).max(25) });

/** Clientes › Aniversários: parabéns automático pelo WhatsApp da loja. */
@Controller({ path: 'birthdays', version: '1' })
export class BirthdaysController {
  constructor(private readonly birthdays: BirthdaysService) {}

  @Get()
  @RequirePermission('customers:read')
  overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.birthdays.overview(ctxOf(t, u));
  }

  @Put('settings')
  @RequirePermission('customers:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.birthdays.saveSettings(ctxOf(t, u, req), b);
  }

  /** A arte em PNG com o que está na tela (nome de exemplo: o de quem está olhando). */
  @Get('preview')
  @RequirePermission('customers:read')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', 'no-store')
  async preview(
    @Query(new ZodPipe(Preview)) qy: z.infer<typeof Preview>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { name, ...draft } = qy;
    const png = await this.birthdays.preview(ctxOf(t, u), draft, name || u.name);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.end(png);
  }

  /** Manda o parabéns de teste (com o nome de quem pediu) para um número. */
  @Post('test')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  test(
    @Body(new ZodPipe(Test)) b: z.infer<typeof Test>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const { phone, ...draft } = b;
    return this.birthdays.sendTest(ctxOf(t, u, req), phone, draft, u.name);
  }

  @Post('greetings/:id/retry')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.birthdays.retry(ctxOf(t, u, req), id);
  }
}
