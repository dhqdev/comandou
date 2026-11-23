import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
  SkipCsrf,
  SkipTenant,
} from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from '../store/customers.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import {
  OnlinePayAdminService,
  OnlinePaySettingsBody,
  TenantFeeBody,
} from './online-pay-admin.service';
import { OnlinePayService } from './online-pay.service';

const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const actor = (req: Request) => ({ admin: req.platformAdmin!, ip: req.ip });

/** CPF com os dígitos verificadores certos. */
export function validCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export const Cpf = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine(validCpf, 'CPF inválido');
export const Email = z.string().trim().toLowerCase().email().max(254);

export const PayCard = z.object({
  /** Cartão cifrado no celular pelo SDK do PagBank (o número nunca chega aqui). */
  encryptedCard: z.string().min(100).max(4000),
  holderName: z
    .string()
    .trim()
    .min(5)
    .max(120)
    .regex(/^[A-Za-zÀ-ÿ' ]+ [A-Za-zÀ-ÿ' ]+$/, 'nome como está no cartão (nome e sobrenome)'),
  cpf: Cpf,
  email: Email,
});
export const PayPix = z.object({ cpf: Cpf, email: Email });

const Update = z
  .object({
    cardEnabled: z.boolean(),
    pixEnabled: z.boolean(),
    cashRegisterId: uuid.nullable(),
    sellerAccountId: z.string().trim(),
  })
  .partial();
const Launch = z.object({ cashSessionId: uuid });

/** Loja online → Pagamentos: conectar a conta PagBank e o que aceitar pelo app. */
@Controller({ path: 'online-pay', version: '1' })
export class OnlinePayController {
  constructor(private readonly pay: OnlinePayService) {}

  @Get()
  @RequirePermission('settings:manage')
  view(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.pay.view(ctxOf(t, u));
  }

  @Patch()
  @RequirePermission('settings:manage')
  update(
    @Body(new ZodPipe(Update)) b: z.infer<typeof Update>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.update(ctxOf(t, u, req), b);
  }

  /** Devolve o endereço do PagBank; o navegador vai para lá. */
  @Post('connect')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  connect(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.connectStart(ctxOf(t, u, req), req.hostname);
  }

  /** Volta do PagBank (navegação do navegador): troca o código e leva de volta para a tela. */
  @Get('connect/finish')
  @RequirePermission('settings:manage')
  async finish(
    @Query('code') code: string,
    @Query('state') state: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let to = '/loja-online?aba=pagamentos&pagbank=ok';
    try {
      const r = await this.pay.connectFinish(
        ctxOf(t, u, req),
        String(code ?? ''),
        String(state ?? ''),
      );
      if (r.needsAccountId) to = '/loja-online?aba=pagamentos&pagbank=conta';
    } catch (e) {
      to = `/loja-online?aba=pagamentos&pagbank=erro&motivo=${encodeURIComponent((e as Error).message.slice(0, 200))}`;
    }
    res.redirect(302, to);
  }

  @Post('disconnect')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  disconnect(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.disconnect(ctxOf(t, u, req));
  }

  /** Pagamento do app aprovado sem caixa aberto: a equipe lança no caixa escolhido. */
  @Post('orders/:id/launch')
  @HttpCode(200)
  @RequirePermission('payments:create')
  launch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Launch)) b: z.infer<typeof Launch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.pay.launchByStaff(ctxOf(t, u, req), id, b.cashSessionId);
  }

  /** "Conferir no PagBank": consulta de novo as cobranças esperando do pedido. */
  @Post('orders/:id/sync')
  @HttpCode(200)
  @RequirePermission('orders:manage')
  async sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    await this.pay.sweepOrder(t.id, id);
    return this.pay.staffCharges(ctxOf(t, u), id);
  }
}

/** Cliente paga o pedido pelo app (link do pedido + conta aberta) e o aviso do PagBank. */
@Controller({ path: 'store', version: '1' })
export class OnlinePayStoreController {
  constructor(
    private readonly pay: OnlinePayService,
    private readonly customers: CustomersService,
  ) {}

  private async payer(t: ResolvedTenant, req: Request, b: { cpf: string; email: string }) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    if (!c)
      throw new ForbiddenException({
        message: 'Entre na sua conta para pagar pelo app',
        code: 'login_required',
      });
    return {
      customerId: c.id,
      payer: { name: c.name, phone: c.phone, email: b.email, taxId: b.cpf },
    };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('orders/:token/pay/card')
  @HttpCode(200)
  async card(
    @Param('token') token: string,
    @Body(new ZodPipe(PayCard)) b: z.infer<typeof PayCard>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { customerId, payer } = await this.payer(t, req, b);
    const orderId = await this.pay.orderForCustomer(t.id, token, customerId);
    return this.pay.pay(
      t.id,
      orderId,
      { method: 'card', encryptedCard: b.encryptedCard, holderName: b.holderName, payer },
      origin(req),
      req.ip,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/:token/pay/pix')
  @HttpCode(200)
  async pix(
    @Param('token') token: string,
    @Body(new ZodPipe(PayPix)) b: z.infer<typeof PayPix>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { customerId, payer } = await this.payer(t, req, b);
    const orderId = await this.pay.orderForCustomer(t.id, token, customerId);
    return this.pay.pay(t.id, orderId, { method: 'pix', payer }, origin(req), req.ip);
  }

  /** Mesmo pagamento, pelo histórico da conta do cliente (pedido conferido como dele). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @Post('account/orders/:id/pay/card')
  @HttpCode(200)
  async accountCard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PayCard)) b: z.infer<typeof PayCard>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { customerId, payer } = await this.payer(t, req, b);
    const orderId = await this.pay.orderOfCustomer(t.id, id, customerId);
    return this.pay.pay(
      t.id,
      orderId,
      { method: 'card', encryptedCard: b.encryptedCard, holderName: b.holderName, payer },
      origin(req),
      req.ip,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('account/orders/:id/pay/pix')
  @HttpCode(200)
  async accountPix(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PayPix)) b: z.infer<typeof PayPix>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const { customerId, payer } = await this.payer(t, req, b);
    const orderId = await this.pay.orderOfCustomer(t.id, id, customerId);
    return this.pay.pay(t.id, orderId, { method: 'pix', payer }, origin(req), req.ip);
  }

  /** Situação do pagamento (o acompanhamento pergunta enquanto espera o Pix ou o cartão). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('orders/:token/pay')
  async status(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    const orderId = await this.pay.orderIdByToken(t.id, token);
    return this.pay.publicView(t.id, orderId);
  }

  /**
   * Aviso do PagBank (notification_urls). Sem sessão nem cabeçalho anti-CSRF: o corpo só diz qual
   * pedido mudou e a situação é consultada no PagBank.
   */
  @Public()
  @SkipCsrf()
  @AllowWhenBlocked()
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Post('pagbank/notify')
  @HttpCode(200)
  async notify(@Body() body: unknown, @CurrentTenant() t: ResolvedTenant) {
    await this.pay.notify(t.id, body).catch(() => undefined);
    return { ok: true };
  }
}

/** Volta do Connect em admin.<base> (endereço fixo da aplicação no PagBank). */
@Controller({ path: 'pagbank/connect', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
export class PagBankCallbackController {
  constructor(private readonly pay: OnlinePayService) {}

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const host = await this.pay.callbackTarget(String(state ?? ''));
    if (!host) {
      res
        .status(400)
        .type('text/plain; charset=utf-8')
        .send('Autorização do PagBank vencida. Volte ao Comandou e conecte de novo.');
      return;
    }
    const base = `${req.protocol}://${host}`;
    if (error || !code) {
      res.redirect(302, `${base}/loja-online?aba=pagamentos&pagbank=cancelado`);
      return;
    }
    const q = new URLSearchParams({ code: String(code), state: String(state) });
    res.redirect(302, `${base}/api/v1/online-pay/connect/finish?${q.toString()}`);
  }
}

/** Super Admin → Cobrança → Pagamentos pelo app. */
@Controller({ path: 'platform/online-pay', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class OnlinePayAdminController {
  constructor(private readonly svc: OnlinePayAdminService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }

  @Put('settings')
  save(
    @Body(new ZodPipe(OnlinePaySettingsBody)) b: z.infer<typeof OnlinePaySettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post('application')
  @HttpCode(200)
  application(@Req() req: Request) {
    return this.svc.createApplication(origin(req), actor(req));
  }

  @Put('tenants/:id/fee')
  fee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(TenantFeeBody)) b: z.infer<typeof TenantFeeBody>,
    @Req() req: Request,
  ) {
    return this.svc.setTenantFee(id, b, actor(req));
  }
}
