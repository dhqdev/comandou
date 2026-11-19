import type {
  ChannelAction,
  ChannelCancelReason,
  ChannelCapability,
  ExternalOrder,
} from '@comandou/shared';
import { channelInfo, withArticle } from '@comandou/shared';
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
  OD_99FOOD_EVENT_TYPES,
  odDenyCode,
  odDispute,
  odDriverUpdate,
  odEventKind,
  odSettlement,
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

/**
 * Como cada aplicativo do padrão difere: a Keeta assina tudo e pede o cadastro da loja; a 99Food
 * dá um token por loja e pede os tipos de evento e o início da janela no polling.
 */
export interface OdDialect {
  /** 'keeta', '99food', 'aiqfome', 'opendelivery' ou um `od-<nome>` cadastrado no Super Admin. */
  channel: string;
  /** Nome na tela, quando não é um canal conhecido (os `od-<nome>`). */
  label?: string;
  /** Keeta: X-App-Signature em toda chamada e corpo canônico (RFC 8785). */
  signed: boolean;
  /**
   * Keeta: token do aplicativo por JSON com `app_level_token`; padrão V1: formulário com
   * `client_credentials`; 99Food ('store'): o mesmo formulário, mas um token por loja, com
   * `client_id` = `<App ID>_<id da loja>`. aiqfome ('oauth'): um token por loja, que a própria
   * loja autorizou no ID Magalu (renovação cifrada em channel_stores, ver `StoreTokenSource`).
   */
  token: 'keeta' | 'form' | 'store' | 'oauth';
  /** Keeta: a loja precisa do PUT /v1/merchantOnboarding antes de receber eventos. */
  onboarding: boolean;
  /** Parâmetros do polling (99Food: eventType e fromTime são obrigatórios). */
  pollQuery?: (now: Date) => string;
  /** 99Food: retirada no balcão se avisa com /pickedUp. */
  pickedUp?: boolean;
  /** Pedidos de token por minuto que o Comandou se permite (token por loja precisa de mais). */
  tokenPerMinute?: number;
  /** Caminho de uma ação quando o aplicativo foge do padrão (aiqfome: `ready-for-pickup`). */
  verbs?: Partial<Record<string, string>>;
  /** aiqfome: "pronto para retirar" só existe no pedido de retirada. */
  readyOnlyPickup?: boolean;
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

/** Janela da 99Food: 24 horas para trás (evento sem ack mais velho que isso já se perdeu). */
const fromTime99 = (now: Date) =>
  new Date(now.getTime() - 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const FOOD99_DIALECT: OdDialect = {
  channel: '99food',
  signed: false,
  token: 'store',
  onboarding: false,
  pickedUp: true,
  tokenPerMinute: 240,
  pollQuery: (now) =>
    [
      ...OD_99FOOD_EVENT_TYPES.map((t) => `eventType=${t}`),
      `fromTime=${encodeURIComponent(fromTime99(now))}`,
    ].join('&'),
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

/**
 * aiqfome (e Magalu Delivery) pela camada Open Delivery deles: polling por loja com o token que a
 * loja autorizou no ID Magalu, ack com id + pedido + tipo, aceite, pronto (só retirada), saiu e
 * entregue. Recusar e cancelar ficam no gestor do aiqfome (a camada não oferece).
 */
export const AIQFOME_DIALECT: OdDialect = {
  channel: 'aiqfome',
  signed: false,
  token: 'oauth',
  onboarding: true,
  verbs: { readyForPickup: 'ready-for-pickup' },
  readyOnlyPickup: true,
  capabilities: ['orders', 'polling', 'confirm', 'ready', 'dispatch', 'delivered'],
};

/** Aplicativo Open Delivery cadastrado no Super Admin (`od-<nome>`): o padrão V1, sem ajustes. */
export function customOdDialect(channel: string, label: string): OdDialect {
  return { ...OPEN_DELIVERY_DIALECT, channel, label };
}

/** Token de uma loja que autorizou o Comandou (aiqfome): guardado cifrado, renovado com trava. */
export interface StoreTokenSource {
  get(tenantId: string, storeId: string, forget: boolean): Promise<string>;
}

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
  readonly label: string;
  private http?: { base: string; client: ChannelHttp };
  /** Tokens guardados: '*' = do aplicativo; na 99Food, um por loja. */
  private readonly tokens = new Map<string, { value: string; until: number; key: string }>();
  private readonly gate = new RateGate();

  constructor(
    readonly dialect: OdDialect,
    private readonly creds: ChannelCredentials,
    private readonly metrics: ChannelMetrics,
    /** Base da API: fixa (Keeta, pelo .env) ou a cadastrada em Credenciais (padrão). */
    private readonly baseOf: () => Promise<string | null>,
    private readonly fetcher: () => Fetcher = () => fetch,
    private readonly storeTokens?: StoreTokenSource,
  ) {
    this.id = dialect.channel;
    this.capabilities = dialect.capabilities;
    this.label = channelInfo(dialect.channel, dialect.label).label;
  }

  /** Token por loja (99Food e aiqfome): cada loja busca, dá ack e age com o dela. */
  private get perStore() {
    return this.dialect.token === 'store' || this.dialect.token === 'oauth';
  }

  private async app() {
    const c = await this.creds.get(this.id);
    if (!c)
      throw new ChannelHttpError(
        401,
        `Chaves ${withArticle(this.label, 'do')} não cadastradas no Comandou`,
      );
    return c;
  }

  private async client(secret: string): Promise<ChannelHttp> {
    const base = await this.baseOf();
    if (!base)
      throw new ChannelHttpError(400, `Endereço ${withArticle(this.label, 'do')} não cadastrado`);
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

  /**
   * Token do aplicativo (ou da loja, na 99Food), guardado até 5 minutos antes de vencer. Na 99Food
   * o `client_id` é `<App ID>_<id da loja>` e a loja precisa estar vinculada ao app do Comandou.
   */
  private async bearer(
    forget = false,
    storeId?: string,
    tenantId?: string,
  ): Promise<{ token: string; http: ChannelHttp }> {
    const c = await this.app();
    const http = await this.client(c.clientSecret);
    if (this.dialect.token === 'oauth') {
      if (!storeId || !tenantId || !this.storeTokens)
        throw new ChannelHttpError(400, 'Loja não informada');
      return { token: await this.storeTokens.get(tenantId, storeId, forget), http };
    }
    const perStore = this.dialect.token === 'store';
    if (perStore && !storeId) throw new ChannelHttpError(400, 'Loja não informada');
    const scope = perStore ? storeId! : '*';
    const clientId = perStore ? `${c.clientId}_${storeId}` : c.clientId;
    const key = `${clientId}|${c.last4}`;
    if (forget) this.tokens.delete(scope);
    const cached = this.tokens.get(scope);
    if (cached && cached.key === key && Date.now() < cached.until)
      return { token: cached.value, http };
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
              client_id: clientId,
              client_secret: c.clientSecret,
            },
          }),
      perMinute: this.dialect.tokenPerMinute ?? OD_LIMITS.token,
      retries: 1,
    });
    const value = r.body?.access_token;
    if (!value || typeof value !== 'string')
      throw new ChannelHttpError(502, `${withArticle(this.label, 'O')} não devolveu o token`);
    const ttl = Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) : 3600;
    // Loja que saiu do app deixa o token aqui até vencer; o limite evita crescer sem fim.
    if (this.tokens.size > 5000) this.tokens.clear();
    this.tokens.set(scope, { value, key, until: Date.now() + Math.max(60, ttl - 300) * 1000 });
    return { token: value, http };
  }

  /** Chamada com o token do aplicativo (ou da loja); 401 → token novo e uma repetição. */
  async call<T>(r: Omit<ChannelRequest, 'token'>, storeId?: string, tenantId?: string) {
    for (let attempt = 0; ; attempt++) {
      const { token, http } = await this.bearer(attempt > 0, storeId, tenantId);
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
        const q = this.dialect.pollQuery?.(new Date());
        const perStore = this.perStore;
        const r = await this.call<OdEvent[] | null>(
          {
            endpoint: 'events:polling',
            method: 'GET',
            path: q ? `${OD_PATHS.polling}?${q}` : OD_PATHS.polling,
            // Token por loja (99Food, aiqfome) já diz de quem são os eventos.
            ...(perStore ? {} : { headers: { 'x-polling-merchants': s.storeId } }),
            perMinute: OD_LIMITS.polling,
            retries: 0,
          },
          s.storeId,
          s.tenantId,
        );
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
              ? { dispute: odDispute(orderId, e.eventType, e.metadata) }
              : {}),
            ...(kind === 'order.dispute_settled' && orderId
              ? { settlement: odSettlement(orderId, e.eventType) }
              : {}),
            ...(kind === 'delivery.update' ? { delivery: odDriverUpdate(e.eventType) } : {}),
          },
        });
      }
    }
    if (!ok && lastError) throw lastError;
    return out;
  }

  async ack(batch: PollBatch, events: ChannelEvent[]) {
    // Token por loja (99Food, aiqfome): o ack de cada loja vai com o token dela.
    const groups = new Map<string | undefined, ChannelEvent[]>();
    const tenantOf = new Map(batch.stores.map((s) => [s.storeId.toLowerCase(), s.tenantId]));
    for (const e of events) {
      const k = this.perStore ? e.storeId : undefined;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const [storeId, list] of groups)
      for (let i = 0; i < list.length; i += OD_ACK_BATCH) {
        const part = list.slice(i, i + OD_ACK_BATCH);
        await this.call(
          {
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
          },
          storeId,
          storeId ? tenantOf.get(storeId.toLowerCase()) : undefined,
        );
      }
  }

  async fetchOrder(ref: OrderRef): Promise<ExternalOrder> {
    const r = await this.call<OdOrder>(
      {
        endpoint: 'orders:details',
        method: 'GET',
        path: OD_PATHS.order(ref.externalOrderId),
        perMinute: OD_LIMITS.order,
        retries: 0,
      },
      ref.storeId,
      ref.tenantId,
    );
    if (!r.body || typeof r.body !== 'object' || !r.body.id)
      throw new ChannelHttpError(502, `${withArticle(this.label, 'O')} devolveu o pedido vazio`);
    const o = odToExternal(r.body, this.id, this.label);
    // O id da loja no pedido é o do aplicativo; a loja que buscou é a que vale.
    o.storeId = ref.storeId;
    return o;
  }

  skipsAction(action: ChannelAction, orderType: string) {
    if (action === 'picked_up') return !this.dialect.pickedUp;
    return action === 'ready' && !!this.dialect.readyOnlyPickup && orderType !== 'pickup';
  }

  async cancellationReasons(): Promise<ChannelCancelReason[]> {
    return OD_CANCEL_REASONS;
  }

  async send(req: ActionRequest) {
    const p = req.payload as {
      reason?: string;
      cancellationCode?: string;
      orderCode?: string;
      createdAt?: string;
      preparationMinutes?: number;
      disputeId?: string;
      orderType?: string;
    };
    const verb = odVerb(req.action, p.disputeId);
    // Sem esse aviso no aplicativo (ex.: retirada no balcão fora da 99Food): nada a mandar.
    if (!verb || (verb === 'pickedUp' && !this.dialect.pickedUp)) return;
    // aiqfome: pedido de entrega não tem "pronto para retirar" (segue com saiu e entregue).
    if (verb === 'readyForPickup' && this.dialect.readyOnlyPickup && p.orderType !== 'pickup')
      return;
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
    } else if (verb === 'denyCancellation') {
      json = {
        reason: (p.reason?.trim() || 'O pedido já está pronto').slice(0, 250),
        code: odDenyCode(p.reason),
      };
    }
    try {
      await this.call(
        {
          endpoint: `orders:${verb.toLowerCase()}`,
          method: 'POST',
          path: OD_PATHS.action(req.externalOrderId, this.dialect.verbs?.[verb] ?? verb),
          ...(json ? { json } : {}),
          perMinute: OD_LIMITS.action,
          // A caixa de saída repete com espera crescente (5xx/429); aqui não.
          retries: 0,
        },
        req.storeId,
        req.tenantId,
      );
    } catch (e) {
      // 422 = a mesma instrução já foi aceita antes (o padrão pede para não repetir).
      if (e instanceof ChannelHttpError && e.status === 422) return;
      throw e;
    }
  }

  /**
   * Keeta: liga a loja da Keeta ao id dela no Comandou (sem isso não chega evento nenhum).
   * 99Food: confere que a loja está vinculada ao app do Comandou pedindo o token dela.
   */
  async onboard(storeId: string, channelStoreId: string) {
    if (this.dialect.token === 'oauth')
      throw new ChannelHttpError(
        400,
        `A loja ${withArticle(this.label, 'do')} liga pela autorização`,
      );
    if (this.dialect.token === 'store') {
      await this.bearer(true, storeId);
      return;
    }
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

  /**
   * aiqfome: depois da autorização, põe a loja no modo polling (sem `ordersWebhookURL`). O id da
   * loja no Comandou é o próprio código do aiqfome (é ele que volta nos eventos e no `state`).
   */
  async onboardAuthorized(tenantId: string, storeId: string) {
    await this.call(
      {
        endpoint: 'merchant:onboarding',
        method: 'PUT',
        path: `${OD_PATHS.onboarding}/${encodeURIComponent(storeId)}`,
        json: { orderingAppMerchantId: storeId },
        perMinute: OD_LIMITS.onboarding,
        retries: 1,
      },
      storeId,
      tenantId,
    );
  }
}
