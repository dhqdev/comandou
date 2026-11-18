import type { ExternalOrder } from '@comandou/shared';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  ActionRequest,
  ChannelAdapter,
  ChannelEvent,
  OrderRef,
  PollBatch,
} from '../src/integrations/channels/channel-adapter';
import { ChannelHttp, RateGate } from '../src/integrations/channels/channel-http';
import type { ChannelMetrics } from '../src/integrations/channels/channel-metrics';

/**
 * Aplicativo de delivery FALSO e genérico, para testar a camada de canais sem nenhum aplicativo
 * real: um servidor HTTP com fila de eventos por loja, ack, detalhes do pedido e ações, e o
 * adaptador que fala com ele (pelo mesmo ChannelHttp dos canais de verdade).
 */
export interface FakeEvent extends ChannelEvent {
  acked?: boolean;
}

export class FakeChannelServer {
  server!: Server;
  url = '';
  readonly events: FakeEvent[] = [];
  readonly orders = new Map<string, ExternalOrder>();
  readonly lookups = new Map<string, number>();
  readonly actions: { orderId: string; action: string; body: unknown }[] = [];
  /** Próximas respostas forçadas (status) por rota: 'poll', 'ack', 'order', 'action'. */
  readonly failNext: Record<string, number[]> = { poll: [], ack: [], order: [], action: [] };
  polls = 0;
  /** Lojas pedidas em cada polling (para conferir lotes de até 100). */
  readonly polledStores: string[][] = [];

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  /** Coloca um evento na fila do aplicativo. */
  push(e: Omit<FakeEvent, 'code' | 'occurredAt'> & { code?: string; occurredAt?: string }) {
    this.events.push({ code: e.kind, occurredAt: new Date().toISOString(), ...e });
  }

  acked(id: string) {
    return this.events.filter((e) => e.id === id).every((e) => e.acked);
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b?: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(b === undefined ? '' : JSON.stringify(b));
      };
      if (req.headers.authorization !== 'Bearer tok-fake') return send(401, { message: 'token' });
      const path = new URL(req.url!, 'http://x').pathname;
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { message: `falha forçada ${s}` });
        return !!s;
      };
      if (req.method === 'GET' && path === '/events') {
        if (fail('poll')) return;
        this.polls++;
        const stores = String(req.headers['x-stores'] ?? '').split(',');
        this.polledStores.push(stores);
        return send(
          200,
          this.events
            .filter((e) => !e.acked && stores.includes(e.storeId))
            .map(({ acked: _a, ...e }) => e),
        );
      }
      if (req.method === 'POST' && path === '/events/ack') {
        if (fail('ack')) return;
        const ids = (JSON.parse(raw) as { ids: string[] }).ids;
        for (const e of this.events) if (ids.includes(e.id)) e.acked = true;
        return send(202);
      }
      const m = /^\/orders\/([^/]+)(?:\/actions\/([a-z_]+))?$/.exec(path);
      if (m && req.method === 'GET' && !m[2]) {
        this.lookups.set(m[1]!, (this.lookups.get(m[1]!) ?? 0) + 1);
        if (fail('order')) return;
        const o = this.orders.get(m[1]!);
        return o ? send(200, o) : send(404, { message: 'pedido não existe' });
      }
      if (m && req.method === 'POST' && m[2]) {
        if (fail('action')) return;
        this.actions.push({ orderId: m[1]!, action: m[2], body: raw ? JSON.parse(raw) : null });
        return send(202);
      }
      send(404, { message: `rota falsa ausente: ${req.method} ${path}` });
    });
  }
}

export const FAKE_CHANNEL = 'fakeapp';

/** Adaptador do aplicativo falso (o mesmo contrato dos canais de verdade). */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly id = FAKE_CHANNEL;
  readonly capabilities = [
    'orders',
    'polling',
    'confirm',
    'reject',
    'startPreparation',
    'ready',
    'dispatch',
    'delivered',
    'cancel',
  ] as const;
  private readonly http: ChannelHttp;

  constructor(server: FakeChannelServer, metrics: ChannelMetrics) {
    this.http = new ChannelHttp(
      FAKE_CHANNEL,
      server.url,
      metrics,
      new RateGate(),
      () => fetch,
      3000,
    );
  }

  async poll(batch: PollBatch): Promise<ChannelEvent[]> {
    const r = await this.http.request<ChannelEvent[]>({
      endpoint: 'events:polling',
      method: 'GET',
      path: '/events',
      token: 'tok-fake',
      headers: { 'x-stores': batch.stores.map((s) => s.storeId).join(',') },
      retries: 0,
    });
    return r.body ?? [];
  }

  async ack(_credential: string, events: ChannelEvent[]) {
    await this.http.request({
      endpoint: 'events:ack',
      method: 'POST',
      path: '/events/ack',
      token: 'tok-fake',
      json: { ids: events.map((e) => e.id) },
      retries: 0,
    });
  }

  async fetchOrder(ref: OrderRef): Promise<ExternalOrder> {
    const r = await this.http.request<ExternalOrder>({
      endpoint: 'orders:details',
      method: 'GET',
      path: `/orders/${encodeURIComponent(ref.externalOrderId)}`,
      token: 'tok-fake',
      retries: 0,
    });
    return r.body;
  }

  async send(req: ActionRequest) {
    await this.http.request({
      endpoint: `orders:${req.action}`,
      method: 'POST',
      path: `/orders/${encodeURIComponent(req.externalOrderId)}/actions/${req.action}`,
      token: 'tok-fake',
      json: req.payload,
      retries: 0,
    });
  }
}

/** Pedido normalizado de exemplo (um item com código do Comandou e um desconhecido). */
export function sampleOrder(
  id: string,
  storeId: string,
  o: Partial<ExternalOrder> & { linkedProductId?: string } = {},
): ExternalOrder {
  const { linkedProductId, ...rest } = o;
  const hex = linkedProductId?.replace(/-/g, '').slice(0, 12);
  return {
    channel: FAKE_CHANNEL,
    externalId: id,
    displayCode: id.slice(-4).toUpperCase(),
    storeId,
    createdAt: new Date().toISOString(),
    fulfillment: 'delivery',
    timing: 'immediate',
    deliveredBy: 'channel',
    customer: { name: 'Cliente Falso', phone: '0800 000 0000', phoneLocator: '12345678' },
    address: { text: 'Rua das Flores, 10', complement: 'Apto 2', reference: 'Perto da praça' },
    items: [
      {
        externalCode: hex ? `CMD-${hex}` : 'SEM-CODIGO',
        name: 'Hambúrguer do app',
        quantity: 2,
        unitPrice: '27.90',
        total: '55.80',
        options: [{ name: 'Bacon extra', quantity: 1, unitPrice: '2.00' }],
      },
      {
        name: 'Refrigerante lata',
        quantity: 1,
        unitPrice: '6.00',
        total: '6.00',
        options: [],
      },
    ],
    totals: { subtotal: '61.80', deliveryFee: '5.00', serviceFee: '0.99', total: '62.79' },
    discounts: [
      { amount: '3.00', sponsor: 'merchant', target: 'items' },
      { amount: '2.00', sponsor: 'channel', target: 'items' },
    ],
    payments: [{ prepaid: true, method: 'credit', amount: '62.79', brand: 'VISA' }],
    ...rest,
  };
}
