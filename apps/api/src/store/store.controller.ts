import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { roleHas } from '@comandou/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { requireKey } from '../common/idempotency';
import { money, uuid } from '../common/schemas';
import { one } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { CepService, isUf } from './cep.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from './customers.service';
import {
  CORNER_STYLES,
  FONT_STYLES,
  mediaUrl,
  PUBLIC_TOKEN_RE,
  StoreService,
} from './store.service';

/** Cor em #rrggbb (minúsculas); vazio volta para as cores do Comandou. */
const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'cor inválida (use #rrggbb)')
  .nullable();

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const OnlineOrder = z
  .object({
    /** table = cliente sentado, pelo QR Code da mesa: o pedido vai para a comanda dela. */
    channel: z.enum(['delivery', 'pickup', 'table']),
    tableId: uuid.optional(),
    token: z.string().regex(PUBLIC_TOKEN_RE, 'token inválido'),
    customerName: text(80),
    // Na mesa o telefone é opcional (o garçom leva até ela); na entrega e na retirada, obrigatório.
    customerPhone: z
      .string()
      .trim()
      .regex(/^[0-9()+\s-]{8,20}$/, 'telefone inválido')
      .optional(),
    address: z
      .object({
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
          .optional()
          .transform((v) => v || undefined),
        city: optText(80),
        state: z
          .string()
          .trim()
          .toUpperCase()
          .refine((v) => !v || isUf(v), 'UF inválida')
          .optional()
          .transform((v) => v || undefined),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .optional(),
    notes: optText(300),
    // Na mesa a conta é paga no fim, com o garçom ou no caixa: sem forma de pagamento no pedido.
    paymentMethod: z.enum(['cash', 'credit', 'debit', 'pix', 'voucher']).optional(),
    changeFor: money.optional(),
    items: z
      .array(
        z.object({
          productId: uuid,
          // Unidades (1 a 50) ou, no item vendido por peso, o peso em kg (0,1 a 5 kg, até 3 casas).
          // A API confere item a item qual das duas vale.
          quantity: z
            .number()
            .positive()
            .max(50)
            .refine(
              (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6,
              'até 3 casas decimais',
            ),
          notes: optText(200),
          optionIds: z.array(uuid).max(50).optional(),
        }),
      )
      .min(1)
      .max(60),
    /** Recompensa do programa de fidelidade (só com a conta aberta). */
    rewardId: uuid.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.channel === 'table') {
      if (!o.tableId)
        ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Informe a mesa' });
      return;
    }
    if (!o.customerPhone)
      ctx.addIssue({ code: 'custom', path: ['customerPhone'], message: 'telefone inválido' });
    if (!o.paymentMethod)
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: 'Escolha a forma de pagamento',
      });
  });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM');

const Settings = z
  .object({
    enabled: z.boolean(),
    isOpen: z.boolean(),
    autoAccept: z.boolean(),
    acceptsDelivery: z.boolean(),
    acceptsPickup: z.boolean(),
    deliveryFee: money,
    minOrder: money,
    etaMin: z.number().int().min(1).max(600),
    etaMax: z.number().int().min(1).max(600),
    about: z.string().trim().max(500).nullable(),
    address: z.string().trim().max(300).nullable(),
    whatsapp: z.string().trim().max(30).nullable(),
    city: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .transform((v) => v || null),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .nullable()
      .refine((v) => !v || isUf(v), 'UF inválida')
      .transform((v) => v || null),
    coverImageId: uuid.nullable(),
    logoImageId: uuid.nullable(),
    theme: z.enum(['auto', 'light', 'dark']),
    headline: z
      .string()
      .trim()
      .max(60)
      .nullable()
      .transform((v) => v || null),
    featuredTitle: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .transform((v) => v || null),
    accountsEnabled: z.boolean(),
    showPopular: z.boolean(),
    chatEnabled: z.boolean(),
    chatGreeting: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .transform((v) => v || null),
    storeLat: z
      .number()
      .min(-90)
      .max(90)
      .nullable()
      .transform((n) => (n === null ? null : n.toFixed(6))),
    storeLng: z
      .number()
      .min(-180)
      .max(180)
      .nullable()
      .transform((n) => (n === null ? null : n.toFixed(6))),
    brandColor: hexColor,
    accentColor: hexColor,
    fontStyle: z.enum(FONT_STYLES),
    cornerStyle: z.enum(CORNER_STYLES),
    faviconImageId: uuid.nullable(),
    brandStaffApp: z.boolean(),
    hoursEnabled: z.boolean(),
    hours: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            open: hhmm,
            close: hhmm,
          })
          .strict(),
      )
      .max(21),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const nullText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const BannerFields = z.object({
  title: text(60),
  subtitle: nullText(120),
  tag: nullText(24),
  cta: nullText(24),
  imageId: uuid.nullable(),
  targetType: z.enum(['none', 'product', 'category']),
  targetId: uuid.nullable(),
  active: z.boolean(),
  position: z.number().int().min(0).max(10_000),
});
const BannerCreate = BannerFields.partial().required({ title: true });
const BannerUpdate = BannerFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);

/** Campos que a operação (caixa/atendente) pode mudar direto da tela de pedidos. */
const OPERATIONAL = new Set(['isOpen', 'autoAccept']);

/** Cardápio online: rotas públicas (cliente final, sem login) no host do restaurante. */
@Controller({ path: 'store', version: '1' })
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly customers: CustomersService,
    private readonly cep: CepService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get()
  menu(@CurrentTenant() t: ResolvedTenant, @Query('mesa') mesa: string | undefined) {
    // ?mesa=<id>: cliente que leu o QR Code da mesa (preços do salão e a mesa escolhida).
    return this.store.publicMenu(t.id, t.name, t.slug, typeof mesa === 'string' ? mesa : undefined);
  }

  /** Situação da loja (aberta/fechada): leve, para o cardápio aberto se atualizar sozinho. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('status')
  status(@CurrentTenant() t: ResolvedTenant) {
    return this.store.publicStatus(t.id);
  }

  /**
   * Cores, fonte, cantos e ícone do restaurante. Pública e separada do cardápio: vale também
   * com a loja online desligada (login e sistema da equipe usam).
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('branding')
  branding(@CurrentTenant() t: ResolvedTenant, @Res({ passthrough: true }) res: Response) {
    // Cor salva tem de valer na hora em todas as telas: nada de cache no navegador/proxy.
    res.setHeader('Cache-Control', 'no-store');
    return this.store.branding(t.id);
  }

  /** Manifesto do app instalado: nome, cor e ícone da loja (cada restaurante tem o seu). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('manifest')
  async manifest(
    @CurrentTenant() t: ResolvedTenant,
    @Query('start') start: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    // Atalho do link do entregador abre direto nas corridas dele (só esse endereço é aceito).
    const courier = start && /^\/entregador\/[A-Za-z0-9_-]{20,64}$/.test(start) ? start : null;
    return this.store.manifest(t.id, t.name, courier);
  }

  /** Cidade e UF do restaurante (ponto de partida para achar o CEP pela rua). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('region')
  region(@CurrentTenant() t: ResolvedTenant) {
    return this.store.region(t.id);
  }

  /** Endereço pelo CEP (rua, bairro, cidade e UF). 404 se o CEP não existe. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Get('cep/:cep')
  async cepLookup(@Param('cep') raw: string) {
    if (!/^[0-9]{5}-?[0-9]{3}$/.test(raw))
      throw new UnprocessableEntityException('CEP com 8 dígitos');
    const a = await this.cep.lookup(raw);
    if (!a) throw new NotFoundException('CEP não encontrado');
    return a;
  }

  /** CEPs de uma rua (o cardápio sugere enquanto o cliente digita o nome da rua). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  @Get('cep')
  cepSearch(@Query('street') street = '', @Query('city') city = '', @Query('state') state = '') {
    return this.cep.search(String(state).slice(0, 2), String(city), String(street));
  }

  /** Cria o pedido do cliente. Exige `Idempotency-Key` (reenvio não duplica o pedido). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post('orders')
  async place(
    @Body(new ZodPipe(OnlineOrder)) b: z.infer<typeof OnlineOrder>,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    // Com a conta aberta, o pedido entra no histórico do cliente.
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    const order = await this.store.placeOrder(
      t.id,
      { ...b, customerId: c?.id },
      requireKey(key),
      req.ip,
    );
    // Pedido feito: a sacola guardada na conta esvazia (o aparelho também limpa a dele).
    if (c) await this.customers.saveCart(t.id, c, []).catch(() => undefined);
    return order;
  }

  /** Programa de fidelidade: regra e recompensas; com a conta aberta, saldo e extrato. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('loyalty')
  async loyaltyView(@CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    return this.loyalty.publicView(t.id, c?.id ?? null);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('orders/:token')
  order(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    return this.store.publicOrder(t.id, t.name, token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/:token/cancel')
  @HttpCode(200)
  cancel(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.store.cancelByCustomer(t.id, token, req.ip);
  }

  @Get('settings')
  @RequirePermission('orders:read', 'settings:manage')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.store.settings(ctxOf(t, u));
  }

  @Patch('settings')
  @RequirePermission('orders:manage', 'settings:manage')
  update(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const onlyOperational = Object.keys(b).every((k) => OPERATIONAL.has(k));
    if (!onlyOperational && !roleHas(u.role, 'settings:manage'))
      throw new ForbiddenException('Só quem gerencia as configurações altera a loja online');
    return this.store.updateSettings(ctxOf(t, u, req), b);
  }

  @Get('banners')
  @RequirePermission('settings:manage')
  banners(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.store.listBanners(ctxOf(t, u));
  }

  @Post('banners')
  @RequirePermission('settings:manage')
  createBanner(
    @Body(new ZodPipe(BannerCreate)) b: z.infer<typeof BannerCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.store.createBanner(ctxOf(t, u, req), b);
  }

  @Patch('banners/:id')
  @RequirePermission('settings:manage')
  updateBanner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(BannerUpdate)) b: z.infer<typeof BannerUpdate>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.store.updateBanner(ctxOf(t, u, req), id, b);
  }

  @Delete('banners/:id')
  @RequirePermission('settings:manage')
  deleteBanner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.store.deleteBanner(ctxOf(t, u, req), id);
  }
}

export const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGES_PER_TENANT = 3000;

/** Confere a assinatura do arquivo: o Content-Type do cliente não basta. */
export function sniff(b: Buffer): string | null {
  if (
    b.length > 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a)
    return 'image/png';
  return null;
}

const Dim = z.coerce.number().int().min(1).max(4096).optional();

/**
 * Fotos do restaurante. O navegador reduz a imagem (WebP, até 1600 px) antes de enviar; aqui só
 * conferimos tipo e tamanho e guardamos no banco. A leitura é pública (o cardápio online usa) e
 * imutável: trocar a foto gera outro id.
 */
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermission('catalog:write', 'settings:manage')
  async upload(
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('w', new ZodPipe(Dim)) width: number | undefined,
    @Query('h', new ZodPipe(Dim)) height: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const mime = (type ?? '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime) || !Buffer.isBuffer(body))
      throw new UnprocessableEntityException('Envie a imagem em WebP, JPEG ou PNG');
    if (body.length === 0 || body.length > MAX_IMAGE_BYTES)
      throw new UnprocessableEntityException('Imagem vazia ou maior que 3 MB');
    if (sniff(body) !== mime)
      throw new UnprocessableEntityException('O arquivo não é uma imagem válida');
    const row = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM media`);
      if (n!.n >= MAX_IMAGES_PER_TENANT)
        throw new UnprocessableEntityException('Limite de imagens atingido; apague fotos antigas');
      const m = await one<{ id: string }>(
        tx,
        `INSERT INTO media (tenant_id, content_type, bytes, size, width, height, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [t.id, mime, body, body.length, width ?? null, height ?? null, u.id],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'media.uploaded',
        entity: 'media',
        entityId: m!.id,
        data: { size: body.length, type: mime },
        ip: req.ip,
      });
      return m!;
    });
    return { id: row.id, url: mediaUrl(row.id) };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @Res() res: Response,
  ) {
    const m = await this.db.withTenant({ tenantId: t.id }, (tx) =>
      one<{ content_type: string; bytes: Buffer }>(
        tx,
        `SELECT content_type, bytes FROM media WHERE id = $1`,
        [id],
      ),
    );
    if (!m) throw new NotFoundException('Imagem não encontrada');
    res.setHeader('Content-Type', m.content_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', String(m.bytes.length));
    res.end(m.bytes);
  }
}
