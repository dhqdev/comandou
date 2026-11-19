import type { ChannelCancelReason, ChannelCapability, ExternalOrder } from '@comandou/shared';
import {
  ChannelHttpError,
  type ActionRequest,
  type ChannelAdapter,
  type ChannelEvent,
  type OrderRef,
  type PollBatch,
} from '../channels/channel-adapter';
import type { ChannelCredentials } from '../channels/channel-credentials.service';
import { ChannelHttp, RateGate, type ChannelRequest, type Fetcher } from '../channels/channel-http';
import type { ChannelMetrics } from '../channels/channel-metrics';
import {
  RAPPI_LIMITS,
  RAPPI_PATHS,
  RAPPI_REJECT_REASONS,
  rappiOrderId,
  rappiRejectCode,
  rappiStoreOf,
  rappiToExternal,
  type RappiOrder,
} from './rappi-order';

export const RAPPI_CREDENTIAL = 'rappi:app';
/** Pedido guardado na memória entre a busca e a entrada no Comandou (só dura alguns minutos). */
const CACHE_MS = 15 * 60_000;
const CACHE_MAX = 2000;

const listOf = (b: unknown): RappiOrder[] => {
  if (Array.isArray(b)) return b as RappiOrder[];
  const o = b as { orders?: unknown; data?: unknown } | null;
  if (o && Array.isArray(o.orders)) return o.orders as RappiOrder[];
  if (o && Array.isArray(o.data)) return o.data as RappiOrder[];
  return [];
};

/**
 * Adaptador da Rappi (Orders Rests API). Pedido novo só se busca UMA vez (a busca o marca SENT),
 * então o polling guarda o pedido na memória até ele entrar no Comandou e, a cada rodada, também
 * lê os SENT dos últimos 10 minutos: se o banco do restaurante estava fora na primeira busca, o
 * pedido volta por aí (a caixa de entrada não grava duas vezes). Cancelamento vem só por webhook.
 * Token do aplicativo (x-authorization) guardado até perto de vencer; 401 renova uma vez.
 */
export class RappiAdapter implements ChannelAdapter {
  readonly id = 'rappi';
  readonly capabilities: readonly ChannelCapability[] = [
    'orders',
    'polling',
    'webhook',
    'confirm',
    'reject',
    'ready',
  ];
  private http?: { base: string; client: ChannelHttp };
  private token?: { value: string; until: number; key: string };
  private readonly gate = new RateGate();
  private readonly cache = new Map<string, { order: RappiOrder; at: number }>();

  constructor(
    private readonly creds: ChannelCredentials,
    private readonly metrics: ChannelMetrics,
    private readonly baseOf: () => Promise<string>,
    private readonly fetcher: () => Fetcher = () => fetch,
  ) {}

  private async app() {
    const c = await this.creds.get(this.id);
    if (!c) throw new ChannelHttpError(401, 'Chaves da Rappi não cadastradas no Comandou');
    return c;
  }

  private async client(): Promise<ChannelHttp> {
    const base = (await this.baseOf()).replace(/\/$/, '');
    if (this.http?.base !== base)
      this.http = {
        base,
        client: new ChannelHttp(this.id, base, this.metrics, this.gate, this.fetcher, 15_000),
      };
    return this.http.client;
  }

  private async bearer(forget = false) {
    const c = await this.app();
    const http = await this.client();
    const key = `${c.clientId}|${c.last4}`;
    if (forget) this.token = undefined;
    if (this.token && this.token.key === key && Date.now() < this.token.until)
      return { token: this.token.value, http };
    const r = await http.request<{ access_token?: string; expires_in?: number }>({
      endpoint: 'auth:token',
      method: 'POST',
      path: RAPPI_PATHS.token,
      json: { client_id: c.clientId, client_secret: c.clientSecret },
      perMinute: RAPPI_LIMITS.token,
      retries: 1,
    });
    const value = r.body?.access_token;
    if (!value || typeof value !== 'string')
      throw new ChannelHttpError(502, 'A Rappi não devolveu o token');
    const ttl = Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) : 3600;
    this.token = { value, key, until: Date.now() + Math.max(60, ttl - 300) * 1000 };
    return { token: value, http };
  }

  /** Chamada com o token (no cabeçalho x-authorization); 401 → token novo e uma repetição. */
  async call<T>(r: Omit<ChannelRequest, 'token'>) {
    for (let attempt = 0; ; attempt++) {
      const { token, http } = await this.bearer(attempt > 0);
      try {
        return await http.request<T>({
          ...r,
          headers: { ...r.headers, 'x-authorization': `Bearer ${token}` },
        });
      } catch (e) {
        if (e instanceof ChannelHttpError && e.status === 401 && attempt === 0) continue;
        throw e;
      }
    }
  }

  /** Guarda o pedido (em memória, por pouco tempo) para a entrada no Comandou. */
  remember(o: RappiOrder) {
    const id = rappiOrderId(o);
    if (!id) return;
    const now = Date.now();
    if (this.cache.size >= CACHE_MAX) {
      for (const [k, v] of this.cache) if (now - v.at > CACHE_MS) this.cache.delete(k);
      // Ainda cheio: sai o mais antigo (a ordem do Map é a de entrada).
      while (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(id, { order: o, at: now });
  }

  /** Evento de pedido novo, sem dados pessoais (o pedido fica na memória do adaptador). */
  newOrderEvent(o: RappiOrder, storeId: string, code = 'NEW_ORDER'): ChannelEvent | null {
    const id = rappiOrderId(o);
    if (!id) return null;
    this.remember(o);
    return {
      id: `${id}:new`,
      code,
      kind: 'order.created',
      storeId: storeId.toLowerCase(),
      orderId: id,
      occurredAt: new Date().toISOString(),
      payload: {},
    };
  }

  async poll(batch: PollBatch): Promise<ChannelEvent[]> {
    const out: ChannelEvent[] = [];
    let ok = 0;
    let lastError: unknown = null;
    for (const s of batch.stores) {
      try {
        const r = await this.call<unknown>({
          endpoint: 'orders:new',
          method: 'GET',
          path: RAPPI_PATHS.storeOrders(s.storeId),
          perMinute: RAPPI_LIMITS.orders,
          retries: 0,
        });
        ok++;
        for (const o of listOf(r.body).slice(0, 200)) {
          const e = this.newOrderEvent(o, s.storeId);
          if (e) out.push(e);
        }
      } catch (e) {
        lastError = e;
      }
    }
    // Rede de segurança: os SENT dos últimos 10 minutos destas lojas (a busca acima é única).
    try {
      const mine = new Set(batch.stores.map((s) => s.storeId.toLowerCase()));
      const seen = new Set(out.map((e) => e.id));
      for (const o of await this.sent()) {
        const store = rappiStoreOf(o)?.toLowerCase();
        if (!store || !mine.has(store)) continue;
        const e = this.newOrderEvent(o, store);
        if (e && !seen.has(e.id)) out.push(e);
      }
    } catch (e) {
      lastError ??= e;
    }
    if (!ok && lastError) throw lastError;
    return out;
  }

  private async sent(): Promise<RappiOrder[]> {
    const r = await this.call<unknown>({
      endpoint: 'orders:sent',
      method: 'GET',
      path: RAPPI_PATHS.sent,
      perMinute: RAPPI_LIMITS.sent,
      retries: 0,
    });
    return listOf(r.body).slice(0, 500);
  }

  async fetchOrder(ref: OrderRef): Promise<ExternalOrder> {
    const now = Date.now();
    let raw = this.cache.get(ref.externalOrderId);
    if (raw && now - raw.at > CACHE_MS) raw = undefined;
    if (!raw) {
      const found = (await this.sent()).find((o) => rappiOrderId(o) === ref.externalOrderId);
      if (!found)
        throw new ChannelHttpError(404, 'Pedido da Rappi não está mais na lista de novos pedidos');
      this.remember(found);
      raw = { order: found, at: now };
    }
    const o = rappiToExternal(raw.order);
    o.storeId = ref.storeId;
    return o;
  }

  /** Já entrou no Comandou: não precisa mais guardar o pedido na memória. */
  forget(orderId: string) {
    this.cache.delete(orderId);
  }

  async cancellationReasons(): Promise<ChannelCancelReason[]> {
    return RAPPI_REJECT_REASONS;
  }

  async send(req: ActionRequest) {
    const p = req.payload as {
      reason?: string;
      cancellationCode?: string;
      preparationMinutes?: number;
    };
    const store = req.storeId;
    const id = req.externalOrderId;
    if (req.action === 'confirm') {
      const m = Number(p.preparationMinutes);
      await this.call({
        endpoint: 'orders:take',
        method: 'PUT',
        path: RAPPI_PATHS.take(store, id, Number.isInteger(m) && m > 0 && m <= 240 ? m : undefined),
        perMinute: RAPPI_LIMITS.action,
        retries: 0,
      });
      this.forget(id);
      return;
    }
    if (req.action === 'reject') {
      await this.call({
        endpoint: 'orders:reject',
        method: 'PUT',
        path: RAPPI_PATHS.reject(store, id, rappiRejectCode(p.cancellationCode)),
        json: {
          description: (p.reason?.trim() || 'Pedido recusado pelo restaurante').slice(0, 250),
          additional_info: {},
        },
        perMinute: RAPPI_LIMITS.action,
        retries: 0,
      });
      this.forget(id);
      return;
    }
    if (req.action === 'ready') {
      try {
        // A Rappi trata mais de 3 avisos como abuso: a caixa de saída só repete em 5xx/429.
        await this.call({
          endpoint: 'orders:ready',
          method: 'POST',
          path: RAPPI_PATHS.ready(store, id),
          perMinute: RAPPI_LIMITS.action,
          retries: 0,
        });
      } catch (e) {
        // Já pronto (a Rappi marca sozinha depois do aceite, conforme a loja): nada a fazer.
        if (e instanceof ChannelHttpError && (e.status === 409 || e.status === 422)) return;
        throw e;
      }
    }
  }

  /** A Rappi não tem cadastro de loja pela API de pedidos: a loja liga pelo id da Rappi. */
  async onboard() {}
}
