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
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from './customers.service';
import { mediaUrl, PUBLIC_TOKEN_RE, StoreService } from './store.service';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const OnlineOrder = z.object({
  channel: z.enum(['delivery', 'pickup']),
  token: z.string().regex(PUBLIC_TOKEN_RE, 'token inválido'),
  customerName: text(80),
  customerPhone: z
    .string()
    .trim()
    .regex(/^[0-9()+\s-]{8,20}$/, 'telefone inválido'),
  address: z
    .object({
      street: text(120),
      number: text(20),
      district: text(80),
      complement: optText(80),
      reference: optText(120),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .optional(),
  notes: optText(300),
  paymentMethod: z.enum(['cash', 'credit', 'debit', 'pix', 'voucher']),
  changeFor: money.optional(),
  items: z
    .array(
      z.object({
        productId: uuid,
        quantity: z.number().int().min(1).max(50),
        notes: optText(200),
        optionIds: z.array(uuid).max(50).optional(),
      }),
    )
    .min(1)
    .max(60),
});

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
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get()
  menu(@CurrentTenant() t: ResolvedTenant) {
    return this.store.publicMenu(t.id, t.name, t.slug);
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
    return this.store.placeOrder(t.id, { ...b, customerId: c?.id }, requireKey(key), req.ip);
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
  @RequirePermission('orders:write', 'settings:manage')
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

const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES_PER_TENANT = 3000;

/** Confere a assinatura do arquivo: o Content-Type do cliente não basta. */
function sniff(b: Buffer): string | null {
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
