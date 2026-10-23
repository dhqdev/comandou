import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import {
  cookieOf,
  Customer,
  CUSTOMER_COOKIE,
  CustomersService,
  normalizePhone,
} from './customers.service';
import { StoreService } from './store.service';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
const phone = z
  .string()
  .trim()
  .max(25)
  .refine((v) => /^[0-9]{10,11}$/.test(normalizePhone(v)), 'Telefone inválido (DDD + número)');
const password = z.string().min(6, 'A senha precisa de pelo menos 6 caracteres').max(200);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido')
  .transform((v) => v || undefined);

const Signup = z.object({
  name: text(80),
  phone,
  email: email.optional(),
  password,
  marketingOptIn: z.boolean().optional(),
});
const Login = z.object({ phone: z.string().trim().max(25), password: z.string().min(1).max(200) });
const Profile = z
  .object({
    name: text(80),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .nullable()
      .refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido')
      .transform((v) => v || null),
    marketingOptIn: z.boolean(),
  })
  .partial();
const Password = z.object({ current: z.string().min(1).max(200), next: password });
const Address = z.object({
  label: optText(30),
  street: text(120),
  number: text(20),
  district: text(80),
  complement: optText(80),
  reference: optText(120),
  isDefault: z.boolean().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
const AddressPatch = Address.partial();

/**
 * Conta do cliente final no cardápio online (/pedir). Rotas públicas para o login da equipe:
 * quem identifica o cliente é o cookie cm_cid, conferido aqui.
 */
@Controller({ path: 'store/account', version: '1' })
export class AccountController {
  constructor(
    private readonly customers: CustomersService,
    private readonly store: StoreService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setCookie(res: Response, s: { token: string; expiresAt: Date }) {
    // Host-only (sem Domain): a conta é deste restaurante e não vaza para outros subdomínios.
    res.cookie(CUSTOMER_COOKIE, s.token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: s.expiresAt,
    });
  }

  private async who(t: ResolvedTenant, req: Request): Promise<Customer> {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    if (!c) throw new UnauthorizedException('Entre na sua conta');
    return c;
  }

  /** Conta aberta neste aparelho, ou { customer: null }. Nunca 401: o cardápio chama sempre. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get()
  async me(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    if (!c) return { customer: null, addresses: [] };
    return this.customers.account(t.id, c);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('signup')
  async signup(
    @Body(new ZodPipe(Signup)) b: z.infer<typeof Signup>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.customers.signup(t.id, b, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.setCookie(res, r.session);
    return this.customers.account(t.id, r.customer);
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60_000,
      limit: (ctx) => ctx.switchToHttp().getRequest<Request>().app.locals.loginRateLimit ?? 10,
    },
  })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(Login)) b: z.infer<typeof Login>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.customers.login(t.id, b, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.setCookie(res, r.session);
    return this.customers.account(t.id, r.customer);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.customers.logout(t.id, cookieOf(req, CUSTOMER_COOKIE));
    res.clearCookie(CUSTOMER_COOKIE, { path: '/' });
  }

  @Public()
  @Patch()
  async update(
    @Body(new ZodPipe(Profile)) b: z.infer<typeof Profile>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    const next = await this.customers.updateProfile(t.id, c, b);
    return this.customers.account(t.id, next!);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password')
  @HttpCode(200)
  async password(
    @Body(new ZodPipe(Password)) b: z.infer<typeof Password>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    return this.customers.changePassword(
      t.id,
      c,
      b.current,
      b.next,
      cookieOf(req, CUSTOMER_COOKIE),
    );
  }

  @Public()
  @Post('addresses')
  async addAddress(
    @Body(new ZodPipe(Address)) b: z.infer<typeof Address>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.addAddress(t.id, await this.who(t, req), b);
  }

  @Public()
  @Patch('addresses/:id')
  async updateAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AddressPatch)) b: z.infer<typeof AddressPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.updateAddress(t.id, await this.who(t, req), id, b);
  }

  @Public()
  @Delete('addresses/:id')
  async deleteAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.deleteAddress(t.id, await this.who(t, req), id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('orders')
  async orders(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.customers.orders(t.id, await this.who(t, req));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('orders/:id')
  async order(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    await this.customers.ownOrderId(t.id, c, id);
    return this.store.accountOrder(t.id, t.name, id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    await this.customers.ownOrderId(t.id, c, id);
    return this.store.cancelByCustomer(t.id, { orderId: id }, req.ip);
  }
}

const CustomerPatch = z
  .object({
    staffNotes: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .transform((v) => v || null),
    blocked: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

/** Clientes com conta no cardápio online, vistos pela equipe do restaurante. */
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers:read')
  list(
    @Query('search') search: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.customers.list(ctxOf(t, u), (search ?? '').slice(0, 80));
  }

  @Get(':id')
  @RequirePermission('customers:read')
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.customers.detail(ctxOf(t, u), id);
  }

  @Patch(':id')
  @RequirePermission('customers:manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CustomerPatch)) b: z.infer<typeof CustomerPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.customers.update(ctxOf(t, u, req), id, b);
  }
}
