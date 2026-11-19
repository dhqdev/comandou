import type { ChannelCancelReason, ChannelCapability, ExternalOrder } from '@comandou/shared';
import { channelInfo } from '@comandou/shared';
import {
  ChannelHttpError,
  type ActionRequest,
  type ChannelAdapter,
  type ChannelEvent,
  type OrderRef,
  type PollBatch,
} from '../channels/channel-adapter';
import type { ChannelCredentials } from '../channels/channel-credentials.service';
import {
  ChannelHttp,
  RateGate,
  type ChannelRequest,
  type ChannelSigner,
  type Fetcher,
} from '../channels/channel-http';
import type { ChannelMetrics } from '../channels/channel-metrics';
import {
  OD_ACK_BATCH,
  OD_CANCEL_REASONS,
  OD_LIMITS,
  OD_PATHS,
  jcs,
  keetaSignature,
  keetaSignatureString,
  odCancelCode,
  odDriverUpdate,
  odEventKind,
  odRefundDispute,
  odRefundSettlement,
  odToExternal,
  odVerb,
  type OdOrder,
} from './od-order';

interface OdEvent {
  eventId?: string;
  eventType?: string;
  orderId?: string;
  createdAt?: string;
  sourceAppId?: string;
  metadata?: unknown;
}

/** Como cada aplicativo do padrão difere (a Keeta assina tudo e pede o cadastro da loja). */
export interface OdDialect {
  /** 'keeta' ou 'opendelivery' (ou um `od-<nome>` no futuro). */
  channel: string;
  /** Keeta: X-App-Signature em toda chamada e corpo canônico (RFC 8785). */
  signed: boolean;
  /** Keeta: token por JSON com `app_level_token`; padrão V1: formulário com `client_credentials`. */
  token: 'keeta' | 'form';
  /** Keeta: a loja precisa do PUT /v1/merchantOnboarding antes de receber eventos. */
  onboarding: boolean;
  capabilities: readonly ChannelCapability[];
}

export const KEETA_DIALECT: OdDialect = {
  channel: 'keeta',
  signed: true,
  token: 'keeta',
  onboarding: true,
  capabilities: [
    'orders',
    'polling',
    'confirm',
    'reject',
    'ready',
    'dispatch',
    'delivered',
    'cancel',
    'disputes',
  ],
};

export const OPEN_DELIVERY_DIALECT: OdDialect = {
  channel: 'opendelivery',
  signed: false,
  token: 'form',
  onboarding: false,
  capabilities: [
    'orders',
    'polling',
    'confirm',
    'reject',
    'startPreparation',
    'ready',
    'dispatch',
    'delivered',
    'cancel',
  ],
};

/** Credencial de polling: um token do aplicativo para todas as lojas autorizadas. */
export const odCredential = (channel: string) => `${channel}:app`;

/**
 * Adaptador do Open Delivery V1 (e da Keeta, que o segue com ajustes). Polling por loja (o evento
 * do padrão não diz de que loja é, e cada loja pode ser de um restaurante), ack do que foi
 * gravado, detalhes do pedido e as ações. Token do aplicativo (client credentials) guardado em
 * memória até perto de vencer; 401 renova uma vez e repete; 4xx nunca se repete.
 */
export class OpenDeliveryAdapter implements ChannelAdapter {
  readonly id: string;
  readonly capabilities: readonly ChannelCapability[];
  private readonly label: string;
  private http?: { base: string; client: ChannelHttp };
  private token?: { value: string; until: number; key: string };
  private readonly gate = new RateGate();

  constructor(
    readonly dialect: OdDialect,
    private readonly creds: ChannelCredentials,
    private readonly metrics: ChannelMetrics,
    /** Base da API: fixa (Keeta, pelo .env) ou a cadastrada em Credenciais (padrão). */
    private readonly baseOf: () => Promise<string | null>,
    private readonly fetcher: () => Fetcher = () => fetch,
  ) {
    this.id = dialect.channel;
    this.capabilities = dialect.capabilities;
    this.label = channelInfo(dialect.channel).label;
  }

  private async app() {
    const c = await this.creds.get(this.id);
    if (!c) throw new ChannelHttpError(401, `Chaves do ${this.label} não cadastradas no Comandou`);
    return c;
  }

  private async client(secret: string): Promise<ChannelHttp> {
    const base = await this.baseOf();
    if (!base) throw new ChannelHttpError(400, `Endereço do ${this.label} não cadastrado`);
    const key = `${base}|${secret.slice(-6)}`;
    if (this.http?.base !== key) {
      const signer: ChannelSigner | undefined = this.dialect.signed
        ? ({ url, params, body }) => ({
            'X-App-Signature': keetaSignature(secret, keetaSignatureString(url, params, body)),
          })
        : undefined;
      this.http = {
        base: key,
        client: new ChannelHttp(
          this.id,
          base,
          this.metrics,
          this.gate,
          this.fetcher,
          15_000,
          signer,
          this.dialect.signed ? jcs : JSON.stringify,
        ),
      };
    }
    return this.http.client;
  }

  /** Token do aplicativo, guardado até 5 minutos antes de vencer. */
  private async bearer(forget = false): Promise<{ token: string; http: ChannelHttp }> {
    const c = await this.app();
    const http = await this.client(c.clientSecret);
    const key = `${c.clientId}|${c.last4}`;
    if (forget) this.token = undefined;
    if (this.token && this.token.key === key && Date.now() < this.token.until)
      return { token: this.token.value, http };
    const r = await http.request<{ access_token?: string; expires_in?: number }>({
      endpoint: 'auth:token',
      method: 'POST',
      path: OD_PATHS.token,
      ...(this.dialect.token === 'keeta'
        ? {
            json: {
              client_id: c.clientId,
              client_secret: c.clientSecret,
              grant_type: 'app_level_token',
            },
          }
        : {
            form: {
              grant_type: 'client_credentials',
              client_id: c.clientId,
              client_secret: c.clientSecret,
            },
          }),
      perMinute: OD_LIMITS.token,
      retries: 1,
    });
    const value = r.body?.access_token;
    if (!value || typeof value !== 'string')
      throw new ChannelHttpError(502, `O ${this.label} não devolveu o token`);
    const ttl = Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) : 3600;
    this.token = { value, key, until: Date.now() + Math.max(60, ttl - 300) * 1000 };
    return { token: value, http };
  }

  /** Chamada com o token do aplicativo; 401 → token novo e uma repetição. */
  async call<T>(r: Omit<ChannelRequest, 'token'>) {
    for (let attempt = 0; ; attempt++) {
      const { token, http } = await this.bearer(attempt > 0);
      try {
        return await http.request<T>({ ...r, token });
      } catch (e) {
        if (e instanceof ChannelHttpError && e.status === 401 && attempt === 0) continue;
        throw e;
      }
    }
  }

  /**
   * Busca de eventos, uma loja por chamada: o evento do padrão não traz a loja, e a loja define o
   * restaurante. Loja que falhou fica para a próxima rodada; se todas falharem, o erro sobe.
   */
  async poll(batch: PollBatch): Promise<ChannelEvent[]> {
    const out: ChannelEvent[] = [];
    let lastError: unknown = null;
    let ok = 0;
    for (const s of batch.stores) {
      let list: OdEvent[];
      try {
        const r = await this.call<OdEvent[] | null>({
          endpoint: 'events:polling',
          method: 'GET',
          path: OD_PATHS.polling,
          headers: { 'x-polling-merchants': s.storeId },
          perMinute: OD_LIMITS.polling,
          retries: 0,
        });
        list = Array.isArray(r.body) ? r.body : [];
        ok++;
      } catch (e) {
        lastError = e;
        continue;
      }
      for (const e of list.slice(0, 500)) {
        if (!e?.eventId || typeof e.eventId !== 'string') continue;
        const kind = odEventKind(e.eventType);
        const orderId = typeof e.orderId === 'string' ? e.orderId.slice(0, 100) : undefined;
        out.push({
          id: e.eventId.slice(0, 120),
          code: String(e.eventType ?? 'UNKNOWN').slice(0, 60),
          kind,
          storeId: s.storeId.toLowerCase(),
          ...(orderId ? { orderId } : {}),
          occurredAt:
            e.createdAt && Number.isFinite(Date.parse(e.createdAt))
              ? e.createdAt
              : new Date().toISOString(),
          // Sem dados pessoais: o pedido é buscado à parte.
          payload: {
            eventType: e.eventType ?? null,
            ...(kind === 'order.dispute' && orderId
              ? { dispute: odRefundDispute(orderId, e.metadata) }
              : {}),
            ...(kind === 'order.dispute_settled' && orderId
              ? { settlement: odRefundSettlement(orderId, e.eventType) }
              : {}),
            ...(kind === 'delivery.update' ? { delivery: odDriverUpdate(e.eventType) } : {}),
          },
        });
      }
    }
    if (!ok && lastError) throw lastError;
    return out;
  }

  async ack(_batch: PollBatch, events: ChannelEvent[]) {
    for (let i = 0; i < events.length; i += OD_ACK_BATCH) {
      const part = events.slice(i, i + OD_ACK_BATCH);
      await this.call({
        endpoint: 'events:ack',
        method: 'POST',
        path: OD_PATHS.ack,
        json: part.map((e) => ({
          id: e.id,
          eventType: e.code,
          ...(e.orderId ? { orderId: e.orderId } : {}),
        })),
        perMinute: OD_LIMITS.ack,
        retries: 2,
      });
    }
  }

  async fetchOrder(ref: OrderRef): Promise<ExternalOrder> {
    const r = await this.call<OdOrder>({
      endpoint: 'orders:details',
      method: 'GET',
      path: OD_PATHS.order(ref.externalOrderId),
      perMinute: OD_LIMITS.order,
      retries: 0,
    });
    if (!r.body || typeof r.body !== 'object' || !r.body.id)
      throw new ChannelHttpError(502, `O ${this.label} devolveu o pedido vazio`);
    const o = odToExternal(r.body, this.id, this.label);
    // O id da loja no pedido é o do aplicativo; a loja que buscou é a que vale.
    o.storeId = ref.storeId;
    return o;
  }

  async cancellationReasons(): Promise<ChannelCancelReason[]> {
    return OD_CANCEL_REASONS;
  }

  async send(req: ActionRequest) {
    const verb = odVerb(req.action);
    if (!verb) return;
    const p = req.payload as {
      reason?: string;
      cancellationCode?: string;
      orderCode?: string;
      createdAt?: string;
      preparationMinutes?: number;
    };
    let json: Record<string, unknown> | undefined;
    if (verb === 'confirm') {
      json = {
        createdAt:
          p.createdAt && Number.isFinite(Date.parse(p.createdAt))
            ? p.createdAt
            : new Date().toISOString(),
        orderExternalCode: String(p.orderCode ?? req.externalOrderId).slice(0, 40),
        ...(Number.isInteger(p.preparationMinutes) && p.preparationMinutes! > 0
          ? { preparationTime: p.preparationMinutes }
          : {}),
      };
    } else if (verb === 'requestCancellation') {
      json = {
        reason: (p.reason?.trim() || 'Pedido cancelado pelo restaurante').slice(0, 250),
        code: odCancelCode(p.cancellationCode),
        mode: 'MANUAL',
      };
    }
    try {
      await this.call({
        endpoint: `orders:${verb.toLowerCase()}`,
        method: 'POST',
        path: OD_PATHS.action(req.externalOrderId, verb),
        ...(json ? { json } : {}),
        perMinute: OD_LIMITS.action,
        // A caixa de saída repete com espera crescente (5xx/429); aqui não.
        retries: 0,
      });
    } catch (e) {
      // 422 = a mesma instrução já foi aceita antes (o padrão pede para não repetir).
      if (e instanceof ChannelHttpError && e.status === 422) return;
      throw e;
    }
  }

  /** Keeta: liga a loja da Keeta ao id dela no Comandou (sem isso não chega evento nenhum). */
  async onboard(storeId: string, channelStoreId: string) {
    if (!this.dialect.onboarding) return;
    const n = Number(channelStoreId);
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new ChannelHttpError(400, `Código da loja na ${this.label} inválido`);
    await this.call({
      endpoint: 'merchant:onboarding',
      method: 'PUT',
      path: `${OD_PATHS.onboarding}?merchantId=${encodeURIComponent(storeId)}`,
      json: { keetaMerchantId: n },
      perMinute: OD_LIMITS.onboarding,
      retries: 1,
    });
  }
}
