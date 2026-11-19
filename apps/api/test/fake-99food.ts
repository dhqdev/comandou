import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OdOrder } from '../src/integrations/opendelivery/od-order';

/**
 * 99Food FALSA (camada Open Delivery da Plataforma Aberta) para os testes: token POR LOJA
 * (`client_id` = `<App ID>_<id da loja>`, só para lojas vinculadas), polling que exige
 * `eventType` e `fromTime` e devolve só os eventos da loja do token, ack, pedido e ações.
 */
export const FOOD99_APP_ID = '5764607569115481356';
export const FOOD99_SECRET = 'segredo-da-99food-123';
const PREFIX = '/v4/opendelivery';

export interface Fake99Event {
  eventId: string;
  eventType: string;
  orderId: string;
  shop: string;
  createdAt: string;
  acked?: boolean;
}

export class Fake99FoodServer {
  server!: Server;
  url = '';
  tokensIssued = 0;
  /** Lojas vinculadas ao app (app_shop_id). */
  readonly bound = new Set<string>();
  /** token → loja. */
  private readonly tokens = new Map<string, string>();
  readonly events: Fake99Event[] = [];
  readonly orders = new Map<string, OdOrder>();
  readonly actions: { orderId: string; verb: string; body: unknown; shop: string }[] = [];
  readonly polls: { shop: string; query: URLSearchParams }[] = [];
  readonly acks: { shop: string; body: unknown }[] = [];
  readonly failNext: Record<string, number[]> = { poll: [], action: [] };

  get base() {
    return `${this.url}${PREFIX}`;
  }

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  push(e: Omit<Fake99Event, 'createdAt'>) {
    this.events.push({ createdAt: new Date().toISOString(), ...e });
  }

  /** Vence todos os tokens (a próxima chamada dá 401). */
  expireTokens() {
    this.tokens.clear();
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b?: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(b === undefined ? '' : JSON.stringify(b));
      };
      const u = new URL(req.url!, this.url);
      if (!u.pathname.startsWith(PREFIX)) return send(404, { title: 'não achei', status: 404 });
      const path = u.pathname.slice(PREFIX.length);
      if (path === '/oauth/token' && req.method === 'POST') {
        const f = new URLSearchParams(raw);
        const [app, shop] = (f.get('client_id') ?? '').split('_');
        if (
          f.get('grant_type') !== 'client_credentials' ||
          app !== FOOD99_APP_ID ||
          f.get('client_secret') !== FOOD99_SECRET
        )
          return send(401, { title: 'credencial inválida', status: 401 });
        if (!shop || !this.bound.has(shop))
          return send(403, { title: 'loja não vinculada', status: 403 });
        const token = `tok-99-${shop}-${++this.tokensIssued}`;
        this.tokens.set(token, shop);
        return send(200, { access_token: token, token_type: 'bearer', expires_in: 12600 });
      }
      const auth = String(req.headers.authorization ?? '');
      const shop = this.tokens.get(auth.replace(/^Bearer /, ''));
      if (!shop) return send(401, { title: 'token expirado', status: 401 });
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { title: `falha forçada ${s}`, status: s });
        return !!s;
      };
      if (path === '/v1/events:polling' && req.method === 'GET') {
        this.polls.push({ shop, query: u.searchParams });
        const types = u.searchParams.getAll('eventType');
        if (!types.length || !u.searchParams.get('fromTime'))
          return send(400, { title: 'faltou eventType ou fromTime', status: 400 });
        if (fail('poll')) return;
        const list = this.events.filter(
          (e) => !e.acked && e.shop === shop && types.includes(e.eventType),
        );
        if (!list.length) return send(204);
        return send(
          200,
          list.map(({ acked: _a, shop: _s, ...e }) => ({
            ...e,
            orderURL: `${this.base}/v1/orders/${e.orderId}`,
            sourceAppId: '99food',
          })),
        );
      }
      if (path === '/v1/events/acknowledgment' && req.method === 'POST') {
        const b = JSON.parse(raw || '[]') as { id: string }[];
        this.acks.push({ shop, body: b });
        for (const x of b)
          for (const e of this.events) if (e.eventId === x.id && e.shop === shop) e.acked = true;
        return send(202);
      }
      const order = /^\/v1\/orders\/([^/]+)$/.exec(path);
      if (order && req.method === 'GET') {
        const o = this.orders.get(decodeURIComponent(order[1]!));
        return o ? send(200, o) : send(404, { title: 'pedido não encontrado', status: 404 });
      }
      const act = /^\/v1\/orders\/([^/]+)\/([A-Za-z]+)$/.exec(path);
      if (act && req.method === 'POST') {
        if (fail('action')) return;
        this.actions.push({
          orderId: decodeURIComponent(act[1]!),
          verb: act[2]!,
          body: raw ? JSON.parse(raw) : null,
          shop,
        });
        return send(/Cancellation$/.test(act[2]!) ? 204 : 202);
      }
      send(404, { title: 'rota desconhecida', status: 404 });
    });
  }
}

const brl = (value: number) => ({ value, currency: 'BRL' });

/** Pedido da 99Food como a Order API devolve (valores de exemplo). */
export function food99Sample(over: Partial<OdOrder> & { id: string }): OdOrder {
  return {
    type: 'DELIVERY',
    displayId: '4521',
    createdAt: new Date().toISOString(),
    orderTiming: 'INSTANT',
    preparationStartDateTime: new Date().toISOString(),
    merchant: { id: '1152921645439779073', name: 'Loja 99' },
    items: [
      {
        id: 'i1',
        name: 'Hambúrguer da 99',
        unit: 'UN',
        quantity: 2,
        unitPrice: brl(20),
        totalPrice: brl(40),
        options: [],
      },
    ],
    otherFees: [
      { type: 'DELIVERY_FEE', receivedBy: 'MARKETPLACE', price: brl(6) },
      { type: 'TIP', receivedBy: 'LOGISTIC_SERVICES', price: brl(2) },
    ],
    discounts: [
      {
        amount: brl(8),
        target: 'CART',
        sponsorshipValues: [
          { name: 'MARKETPLACE', amount: brl(5) },
          { name: 'MERCHANT', amount: brl(3) },
        ],
      },
    ],
    total: { itemsPrice: brl(40), otherFees: brl(8), discount: brl(8), orderAmount: brl(40) },
    payments: { methods: [{ value: 40, type: 'PENDING', method: 'CASH', changeFor: 50 }] },
    customer: { name: 'Carla', phone: { number: '0800 555 1234' } },
    delivery: {
      deliveredBy: 'MERCHANT',
      deliveryAddress: {
        street: 'Rua C',
        number: '30',
        district: 'Centro',
        city: 'Santos',
        formattedAddress: 'Rua C, 30 - Centro - Santos',
        coordinates: { latitude: -23.96, longitude: -46.33 },
      },
    },
    extraInfo: 'localizador: 12345678; precisa de talheres: sim',
    ...over,
  };
}
