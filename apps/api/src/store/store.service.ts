import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  customerStep,
  formatPixKey,
  fromCents,
  toCents,
  normalizePixKey,
  PIX_KEY_TYPE_LABELS,
  pixBrCode,
  storeRules,
  storeSchedule,
  type PixKeyType,
  type StoreSchedule,
  type PixReceiptStatus,
} from '@comandou/shared';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Ctx, onlineCtx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OnlinePayService } from '../online-pay/online-pay.service';
import { ZonesService } from '../delivery/zones.service';
import { distanceM, locateContext } from '../delivery/zones';
import { GeocoderService } from '../delivery/geocoder.service';
import { customerMapOf } from '../delivery/delivery.service';
import { menuTreeSql } from '../catalog/menu-sql';
import { modelUrls } from '../catalog/models.controller';
import { LinkPreview, oneLine, PRODUCT_PATH_RE } from './link-preview';
import { SiteCopy } from '../chat/site-page';

export const mediaUrl = (id: string | null | undefined) => (id ? `/api/v1/media/${id}` : null);
/** O pedido da mesa saiu do acompanhamento: a conta foi fechada e ele terminou. */
export const TABLE_CLOSED_CODE = 'table_closed';

/**
 * Pedido da mesa (QR Code) cuja conta já foi fechada e que terminou (entregue ou cancelado). O
 * que ainda está na cozinha segue no acompanhamento até sair (o Pix aprovado fecha a comanda com
 * pedido em preparo, e o cliente pode estar esperando para buscar no balcão).
 */
export async function tableBillEndedIn(tx: Tx, orderId: string): Promise<boolean> {
  return !!(await one(
    tx,
    `SELECT 1 FROM orders o JOIN tabs tb ON tb.id = o.tab_id
      WHERE o.id = $1 AND o.channel = 'table' AND tb.status <> 'open'
        AND o.status IN ('completed', 'cancelled')`,
    [orderId],
  ));
}

export const publicTokenHash = (token: string) => createHash('sha256').update(token).digest();
export const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoreSettings {
  enabled: boolean;
  isOpen: boolean;
  autoAccept: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string;
  minOrder: string;
  etaMin: number;
  etaMax: number;
  about: string | null;
  address: string | null;
  whatsapp: string | null;
  /** Cidade e UF da loja: o cardápio acha o CEP pelo nome da rua nesta cidade. */
  city: string | null;
  state: string | null;
  coverImageId: string | null;
  logoImageId: string | null;
  theme: 'auto' | 'light' | 'dark';
  headline: string | null;
  featuredTitle: string | null;
  accountsEnabled: boolean;
  /** Aba Perfil no cardápio da mesa (com as contas ligadas). */
  tableAccount: boolean;
  /** Cupons da conta no pedido da mesa (com o Perfil na mesa). */
  tableCoupons: boolean;
  showPopular: boolean;
  /** Conversa do cliente com a loja no cardápio (no lugar de levar ao WhatsApp). */
  chatEnabled: boolean;
  /** Boas-vindas que o cliente vê ao abrir a conversa (null = texto padrão). */
  chatGreeting: string | null;
  /** Ponto da loja no mapa (centro das áreas por raio e referência da busca de endereço). */
  storeLat: string | null;
  storeLng: string | null;
  /** Identidade visual: cores em #rrggbb (null = cores do Comandou), fonte, cantos e ícone. */
  brandColor: string | null;
  accentColor: string | null;
  fontStyle: FontStyle;
  cornerStyle: CornerStyle;
  faviconImageId: string | null;
  /** As cores valem também no sistema da equipe. */
  brandStaffApp: boolean;
  /** Horário de funcionamento: fora dele a loja fica fechada sozinha, mesmo com isOpen ligado. */
  hoursEnabled: boolean;
  hours: StoreHour[];
  /**
   * Pix pelo cardápio (sem banco nem intermediário): com a chave preenchida e ligado, quem escolhe
   * Pix no checkout vê o QR Code com o valor e manda o comprovante; a equipe confere no PDV.
   */
  pixEnabled: boolean;
  pixKeyType: PixKeyType | null;
  /** Já no formato do Pix (só dígitos, +55..., minúsculas): conferido em updateSettings. */
  pixKey: string | null;
  pixName: string | null;
  pixCity: string | null;
  /** Pedido pelo QR Code da mesa só com a localização do celular perto do ponto da loja. */
  tableCheckLocation: boolean;
  /** Pedido da mesa pronto: o cliente busca no balcão (em vez de o garçom levar). */
  tableSelfPickup: boolean;
}

/** Um turno do dia da semana (0 = domingo). close menor que open = vira a meia-noite. */
export interface StoreHour {
  day: number;
  open: string;
  close: string;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * A loja está dentro do horário em `dow` (0 = domingo) às `hhmm` (hora local do restaurante)?
 * Um turno que passa da meia-noite (ex.: 18:00 a 02:00) vale também na madrugada do dia seguinte.
 */
export function withinHours(hours: StoreHour[], dow: number, hhmm: string): boolean {
  const now = minutes(hhmm);
  const yesterday = (dow + 6) % 7;
  return hours.some((h) => {
    const open = minutes(h.open);
    const close = minutes(h.close);
    if (close > open) return h.day === dow && now >= open && now < close;
    // Turno que vira a noite (ou 24h quando open = close).
    if (h.day === dow && now >= open) return true;
    return h.day === yesterday && now < close;
  });
}

export const FONT_STYLES = ['padrao', 'sistema', 'classica', 'arredondada'] as const;
export const CORNER_STYLES = ['padrao', 'reto', 'arredondado'] as const;
export type FontStyle = (typeof FONT_STYLES)[number];
export type CornerStyle = (typeof CORNER_STYLES)[number];

/** O que o navegador precisa para vestir a loja com a identidade do restaurante. */
export interface Branding {
  brandColor: string | null;
  accentColor: string | null;
  fontStyle: FontStyle;
  cornerStyle: CornerStyle;
  faviconUrl: string | null;
  logoUrl: string | null;
  staffApp: boolean;
}

export const brandingOf = (s: StoreSettings): Branding => ({
  brandColor: s.brandColor,
  accentColor: s.accentColor,
  fontStyle: s.fontStyle,
  cornerStyle: s.cornerStyle,
  faviconUrl: mediaUrl(s.faviconImageId ?? s.logoImageId),
  logoUrl: mediaUrl(s.logoImageId),
  staffApp: s.brandStaffApp,
});

export interface BannerInput {
  title: string;
  subtitle: string | null;
  tag: string | null;
  cta: string | null;
  imageId: string | null;
  targetType: 'none' | 'product' | 'category';
  targetId: string | null;
  active: boolean;
  position: number;
}
const BANNER_COLS = `id, title, subtitle, tag, cta, image_id AS "imageId", target_type AS "targetType",
  target_id AS "targetId", active, position`;
const MAX_BANNERS = 12;

const SETTINGS_COLS = `enabled, is_open AS "isOpen", auto_accept AS "autoAccept",
  accepts_delivery AS "acceptsDelivery", accepts_pickup AS "acceptsPickup",
  delivery_fee::text AS "deliveryFee", min_order::text AS "minOrder", eta_min AS "etaMin",
  eta_max AS "etaMax", about, address, whatsapp, city, state, cover_image_id AS "coverImageId",
  logo_image_id AS "logoImageId", theme, headline, featured_title AS "featuredTitle",
  accounts_enabled AS "accountsEnabled", show_popular AS "showPopular",
  chat_enabled AS "chatEnabled", chat_greeting AS "chatGreeting",
  store_lat::text AS "storeLat", store_lng::text AS "storeLng", brand_color AS "brandColor",
  accent_color AS "accentColor", font_style AS "fontStyle", corner_style AS "cornerStyle",
  favicon_image_id AS "faviconImageId", brand_staff_app AS "brandStaffApp",
  hours_enabled AS "hoursEnabled", hours, pix_enabled AS "pixEnabled",
  pix_key_type AS "pixKeyType", pix_key AS "pixKey", pix_name AS "pixName", pix_city AS "pixCity",
  table_check_location AS "tableCheckLocation", table_self_pickup AS "tableSelfPickup",
  table_account AS "tableAccount", table_coupons AS "tableCoupons"`;

const DEFAULTS: StoreSettings = {
  enabled: true,
  isOpen: true,
  autoAccept: false,
  acceptsDelivery: true,
  acceptsPickup: true,
  deliveryFee: '0.00',
  minOrder: '0.00',
  etaMin: 30,
  etaMax: 50,
  about: null,
  address: null,
  whatsapp: null,
  city: null,
  state: null,
  coverImageId: null,
  logoImageId: null,
  theme: 'auto',
  headline: null,
  featuredTitle: null,
  accountsEnabled: true,
  tableAccount: true,
  tableCoupons: true,
  showPopular: true,
  chatEnabled: true,
  chatGreeting: null,
  storeLat: null,
  storeLng: null,
  brandColor: null,
  accentColor: null,
  fontStyle: 'padrao',
  cornerStyle: 'padrao',
  faviconImageId: null,
  brandStaffApp: true,
  hoursEnabled: false,
  hours: [],
  pixEnabled: false,
  pixKeyType: null,
  pixKey: null,
  pixName: null,
  pixCity: null,
  tableCheckLocation: true,
  tableSelfPickup: false,
};

const COLUMN: Record<keyof StoreSettings, string> = {
  enabled: 'enabled',
  isOpen: 'is_open',
  autoAccept: 'auto_accept',
  acceptsDelivery: 'accepts_delivery',
  acceptsPickup: 'accepts_pickup',
  deliveryFee: 'delivery_fee',
  minOrder: 'min_order',
  etaMin: 'eta_min',
  etaMax: 'eta_max',
  about: 'about',
  address: 'address',
  whatsapp: 'whatsapp',
  city: 'city',
  state: 'state',
  coverImageId: 'cover_image_id',
  logoImageId: 'logo_image_id',
  theme: 'theme',
  headline: 'headline',
  featuredTitle: 'featured_title',
  accountsEnabled: 'accounts_enabled',
  tableAccount: 'table_account',
  tableCoupons: 'table_coupons',
  showPopular: 'show_popular',
  chatEnabled: 'chat_enabled',
  chatGreeting: 'chat_greeting',
  storeLat: 'store_lat',
  storeLng: 'store_lng',
  brandColor: 'brand_color',
  accentColor: 'accent_color',
  fontStyle: 'font_style',
  cornerStyle: 'corner_style',
  faviconImageId: 'favicon_image_id',
  brandStaffApp: 'brand_staff_app',
  hoursEnabled: 'hours_enabled',
  hours: 'hours',
  pixEnabled: 'pix_enabled',
  pixKeyType: 'pix_key_type',
  pixKey: 'pix_key',
  pixName: 'pix_name',
  pixCity: 'pix_city',
  tableCheckLocation: 'table_check_location',
  tableSelfPickup: 'table_self_pickup',
};

/** Comprovantes por pedido (o cliente reenvia se a loja recusar). */
export const MAX_PIX_RECEIPTS = 5;

/** Pino mais longe que isso do endereço digitado (achado no mapa) é conferido. */
export const PIN_DRIFT_M = 1_500;

/**
 * Pedido pela mesa: até onde do ponto da loja o celular pode estar. O GPS dentro do salão erra, então
 * a precisão que o próprio celular informa entra na conta (até TABLE_SLACK_M a mais).
 */
export const TABLE_RADIUS_M = 150;
export const TABLE_SLACK_M = 350;

/** Onde o celular do cliente está (o navegador informa a precisão em metros). */
export interface Presence {
  lat: number;
  lng: number;
  accuracy: number;
}

/** A loja confere onde está quem pede pela mesa? (ligado e com o ponto marcado no mapa) */
export const checksTableLocation = (s: StoreSettings) =>
  s.tableCheckLocation && !!s.storeLat && !!s.storeLng;

/** O celular está no restaurante? Sem conferência (desligada ou sem o ponto), sempre sim. */
export function tablePresenceOf(s: StoreSettings, p: Presence | undefined) {
  if (!checksTableLocation(s)) return { ok: true, distanceM: null };
  if (!p) return { ok: false, distanceM: null };
  const d = distanceM([Number(s.storeLat), Number(s.storeLng)], [p.lat, p.lng]);
  const slack = Math.min(Math.max(p.accuracy, 0), TABLE_SLACK_M);
  return { ok: d <= TABLE_RADIUS_M + slack, distanceM: Math.round(d) };
}

/** Recusa do pedido pela mesa longe do restaurante: o cardápio reabre a confirmação. */
export const TABLE_LOCATION_CODE = 'table_location';
/** Recusa do que pede a conta do cliente (Pix, reserva): o cardápio leva para o login. */
export const LOGIN_REQUIRED_CODE = 'login_required';

/** Pix da loja para o cardápio: o navegador monta o copia e cola com o valor do pedido. */
export function publicPix(s: StoreSettings) {
  const p = pixPayeeOf(s);
  return p ? { ...p, keyLabel: formatPixKey(p.keyType, p.key) } : null;
}

/** Recebedor do Pix da loja, se o Pix pelo cardápio está ligado e completo. */
export function pixPayeeOf(s: StoreSettings) {
  if (!s.pixEnabled || !s.pixKey || !s.pixKeyType || !s.pixName || !s.pixCity) return null;
  return { keyType: s.pixKeyType, key: s.pixKey, name: s.pixName, city: s.pixCity };
}

export interface OnlineOrderInput {
  /** table = cliente sentado, pelo QR Code da mesa (exige `tableId`). */
  channel: 'delivery' | 'pickup' | 'table';
  tableId?: string;
  token: string;
  customerName: string;
  /** Obrigatório na entrega e na retirada; opcional na mesa. */
  customerPhone?: string;
  /** CPF (só dígitos, já conferido): obrigatório na mesa. */
  customerCpf?: string;
  address?: {
    street: string;
    number: string;
    district: string;
    complement?: string;
    reference?: string;
    cep?: string;
    city?: string;
    state?: string;
    lat?: number;
    lng?: number;
  };
  notes?: string;
  /** Obrigatório na entrega e na retirada; na mesa a conta é paga no fim. */
  paymentMethod?: 'cash' | 'credit' | 'debit' | 'pix' | 'voucher';
  /** Crédito pago agora pelo app (PagBank), e não na entrega. */
  payInApp?: boolean;
  changeFor?: string;
  items: { productId: string; quantity: number; notes?: string; optionIds?: string[] }[];
  /** Cliente com a conta aberta (cookie cm_cid). */
  customerId?: string;
  /** Recompensa do programa de fidelidade trocada no pedido. */
  rewardId?: string;
  /** Cupom da loja (aba Cupons). */
  couponCode?: string;
  /** Mesa: onde o celular está (a loja confere com o ponto dela no mapa). */
  presence?: Presence;
}

/** Loja online: configurações, cardápio público e pedidos feitos pelo cliente final. */
/** Por quanto tempo o "Mais pedidos" do cardápio vale sem refazer a conta. */
const POPULAR_TTL_MS = 5 * 60_000;
const POPULAR_CACHE_MAX = 5_000;

@Injectable()
export class StoreService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly zones: ZonesService,
    private readonly onlinePay: OnlinePayService,
    @Optional() private readonly geocoder?: GeocoderService,
  ) {
    realtime.onCacheClear((tenantId) => this.popularCache.delete(tenantId));
  }

  /**
   * "Mais pedidos" de cada restaurante, guardado por alguns minutos: a conta varre 30 dias de
   * pedidos e o cardápio é aberto a cada visita (e a cada recarregar). Muda devagar, então uns
   * minutos de atraso não aparecem para o cliente.
   */
  private readonly popularCache = new Map<string, { at: number; ids: string[] }>();

  private readonly openHooks: ((
    tenantId: string,
    userId: string | null,
    isOpen: boolean,
  ) => Promise<void>)[] = [];

  /** "Loja aberta" mudou (aplicativos de delivery pausam ou reabrem junto). Roda depois de gravar. */
  onOpenChanged(fn: (tenantId: string, userId: string | null, isOpen: boolean) => Promise<void>) {
    this.openHooks.push(fn);
  }

  async settingsIn(tx: Tx): Promise<StoreSettings> {
    const s = await one<StoreSettings>(tx, `SELECT ${SETTINGS_COLS} FROM tenant_store_settings`);
    return s ?? { ...DEFAULTS };
  }

  /**
   * A loja recebe pedido agora? O botão "aberta" ligado e, com horário configurado, dentro do
   * horário na hora local do restaurante.
   */
  async openNowIn(tx: Tx, s: StoreSettings): Promise<boolean> {
    if (!s.isOpen) return false;
    if (!s.hoursEnabled) return true;
    const now = await one<{ dow: number; hhmm: string }>(
      tx,
      `SELECT extract(dow FROM now() AT TIME ZONE z.tz)::int AS dow,
              to_char(now() AT TIME ZONE z.tz, 'HH24:MI') AS hhmm
         FROM (SELECT COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()),
                               'America/Sao_Paulo') AS tz) z`,
    );
    return withinHours(s.hours ?? [], now!.dow, now!.hhmm);
  }

  /**
   * Faixa da loja no app: aberta até que horas ou quando abre de novo (hora local do
   * restaurante). Sem horário ligado, só o aberto/fechado do botão.
   */
  async scheduleIn(tx: Tx, s: StoreSettings, openNow: boolean): Promise<StoreSchedule> {
    if (!s.hoursEnabled || !s.hours?.length) return { closesAt: null, opensAt: null };
    const now = await one<{ dow: number; hhmm: string }>(
      tx,
      `SELECT extract(dow FROM now() AT TIME ZONE z.tz)::int AS dow,
              to_char(now() AT TIME ZONE z.tz, 'HH24:MI') AS hhmm
         FROM (SELECT COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()),
                               'America/Sao_Paulo') AS tz) z`,
    );
    // Botão "loja fechada" desligado à mão no meio do turno: não promete horário de abrir hoje.
    if (!openNow && !s.isOpen) return { closesAt: null, opensAt: null };
    return storeSchedule(s.hours, now!.dow, now!.hhmm, openNow);
  }

  /** A loja com o "recebe agora" e se a página do restaurante (/site) já foi criada. */
  private async withOpenNow(tx: Tx) {
    const s = await this.settingsIn(tx);
    const row = await one<{ site: unknown }>(tx, `SELECT site FROM tenant_store_settings`);
    return {
      ...s,
      openNow: await this.openNowIn(tx, s),
      hasSite: SiteCopy.safeParse(row?.site).success,
    };
  }

  settings(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.withOpenNow(tx));
  }

  /** Identidade visual (pública: o login e o cardápio usam antes de qualquer sessão). */
  branding(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => brandingOf(await this.settingsIn(tx)));
  }

  /**
   * Página do restaurante (<endereço>/site): os textos guardados e, lidos na hora, o cadastro da
   * loja (logo, capa, contato, horário) e até 8 itens do cardápio, os destaques primeiro. Vale
   * mesmo com o cardápio online desligado (aí a página não mostra o botão de pedir).
   */
  publicSite(tenantId: string, tenantName: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const row = await one<{ site: unknown; updatedAt: Date | null }>(
        tx,
        `SELECT site, site_updated_at AS "updatedAt" FROM tenant_store_settings`,
      );
      const copy = SiteCopy.safeParse(row?.site);
      if (!copy.success) throw new NotFoundException('Este restaurante ainda não tem a página');
      const s = await this.settingsIn(tx);
      const region = await this.regionIn(tx, s);
      const products = await q<{
        id: string;
        name: string;
        description: string | null;
        price: string;
        imageUrl: string | null;
      }>(
        tx,
        `SELECT p.id, p.name, p.description, p.price::text,
                '/api/v1/media/' || p.image_id AS "imageUrl"
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.active AND c.active AND NOT p.sold_out
          ORDER BY p.featured DESC, (p.image_id IS NOT NULL) DESC, p.name LIMIT 8`,
      );
      return {
        restaurant: {
          name: tenantName,
          address: s.address,
          whatsapp: s.whatsapp,
          city: region.city,
          state: region.state,
          coverUrl: mediaUrl(s.coverImageId),
          logoUrl: mediaUrl(s.logoImageId),
        },
        copy: copy.data,
        /** Cardápio online ligado: a página mostra o botão de pedir. */
        ordering: s.enabled,
        isOpen: await this.openNowIn(tx, s),
        acceptsDelivery: s.acceptsDelivery,
        acceptsPickup: s.acceptsPickup,
        hours: s.hoursEnabled ? (s.hours ?? []) : [],
        products,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  /** Textos da página do restaurante corrigidos à mão em Loja online. */
  async saveSite(ctx: Ctx, copy: SiteCopy) {
    await this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `INSERT INTO tenant_store_settings (tenant_id, site, site_updated_at) VALUES ($1, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET site = EXCLUDED.site, site_updated_at = now()`,
        [ctx.tenantId, JSON.stringify(copy)],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.site_updated',
        entity: 'store',
        entityId: ctx.tenantId,
        data: { headline: copy.headline },
        ip: ctx.ip,
      });
    });
    return { copy };
  }

  /**
   * Manifesto do app instalado (PWA) de cada restaurante: nome, cor e ícone da loja. Sem ícone
   * próprio, valem os do Comandou.
   */
  manifest(tenantId: string, name: string, startUrl: string | null = null) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      const iconId = s.faviconImageId ?? s.logoImageId;
      const media = iconId
        ? await one<{ content_type: string }>(tx, `SELECT content_type FROM media WHERE id = $1`, [
            iconId,
          ])
        : null;
      const icons = media
        ? [192, 512].map((n) => ({
            src: mediaUrl(iconId)!,
            sizes: `${n}x${n}`,
            type: media.content_type,
            purpose: 'any',
          }))
        : [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ];
      return {
        name,
        short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
        description: `${name} no Comandou`,
        lang: 'pt-BR',
        // Topo do app instalado na cor do fundo do cardápio (uma cor só, sem faixa da cor da loja).
        theme_color: '#f6f6f7',
        background_color: '#f6f6f7',
        display: 'standalone',
        start_url: startUrl ?? '/',
        scope: '/',
        // Outro endereço de início é outro app instalado (o do entregador ao lado do painel).
        ...(startUrl ? { id: startUrl } : {}),
        icons,
      };
    });
  }

  /**
   * O que o link do cardápio mostra quando é compartilhado: nome, texto e a capa da loja (sem capa,
   * a logo). A capa é deitada e vira o cartão grande do WhatsApp; a logo quadrada aparecia enorme,
   * com os cantos brancos (pedido do David, 0.254.1). No link de um produto, o nome, a descrição e a
   * foto dele. O ícone da aba segue o favicon/logo. `origin` é o endereço da loja
   * (https://aurora.comandou.com): os apps só aceitam imagem com endereço completo.
   */
  linkPreview(tenantId: string, name: string, path: string, origin: string): Promise<LinkPreview> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      const productId = PRODUCT_PATH_RE.exec(path)?.[1];
      const product = productId
        ? await one<{ name: string; description: string | null; imageId: string | null }>(
            tx,
            `SELECT name, description, image_id AS "imageId" FROM products WHERE id = $1 AND active`,
            [productId],
          )
        : null;
      const imageId = product?.imageId ?? s.coverImageId ?? s.logoImageId ?? s.faviconImageId;
      const media = imageId
        ? await one<{ content_type: string; width: number | null; height: number | null }>(
            tx,
            `SELECT content_type, width, height FROM media WHERE id = $1`,
            [imageId],
          )
        : null;
      const iconId = s.faviconImageId ?? s.logoImageId;
      const storeText =
        oneLine(s.about) || oneLine(s.headline) || `Peça pelo cardápio online de ${name}.`;
      return {
        title: product ? `${oneLine(product.name, 90)} · ${name}` : name,
        description: product ? oneLine(product.description) || storeText : storeText,
        image: media ? `${origin}${mediaUrl(imageId)}` : null,
        imageType: media?.content_type ?? null,
        imageWidth: media?.width ?? null,
        imageHeight: media?.height ?? null,
        icon: iconId ? `${origin}${mediaUrl(iconId)}` : null,
        target: product ? path : '/pedir',
        siteName: name,
      };
    });
  }

  async updateSettings(ctx: Ctx, patch: Partial<StoreSettings>) {
    const accepted: string[] = [];
    let openChanged: boolean | null = null;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const cur = await this.settingsIn(tx);
      const next = { ...cur, ...patch };
      if (next.isOpen !== cur.isOpen) openChanged = next.isOpen;
      if (next.etaMax < next.etaMin)
        throw new UnprocessableEntityException('O tempo máximo deve ser maior que o mínimo');
      // Chave Pix no formato do Pix (o mesmo texto vai no QR Code do cliente).
      if (next.pixKey && next.pixKeyType) {
        const key = normalizePixKey(next.pixKeyType, next.pixKey);
        if (!key)
          throw new UnprocessableEntityException(
            `Chave Pix inválida para o tipo ${PIX_KEY_TYPE_LABELS[next.pixKeyType]}`,
          );
        next.pixKey = key;
      } else if (next.pixKey && !next.pixKeyType) {
        throw new UnprocessableEntityException('Escolha o tipo da chave Pix');
      }
      if (next.pixEnabled && !pixPayeeOf(next))
        throw new UnprocessableEntityException(
          'Para ligar o Pix no cardápio, preencha a chave, o nome e a cidade de quem recebe',
        );
      const keys = Object.keys(COLUMN) as (keyof StoreSettings)[];
      const cols = keys.map((k) => COLUMN[k]);
      await q(
        tx,
        `INSERT INTO tenant_store_settings (tenant_id, ${cols.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        // jsonb vai como texto JSON (o driver mandaria array no formato do Postgres).
        [ctx.tenantId, ...keys.map((k) => (k === 'hours' ? JSON.stringify(next[k]) : next[k]))],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.settings_updated',
        entity: 'store',
        entityId: ctx.tenantId,
        data: { changes: patch },
        ip: ctx.ip,
      });
      // Ligou o aceite automático: quem já estava "em análise" é aceito agora, como os próximos.
      if (next.autoAccept && !cur.autoAccept) {
        const waiting = await q<{ id: string }>(
          tx,
          `SELECT id FROM orders WHERE status = 'awaiting' ORDER BY created_at, id`,
        );
        for (const w of waiting) {
          // Um pedido que não dá para aceitar (ex.: falta estoque) fica em análise; os outros seguem.
          await q(tx, `SAVEPOINT auto_accept`);
          try {
            const o = await this.orders.lock(tx, w.id);
            if (o.status !== 'awaiting') continue;
            await this.orders.transitionInTx(tx, ctx, o, 'new', 'Aceite automático ligado');
            accepted.push(o.id);
          } catch {
            await q(tx, `ROLLBACK TO SAVEPOINT auto_accept`);
          }
        }
      }
      return this.withOpenNow(tx);
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    if (openChanged !== null) {
      const isOpen: boolean = openChanged;
      // Não segura a resposta: o aplicativo pode demorar; o resultado aparece na tela dele.
      void Promise.all(
        this.openHooks.map((h) => h(ctx.tenantId, ctx.userId, isOpen).catch(() => undefined)),
      );
    }
    for (const id of accepted)
      this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: id, status: 'new' });
    if (accepted.length) {
      this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
      this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    }
    return res;
  }

  /** Situação da loja agora (aberta, entrega, retirada): o cardápio aberto confere de tempos em tempos. */
  async publicStatus(tenantId: string) {
    const status = await this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
      const isOpen = await this.openNowIn(tx, s);
      return {
        isOpen,
        acceptsDelivery: s.acceptsDelivery,
        acceptsPickup: s.acceptsPickup,
        schedule: await this.scheduleIn(tx, s, isOpen),
      };
    });
    // Quando o Super Admin limpou o cache da loja: o cardápio aberto limpa e recarrega.
    const [epoch] = await this.db
      .queryUnscoped<{ at: Date | null }>('SELECT app_tenant_cache_epoch($1) AS at', [tenantId])
      .catch(() => []);
    return { ...status, cacheEpoch: epoch?.at ? new Date(epoch.at).toISOString() : null };
  }

  /**
   * Cidade e UF do restaurante, para achar o CEP pela rua nos endereços (cardápio e sistema).
   * Sem cidade na Loja online, vale a cidade da empresa na nota fiscal.
   */
  region(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (tx) =>
      this.regionIn(tx, await this.settingsIn(tx)),
    );
  }

  async regionIn(tx: Tx, s: StoreSettings) {
    if (s.city?.trim() && s.state?.trim())
      return { city: s.city.trim(), state: s.state.trim().toUpperCase() };
    const f = await one<{ city: string | null; state: string | null }>(
      tx,
      `SELECT company->>'municipio' AS city, company->>'uf' AS state FROM tenant_fiscal_settings`,
    );
    return {
      city: s.city?.trim() || f?.city?.trim() || null,
      state: (s.state?.trim() || f?.state?.trim() || '').toUpperCase() || null,
    };
  }

  /**
   * Cardápio público: só o que o cliente precisa ver. Sem custos, fichas, setores ou dados fiscais.
   * Com `tableId` (QR Code da mesa), vem a mesa e os preços do salão; mesa inexistente ou
   * desativada volta `table: null` e o cardápio normal (entrega e retirada).
   */
  async publicMenu(tenantId: string, tenantName: string, slug: string, tableId?: string) {
    // Pagamento pelo app (PagBank conectado): fora da transação do cardápio.
    const onlinePay = await this.onlinePay.offer(tenantId).catch(() => null);
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
      const table = tableId ? await this.publicTableIn(tx, tableId) : null;
      const categories = await q<{
        id: string;
        name: string;
        imageId: string | null;
        products: {
          id: string;
          name: string;
          description: string | null;
          price: string;
          soldOut: boolean;
          imageId: string | null;
          featured: boolean;
          badge: string | null;
          loyaltyPoints: number | null;
          modelV: number | null;
          modelUsdz: boolean;
          photoIds: string[] | null;
          rating: { average: number; count: number } | null;
          optionGroups: unknown[];
        }[];
      }>(
        tx,
        // O cardápio online usa o cardápio Delivery (itens e preços dele), igual ao pedido que chega.
        // Na mesa vale o Principal (o do salão), que é o que o pedido de mesa cobra.
        menuTreeSql(
          `'featured', p.featured, 'badge', p.badge, 'loyaltyPoints', p.loyalty_points,
           'modelV', (SELECT floor(extract(epoch FROM pm.updated_at))::bigint FROM product_models pm
                       WHERE pm.product_id = p.id AND pm.glb IS NOT NULL),
           'modelUsdz', COALESCE((SELECT pm.usdz IS NOT NULL FROM product_models pm
                                   WHERE pm.product_id = p.id), false),
           'photoIds', (SELECT json_agg(pp.image_id ORDER BY pp.position) FROM product_photos pp
                         WHERE pp.product_id = p.id),
           'rating', (SELECT json_build_object('average', round(avg(r.rating), 1), 'count', count(*))
                        FROM product_reviews r WHERE r.product_id = p.id AND r.hidden_at IS NULL
                      HAVING count(*) > 0),`,
        ),
        [table ? 'principal' : 'delivery'],
      );
      const banners = await q<BannerInput & { id: string }>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners WHERE active ORDER BY position, created_at`,
      );
      // "Mais pedidos": os produtos que mais saíram nos últimos 30 dias (pedidos não cancelados).
      const popular = s.showPopular ? await this.popularIn(tx, tenantId) : [];
      const zoneCount = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM delivery_zones WHERE active`,
      );
      const region = await this.regionIn(tx, s);
      const visible = categories.filter((c) => c.products.length > 0);
      // Regras do cardápio (mesa ou online): o que cada um mostra (store-rules.ts, no shared).
      const rules = storeRules(table ? 'table' : 'online', s);
      const productIds = new Set(visible.flatMap((c) => c.products.map((p) => p.id)));
      const categoryIds = new Set(visible.map((c) => c.id));
      const openNow = await this.openNowIn(tx, s);
      // Resumo do programa de fidelidade (o saldo vem em /store/loyalty): o início já mostra os
      // pontos de cada item e as abas do app sem esperar outra chamada.
      const lp = rules.loyalty
        ? await one<{
            enabled: boolean;
            mode: 'points' | 'stamps';
            pointsPerReal: string;
            showItemPoints: boolean;
          }>(
            tx,
            `SELECT enabled, mode, points_per_real::text AS "pointsPerReal",
                    show_item_points AS "showItemPoints" FROM loyalty_programs`,
          )
        : null;
      // Cupons na vitrine (aba Cupons): com as contas ligadas (na mesa, com os Cupons na mesa).
      const coupons = rules.coupons
        ? ((
            await one<{ n: number }>(
              tx,
              `SELECT count(*)::int AS n FROM coupons
                  WHERE active AND listed AND (starts_at IS NULL OR starts_at <= now())
                    AND (ends_at IS NULL OR ends_at > now())`,
            )
          )?.n ?? 0)
        : 0;
      // Avisos no ar (tela Notificações): o sino do início mostra a bolinha se houver um novo.
      const notices = table
        ? []
        : (
            await q<{ id: string }>(
              tx,
              `SELECT id FROM store_notices
                WHERE active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
                ORDER BY starts_at DESC LIMIT 30`,
            )
          ).map((n) => n.id);
      return {
        restaurant: {
          name: tenantName,
          slug,
          about: s.about,
          address: s.address,
          whatsapp: s.whatsapp,
          city: region.city,
          state: region.state,
          coverUrl: mediaUrl(s.coverImageId),
          logoUrl: mediaUrl(s.logoImageId),
        },
        store: {
          isOpen: openNow,
          // Faixa do app: "Aberta até 23h" ou "Fechada. Abre hoje às 10h30".
          schedule: await this.scheduleIn(tx, s, openNow),
          acceptsDelivery: s.acceptsDelivery,
          acceptsPickup: s.acceptsPickup,
          deliveryFee: s.deliveryFee,
          minOrder: s.minOrder,
          etaMin: s.etaMin,
          etaMax: s.etaMax,
          /** Taxa por área no mapa: o cardápio pede a localização do endereço antes do pedido. */
          deliveryZones: (zoneCount?.n ?? 0) > 0,
          /** Tem mesas: o cardápio online oferece "Estou no restaurante" (lê o QR da mesa). */
          tables: !table && !!(await one(tx, `SELECT 1 FROM dining_tables WHERE active LIMIT 1`)),
        },
        // Na mesa: se o cliente confirma a localização antes de pedir e se busca o pedido pronto.
        table: table
          ? { ...table, confirmLocation: checksTableLocation(s), selfPickup: s.tableSelfPickup }
          : null,
        // Pix pelo cardápio: o checkout monta o QR Code com o valor, também na mesa (o cliente
        // paga o pedido pelo Pix ou no fim, com o garçom). Só com a conta do cliente aberta: sem
        // contas na loja, não há Pix pelo cardápio.
        pix: s.accountsEnabled ? publicPix(s) : null,
        // Cartão e Pix pelo app (PagBank): entrega e retirada, com a conta do cliente aberta. Com o
        // Pix pelo app ligado, ele toma o lugar do Pix com comprovante fora da mesa.
        onlinePay: s.accountsEnabled ? onlinePay : null,
        appearance: {
          theme: s.theme,
          headline: s.headline,
          featuredTitle: s.featuredTitle,
          accountsEnabled: s.accountsEnabled,
          tableAccount: s.tableAccount,
          tableCoupons: s.tableCoupons,
          // Na mesa não há conversa: quem resolve é o garçom.
          chatEnabled: rules.chat,
        },
        mode: rules.mode,
        loyalty: lp?.enabled
          ? { mode: lp.mode, pointsPerReal: lp.pointsPerReal, showItemPoints: lp.showItemPoints }
          : null,
        coupons,
        notices,
        // Banner que aponta para produto/categoria fora do cardápio vira banner sem link.
        banners: banners.map(({ imageId, active: _a, position: _p, ...b }) => {
          const ok =
            (b.targetType === 'product' && productIds.has(b.targetId!)) ||
            (b.targetType === 'category' && categoryIds.has(b.targetId!));
          return {
            ...b,
            targetType: ok ? b.targetType : 'none',
            targetId: ok ? b.targetId : null,
            imageUrl: mediaUrl(imageId),
          };
        }),
        popular: popular.filter((id) => productIds.has(id)),
        categories: visible.map(({ imageId, products, ...c }) => ({
          ...c,
          imageUrl: mediaUrl(imageId),
          products: products.map(({ imageId: img, modelV, modelUsdz, photoIds, rating, ...p }) => ({
            ...p,
            imageUrl: mediaUrl(img),
            // Fotos extras do item (a principal vem em imageUrl).
            photos: (photoIds ?? []).map((id) => mediaUrl(id)!),
            rating: rating
              ? { average: Number(rating.average), count: Number(rating.count) }
              : null,
            model: modelUrls(p.id, modelV ?? null, !!modelUsdz),
          })),
        })),
      };
    });
  }

  /** Produtos que mais saíram nos últimos 30 dias (pedidos não cancelados), do cache se recente. */
  private async popularIn(tx: Tx, tenantId: string): Promise<string[]> {
    const hit = this.popularCache.get(tenantId);
    if (hit && Date.now() - hit.at < POPULAR_TTL_MS) return hit.ids;
    const rows = await q<{ id: string }>(
      tx,
      `SELECT i.product_id AS id FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.created_at > now() - interval '30 days' AND o.status <> 'cancelled'
          AND i.product_id IS NOT NULL
        GROUP BY i.product_id ORDER BY sum(CASE WHEN i.unit = 'kg' THEN 1 ELSE i.quantity END) DESC LIMIT 10`,
    );
    const ids = rows.map((r) => r.id);
    // Muitos restaurantes numa réplica: o mapa não cresce sem limite.
    if (this.popularCache.size >= POPULAR_CACHE_MAX) this.popularCache.clear();
    this.popularCache.set(tenantId, { at: Date.now(), ids });
    return ids;
  }

  /**
   * Mesa do QR Code, para o cliente: nome e a taxa de serviço que a comanda cobra (a da comanda
   * aberta; sem comanda, a do salão). Nada de comanda, cliente ou valores.
   */
  private async publicTableIn(tx: Tx, tableId: string) {
    if (!UUID_RE.test(tableId)) return null;
    return (
      (await one<{ id: string; label: string; serviceFeePercent: string | null }>(
        tx,
        `SELECT dt.id, dt.label,
                (CASE WHEN tb.id IS NOT NULL THEN tb.service_fee_percent
                      ELSE (SELECT NULLIF(service_fee_percent, 0) FROM salon_settings) END)::text
                  AS "serviceFeePercent"
           FROM dining_tables dt
           LEFT JOIN tabs tb ON tb.table_id = dt.id AND tb.status = 'open'
          WHERE dt.id = $1 AND dt.active`,
        [tableId],
      )) ?? null
    );
  }

  /** Pedido do cliente final. Preços, taxa e pedido mínimo vêm sempre do banco. */
  async placeOrder(tenantId: string, input: OnlineOrderInput, key: string, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const { s, openNow } = await this.db.withTenant(ctx, async (tx) => {
      const st = await this.settingsIn(tx);
      return { s: st, openNow: await this.openNowIn(tx, st) };
    });
    if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
    const atTable = input.channel === 'table';
    if (!openNow)
      throw new ConflictException(
        atTable
          ? 'A loja não está recebendo pedidos pelo celular agora. Chame o garçom para pedir.'
          : 'A loja está fechada agora. Tente novamente mais tarde.',
      );
    if (atTable && !input.tableId) throw new UnprocessableEntityException('Informe a mesa');
    if (atTable && input.couponCode && !storeRules('table', s).coupons)
      throw new UnprocessableEntityException('Esta loja não aceita cupom no pedido da mesa');
    // Mesa: quem pede está no restaurante (QR Code fotografado não pede de casa).
    if (atTable && !tablePresenceOf(s, input.presence).ok)
      throw new HttpException(
        {
          message: input.presence
            ? 'Parece que você não está no restaurante. Confirme a localização de dentro do salão ou chame o garçom.'
            : 'Confirme sua localização para pedir pela mesa',
          code: TABLE_LOCATION_CODE,
        },
        428,
      );
    // Pago pelo app (PagBank): cartão de crédito marcado "pelo app" ou Pix (quando a loja liga o
    // Pix pelo app), na entrega e na retirada. O pedido espera o pagamento em análise.
    const offer =
      !atTable && s.accountsEnabled ? await this.onlinePay.offer(tenantId).catch(() => null) : null;
    if (input.payInApp && !(input.paymentMethod === 'credit' && offer?.card))
      throw new ConflictException('Esta loja não está recebendo cartão pelo app agora');
    const payOnline: 'card' | 'pix' | undefined =
      input.paymentMethod === 'credit' && input.payInApp
        ? 'card'
        : input.paymentMethod === 'pix' && offer?.pix
          ? 'pix'
          : undefined;
    if (payOnline && !input.customerId)
      throw new ForbiddenException({
        message: 'Entre na sua conta para pagar pelo app',
        code: LOGIN_REQUIRED_CODE,
      });
    // Pix pelo cardápio (QR Code na hora): só com a conta do cliente aberta.
    const pixNow =
      !payOnline && input.paymentMethod === 'pix' && s.accountsEnabled && !!pixPayeeOf(s);
    if (pixNow && !input.customerId)
      throw new ForbiddenException({
        message: 'Entre na sua conta para pagar pelo Pix',
        code: LOGIN_REQUIRED_CODE,
      });
    if (!atTable && (!input.customerPhone || !input.paymentMethod))
      throw new UnprocessableEntityException('Informe o telefone e a forma de pagamento');
    if (input.channel === 'delivery' && !s.acceptsDelivery)
      throw new UnprocessableEntityException('Esta loja não está fazendo entregas agora');
    if (input.channel === 'pickup' && !s.acceptsPickup)
      throw new UnprocessableEntityException('Esta loja não está aceitando retirada agora');
    if (input.channel === 'delivery' && !input.address)
      throw new UnprocessableEntityException('Informe o endereço de entrega');
    const a = input.address;
    const address =
      input.channel === 'delivery' && a
        ? [
            `${a.street}, ${a.number}`,
            a.complement,
            a.district,
            a.city ? `${a.city}${a.state ? `/${a.state}` : ''}` : undefined,
            a.cep ? `CEP ${a.cep.slice(0, 5)}-${a.cep.slice(5)}` : undefined,
            a.reference ? `Ref.: ${a.reference}` : undefined,
          ]
            .filter(Boolean)
            .join(' — ')
        : undefined;
    // Taxa e pedido mínimo da área de entrega (se a loja desenhou áreas no mapa).
    let fee = s.deliveryFee;
    let minSubtotal = s.minOrder;
    const point =
      a?.lat !== undefined && a?.lng !== undefined ? { lat: a.lat, lng: a.lng } : undefined;
    if (input.channel === 'delivery') {
      const quote = await this.db.withTenant(ctx, async (tx) =>
        point ? this.zones.quoteIn(tx, [point.lat, point.lng], s.deliveryFee, a?.district) : null,
      );
      const hasZones =
        quote?.hasZones ??
        (await this.db.withTenant(ctx, async (tx) =>
          (await this.zones.listIn(tx)).some((z) => z.active),
        ));
      if (hasZones && !quote)
        throw new UnprocessableEntityException(
          'Confirme o endereço no mapa para calcular a taxa de entrega',
        );
      if (quote && !quote.covered)
        throw new UnprocessableEntityException('Ainda não entregamos neste endereço');
      if (quote?.zone) {
        fee = quote.fee;
        if (quote.minOrder) minSubtotal = quote.minOrder;
      }
      // O pino escolhe a área e a taxa. Com o endereço digitado achado no mapa (a busca que o
      // cardápio fez, guardada), o pino longe dele não barateia a entrega: vale a taxa maior, e o
      // endereço fora das áreas pede para conferir.
      if (quote?.zone && point && a) {
        const typed = await this.db.withTenant(ctx, async (tx) => {
          const found = this.geocoder?.peek(
            a,
            locateContext(s, await this.regionIn(tx, s), await this.zones.listIn(tx)),
          );
          if (!found || (found.precision !== 'house' && found.precision !== 'street')) return null;
          if (distanceM([found.lat, found.lng], [point.lat, point.lng]) <= PIN_DRIFT_M) return null;
          return this.zones.quoteIn(tx, [found.lat, found.lng], s.deliveryFee, a.district);
        });
        if (typed && !typed.covered)
          throw new UnprocessableEntityException(
            'O ponto no mapa está longe do endereço digitado. Confira o endereço e o ponto da entrega.',
          );
        if (typed?.zone && toCents(typed.fee) > toCents(fee)) {
          fee = typed.fee;
          if (typed.minOrder) minSubtotal = typed.minOrder;
        }
      }
    }
    // Mesa: entra na comanda aberta dela (ou abre uma, no nome do cliente). Sem taxa de entrega
    // nem pedido mínimo. O cliente paga no fim, com o garçom, ou já pelo Pix do cardápio (o
    // comprovante aprovado entra como pagamento deste pedido e baixa o saldo da comanda).
    // Aceite automático só para quem não parece pedido falso: o mesmo telefone com pedidos em
    // aberto, ou uma enxurrada de pedidos sem conta, cai em análise (uma pessoa aceita).
    const autoAccept = !atTable
      ? (await this.db.withTenant(ctx, (tx) =>
          this.autoAcceptAllowed(tx, input.customerPhone, !!input.customerId),
        )) && s.autoAccept
      : s.autoAccept;
    const order = await this.orders.create(
      ctx,
      {
        channel: input.channel,
        tableId: atTable ? input.tableId : undefined,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: address,
        deliveryLocation: input.channel === 'delivery' ? point : undefined,
        notes: input.notes,
        deliveryFee: input.channel === 'delivery' ? fee : undefined,
        items: input.items,
        online: {
          tokenHash: publicTokenHash(input.token),
          autoAccept,
          paymentHint: atTable ? (pixNow ? 'pix' : undefined) : input.paymentMethod,
          // Pix pelo cardápio ligado: o pedido espera o comprovante do cliente.
          pix: pixNow,
          payOnline,
          changeFor: !atTable && input.paymentMethod === 'cash' ? input.changeFor : undefined,
          customerId: input.customerId,
          rewardId: input.rewardId,
          couponCode: input.couponCode,
          taxDocument: atTable ? input.customerCpf : undefined,
        },
        minSubtotal: atTable ? undefined : minSubtotal,
      },
      key,
    );
    return {
      number: order.number,
      status: order.status,
      // Total da API (o QR Code do Pix pede este valor).
      total: (order as unknown as { total: string }).total,
      pixStatus: (order as unknown as { pixStatus: PixReceiptStatus | null }).pixStatus ?? null,
      payOnline: payOnline ?? null,
    };
  }

  /**
   * Pedido online pode ir direto para a cozinha (aceite automático)? Não quando o mesmo telefone
   * já tem 2 pedidos em aberto na última hora, ou quando chegaram 10 pedidos sem conta nos últimos
   * 10 minutos. Em análise, a loja vê e recusa o que for falso antes de ir para a cozinha.
   */
  async autoAcceptAllowed(tx: Tx, phone: string | undefined, withAccount: boolean) {
    const tail = (phone ?? '').replace(/\D/g, '').slice(-8);
    const r = await one<{ open: number; burst: number }>(
      tx,
      `SELECT count(*) FILTER (WHERE $1 <> '' AND right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 8) = $1
                                 AND status NOT IN ('completed', 'cancelled'))::int AS open,
              count(*) FILTER (WHERE customer_id IS NULL AND created_at > now() - interval '10 minutes')::int AS burst
         FROM orders
        WHERE source = 'online' AND tab_id IS NULL AND created_at > now() - interval '1 hour'`,
      [tail.length === 8 ? tail : ''],
    );
    if ((r?.open ?? 0) >= 2) return false;
    return withAccount || (r?.burst ?? 0) < 10;
  }

  /** Pedido pelo link do cliente (token), válido por 7 dias. */
  async byToken(tx: Tx, token: string) {
    if (!PUBLIC_TOKEN_RE.test(token)) throw new NotFoundException('Pedido não encontrado');
    const o = await one<{ id: string; created_at: Date }>(
      tx,
      `SELECT id, created_at FROM orders WHERE public_token_hash = $1`,
      [publicTokenHash(token)],
    );
    // O link vale por 7 dias; depois disso o pedido some do acompanhamento.
    if (!o || Date.now() - new Date(o.created_at).getTime() > 7 * 86_400_000)
      throw new NotFoundException('Pedido não encontrado');
    return o.id;
  }

  /**
   * Acompanhamento do pedido pelo cliente (quem tem o link). Pedido da mesa pelo QR Code: depois
   * que a conta da mesa é paga (comanda fechada) e o pedido terminou, o link deixa de mostrar o
   * pedido (410 `table_closed`). O celular fica na mesa para o próximo cliente; quem quer guardar
   * o histórico pede com a conta aberta (`accountOrder` continua mostrando).
   */
  publicOrder(tenantId: string, tenantName: string, token: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const id = await this.byToken(tx, token);
      if (await tableBillEndedIn(tx, id))
        throw new GoneException({
          message: 'A conta desta mesa já foi fechada. Obrigado pela visita!',
          code: TABLE_CLOSED_CODE,
        });
      return this.orderView(tx, id, tenantName);
    });
  }

  /** Mesmo acompanhamento, pelo histórico da conta do cliente (id já conferido como dele). */
  accountOrder(tenantId: string, tenantName: string, orderId: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.orderView(tx, orderId, tenantName));
  }

  private async orderView(tx: Tx, id: string, tenantName: string) {
    const o = await one<{
      number: number;
      status: Parameters<typeof customerStep>[0];
      channel: string;
      createdAt: Date;
      acceptedAt: Date | null;
      customerName: string | null;
      deliveryAddress: string | null;
      notes: string | null;
      subtotal: string;
      deliveryFee: string;
      discount: string;
      surcharge: string;
      total: string;
      tableLabel: string | null;
      paymentHint: string | null;
      changeFor: string | null;
      paymentStatus: string;
      cancelReason: string | null;
      pixStatus: PixReceiptStatus | null;
      paidAmount: string;
      servedAt: Date | null;
    }>(
      tx,
      `SELECT number, status, channel, created_at AS "createdAt", accepted_at AS "acceptedAt",
                served_at AS "servedAt",
                customer_name AS "customerName", delivery_address AS "deliveryAddress", notes,
                subtotal::text, delivery_fee::text AS "deliveryFee", discount::text,
                surcharge::text, total::text,
                (SELECT dt.label FROM tabs tb JOIN dining_tables dt ON dt.id = tb.table_id
                  WHERE tb.id = orders.tab_id) AS "tableLabel",
                payment_hint AS "paymentHint", change_for::text AS "changeFor",
                payment_status AS "paymentStatus", cancel_reason AS "cancelReason",
                pix_status AS "pixStatus", paid_amount::text AS "paidAmount"
           FROM orders WHERE id = $1`,
      [id],
    );
    const items = await q(
      tx,
      `SELECT i.name, i.quantity::text, i.unit, i.total::text, i.notes, i.status,
                (SELECT '/api/v1/media/' || p.image_id FROM products p WHERE p.id = i.product_id) AS "imageUrl",
                COALESCE((SELECT json_agg(io.name) FROM order_item_options io WHERE io.order_item_id = i.id), '[]') AS options
           FROM order_items i WHERE i.order_id = $1 ORDER BY i.created_at, i.id`,
      [id],
    );
    const history = await q<{ to: string; at: Date }>(
      tx,
      `SELECT to_status AS "to", created_at AS "at" FROM order_status_history WHERE order_id = $1 ORDER BY id`,
      [id],
    );
    const delivery = await one<{
      id: string;
      courier: string;
      status: string;
      code: string | null;
      lat: string | null;
      lng: string | null;
      at: Date | null;
      heading: number | null;
      speed: number | null;
      accuracy: number | null;
    }>(
      tx,
      `SELECT d.id, split_part(c.name, ' ', 1) AS courier, d.status, d.confirm_code AS code, d.last_lat::text AS lat,
                d.last_lng::text AS lng, d.last_location_at AS at, d.last_heading AS heading,
                d.last_speed::float AS speed, d.last_accuracy AS accuracy
           FROM deliveries d JOIN couriers c ON c.id = d.courier_id
          WHERE d.order_id = $1 ORDER BY d.dispatched_at DESC LIMIT 1`,
      [id],
    );
    const s = await this.settingsIn(tx);
    const dest = await one<{ lat: string | null; lng: string | null }>(
      tx,
      `SELECT delivery_lat::text AS lat, delivery_lng::text AS lng FROM orders WHERE id = $1`,
      [id],
    );
    const onRoad = !!delivery && o!.status === 'dispatched' && delivery.status === 'out';
    const map = onRoad ? await customerMapOf(tx, delivery.id) : null;
    const when = (st: string) => history.find((h) => h.to === st)?.at ?? null;
    const { pixStatus, paidAmount, servedAt, ...rest } = o!;
    const atTable = o!.channel === 'table';
    return {
      restaurant: {
        name: tenantName,
        whatsapp: s.whatsapp,
        logoUrl: mediaUrl(s.logoImageId),
        // Conversa pelo cardápio no lugar do WhatsApp (pedido de mesa não tem: é com o garçom).
        chat: storeRules(atTable ? 'table' : 'online', s).chat && s.enabled,
      },
      etaMin: s.etaMin,
      etaMax: s.etaMax,
      ...rest,
      pix: pixStatus ? await this.pixViewIn(tx, id, s, { ...o!, pixStatus }) : null,
      online: await this.onlinePay.publicViewIn(tx, id),
      step: customerStep(o!.status, atTable && !!servedAt),
      canCancel:
        o!.status === 'awaiting' &&
        !(await one(tx, `SELECT 1 FROM online_charges WHERE order_id = $1 AND status = 'paid'`, [
          id,
        ])),
      // Mesa: o cliente busca o pedido pronto no balcão e avisa que pegou.
      selfPickup: atTable && s.tableSelfPickup,
      canPickUp: atTable && s.tableSelfPickup && o!.status === 'ready' && !servedAt,
      timeline: {
        awaiting: o!.createdAt,
        accepted: o!.acceptedAt ?? when('new') ?? when('in_production'),
        ready: when('ready'),
        dispatched: when('dispatched'),
        completed: servedAt ?? when('completed'),
        cancelled: when('cancelled'),
      },
      items,
      courier:
        delivery && o!.status === 'dispatched'
          ? {
              name: delivery.courier,
              // Código que o cliente passa ao entregador para concluir (só enquanto está na rua).
              code: delivery.status === 'out' ? delivery.code : null,
              location:
                delivery.status === 'out' && delivery.lat && delivery.lng
                  ? {
                      lat: delivery.lat,
                      lng: delivery.lng,
                      at: delivery.at,
                      heading: delivery.heading,
                      speed: delivery.speed,
                      accuracy: delivery.accuracy,
                    }
                  : null,
              destination: dest?.lat && dest.lng ? { lat: dest.lat, lng: dest.lng } : null,
              store: map?.store ?? null,
              trail: map?.trail ?? [],
            }
          : null,
    };
  }

  /**
   * Pix do pedido, para o cliente: o QR Code com o que falta pagar (enquanto não foi aprovado) e
   * como está o comprovante. Recusado, ele pode mandar outro. Pedido cancelado com o comprovante
   * enviado: a loja confere e devolve (`refund_due`) e depois avisa que devolveu (`refunded`).
   */
  private async pixViewIn(
    tx: Tx,
    orderId: string,
    s: StoreSettings,
    o: { status: string; total: string; paidAmount: string; pixStatus: PixReceiptStatus },
  ) {
    const last = await one<{
      status: string;
      at: Date;
      reason: string | null;
      amount: string;
      n: number;
    }>(
      tx,
      `SELECT status, created_at AS at, reject_reason AS reason, amount::text,
              (SELECT count(*)::int FROM pix_receipts WHERE order_id = $1) AS n
         FROM pix_receipts WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    const due = fromCents(Math.max(0, toCents(o.total) - toCents(o.paidAmount)));
    const payee = pixPayeeOf(s);
    const open = o.status !== 'cancelled' && o.pixStatus !== 'approved' && toCents(due) > 0;
    return {
      status: o.pixStatus,
      amount: due,
      // Sem a chave (a loja desligou o Pix depois), o cliente fala com a loja.
      code: open && payee ? pixBrCode(payee, due) : null,
      payee: payee
        ? { name: payee.name, keyType: payee.keyType, key: formatPixKey(payee.keyType, payee.key) }
        : null,
      receipt: last
        ? { status: last.status, at: last.at, reason: last.reason, amount: last.amount }
        : null,
      canSend: open && (last?.n ?? 0) < MAX_PIX_RECEIPTS,
    };
  }

  /** O cliente confirma, antes de pedir pela mesa, que está no restaurante. */
  async tablePresence(tenantId: string, p: Presence) {
    const s = await this.db.withTenant({ tenantId }, (tx) => this.settingsIn(tx));
    return tablePresenceOf(s, p);
  }

  /** Mesa com o cliente buscando no balcão: ele avisa que pegou o pedido pronto. */
  async pickedUpByCustomer(tenantId: string, token: string | { orderId: string }, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const s = await this.settingsIn(tx);
      const id = typeof token === 'string' ? await this.byToken(tx, token) : token.orderId;
      if (!s.tableSelfPickup) throw new ConflictException('O garçom leva o pedido até a sua mesa');
      return id;
    });
    await this.orders.markServed(ctx, orderId);
    return { ok: true };
  }

  /** O cliente pode desistir enquanto o pedido ainda está em análise. */
  async cancelByCustomer(tenantId: string, token: string | { orderId: string }, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const orderId = await this.db.withTenant(ctx, async (tx) => {
      const id = typeof token === 'string' ? await this.byToken(tx, token) : token.orderId;
      const o = await this.orders.lock(tx, id);
      if (o.status !== 'awaiting')
        throw new ConflictException(
          'O restaurante já aceitou o pedido. Para cancelar, fale com a loja.',
        );
      const paid = await one(
        tx,
        `SELECT 1 FROM online_charges WHERE order_id = $1 AND status = 'paid'`,
        [id],
      );
      if (paid)
        throw new ConflictException(
          'Você já pagou este pedido pelo app. Para cancelar, fale com a loja (ela devolve o valor).',
        );
      await this.orders.transitionInTx(tx, ctx, o, 'cancelled', 'Cancelado pelo cliente');
      return id;
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId, status: 'cancelled' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ banners
  listBanners(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<BannerInput & { id: string }>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners ORDER BY position, created_at`,
      );
      return rows.map((b) => ({ ...b, imageUrl: mediaUrl(b.imageId) }));
    });
  }

  private async checkTarget(tx: Tx, b: Partial<BannerInput>) {
    if (b.targetType === undefined && b.targetId === undefined) return;
    if ((b.targetType === 'none') !== (b.targetId == null))
      throw new UnprocessableEntityException('Escolha para onde o banner leva');
    if (b.targetType === 'product' || b.targetType === 'category') {
      const table = b.targetType === 'product' ? 'products' : 'categories';
      const ok = await one(tx, `SELECT 1 FROM ${table} WHERE id = $1`, [b.targetId]);
      if (!ok)
        throw new NotFoundException(
          b.targetType === 'product' ? 'Produto não encontrado' : 'Categoria não encontrada',
        );
    }
  }

  async createBanner(ctx: Ctx, b: Partial<BannerInput> & { title: string }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: number; pos: number }>(
        tx,
        `SELECT count(*)::int AS n, COALESCE(max(position) + 1, 0)::int AS pos FROM store_banners`,
      );
      if (n!.n >= MAX_BANNERS)
        throw new UnprocessableEntityException(`Limite de ${MAX_BANNERS} banners`);
      const targetType = b.targetType ?? 'none';
      const targetId = targetType === 'none' ? null : (b.targetId ?? null);
      await this.checkTarget(tx, { targetType, targetId });
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO store_banners (tenant_id, title, subtitle, tag, cta, image_id, target_type, target_id, active, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          ctx.tenantId,
          b.title,
          b.subtitle ?? null,
          b.tag ?? null,
          b.cta ?? null,
          b.imageId ?? null,
          targetType,
          targetId,
          b.active ?? true,
          b.position ?? n!.pos,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_created',
        entity: 'store_banner',
        entityId: row!.id,
        data: { title: b.title },
        ip: ctx.ip,
      });
      return row!;
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return res;
  }

  async updateBanner(ctx: Ctx, id: string, b: Partial<BannerInput>) {
    const cols: [keyof BannerInput, string][] = [
      ['title', 'title'],
      ['subtitle', 'subtitle'],
      ['tag', 'tag'],
      ['cta', 'cta'],
      ['imageId', 'image_id'],
      ['targetType', 'target_type'],
      ['targetId', 'target_id'],
      ['active', 'active'],
      ['position', 'position'],
    ];
    if (b.targetType === 'none') b.targetId = null;
    await this.db.withTenant(ctx, async (tx) => {
      const cur = await one<BannerInput>(
        tx,
        `SELECT ${BANNER_COLS} FROM store_banners WHERE id = $1`,
        [id],
      );
      if (!cur) throw new NotFoundException('Banner não encontrado');
      if (b.targetType !== undefined || b.targetId !== undefined)
        await this.checkTarget(tx, {
          targetType: b.targetType ?? cur.targetType,
          targetId: b.targetId !== undefined ? b.targetId : cur.targetId,
        });
      const set = cols.filter(([k]) => b[k] !== undefined);
      await q(
        tx,
        `UPDATE store_banners SET ${set.map(([, c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...set.map(([k]) => b[k])],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_updated',
        entity: 'store_banner',
        entityId: id,
        data: { changes: b },
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return { ok: true };
  }

  async deleteBanner(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `DELETE FROM store_banners WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Banner não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'store.banner_deleted',
        entity: 'store_banner',
        entityId: id,
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'store.changed' });
    return { ok: true };
  }
}
