import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  fromCents,
  MAX_CARD_ATTEMPTS,
  ONLINE_PAY_WINDOW_MINUTES,
  OnlineChargeStatus,
  OnlinePayMethod,
  platformFeeCents,
  splitParts,
  toCents,
} from '@comandou/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { Ctx, ONLINE_CUSTOMER, onlineCtx } from '../common/context';
import { one, q } from '../common/sql';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { PlatformDb } from '../platform/platform-db.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  chargeStatusOf,
  declineReasonOf,
  lastCharge,
  PagBankClient,
  PagBankEnvironment,
  PagBankError,
  PagBankOrder,
  PAGBANK_SCOPES,
  pixOf,
  SplitReceiver,
} from './pagbank.client';

const PLATFORM_TOKEN_CONTEXT = 'online-pay:platform-token';
const CLIENT_SECRET_CONTEXT = 'online-pay:client-secret';
const ACCESS_CONTEXT = (t: string) => `online-pay:${t}:access`;
const REFRESH_CONTEXT = (t: string) => `online-pay:${t}:refresh`;
const STATE_MINUTES = 10;
const ACCOUNT_RE = /^ACCO_[A-Za-z0-9-]{4,60}$/;

/** Configuração da plataforma já aberta (segredos decifrados). Nunca vai para o navegador. */
export interface PlatformPayCfg {
  enabled: boolean;
  environment: PagBankEnvironment;
  platformToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  receiverAccountId: string | null;
  feePercent: string;
  feeFixed: string;
}

interface AccountRow {
  environment: PagBankEnvironment;
  seller_account_id: string | null;
  access_token_enc: Buffer | null;
  refresh_token_enc: Buffer | null;
  token_expires_at: Date | null;
  public_key: string | null;
  card_enabled: boolean;
  pix_enabled: boolean;
  cash_register_id: string | null;
  connected_at: Date | null;
  last_error: string | null;
}

interface ChargeRow {
  id: string;
  order_id: string;
  method: OnlinePayMethod;
  environment: PagBankEnvironment;
  status: OnlineChargeStatus;
  amount: string;
  fee_amount: string;
  pagbank_order_id: string | null;
  pagbank_charge_id: string | null;
  payment_id: string | null;
  refunded_amount: string;
  created_at: Date;
}

/** O que o cardápio pode oferecer pelo app agora (sem nada secreto). */
export interface OnlinePayOffer {
  card: boolean;
  pix: boolean;
  publicKey: string | null;
  env: 'SANDBOX' | 'PROD';
}

export interface Payer {
  name: string;
  email: string;
  taxId: string;
  phone: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const minutesAgo = (d: Date) => (Date.now() - new Date(d).getTime()) / 60_000;

/**
 * Pagamento pelo app com PagBank e split (docs/pagamento-online.md): o restaurante conecta a conta
 * dele (Connect), o cliente paga com cartão (cifrado no celular) ou Pix, o PagBank divide na hora
 * entre o restaurante e a taxa da Comandou. Pago, entra no caixa como crédito/Pix.
 */
@Injectable()
export class OnlinePayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OnlinePay');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly cash: CashService,
  ) {
    // Pedido cancelado: cobrança esperando deixa de valer; paga fora do caixa vira "a devolver".
    this.orders.onCancelInTx((tx, ctx, orderId) => this.onOrderCancelledIn(tx, ctx, orderId));
    // Estorno de um pagamento que veio do app: vai ao PagBank antes de gravar.
    this.cash.onRefundInTx((tx, ctx, paymentId, cents) =>
      this.onRefundIn(tx, ctx, paymentId, cents),
    );
  }

  onApplicationBootstrap() {
    const s = this.env.ONLINE_PAY_INTERVAL_SECONDS;
    if (!s) return;
    this.timer = setInterval(() => void this.sweepSafely(), s * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ plataforma

  private get key() {
    return this.env.INTEGRATIONS_KEY;
  }

  client(environment: PagBankEnvironment) {
    return new PagBankClient(
      environment === 'production'
        ? this.env.PAGBANK_API_URL_PRODUCAO
        : this.env.PAGBANK_API_URL_SANDBOX,
    );
  }

  /** Endereço de volta do Connect (fixo na aplicação do PagBank). */
  redirectUri() {
    return `https://admin.${this.env.COMANDOU_BASE_DOMAIN}/api/v1/pagbank/connect/callback`;
  }

  async platformCfg(): Promise<PlatformPayCfg | null> {
    if (!this.platformDb.enabled || !this.key) return null;
    const [r] = await this.platformDb.query<{
      enabled: boolean;
      environment: PagBankEnvironment;
      platform_token_enc: Buffer | null;
      client_id: string | null;
      client_secret_enc: Buffer | null;
      receiver_account_id: string | null;
      fee_percent: string;
      fee_fixed: string;
    }>(
      `SELECT enabled, environment, platform_token_enc, client_id, client_secret_enc,
              receiver_account_id, fee_percent::text, fee_fixed::text
         FROM platform_online_pay_settings`,
    );
    if (!r) return null;
    const dec = (b: Buffer | null, c: string) => {
      if (!b) return null;
      try {
        return open(this.key!, b, c);
      } catch {
        return null;
      }
    };
    return {
      enabled: r.enabled,
      environment: r.environment,
      platformToken: dec(r.platform_token_enc, PLATFORM_TOKEN_CONTEXT),
      clientId: r.client_id,
      clientSecret: dec(r.client_secret_enc, CLIENT_SECRET_CONTEXT),
      receiverAccountId: r.receiver_account_id,
      feePercent: r.fee_percent,
      feeFixed: r.fee_fixed,
    };
  }

  /** Plataforma pronta: ligada, com aplicação do Connect e a conta que recebe a taxa. */
  private ready(c: PlatformPayCfg | null): c is PlatformPayCfg & {
    platformToken: string;
    clientId: string;
    clientSecret: string;
  } {
    return !!c && c.enabled && !!c.platformToken && !!c.clientId && !!c.clientSecret;
  }

  /** Taxa vigente do restaurante (a dele, se o Super Admin deu uma, ou a padrão). */
  async feeOf(tenantId: string, cfg: PlatformPayCfg) {
    const [f] = await this.platformDb.query<{ fee_percent: string; fee_fixed: string }>(
      `SELECT fee_percent::text, fee_fixed::text FROM tenant_online_pay_fees WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      percent: f?.fee_percent ?? cfg.feePercent,
      fixed: f?.fee_fixed ?? cfg.feeFixed,
      custom: !!f,
    };
  }

  // ------------------------------------------------------------------ conta do restaurante

  private async accountIn(tx: Tx): Promise<AccountRow | null> {
    const a = await one<AccountRow>(
      tx,
      `SELECT environment, seller_account_id, access_token_enc, refresh_token_enc, token_expires_at,
              public_key, card_enabled, pix_enabled, cash_register_id, connected_at, last_error
         FROM online_pay_accounts`,
    );
    return a ?? null;
  }

  /** Conectada no ambiente atual, com token e id da conta. */
  private connected(a: AccountRow | null, cfg: PlatformPayCfg | null): a is AccountRow {
    return (
      !!a &&
      !!cfg &&
      a.environment === cfg.environment &&
      !!a.access_token_enc &&
      !!a.seller_account_id &&
      !!a.public_key
    );
  }

  /**
   * Token do restaurante, renovado quando falta menos de 1 dia para vencer. Grava o novo na
   * mesma transação (o refresh token muda a cada renovação).
   */
  private async sellerTokenIn(tx: Tx, tenantId: string, a: AccountRow, cfg: PlatformPayCfg) {
    const token = open(this.key!, a.access_token_enc!, ACCESS_CONTEXT(tenantId));
    const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : null;
    if (!exp || exp - Date.now() > 86_400_000 || !a.refresh_token_enc || !this.ready(cfg))
      return token;
    const refresh = open(this.key!, a.refresh_token_enc, REFRESH_CONTEXT(tenantId));
    try {
      const t = await this.client(cfg.environment).refresh(cfg, refresh);
      await q(
        tx,
        `UPDATE online_pay_accounts SET access_token_enc = $1, refresh_token_enc = COALESCE($2, refresh_token_enc),
                token_expires_at = $3, last_error = NULL`,
        [
          seal(this.key!, t.accessToken, ACCESS_CONTEXT(tenantId)),
          t.refreshToken ? seal(this.key!, t.refreshToken, REFRESH_CONTEXT(tenantId)) : null,
          t.expiresAt,
        ],
      );
      return t.accessToken;
    } catch (e) {
      // Ainda vale até vencer: usa o atual e tenta renovar de novo na próxima.
      this.logger.warn(`renovar token do PagBank (${tenantId}) falhou: ${(e as Error).message}`);
      if (exp > Date.now()) return token;
      throw new ServiceUnavailableException('A conexão com o PagBank venceu. Conecte de novo.');
    }
  }

  /** O que o cardápio oferece pelo app (null = como antes: Pix com comprovante e na entrega). */
  async offer(tenantId: string): Promise<OnlinePayOffer | null> {
    const cfg = await this.platformCfg().catch(() => null);
    if (!this.ready(cfg) || !cfg.receiverAccountId) return null;
    const a = await this.db.withTenant({ tenantId }, (tx) => this.accountIn(tx));
    if (!this.connected(a, cfg) || (!a.card_enabled && !a.pix_enabled)) return null;
    return {
      card: a.card_enabled,
      pix: a.pix_enabled,
      publicKey: a.card_enabled ? a.public_key : null,
      env: cfg.environment === 'production' ? 'PROD' : 'SANDBOX',
    };
  }

  /** Loja online → Pagamentos. */
  async view(ctx: Ctx) {
    const cfg = await this.platformCfg().catch(() => null);
    const ready = this.ready(cfg) && !!cfg?.receiverAccountId;
    const fee = cfg ? await this.feeOf(ctx.tenantId, cfg) : null;
    return this.db.withTenant(ctx, async (tx) => {
      const a = await this.accountIn(tx);
      const charges = await q(
        tx,
        `SELECT c.id, c.method, c.status, c.amount::text, c.fee_amount::text AS "feeAmount",
                c.refunded_amount::text AS "refundedAmount", c.card_brand AS "cardBrand",
                c.card_last4 AS "cardLast4", c.decline_reason AS "declineReason",
                c.payment_id IS NOT NULL AS "inCash", c.created_at AS "createdAt", c.paid_at AS "paidAt",
                o.number AS "orderNumber", o.id AS "orderId"
           FROM online_charges c JOIN orders o ON o.id = c.order_id
          ORDER BY c.created_at DESC LIMIT 30`,
      );
      const month = await one<{ paid: string; fees: string; n: number }>(
        tx,
        `SELECT COALESCE(sum(amount - refunded_amount), 0)::text AS paid,
                COALESCE(sum(fee_amount), 0)::text AS fees, count(*)::int AS n
           FROM online_charges WHERE status IN ('paid','refunded','refund_due')
            AND paid_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
      );
      const isConnected = this.connected(a, cfg);
      return {
        available: ready,
        environment: cfg?.environment ?? 'sandbox',
        connected: isConnected,
        // Conectou, mas o PagBank não disse qual é a conta: o dono informa o ACCO_.
        needsAccountId: !!a?.access_token_enc && !a.seller_account_id,
        // Conectado no outro ambiente (o Super Admin trocou): precisa conectar de novo.
        otherEnvironment: !!a?.access_token_enc && !!cfg && a.environment !== cfg.environment,
        sellerAccountId: a?.seller_account_id ?? null,
        cardEnabled: a?.card_enabled ?? true,
        pixEnabled: a?.pix_enabled ?? true,
        cashRegisterId: a?.cash_register_id ?? null,
        connectedAt: a?.connected_at ?? null,
        lastError: a?.last_error ?? null,
        fee: fee ? { percent: fee.percent, fixed: fee.fixed } : null,
        month: month ?? { paid: '0.00', fees: '0.00', n: 0 },
        charges,
      };
    });
  }

  /** Começa o Connect: devolve o endereço do PagBank (o navegador vai para lá). */
  async connectStart(ctx: Ctx, returnHost: string) {
    if (ctx.user.role !== 'owner')
      throw new ForbiddenException('Só o administrador do restaurante conecta a conta PagBank');
    const cfg = await this.platformCfg();
    if (!this.ready(cfg))
      throw new ServiceUnavailableException('Pagamento pelo app ainda não está disponível');
    const state = `${ctx.tenantId.replace(/-/g, '')}.${randomBytes(32).toString('base64url')}`;
    await this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `INSERT INTO online_pay_states (tenant_id, state_hash, user_id, return_host, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
        [ctx.tenantId, sha(state), ctx.userId, returnHost, STATE_MINUTES],
      ),
    );
    const base =
      cfg.environment === 'production'
        ? this.env.PAGBANK_CONNECT_URL_PRODUCAO
        : this.env.PAGBANK_CONNECT_URL_SANDBOX;
    const u = new URL(base);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('state', state);
    // O PagBank separa os escopos com "+".
    return { url: `${u.toString()}&scope=${PAGBANK_SCOPES.join('+')}` };
  }

  /**
   * Volta do PagBank em admin.<base>: acha o restaurante pelo state e manda o navegador de volta
   * ao endereço dele (o cookie da equipe só vale lá). Nada é trocado aqui.
   */
  async callbackTarget(state: string): Promise<string | null> {
    const m = /^([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/.exec(state ?? '');
    if (!m || !this.platformDb.enabled) return null;
    const tenantId = m[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    try {
      const h = await this.platformDb.tenantDb(tenantId);
      const [row] = await h.query<{ return_host: string }>(
        `SELECT return_host FROM online_pay_states
          WHERE tenant_id = $1 AND state_hash = $2 AND used_at IS NULL AND expires_at > now()`,
        [tenantId, sha(state)],
      );
      return row?.return_host ?? null;
    } catch {
      return null;
    }
  }

  /** No endereço do restaurante: confere o state, troca o código e cria a chave do cartão. */
  async connectFinish(ctx: Ctx, code: string, state: string) {
    if (ctx.user.role !== 'owner')
      throw new ForbiddenException('Só o administrador do restaurante conecta a conta PagBank');
    const cfg = await this.platformCfg();
    if (!this.ready(cfg))
      throw new ServiceUnavailableException('Pagamento pelo app ainda não está disponível');
    if (!/^[A-Za-z0-9._~-]{4,512}$/.test(code ?? ''))
      throw new UnprocessableEntityException('Código do PagBank inválido');
    // State de uso único, deste restaurante e de quem começou.
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `UPDATE online_pay_states SET used_at = now()
          WHERE state_hash = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING id`,
        [sha(state ?? ''), ctx.userId],
      );
      if (!r)
        throw new UnprocessableEntityException(
          'A autorização do PagBank venceu ou já foi usada. Toque em Conectar de novo.',
        );
    });
    const pb = this.client(cfg.environment);
    const t = await pb.exchangeCode(cfg, code, this.redirectUri()).catch((e: Error) => {
      throw new HttpException(`Não deu para conectar ao PagBank: ${e.message}`, 502);
    });
    const publicKey = await pb.publicKey(t.accessToken).catch((e: Error) => {
      throw new HttpException(`PagBank não liberou a chave do cartão: ${e.message}`, 502);
    });
    await this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `INSERT INTO online_pay_accounts (tenant_id, environment, seller_account_id, access_token_enc,
                                          refresh_token_enc, token_expires_at, public_key, connected_by,
                                          connected_at, last_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), NULL)
         ON CONFLICT (tenant_id) DO UPDATE SET environment = EXCLUDED.environment,
               seller_account_id = COALESCE(EXCLUDED.seller_account_id, online_pay_accounts.seller_account_id),
               access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
               token_expires_at = EXCLUDED.token_expires_at, public_key = EXCLUDED.public_key,
               connected_by = EXCLUDED.connected_by, connected_at = now(), last_error = NULL`,
        [
          ctx.tenantId,
          cfg.environment,
          t.accountId,
          seal(this.key!, t.accessToken, ACCESS_CONTEXT(ctx.tenantId)),
          t.refreshToken ? seal(this.key!, t.refreshToken, REFRESH_CONTEXT(ctx.tenantId)) : null,
          t.expiresAt,
          publicKey,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'online_pay.connected',
        entity: 'online_pay',
        data: { environment: cfg.environment, accountId: t.accountId },
        ip: ctx.ip,
      });
    });
    return { ok: true, needsAccountId: !t.accountId };
  }

  async update(
    ctx: Ctx,
    b: {
      cardEnabled?: boolean;
      pixEnabled?: boolean;
      cashRegisterId?: string | null;
      sellerAccountId?: string;
    },
  ) {
    if (b.sellerAccountId !== undefined) {
      if (ctx.user.role !== 'owner')
        throw new ForbiddenException('Só o administrador do restaurante muda a conta PagBank');
      if (!ACCOUNT_RE.test(b.sellerAccountId))
        throw new UnprocessableEntityException('O id da conta PagBank começa com ACCO_');
    }
    await this.db.withTenant(ctx, async (tx) => {
      const a = await this.accountIn(tx);
      if (!a) throw new ConflictException('Conecte a conta PagBank primeiro');
      if (b.cashRegisterId) {
        const r = await one(tx, `SELECT 1 FROM cash_registers WHERE id = $1`, [b.cashRegisterId]);
        if (!r) throw new NotFoundException('Caixa não encontrado');
      }
      await q(
        tx,
        `UPDATE online_pay_accounts SET card_enabled = COALESCE($1, card_enabled),
                pix_enabled = COALESCE($2, pix_enabled),
                cash_register_id = CASE WHEN $3 THEN $4::uuid ELSE cash_register_id END,
                seller_account_id = COALESCE($5, seller_account_id)`,
        [
          b.cardEnabled ?? null,
          b.pixEnabled ?? null,
          b.cashRegisterId !== undefined,
          b.cashRegisterId ?? null,
          b.sellerAccountId ?? null,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'online_pay.settings_updated',
        entity: 'online_pay',
        data: b,
        ip: ctx.ip,
      });
    });
    return this.view(ctx);
  }

  async disconnect(ctx: Ctx) {
    if (ctx.user.role !== 'owner')
      throw new ForbiddenException('Só o administrador do restaurante desconecta a conta PagBank');
    await this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `UPDATE online_pay_accounts SET access_token_enc = NULL, refresh_token_enc = NULL,
                token_expires_at = NULL, public_key = NULL, connected_at = NULL`,
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'online_pay.disconnected',
        entity: 'online_pay',
        ip: ctx.ip,
      });
    });
    return this.view(ctx);
  }

  // ------------------------------------------------------------------ cobrança

  /** Pedido do cardápio pelo link (token), sem depender da loja online. */
  async orderByToken(tx: Tx, token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException('Pedido não encontrado');
    const o = await one<{ id: string; created_at: Date }>(
      tx,
      `SELECT id, created_at FROM orders WHERE public_token_hash = $1`,
      [createHash('sha256').update(token).digest()],
    );
    if (!o || Date.now() - new Date(o.created_at).getTime() > 7 * 86_400_000)
      throw new NotFoundException('Pedido não encontrado');
    return o.id;
  }

  orderIdByToken(tenantId: string, token: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.orderByToken(tx, token));
  }

  /** Pedido do link que é da conta aberta (quem paga é quem pediu). */
  async orderForCustomer(tenantId: string, token: string, customerId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const id = await this.orderByToken(tx, token);
      const o = await one(tx, `SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2`, [
        id,
        customerId,
      ]);
      if (!o) throw new NotFoundException('Pedido não encontrado nesta conta');
      return id;
    });
  }

  /** Pedido da conta do cliente (pelo histórico). */
  async orderOfCustomer(tenantId: string, orderId: string, customerId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const o = await one(tx, `SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2`, [
        orderId,
        customerId,
      ]);
      if (!o) throw new NotFoundException('Pedido não encontrado nesta conta');
      return orderId;
    });
  }

  /**
   * Cria a cobrança (cartão cifrado no celular ou Pix) do que falta pagar. A tentativa é gravada
   * antes de chamar o PagBank; o resultado é aplicado logo depois (ou pelo aviso/conferência).
   */
  async pay(
    tenantId: string,
    orderId: string,
    p:
      | { method: 'card'; encryptedCard: string; holderName: string; payer: Payer }
      | { method: 'pix'; payer: Payer },
    baseUrl: string,
    ip?: string,
  ) {
    const cfg = await this.platformCfg();
    if (!this.ready(cfg) || !cfg.receiverAccountId)
      throw new ConflictException('Esta loja não está recebendo pagamento pelo app agora');
    const fee = await this.feeOf(tenantId, cfg);
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    // 1) Grava a tentativa (ou devolve o Pix que já está esperando).
    const prep = await this.db.withTenant(ctx, async (tx) => {
      const a = await this.accountIn(tx);
      if (!this.connected(a, cfg) || !(p.method === 'card' ? a.card_enabled : a.pix_enabled))
        throw new ConflictException('Esta forma de pagamento não está disponível nesta loja');
      const o = await one<{
        id: string;
        number: number;
        status: string;
        total: string;
        paid_amount: string;
        pay_online: OnlinePayMethod | null;
      }>(
        tx,
        `SELECT id, number, status, total::text, paid_amount::text, pay_online FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      if (!o) throw new NotFoundException('Pedido não encontrado');
      if (!o.pay_online) throw new ConflictException('Este pedido não é pago pelo app');
      if (o.status === 'cancelled') throw new ConflictException('Este pedido foi cancelado');
      const cs = await q<ChargeRow & { pix_text: string | null; pix_expires_at: Date | null }>(
        tx,
        `SELECT id, method, status, pix_text, pix_expires_at, created_at FROM online_charges
          WHERE order_id = $1 ORDER BY created_at`,
        [orderId],
      );
      if (cs.some((c) => c.status === 'paid'))
        throw new ConflictException('Este pedido já foi pago');
      const pending = cs.find((c) => c.status === 'pending');
      if (pending) {
        // Pix esperando e ainda valendo: o mesmo QR Code.
        if (
          p.method === 'pix' &&
          pending.method === 'pix' &&
          pending.pix_text &&
          pending.pix_expires_at &&
          new Date(pending.pix_expires_at).getTime() > Date.now() + 60_000
        )
          return { reuse: pending.id } as const;
        // Trocou de forma (ou o Pix venceu): a tentativa anterior deixa de valer.
        if (pending.method === 'pix' || minutesAgo(pending.created_at) > 2)
          await q(
            tx,
            `UPDATE online_charges SET status = 'expired', last_error = 'trocou a forma de pagamento'
              WHERE id = $1`,
            [pending.id],
          );
        else
          throw new ConflictException(
            'O pagamento anterior ainda está sendo confirmado. Aguarde um instante.',
          );
      }
      if (p.method === 'card' && cs.filter((c) => c.method === 'card').length >= MAX_CARD_ATTEMPTS)
        throw new ConflictException(
          'Muitas tentativas com cartão neste pedido. Pague com Pix ou fale com a loja.',
        );
      const due = toCents(o.total) - toCents(o.paid_amount);
      if (due < 100)
        throw new UnprocessableEntityException('Valor mínimo para pagar pelo app: R$ 1,00');
      const feeCents = platformFeeCents(due, fee.percent, toCents(fee.fixed));
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO online_charges (tenant_id, order_id, method, environment, amount, fee_amount,
                                     fee_percent, fee_fixed, receiver_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          tenantId,
          orderId,
          p.method,
          cfg.environment,
          fromCents(due),
          fromCents(feeCents),
          fee.percent,
          fee.fixed,
          cfg.receiverAccountId,
        ],
      );
      await q(tx, `UPDATE orders SET pay_online = $2, version = version + 1 WHERE id = $1`, [
        orderId,
        p.method,
      ]);
      const token = await this.sellerTokenIn(tx, tenantId, a, cfg);
      return {
        chargeId: c!.id,
        number: o.number,
        due,
        feeCents,
        token,
        seller: a.seller_account_id!,
      } as const;
    });
    if ('reuse' in prep) return this.publicView(tenantId, orderId);
    // 2) PagBank.
    const receivers: SplitReceiver[] | null =
      prep.feeCents > 0
        ? [
            {
              accountId: prep.seller,
              cents: splitParts(prep.due, prep.feeCents).restaurant,
              reason: `Pedido #${prep.number}`,
            },
            { accountId: cfg.receiverAccountId, cents: prep.feeCents, reason: 'Taxa Comandou' },
          ]
        : null;
    const description = `Pedido #${prep.number}`;
    const notifyUrl = `${baseUrl}/api/v1/store/pagbank/notify`;
    const pb = this.client(cfg.environment);
    let res: PagBankOrder | null = null;
    let err: PagBankError | null = null;
    try {
      res =
        p.method === 'card'
          ? await pb.cardOrder(prep.token, {
              referenceId: prep.chargeId,
              description,
              customer: p.payer,
              cents: prep.due,
              encryptedCard: p.encryptedCard,
              holder: { name: p.holderName, taxId: p.payer.taxId },
              receivers,
              notifyUrl,
            })
          : await pb.pixOrder(prep.token, {
              referenceId: prep.chargeId,
              description,
              customer: p.payer,
              cents: prep.due,
              expiresAt: new Date(Date.now() + ONLINE_PAY_WINDOW_MINUTES * 60_000),
              receivers,
              notifyUrl,
            });
    } catch (e) {
      err = e instanceof PagBankError ? e : new PagBankError((e as Error).message, 0);
    }
    // 3) Resultado.
    await this.db.withTenant(ctx, async (tx) => {
      if (res) return this.applyOrderIn(tx, ctx, prep.chargeId, res);
      // Recusa clara (4xx): a tentativa não vale. Sem resposta: fica esperando o aviso.
      const definite = err!.status >= 400 && err!.status < 500;
      await q(
        tx,
        `UPDATE online_charges SET status = CASE WHEN $3 THEN 'declined' ELSE status END,
                decline_reason = CASE WHEN $3 THEN $2 ELSE decline_reason END, last_error = $2
          WHERE id = $1 AND status = 'pending'`,
        [prep.chargeId, err!.message.slice(0, 300), definite],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'online_pay.charge_failed',
        entity: 'order',
        entityId: orderId,
        data: {
          chargeId: prep.chargeId,
          method: p.method,
          status: err!.status,
          error: err!.message,
        },
        ip,
      });
    });
    this.publishOrder(tenantId, orderId);
    return this.publicView(tenantId, orderId);
  }

  /**
   * Aplica a situação de um pedido do PagBank à cobrança (resposta da criação, aviso ou consulta).
   * Pago: grava, devolve se o pedido foi cancelado, senão lança no caixa e aceita o pedido.
   */
  private async applyOrderIn(tx: Tx, ctx: Ctx, chargeId: string, res: PagBankOrder) {
    const c = await one<ChargeRow>(
      tx,
      `SELECT id, order_id, method, status, amount::text, payment_id FROM online_charges WHERE id = $1 FOR UPDATE`,
      [chargeId],
    );
    if (!c) return;
    const ch = lastCharge(res);
    const pix = pixOf(res);
    await q(
      tx,
      `UPDATE online_charges SET pagbank_order_id = COALESCE(pagbank_order_id, $2),
              pagbank_charge_id = COALESCE($3, pagbank_charge_id), pagbank_status = $4,
              card_brand = COALESCE($5, card_brand), card_last4 = COALESCE($6, card_last4),
              pix_text = COALESCE($7, pix_text), pix_expires_at = COALESCE($8, pix_expires_at),
              checked_at = now(), last_error = NULL
        WHERE id = $1`,
      [
        chargeId,
        res.id ?? null,
        ch?.id ?? null,
        ch?.status ?? (pix ? 'WAITING' : null),
        ch?.payment_method?.card?.brand?.slice(0, 30) ?? null,
        /^\d{4}$/.test(ch?.payment_method?.card?.last_digits ?? '')
          ? ch!.payment_method!.card!.last_digits
          : null,
        pix?.text?.slice(0, 600) ?? null,
        pix?.expiresAt && !Number.isNaN(Date.parse(pix.expiresAt)) ? new Date(pix.expiresAt) : null,
      ],
    );
    if (c.status !== 'pending') return;
    const next = chargeStatusOf(ch?.status);
    if (!next) return;
    if (next === 'declined' || next === 'expired') {
      await q(tx, `UPDATE online_charges SET status = $2, decline_reason = $3 WHERE id = $1`, [
        chargeId,
        next,
        next === 'declined' ? declineReasonOf(ch) : null,
      ]);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: null,
        action: `online_pay.charge_${next}`,
        entity: 'order',
        entityId: c.order_id,
        data: { chargeId, code: ch?.payment_response?.code ?? null },
        ip: ctx.ip,
      });
      return;
    }
    // Pago.
    const o = await one<{ status: string }>(tx, `SELECT status FROM orders WHERE id = $1`, [
      c.order_id,
    ]);
    // Pedido cancelado, ou já pago por outra tentativa (ex.: Pix pago enquanto trocava para o
    // cartão): este pagamento é devolvido.
    const twice = await one(
      tx,
      `SELECT 1 FROM online_charges WHERE order_id = $1 AND id <> $2 AND status = 'paid'`,
      [c.order_id, chargeId],
    );
    const cancelled = o?.status === 'cancelled' || !!twice;
    await q(tx, `UPDATE online_charges SET status = $2, paid_at = now() WHERE id = $1`, [
      chargeId,
      cancelled ? 'refund_due' : 'paid',
    ]);
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: null,
      action: cancelled ? 'online_pay.refund_due' : 'online_pay.charge_paid',
      entity: 'order',
      entityId: c.order_id,
      data: { chargeId, method: c.method, amount: c.amount },
      ip: ctx.ip,
    });
    if (cancelled) return;
    await this.acceptPaidIn(tx, ctx, c.order_id);
  }

  /** Pedido pago em análise com aceite automático: vai para a cozinha. */
  private async acceptPaidIn(tx: Tx, ctx: Ctx, orderId: string) {
    const s = await one<{ auto_accept: boolean }>(
      tx,
      `SELECT auto_accept FROM tenant_store_settings`,
    );
    if (!s?.auto_accept) return;
    const o = await this.orders.lock(tx, orderId);
    if (o.status !== 'awaiting') return;
    await this.orders.transitionInTx(tx, onlineCtx(ctx.tenantId), o, 'new', 'Pago pelo app');
  }

  /**
   * Lança no caixa o pagamento aprovado (caixa escolhido ou o aberto há mais tempo). Sem caixa
   * aberto, fica para depois. Travas na ordem do caixa: sessão → comanda → pedido → cobrança.
   */
  async launch(tenantId: string, chargeId: string, sessionId?: string, by?: Ctx) {
    const res = await this.db.withTenant({ tenantId }, async (tx) => {
      const pre = await one<{ order_id: string; method: OnlinePayMethod }>(
        tx,
        `SELECT order_id, method FROM online_charges WHERE id = $1 AND status = 'paid' AND payment_id IS NULL`,
        [chargeId],
      );
      if (!pre) return null;
      const sid =
        sessionId ??
        (
          await one<{ id: string }>(
            tx,
            `SELECT s.id FROM cash_sessions s
               LEFT JOIN online_pay_accounts a ON true
              WHERE s.status = 'open' AND (a.cash_register_id IS NULL OR s.register_id = a.cash_register_id)
              ORDER BY s.opened_at LIMIT 1`,
          )
        )?.id;
      if (!sid) return null;
      const sess = await this.cash.lockSession(tx, sid, 'SHARE');
      await this.orders.lockTabOf(tx, pre.order_id);
      const o = await this.orders.lock(tx, pre.order_id);
      const c = await one<{ amount: string }>(
        tx,
        `SELECT amount::text FROM online_charges WHERE id = $1 AND status = 'paid' AND payment_id IS NULL FOR UPDATE`,
        [chargeId],
      );
      if (!c || o.status === 'cancelled') return null;
      const due = toCents(o.total) - toCents(o.paid_amount);
      const cents = Math.min(due, toCents(c.amount));
      if (cents <= 0) return null;
      const opener = await one<{ opened_by: string }>(
        tx,
        `SELECT opened_by FROM cash_sessions WHERE id = $1`,
        [sess.id],
      );
      // Quem lança: a pessoa da equipe (ao tocar em "Lançar no caixa") ou, sozinho, quem abriu o caixa.
      const ctx: Ctx = by ?? {
        tenantId,
        userId: opener!.opened_by,
        user: ONLINE_CUSTOMER,
      };
      const p = await this.cash.applyPayment(tx, ctx, o, {
        cashSessionId: sess.id,
        method: pre.method === 'card' ? 'credit' : 'pix',
        amountCents: cents,
      });
      await q(tx, `UPDATE online_charges SET payment_id = $2 WHERE id = $1`, [chargeId, p.id]);
      await this.audit.record(tx, {
        tenantId,
        actorUserId: by?.userId ?? null,
        action: 'online_pay.launched',
        entity: 'order',
        entityId: o.id,
        data: { chargeId, paymentId: p.id, sessionId: sess.id, amount: fromCents(cents) },
      });
      const paid = await one<{ payment_status: string }>(
        tx,
        `SELECT payment_status FROM orders WHERE id = $1`,
        [o.id],
      );
      return { orderId: o.id, sessionId: sess.id, paid: paid?.payment_status === 'paid', ctx };
    });
    if (!res) return false;
    this.publishOrder(tenantId, res.orderId);
    this.realtime.publish(tenantId, { type: 'cash.changed', sessionId: res.sessionId });
    if (res.paid) this.cash.notifyPaid(res.ctx, res.orderId);
    return true;
  }

  /** A equipe lança na hora, no caixa que escolheu. */
  async launchByStaff(ctx: Ctx, orderId: string, cashSessionId: string) {
    const c = await this.db.withTenant(ctx, (tx) =>
      one<{ id: string }>(
        tx,
        `SELECT id FROM online_charges WHERE order_id = $1 AND status = 'paid' AND payment_id IS NULL`,
        [orderId],
      ),
    );
    if (!c) throw new ConflictException('Este pedido não tem pagamento do app para lançar');
    const ok = await this.launch(ctx.tenantId, c.id, cashSessionId, ctx);
    if (!ok) throw new ConflictException('Não deu para lançar: confira se o caixa está aberto');
    return this.orders.get(ctx, orderId);
  }

  // ------------------------------------------------------------------ avisos e conferência

  /**
   * Aviso do PagBank. O corpo só diz qual pedido mudou: a situação vem da consulta ao PagBank com
   * o token do restaurante.
   */
  async notify(tenantId: string, body: unknown) {
    const b = (body ?? {}) as { id?: unknown; reference_id?: unknown };
    const ref = typeof b.reference_id === 'string' ? b.reference_id : null;
    const pbId = typeof b.id === 'string' ? b.id : null;
    const c = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ id: string }>(
        tx,
        `SELECT id FROM online_charges
          WHERE ($1::text IS NOT NULL AND id::text = $1) OR ($2::text IS NOT NULL AND pagbank_order_id = $2)
          LIMIT 1`,
        [ref && /^[0-9a-f-]{36}$/.test(ref) ? ref : null, pbId && pbId.length <= 80 ? pbId : null],
      ),
    );
    if (c) await this.sync(tenantId, c.id, pbId);
    return { ok: true };
  }

  /** Consulta o PagBank e aplica (aviso, conferência do ciclo ou "Conferir" da equipe). */
  async sync(tenantId: string, chargeId: string, pagbankOrderId?: string | null) {
    const cfg = await this.platformCfg();
    if (!this.ready(cfg)) return;
    const ctx = onlineCtx(tenantId);
    const pre = await this.db.withTenant(ctx, async (tx) => {
      const c = await one<ChargeRow>(
        tx,
        `SELECT id, order_id, status, pagbank_order_id, environment FROM online_charges WHERE id = $1`,
        [chargeId],
      );
      const a = await this.accountIn(tx);
      if (!c || !a?.access_token_enc || a.environment !== c.environment) return null;
      return { c, token: await this.sellerTokenIn(tx, tenantId, a, cfg) };
    });
    const id = pre?.c.pagbank_order_id ?? pagbankOrderId;
    if (!pre || !id) return;
    const res = await this.client(pre.c.environment).order(pre.token, id);
    // O pedido do PagBank tem de ser desta cobrança.
    if (res.reference_id && res.reference_id !== chargeId) return;
    const before = pre.c.status;
    await this.db.withTenant(ctx, (tx) => this.applyOrderIn(tx, ctx, chargeId, res));
    if (before === 'pending') this.publishOrder(tenantId, pre.c.order_id);
  }

  /**
   * Pedido cancelado (pela equipe, pelo cliente em análise ou pelo prazo): cobranças esperando
   * deixam de valer; paga e fora do caixa vira "a devolver" (o ciclo devolve no PagBank).
   */
  private async onOrderCancelledIn(tx: Tx, ctx: Ctx, orderId: string) {
    await q(
      tx,
      `UPDATE online_charges SET status = 'expired' WHERE order_id = $1 AND status = 'pending'`,
      [orderId],
    );
    const due = await q<{ id: string; amount: string }>(
      tx,
      `UPDATE online_charges SET status = 'refund_due'
        WHERE order_id = $1 AND status = 'paid' AND payment_id IS NULL RETURNING id, amount::text`,
      [orderId],
    );
    for (const d of due)
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'online_pay.refund_due',
        entity: 'order',
        entityId: orderId,
        data: { chargeId: d.id, amount: d.amount },
        ip: ctx.ip,
      });
  }

  /** Estorno no caixa de um pagamento do app: devolve no PagBank antes (falhou, não estorna). */
  private async onRefundIn(tx: Tx, ctx: Ctx, paymentId: string, cents: number) {
    const c = await one<ChargeRow>(
      tx,
      `SELECT id, order_id, environment, status, amount::text, refunded_amount::text, pagbank_charge_id
         FROM online_charges WHERE payment_id = $1 FOR UPDATE`,
      [paymentId],
    );
    if (!c) return;
    if (!c.pagbank_charge_id)
      throw new ConflictException(
        'Pagamento do app sem o registro do PagBank: estorne pelo PagBank',
      );
    const cfg = await this.platformCfg();
    const a = await this.accountIn(tx);
    if (!cfg || !a?.access_token_enc || a.environment !== c.environment)
      throw new ConflictException(
        'Para estornar um pagamento do app, a conta PagBank precisa estar conectada',
      );
    const token = await this.sellerTokenIn(tx, ctx.tenantId, a, cfg);
    const refunded = toCents(c.refunded_amount) + cents;
    try {
      await this.client(c.environment).cancelCharge(
        token,
        c.pagbank_charge_id,
        cents,
        `${c.id}-${refunded}`,
      );
    } catch (e) {
      throw new ConflictException(`O PagBank não estornou: ${(e as Error).message}`);
    }
    await q(
      tx,
      `UPDATE online_charges SET refunded_amount = $2,
              status = CASE WHEN $2 >= amount THEN 'refunded' ELSE status END
        WHERE id = $1`,
      [c.id, fromCents(refunded)],
    );
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'online_pay.refunded',
      entity: 'order',
      entityId: c.order_id,
      data: { chargeId: c.id, amount: fromCents(cents), paymentId },
      ip: ctx.ip,
    });
  }

  /** Devolve no PagBank um pagamento de pedido cancelado que não entrou no caixa. */
  private async refundDue(tenantId: string, chargeId: string) {
    const cfg = await this.platformCfg();
    if (!this.ready(cfg)) return;
    await this.db.withTenant({ tenantId }, async (tx) => {
      const c = await one<ChargeRow>(
        tx,
        `SELECT id, order_id, environment, amount::text, refunded_amount::text, pagbank_charge_id
           FROM online_charges WHERE id = $1 AND status = 'refund_due' FOR UPDATE SKIP LOCKED`,
        [chargeId],
      );
      const a = await this.accountIn(tx);
      if (!c?.pagbank_charge_id || !a?.access_token_enc || a.environment !== c.environment) return;
      const token = await this.sellerTokenIn(tx, tenantId, a, cfg);
      const cents = toCents(c.amount) - toCents(c.refunded_amount);
      try {
        await this.client(c.environment).cancelCharge(
          token,
          c.pagbank_charge_id,
          cents,
          `${c.id}-${toCents(c.amount)}`,
        );
      } catch (e) {
        await q(tx, `UPDATE online_charges SET last_error = $2 WHERE id = $1`, [
          c.id,
          (e as Error).message.slice(0, 300),
        ]);
        return;
      }
      await q(
        tx,
        `UPDATE online_charges SET status = 'refunded', refunded_amount = amount, last_error = NULL WHERE id = $1`,
        [c.id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'online_pay.refunded',
        entity: 'order',
        entityId: c.order_id,
        data: { chargeId: c.id, amount: fromCents(cents), auto: true },
      });
    });
  }

  /** Cancela sozinho o pedido pago pelo app sem pagamento depois do prazo. */
  private async expireOrder(tenantId: string, orderId: string) {
    const ctx = onlineCtx(tenantId);
    const done = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (o.status !== 'awaiting' || toCents(o.paid_amount) > 0) return false;
      const paid = await one(
        tx,
        `SELECT 1 FROM online_charges WHERE order_id = $1 AND status IN ('paid','refund_due','refunded')`,
        [orderId],
      );
      if (paid) return false;
      await this.orders.transitionInTx(tx, ctx, o, 'cancelled', 'Pagamento não concluído');
      return true;
    });
    if (done)
      this.realtime.publish(tenantId, { type: 'order.changed', orderId, status: 'cancelled' });
  }

  /** Um restaurante: confere pendentes, cancela vencidos, lança no caixa e devolve. */
  async sweepTenant(tenantId: string) {
    const work = await this.db.withTenant({ tenantId }, async (tx) => ({
      pending: await q<{ id: string }>(
        tx,
        `SELECT id FROM online_charges WHERE status = 'pending' AND created_at < now() - interval '1 minute'
            AND pagbank_order_id IS NOT NULL ORDER BY created_at LIMIT 50`,
      ),
      lost: await q<{ id: string; order_id: string }>(
        tx,
        `UPDATE online_charges SET status = 'expired', last_error = 'sem resposta do PagBank'
          WHERE status = 'pending' AND pagbank_order_id IS NULL
            AND created_at < now() - make_interval(mins => $1)
        RETURNING id, order_id`,
        [ONLINE_PAY_WINDOW_MINUTES],
      ),
      expired: await q<{ id: string }>(
        tx,
        `SELECT o.id FROM orders o
          WHERE o.pay_online IS NOT NULL AND o.status = 'awaiting' AND o.payment_status <> 'paid'
            AND o.created_at < now() - make_interval(mins => $1)
            AND NOT EXISTS (SELECT 1 FROM online_charges c WHERE c.order_id = o.id
                             AND c.status IN ('paid','refund_due','refunded','pending'))
          LIMIT 50`,
        [ONLINE_PAY_WINDOW_MINUTES],
      ),
      launch: await q<{ id: string }>(
        tx,
        `SELECT id FROM online_charges WHERE status = 'paid' AND payment_id IS NULL LIMIT 50`,
      ),
      refund: await q<{ id: string }>(
        tx,
        `SELECT id FROM online_charges WHERE status = 'refund_due' LIMIT 50`,
      ),
    }));
    for (const l of work.lost)
      this.logger.warn(`cobrança ${l.id} sem resposta do PagBank: confira no painel do PagBank`);
    for (const c of work.pending) await this.sync(tenantId, c.id).catch((e) => this.warn(e));
    for (const c of work.launch) await this.launch(tenantId, c.id).catch((e) => this.warn(e));
    for (const c of work.refund) await this.refundDue(tenantId, c.id).catch((e) => this.warn(e));
    for (const o of work.expired) await this.expireOrder(tenantId, o.id).catch((e) => this.warn(e));
  }

  private warn(e: unknown) {
    this.logger.warn(`pagamento pelo app: ${(e as Error).message}`);
  }

  /** Restaurantes com algo a fazer (banco central e bancos próprios). */
  private async tenantsWithWork(): Promise<string[]> {
    if (!this.platformDb.enabled) return [];
    const sql = `SELECT DISTINCT tenant_id FROM online_charges
                  WHERE status IN ('pending','refund_due') OR (status = 'paid' AND payment_id IS NULL)
                 UNION
                 SELECT DISTINCT tenant_id FROM online_pay_accounts WHERE connected_at IS NOT NULL`;
    const ids = new Set<string>();
    for (const r of await this.platformDb.query<{ tenant_id: string }>(sql)) ids.add(r.tenant_id);
    for (const d of await this.platformDb.eachDedicated<{ tenant_id: string }>(sql))
      for (const r of d.rows) ids.add(r.tenant_id);
    return [...ids];
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      for (const t of await this.tenantsWithWork())
        await this.sweepTenant(t).catch((e) => this.warn(e));
    } finally {
      this.running = false;
    }
  }

  private async sweepSafely() {
    try {
      const cfg = await this.platformCfg();
      if (this.ready(cfg)) await this.sweep();
    } catch (e) {
      this.warn(e);
    }
  }

  // ------------------------------------------------------------------ telas

  private publishOrder(tenantId: string, orderId: string) {
    this.realtime.publish(tenantId, { type: 'order.changed', orderId });
  }

  /** Pagamento do pedido pelo app, para o cliente (acompanhamento). */
  async publicView(tenantId: string, orderId: string) {
    return this.db.withTenant({ tenantId }, (tx) => this.publicViewIn(tx, orderId));
  }

  async publicViewIn(tx: Tx, orderId: string) {
    const o = await one<{
      status: string;
      total: string;
      paid_amount: string;
      pay_online: OnlinePayMethod | null;
    }>(tx, `SELECT status, total::text, paid_amount::text, pay_online FROM orders WHERE id = $1`, [
      orderId,
    ]);
    if (!o?.pay_online) return null;
    const cs = await q<{
      method: OnlinePayMethod;
      status: OnlineChargeStatus;
      amount: string;
      card_brand: string | null;
      card_last4: string | null;
      decline_reason: string | null;
      pix_text: string | null;
      pix_expires_at: Date | null;
    }>(
      tx,
      `SELECT method, status, amount::text, card_brand, card_last4, decline_reason, pix_text, pix_expires_at
         FROM online_charges WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    );
    const last = cs[cs.length - 1];
    const paid =
      cs.find((c) => c.status === 'paid') ??
      cs.find((c) => c.status === 'refund_due' || c.status === 'refunded');
    const cardTries = cs.filter((c) => c.method === 'card').length;
    const open = o.status !== 'cancelled' && !paid;
    const due = fromCents(Math.max(0, toCents(o.total) - toCents(o.paid_amount)));
    // O que a loja aceita agora (o acompanhamento abre sem o cardápio carregado).
    const cfg = open ? await this.platformCfg().catch(() => null) : null;
    const a = open ? await this.accountIn(tx) : null;
    const offer =
      open && this.ready(cfg) && cfg.receiverAccountId && this.connected(a, cfg)
        ? {
            card: a.card_enabled,
            pix: a.pix_enabled,
            publicKey: a.card_enabled ? a.public_key : null,
            env: cfg.environment === 'production' ? ('PROD' as const) : ('SANDBOX' as const),
          }
        : null;
    return {
      method: o.pay_online,
      offer,
      status: (paid?.status ?? last?.status ?? 'waiting') as OnlineChargeStatus | 'waiting',
      amount: paid?.amount ?? due,
      card:
        (paid ?? last)?.card_last4 != null
          ? { brand: (paid ?? last)!.card_brand, last4: (paid ?? last)!.card_last4 }
          : null,
      declineReason: !paid && last?.status === 'declined' ? last.decline_reason : null,
      pix:
        open && last?.method === 'pix' && last.status === 'pending' && last.pix_text
          ? { code: last.pix_text, expiresAt: last.pix_expires_at }
          : null,
      cardAttemptsLeft: Math.max(0, MAX_CARD_ATTEMPTS - cardTries),
      canPay: open && last?.status !== 'pending',
      processing: open && last?.status === 'pending' && last.method === 'card',
    };
  }

  /** "Conferir no PagBank" de um pedido: consulta as esperando e lança no caixa as pagas. */
  async sweepOrder(tenantId: string, orderId: string) {
    const cs = await this.db.withTenant({ tenantId }, (tx) =>
      q<{ id: string; status: string; payment_id: string | null }>(
        tx,
        `SELECT id, status, payment_id FROM online_charges WHERE order_id = $1`,
        [orderId],
      ),
    );
    for (const c of cs) {
      if (c.status === 'pending') await this.sync(tenantId, c.id);
      if (c.status === 'refund_due') await this.refundDue(tenantId, c.id);
    }
    const paid = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ id: string }>(
        tx,
        `SELECT id FROM online_charges WHERE order_id = $1 AND status = 'paid' AND payment_id IS NULL`,
        [orderId],
      ),
    );
    if (paid) await this.launch(tenantId, paid.id);
  }

  staffCharges(ctx: Ctx, orderId: string) {
    return this.db.withTenant(ctx, (tx) => this.staffChargesIn(tx, orderId));
  }

  /** Para a equipe: cobranças do pedido (no detalhe). */
  staffChargesIn(tx: Tx, orderId: string) {
    return q(
      tx,
      `SELECT id, method, status, amount::text, fee_amount::text AS "feeAmount",
              refunded_amount::text AS "refundedAmount", card_brand AS "cardBrand", card_last4 AS "cardLast4",
              decline_reason AS "declineReason", payment_id AS "paymentId", last_error AS "lastError",
              created_at AS "createdAt", paid_at AS "paidAt"
         FROM online_charges WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    );
  }
}
