import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from './customers.service';
import { PrivacyService } from './privacy.service';

/** Palavra que a pessoa digita para confirmar que quer apagar (sem volta). */
export const ERASE_WORD = 'APAGAR';
const confirmWord = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === ERASE_WORD, `Digite ${ERASE_WORD} para confirmar`);

const OwnErase = z.object({ password: z.string().min(1).max(200), confirm: confirmWord });
const StaffErase = z.object({ confirm: confirmWord });
const ByPhone = z.object({ phone: z.string().trim().min(1).max(25) });
const ByPhoneErase = ByPhone.extend({ confirm: confirmWord });

/**
 * LGPD pelo próprio cliente, no cardápio (Conta › Privacidade e dados). Quem identifica o titular
 * é o cookie da conta (cm_cid); apagar pede a senha e a palavra APAGAR.
 */
@Controller({ path: 'store/account/privacy', version: '1' })
export class AccountPrivacyController {
  constructor(
    private readonly customers: CustomersService,
    private readonly privacy: PrivacyService,
  ) {}

  private async who(t: ResolvedTenant, req: Request) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    if (!c) throw new UnauthorizedException('Entre na sua conta');
    return c;
  }

  /** Baixar meus dados: tudo o que a loja guarda da conta (e do telefone dela). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('export')
  @HttpCode(200)
  async export(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    const c = await this.who(t, req);
    return this.privacy.export(t.id, { customerId: c.id }, { by: 'customer', ip: req.ip });
  }

  /** Apagar minha conta. Sai do aparelho junto (a sessão foi apagada com a conta). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('erase')
  @HttpCode(200)
  async erase(
    @Body(new ZodPipe(OwnErase)) b: z.infer<typeof OwnErase>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = await this.who(t, req);
    await this.customers.confirmPassword(t.id, c, b.password, req.ip);
    const r = await this.privacy.erase(t.id, { customerId: c.id }, { by: 'customer', ip: req.ip });
    res.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return r;
  }
}

/**
 * LGPD pela equipe (Clientes › cliente › Dados pessoais, e "Pedido LGPD" pelo telefone para quem
 * pediu sem conta). Só quem anota e bloqueia clientes (`customers:manage`: dono e gerente).
 * Telefone vai no corpo, nunca na URL (não fica nos logs).
 */
@Controller({ path: 'privacy', version: '1' })
export class StaffPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('requests')
  @RequirePermission('customers:manage')
  history(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.privacy.history({ tenantId: t.id, userId: u.id });
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('customers/:id/export')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  exportCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.privacy.export(t.id, { customerId: id }, { by: 'staff', userId: u.id, ip: req.ip });
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('customers/:id/erase')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  eraseCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StaffErase)) _b: z.infer<typeof StaffErase>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.privacy.erase(t.id, { customerId: id }, { by: 'staff', userId: u.id, ip: req.ip });
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('phone/export')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  async exportPhone(
    @Body(new ZodPipe(ByPhone)) b: z.infer<typeof ByPhone>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const phone = PrivacyService.phoneOf(b.phone)!;
    const customerId = await this.privacy.customerByPhone(t.id, u.id, phone);
    return this.privacy.export(
      t.id,
      { customerId, phone },
      { by: 'staff', userId: u.id, ip: req.ip },
    );
  }

  /**
   * Apagar pelo telefone. Se o telefone tem conta no cardápio, apaga a conta também (o mesmo que
   * pelo cadastro do cliente).
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('phone/erase')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  async erasePhone(
    @Body(new ZodPipe(ByPhoneErase)) b: z.infer<typeof ByPhoneErase>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const phone = PrivacyService.phoneOf(b.phone)!;
    const customerId = await this.privacy.customerByPhone(t.id, u.id, phone);
    return this.privacy.erase(t.id, customerId ? { customerId } : { phone }, {
      by: 'staff',
      userId: u.id,
      ip: req.ip,
    });
  }
}
