import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from '../store/customers.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AppContentService } from './app-content.service';

const nullText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const when = z.string().datetime({ offset: true }).nullable();

const About = z.object({
  about: nullText(2000),
  instagram: z
    .string()
    .trim()
    .max(60)
    .transform((v) => v.replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, ''))
    .refine((v) => !v || /^[A-Za-z0-9._]{1,30}\/?$/.test(v), 'usuário do Instagram inválido')
    .transform((v) => v.replace(/\/$/, '') || null)
    .nullable(),
});
const Faq = z.object({
  items: z
    .array(
      z.object({
        section: z.string().trim().min(1).max(40),
        question: z.string().trim().min(3).max(160),
        answer: z.string().trim().min(1).max(2000),
        active: z.boolean().default(true),
      }),
    )
    .max(60),
});
const NoticeFields = z.object({
  title: z.string().trim().min(1).max(80),
  body: nullText(600),
  imageId: uuid.nullable(),
  targetType: z.enum(['none', 'product', 'coupon']),
  target: nullText(60),
  startsAt: when,
  endsAt: when,
  active: z.boolean(),
});
const NoticeCreate = NoticeFields.partial({
  body: true,
  imageId: true,
  targetType: true,
  target: true,
  startsAt: true,
  endsAt: true,
  active: true,
});
const NoticeUpdate = NoticeFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);
const Referral = z.object({ code: z.string().trim().min(4).max(12) });

/** Conteúdo do app do cliente (Loja online › App do cliente): Ajuda, Avisos e Sobre. */
@Controller({ path: 'app-content', version: '1' })
export class AppContentController {
  constructor(private readonly content: AppContentService) {}

  @Get()
  @RequirePermission('settings:manage')
  overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.content.overview(ctxOf(t, u));
  }

  @Put('about')
  @RequirePermission('settings:manage')
  about(
    @Body(new ZodPipe(About)) b: z.infer<typeof About>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.content.saveAbout(ctxOf(t, u, req), b.about, b.instagram);
  }

  @Put('faq')
  @RequirePermission('settings:manage')
  faq(
    @Body(new ZodPipe(Faq)) b: z.infer<typeof Faq>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.content.saveFaq(ctxOf(t, u, req), b.items);
  }

  @Post('notices')
  @RequirePermission('settings:manage')
  createNotice(
    @Body(new ZodPipe(NoticeCreate)) b: z.infer<typeof NoticeCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.content.createNotice(ctxOf(t, u, req), {
      body: null,
      imageId: null,
      targetType: 'none',
      target: null,
      startsAt: null,
      endsAt: null,
      active: true,
      ...b,
    });
  }

  @Patch('notices/:id')
  @RequirePermission('settings:manage')
  updateNotice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NoticeUpdate)) b: z.infer<typeof NoticeUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.content.updateNotice(ctxOf(t, u, req), id, b);
  }

  @Delete('notices/:id')
  @RequirePermission('settings:manage')
  deleteNotice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.content.deleteNotice(ctxOf(t, u, req), id);
  }
}

/**
 * Telas da Conta do app do cliente: Ajuda, Notificações, Sobre e Escolher loja (público) e, com a
 * conta aberta (cookie cm_cid), trocar o PIN e usar o código de convite de um amigo.
 */
@Controller({ path: 'store', version: '1' })
export class StoreAppController {
  constructor(
    private readonly content: AppContentService,
    private readonly customers: CustomersService,
    private readonly loyalty: LoyaltyService,
  ) {}

  private async who(t: ResolvedTenant, req: Request) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    if (!c) throw new UnauthorizedException('Entre na sua conta');
    return c;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('app')
  app(@CurrentTenant() t: ResolvedTenant) {
    return this.content.publicView(t.id);
  }

  /** Indique um amigo: o cliente informa o código de quem o convidou (uma vez). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('account/referral')
  @HttpCode(200)
  async referral(
    @Body(new ZodPipe(Referral)) b: z.infer<typeof Referral>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    return this.loyalty.useReferral(t.id, c.id, b.code);
  }
}
