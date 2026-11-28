import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CUSTOMER_AVATARS, isValidBirthday, isValidCnpj, isValidCpf } from '@comandou/shared';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { newPassword, notPersonal } from '../common/schemas';
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
  MAX_CUSTOMER_PHOTO_BYTES,
  normalizePhone,
} from './customers.service';
import { IMAGE_TYPES, ReceiptDim, sniff } from './store.controller';
import { checkReceipt, PixService } from './pix.service';
import { isUf } from './cep.service';
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
// Senha nova do cliente: 8 caracteres e nada óbvio (quem já tem senha de 6 continua entrando).
const password = newPassword();
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido')
  .transform((v) => v || undefined);

/**
 * CPF do cliente (opcional): só números e com os dígitos certos; vazio apaga. CNPJ também passa
 * (a equipe pode ter cadastrado o da empresa na ficha).
 */
const cpf = z
  .string()
  .trim()
  .max(20)
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => !v || isValidCpf(v) || isValidCnpj(v), 'CPF inválido');

const Signup = z
  .object({
    name: text(80),
    phone,
    email: email.optional(),
    password,
    marketingOptIn: z.boolean().optional(),
    cpf: cpf.transform((v) => v || undefined).optional(),
    /** Código de 6 números que chegou no WhatsApp (quando a loja manda). */
    code: z.string().trim().max(12).optional(),
  })
  .superRefine(
    notPersonal((v) => ({ password: v.password, personal: [v.phone, v.email, v.name] })),
  );
/** Aniversário: dia e mês, ano opcional (null apaga). */
const birthday = z
  .object({
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
  })
  .refine((b) => isValidBirthday(b), 'Data de aniversário inválida')
  .nullable();

const Login = z.object({ phone: z.string().trim().max(25), password: z.string().min(1).max(200) });
/** Token do link de entrada mandado pelo WhatsApp (randomBytes(24) em base64url). */
const LinkLogin = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{24,64}$/) });
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
    cpf: cpf.nullable().transform((v) => v || null),
    /** Avatar desenhado; escolher um tira a foto. null volta para o automático. */
    avatar: z.enum(CUSTOMER_AVATARS).nullable(),
    birthday,
    /** true = não quer receber o parabéns da loja no aniversário. */
    birthdayOptOut: z.boolean(),
  })
  .partial();

/** Confere a foto do perfil enviada no corpo (WebP, JPEG ou PNG de verdade, até 1 MB). */
function checkPhoto(body: unknown, type: string | undefined) {
  const mime = (type ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime) || !Buffer.isBuffer(body))
    throw new UnprocessableEntityException('Envie a foto em JPG, PNG ou WebP');
  if (body.length === 0 || body.length > MAX_CUSTOMER_PHOTO_BYTES)
    throw new UnprocessableEntityException('Foto vazia ou maior que 1 MB');
  if (sniff(body) !== mime)
    throw new UnprocessableEntityException('O arquivo não é uma foto válida');
  return { mime, bytes: body };
}

function sendPhoto(res: Response, f: { type: string; bytes: Buffer }) {
  res.setHeader('Content-Type', f.type);
  // A URL muda a cada foto nova (?v=), então pode guardar; é privada (cliente ou equipe).
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(f.bytes.length));
  res.end(f.bytes);
}
/** `current` ficou opcional e é ignorado: o cliente já entrou, só escolhe a nova. */
const Password = z.object({ current: z.string().max(200).optional(), next: password });
const Forgot = z.object({ phone: z.string().trim().max(25) });
const Reset = z
  .object({
    phone: z.string().trim().max(25),
    code: z.string().trim().max(12),
    password,
  })
  .superRefine(notPersonal((v) => ({ password: v.password, personal: [v.phone] })));
const Address = z.object({
  label: optText(30),
  street: text(120),
  number: text(20),
  district: text(80),
  complement: optText(80),
  reference: optText(120),
  cep: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => !v || v.length === 8, 'CEP com 8 dígitos')
    .nullable()
    .optional()
    .transform((v) => v || null),
  city: optText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || isUf(v), 'UF inválida')
    .nullable()
    .optional()
    .transform((v) => v || null),
  isDefault: z.boolean().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
const AddressPatch = Address.partial();

/**
 * Sacola guardada na conta: as linhas como o cardápio monta. Só serve para lembrar a escolha;
 * no pedido o servidor confere produto, opções e preço de novo.
 */
const CartLines = z.object({
  lines: z
    .array(
      z.object({
        key: z.string().max(2000),
        productId: z.string().uuid(),
        name: z.string().max(200),
        imageUrl: z.string().max(1000).nullable(),
        unit: z.string().max(20),
        optionIds: z.array(z.string().uuid()).max(50),
        optionNames: z.array(z.string().max(200)).max(50),
        quantity: z.number().positive().max(50),
        weight: z.boolean().optional(),
        notes: z.string().max(200),
      }),
    )
    .max(60),
});

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
    private readonly pix: PixService,
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

  /** Cadastro, passo 1: código pelo WhatsApp da loja para confirmar o celular. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('signup/code')
  @HttpCode(200)
  signupCode(
    @Body(new ZodPipe(Forgot)) b: z.infer<typeof Forgot>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.requestSignupCode(t.id, t.name, b.phone, req.ip);
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

  /**
   * Entrada pelo link que o WhatsApp da loja mandou ao próprio número da conta (0.280): o cliente
   * abre o cardápio já dentro dela e vê a sacola montada na conversa. Uso único, 30 minutos.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('link')
  @HttpCode(200)
  async linkLogin(
    @Body(new ZodPipe(LinkLogin)) b: z.infer<typeof LinkLogin>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.customers.loginByLink(t.id, b.token, {
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

  /** Foto do perfil: o corpo é a própria imagem (recortada e reduzida no navegador). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Put('photo')
  async putPhoto(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    const next = await this.customers.setPhoto(t.id, c, checkPhoto(body, type));
    return this.customers.account(t.id, next);
  }

  @Public()
  @Delete('photo')
  async deletePhoto(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    const c = await this.who(t, req);
    const next = await this.customers.setPhoto(t.id, c, null);
    return this.customers.account(t.id, next);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('photo')
  async photo(@CurrentTenant() t: ResolvedTenant, @Req() req: Request, @Res() res: Response) {
    const c = await this.who(t, req);
    sendPhoto(res, await this.customers.photo({ tenantId: t.id }, c.id));
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
    return this.customers.changePassword(t.id, c, b.next, cookieOf(req, CUSTOMER_COOKIE));
  }

  /** Esqueci minha senha: manda um código pelo WhatsApp da loja (ou diz para falar com ela). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('password/forgot')
  @HttpCode(200)
  forgot(
    @Body(new ZodPipe(Forgot)) b: z.infer<typeof Forgot>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.requestReset(t.id, t.name, b.phone, req.ip);
  }

  /** Nova senha com o código recebido. Já entra na conta neste aparelho. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password/reset')
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(Reset)) b: z.infer<typeof Reset>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.customers.resetPassword(t.id, b, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.setCookie(res, r.session);
    return this.customers.account(t.id, r.customer);
  }

  /** Sacola salva na conta (para juntar com a do aparelho ao entrar). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('cart')
  async cart(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.customers.cart(t.id, await this.who(t, req));
  }

  /** Guarda a sacola na conta a cada mudança (o cardápio manda com um pequeno atraso). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Put('cart')
  async saveCart(
    @Body(new ZodPipe(CartLines)) b: z.infer<typeof CartLines>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    return this.customers.saveCart(t.id, await this.who(t, req), b.lines);
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

  /** Mesa com o cliente buscando no balcão: "Já peguei" pelo histórico da conta. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/:id/picked-up')
  @HttpCode(200)
  async pickedUp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.who(t, req);
    await this.customers.ownOrderId(t.id, c, id);
    return this.store.pickedUpByCustomer(t.id, { orderId: id }, req.ip);
  }

  /** Comprovante do Pix pelo histórico da conta (mesmo que pelo link do pedido). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/:id/pix-receipt')
  @HttpCode(200)
  async pixReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(ReceiptDim)) width: number | undefined,
    @Query('h', new ZodPipe(ReceiptDim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const f = checkReceipt(body, type);
    const c = await this.who(t, req);
    await this.customers.ownOrderId(t.id, c, id);
    return this.pix.submit(t.id, { orderId: id }, { ...f, width, height }, req.ip);
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
    /** CPF ou CNPJ (destinatário da nota fiscal). */
    document: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().regex(/^([0-9]{11}|[0-9]{14})?$/, 'CPF com 11 dígitos ou CNPJ com 14'))
      .nullable()
      .transform((v) => v || null),
    stateRegistration: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => (v === 'ISENTO' ? v : v.replace(/\D/g, '')))
      .pipe(
        z.string().regex(/^([0-9]{2,14}|ISENTO)?$/, 'Inscrição estadual só com números ou ISENTO'),
      )
      .nullable()
      .transform((v) => v || null),
    ieIndicator: z.union([z.literal(1), z.literal(2), z.literal(9)]).nullable(),
    birthday,
    birthdayOptOut: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const NewCustomer = z.object({ name: text(80), phone });

/** Clientes do restaurante (conta no cardápio online ou cadastro da equipe no pedido). */
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** `limit` (1 a 300) encurta a lista: o pedido mostra só os clientes mais recentes. */
  @Get()
  @RequirePermission('customers:read')
  list(
    @Query('search') search: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const n = Number.parseInt(limit ?? '', 10);
    return this.customers.list(
      ctxOf(t, u),
      (search ?? '').slice(0, 80),
      Number.isFinite(n) ? Math.min(Math.max(n, 1), 300) : 300,
    );
  }

  /**
   * Cadastro rápido pela equipe ao lançar um pedido: nome e telefone. Telefone que já tem
   * cadastro devolve o cliente existente (`existing: true`) em vez de criar outro.
   */
  @Post()
  @RequirePermission('customers:create')
  create(
    @Body(new ZodPipe(NewCustomer)) b: z.infer<typeof NewCustomer>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.customers.staffCreate(ctxOf(t, u, req), b);
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

  /** Foto do perfil do cliente (quando ele pôs uma). */
  @Get(':id/photo')
  @RequirePermission('customers:read')
  async photo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
  ) {
    sendPhoto(res, await this.customers.photo(ctxOf(t, u), id));
  }

  /** Código para o cliente criar uma senha nova (a equipe passa para ele). */
  @Post(':id/reset-code')
  @HttpCode(200)
  @RequirePermission('customers:manage')
  resetCode(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.customers.staffResetCode(ctxOf(t, u, req), id);
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
