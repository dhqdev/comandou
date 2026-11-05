import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { spDate } from '@comandou/shared';
import { z } from 'zod';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
  SkipCsrf,
  SkipTenant,
} from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import {
  BillingService,
  BillingSettingsBody,
  CardBody,
  ManualInvoiceBody,
} from './billing.service';

const actor = (req: Request) => ({ admin: req.platformAdmin!, ip: req.ip });
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const Mode = z.object({ mode: z.enum(['manual', 'asaas']) });
const Upgrade = z.object({ planId: z.string().uuid() });
const PayMethodBody = z.object({ method: z.enum(['pix', 'boleto', 'card']) });

/** Ações que mexem em dinheiro ou no plano: só o administrador (dono) do restaurante. */
function ownerOnly(u: AuthenticatedUser) {
  if (u.role !== 'owner')
    throw new ForbiddenException('Só o administrador do restaurante mexe na assinatura');
  return { id: u.id, name: u.name };
}

/** Super Admin → Cobrança: conta do Asaas, regras e faturas de cada cliente. */
@Controller({ path: 'platform/billing', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class BillingAdminController {
  constructor(private readonly svc: BillingService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }

  /** Calendário de recebimentos do mês (?month=AAAA-MM; sem ele, o mês atual). */
  @Get('calendar')
  calendar(@Query('month') month?: string) {
    const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : spDate().slice(0, 7);
    return this.svc.calendar(m);
  }

  @Put('settings')
  save(
    @Body(new ZodPipe(BillingSettingsBody)) b: z.infer<typeof BillingSettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post('test')
  @HttpCode(200)
  test(@Req() req: Request) {
    return this.svc.test(actor(req));
  }

  @Post('webhook/register')
  @HttpCode(200)
  register(@Req() req: Request) {
    return this.svc.registerWebhook(origin(req), actor(req));
  }

  @Post('webhook/token')
  @HttpCode(200)
  token(@Req() req: Request) {
    return this.svc.webhookToken(origin(req), actor(req));
  }

  /** Roda o ciclo agora (gera faturas, marca vencidas, aplica o bloqueio). */
  @Post('run')
  @HttpCode(200)
  async run() {
    return (await this.svc.runCycle()) ?? { busy: true };
  }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.tenantAdmin(id);
  }

  @Put('tenants/:id/mode')
  mode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Mode)) b: z.infer<typeof Mode>,
    @Req() req: Request,
  ) {
    return this.svc.setMode(id, b.mode, actor(req));
  }

  @Post('tenants/:id/charge')
  @HttpCode(200)
  charge(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.chargeNow(id, actor(req));
  }

  @Post('tenants/:id/invoices')
  manual(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ManualInvoiceBody)) b: z.infer<typeof ManualInvoiceBody>,
    @Req() req: Request,
  ) {
    return this.svc.createManual(id, b, actor(req));
  }

  @Post('invoices/:iid/cancel')
  @HttpCode(200)
  cancel(@Param('iid', ParseUUIDPipe) iid: string, @Req() req: Request) {
    return this.svc.cancelInvoice(iid, actor(req));
  }

  @Post('invoices/:iid/paid')
  @HttpCode(200)
  paid(@Param('iid', ParseUUIDPipe) iid: string, @Req() req: Request) {
    return this.svc.markPaid(iid, actor(req));
  }

  @Post('invoices/:iid/sync')
  @HttpCode(200)
  sync(@Param('iid', ParseUUIDPipe) iid: string, @Req() req: Request) {
    return this.svc.sync(iid, actor(req));
  }
}

/**
 * Webhook do Asaas em admin.<base>/api/v1/platform/billing/asaas/webhook. Sem sessão e sem o
 * cabeçalho anti-CSRF: vale o token (asaas-access-token) guardado cifrado no painel.
 */
@Controller({ path: 'platform/billing/asaas', version: '1' })
@SkipTenant()
@Public()
@SkipCsrf()
@UseGuards(PlatformHostGuard)
@Throttle({ default: { ttl: 60_000, limit: 600 } })
export class AsaasWebhookController {
  constructor(private readonly svc: BillingService) {}

  @Post('webhook')
  @HttpCode(200)
  hook(@Body() body: unknown, @Req() req: Request) {
    return this.svc.webhook(req.get('asaas-access-token'), body);
  }
}

/**
 * Tela Assinatura do restaurante: tempo que falta, faturas, pagar (Pix, boleto, cartão) e subir
 * de plano. Funciona com o restaurante bloqueado, para dar para pagar.
 */
@Controller({ path: 'subscription', version: '1' })
@AllowWhenBlocked()
export class TenantBillingController {
  constructor(private readonly svc: BillingService) {}

  @Get('billing')
  @RequirePermission('plan:read')
  view(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.view(t.id);
  }

  /** Aviso da barra do sistema: qualquer pessoa da equipe vê (sem valores). */
  @Get('notice')
  notice(@CurrentTenant() t: ResolvedTenant) {
    return this.svc.available ? this.svc.notice(t.id) : { level: 'none' };
  }

  @Get('invoices/:iid/pay')
  @RequirePermission('plan:read')
  pay(@CurrentTenant() t: ResolvedTenant, @Param('iid', ParseUUIDPipe) iid: string) {
    return this.svc.payInfo(t.id, iid);
  }

  @Get('plans/:pid/quote')
  @RequirePermission('plan:read')
  quote(@CurrentTenant() t: ResolvedTenant, @Param('pid', ParseUUIDPipe) pid: string) {
    return this.svc.quote(t.id, pid);
  }

  /** Só o administrador do restaurante sobe de plano (gera cobrança). */
  @Post('upgrade')
  @HttpCode(200)
  @RequirePermission('plan:read')
  upgrade(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodPipe(Upgrade)) b: z.infer<typeof Upgrade>,
  ) {
    if (u.role !== 'owner')
      throw new ForbiddenException('Só o administrador do restaurante troca o plano');
    return this.svc.upgrade(t.id, b.planId, { id: u.id, name: u.name });
  }

  /** Plano menor: vale no próximo período (no teste grátis, na hora). */
  @Post('downgrade')
  @HttpCode(200)
  @RequirePermission('plan:read')
  downgrade(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodPipe(Upgrade)) b: z.infer<typeof Upgrade>,
  ) {
    return this.svc.scheduleDowngrade(t.id, b.planId, ownerOnly(u));
  }

  @Delete('downgrade')
  @RequirePermission('plan:read')
  cancelDowngrade(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.svc.cancelDowngrade(t.id, ownerOnly(u));
  }

  @Put('pay-method')
  @RequirePermission('plan:read')
  payMethod(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodPipe(PayMethodBody)) b: z.infer<typeof PayMethodBody>,
  ) {
    return this.svc.setPayMethod(t.id, b.method, ownerOnly(u));
  }

  /** Salva o cartão no Asaas (só o token fica aqui) e liga a cobrança automática nele. */
  @Post('card')
  @HttpCode(200)
  @RequirePermission('plan:read')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  saveCard(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodPipe(CardBody)) b: z.infer<typeof CardBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveCard(t.id, b, req.ip ?? '0.0.0.0', ownerOnly(u));
  }

  @Delete('card')
  @RequirePermission('plan:read')
  removeCard(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.svc.removeCard(t.id, ownerOnly(u));
  }

  /** Paga agora uma fatura com o cartão salvo. */
  @Post('invoices/:iid/card')
  @HttpCode(200)
  @RequirePermission('plan:read')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  chargeCard(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Param('iid', ParseUUIDPipe) iid: string,
  ) {
    ownerOnly(u);
    return this.svc.chargeCard(iid, t.id);
  }
}

/**
 * Planos para a página pública /precos (qualquer endereço do Comandou, sem login). Sai direto do
 * Super Admin → Planos: o que mudar lá aparece aqui na hora.
 */
@Controller({ path: 'public/plans', version: '1' })
@SkipTenant()
@Public()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class PublicPlansController {
  constructor(private readonly svc: BillingService) {}

  @Get()
  list() {
    return this.svc.publicPlans();
  }
}
