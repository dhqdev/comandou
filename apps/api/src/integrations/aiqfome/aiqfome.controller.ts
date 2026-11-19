import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
  SkipTenant,
} from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PlatformHostGuard } from '../../platform/platform-auth';
import type { AuthenticatedUser, ResolvedTenant } from '../../tenancy/tenant.types';
import { AiqfomeService } from './aiqfome.service';

const AuthorizeBody = z.object({
  storeId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, 'O código da loja no aiqfome tem só números'),
  name: z.string().trim().max(160).default(''),
});

/** Volta para a tela de aplicativos com o resultado (o motivo é texto do Comandou). */
const back = (r: 'ok' | 'erro' | 'cancelado', motivo?: string) =>
  `/integracoes?aiqfome=${r}${motivo ? `&motivo=${encodeURIComponent(motivo.slice(0, 200))}` : ''}`;

/** Aplicativos de delivery › aiqfome: ligar a loja pela autorização no ID Magalu. */
@Controller({ path: 'channels/aiqfome', version: '1' })
export class AiqfomeController {
  constructor(private readonly svc: AiqfomeService) {}

  /** Devolve o endereço do ID Magalu; o navegador vai para lá. */
  @Post('authorize')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  authorize(
    @Body(new ZodPipe(AuthorizeBody)) b: z.infer<typeof AuthorizeBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.svc.authorize({ tenantId: t.id, userId: u.id }, b, req.hostname);
  }

  /** Volta do ID Magalu (navegação do navegador): troca o código e leva de volta para a tela. */
  @Get('finish')
  @RequirePermission('settings:manage')
  async finish(
    @Query('code') code: string,
    @Query('state') state: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let to = back('ok');
    try {
      await this.svc.finish(
        { tenantId: t.id, userId: u.id, ip: req.ip },
        String(code ?? ''),
        String(state ?? ''),
      );
    } catch (e) {
      to = back('erro', (e as Error).message);
    }
    res.redirect(302, to);
  }
}

/** Volta da autorização em admin.<base> (endereço fixo do aplicativo no portal do aiqfome). */
@Controller({ path: 'platform/channels/oauth/aiqfome', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
export class AiqfomeCallbackController {
  constructor(private readonly svc: AiqfomeService) {}

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const host = await this.svc.callbackTarget(String(state ?? ''));
    if (!host) {
      res
        .status(400)
        .type('text/plain; charset=utf-8')
        .send('Autorização do aiqfome vencida. Volte ao Comandou e ligue a loja de novo.');
      return;
    }
    const base = `${req.protocol}://${host}`;
    if (error || !code) {
      res.redirect(302, `${base}${back('cancelado')}`);
      return;
    }
    const q = new URLSearchParams({ code: String(code), state: String(state) });
    res.redirect(302, `${base}/api/v1/channels/aiqfome/finish?${q.toString()}`);
  }
}
