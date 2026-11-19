import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OdOrder } from '../src/integrations/opendelivery/od-order';

/**
 * aiqfome FALSO para os testes, nos dois endereços que o Comandou usa:
 * - `/magalu`: o ID Magalu (troca do código e renovação; o token de renovação vale UMA vez);
 * - `/api/od`: a camada Open Delivery do aiqfome (token POR LOJA, polling sem filtro obrigatório,
 *   ack com id + pedido + tipo, pedido, merchantOnboarding e as ações em kebab-case).
 */
export const AIQFOME_CLIENT_ID = 'cliente-aiqfome';
export const AIQFOME_SECRET = 'segredo-do-aiqfome-123';
const API = '/api/od';
const AUTH = '/magalu';

export interface FakeAiqEvent {
  eventId: string;
  eventType: string;
  orderId: string;
  store: string;
  createdAt: string;
  acked?: boolean;
}

export class FakeAiqfomeServer {
  server!: Server;
  url = '';
  tokensIssued = 0;
  refreshes = 0;
  /** Código da autorização → loja (de uso único). */
  readonly codes = new Map<string, string>();
  private readonly access = new Map<string, string>();
  private readonly refresh = new Map<string, string>();
  readonly events: FakeAiqEvent[] = [];
  readonly orders = new Map<string, OdOrder>();
  readonly actions: { orderId: string; verb: string; body: unknown; store: string }[] = [];
  readonly onboardings: { id: string; body: unknown; store: string }[] = [];
  readonly acks: { store: string; body: unknown }[] = [];
  readonly redirects: string[] = [];
  readonly failNext: Record<string, number[]> = { poll: [], action: [] };

  get apiBase() {
    return `${this.url}${API}`;
  }
  get authBase() {
    return `${this.url}${AUTH}`;
  }

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  /** A loja autorizou no ID Magalu: este código volta no callback. */
  authorize(store: string) {
    const code = `code-${store}-${this.codes.size + 1}`;
    this.codes.set(code, store);
    return code;
  }

  push(e: Omit<FakeAiqEvent, 'createdAt'>) {
    this.events.push({ createdAt: new Date().toISOString(), ...e });
  }

  /** Vence os tokens de acesso (a próxima chamada dá 401). */
  expireAccess() {
    this.access.clear();
  }

  /** A loja tirou a autorização: nem o token de renovação vale mais. */
  revokeAll() {
    this.access.clear();
    this.refresh.clear();
  }

  private issue(store: string) {
    const n = ++this.tokensIssued;
    const access = `acc-${store}-${n}`;
    const refresh = `rfr-${store}-${n}`;
    this.access.set(access, store);
    this.refresh.set(refresh, store);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: refresh,
      scope: 'aqf:store:read aqf:order:read aqf:order:create',
      created_at: Math.floor(Date.now() / 1000),
    };
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
      if (u.pathname === `${AUTH}/oauth/token` && req.method === 'POST') {
        const f = new URLSearchParams(raw);
        if (f.get('client_id') !== AIQFOME_CLIENT_ID || f.get('client_secret') !== AIQFOME_SECRET)
          return send(401, { error: 'invalid_client' });
        this.redirects.push(f.get('redirect_uri') ?? '');
        if (f.get('grant_type') === 'authorization_code') {
          const store = this.codes.get(f.get('code') ?? '');
          // Código de uso único: some na primeira troca.
          this.codes.delete(f.get('code') ?? '');
          return store ? send(200, this.issue(store)) : send(400, { error: 'invalid_grant' });
        }
        if (f.get('grant_type') === 'refresh_token') {
          const old = f.get('refresh_token') ?? '';
          const store = this.refresh.get(old);
          if (!store) return send(400, { error: 'invalid_grant' });
          this.refresh.delete(old);
          this.refreshes++;
          return send(200, this.issue(store));
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      if (!u.pathname.startsWith(API)) return send(404, { title: 'não achei', status: 404 });
      const path = u.pathname.slice(API.length);
      const store = this.access.get(
        String(req.headers.authorization ?? '').replace(/^Bearer /, ''),
      );
      if (!store) return send(401, { title: 'token inválido', status: 401 });
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { title: `falha forçada ${s}`, status: s });
        return !!s;
      };
      const onboarding = /^\/v1\/merchantOnboarding\/([^/]+)$/.exec(path);
      if (onboarding && req.method === 'PUT') {
        this.onboardings.push({
          id: decodeURIComponent(onboarding[1]!),
          body: raw ? JSON.parse(raw) : null,
          store,
        });
        return send(200, { success: true });
      }
      if (path === '/v1/events:polling' && req.method === 'GET') {
        if (fail('poll')) return;
        const list = this.events.filter((e) => !e.acked && e.store === store).slice(0, 100);
        if (!list.length) return send(204);
        return send(
          200,
          list.map(({ acked: _a, store: _s, ...e }) => ({
            ...e,
            orderURL: `${this.apiBase}/v1/orders/${e.orderId}`,
            sourceAppId: 'aiqfome',
          })),
        );
      }
      if (path === '/v1/events/acknowledgment' && req.method === 'POST') {
        const b = JSON.parse(raw || '[]') as {
          id?: string;
          orderId?: string;
          eventType?: string;
        }[];
        // No aiqfome os três campos são obrigatórios.
        if (!Array.isArray(b) || b.some((x) => !x.id || !x.orderId || !x.eventType))
          return send(400, { title: 'ack incompleto', status: 400 });
        this.acks.push({ store, body: b });
        for (const x of b)
          for (const e of this.events) if (e.eventId === x.id && e.store === store) e.acked = true;
        return send(202);
      }
      const order = /^\/v1\/orders\/([^/]+)$/.exec(path);
      if (order && req.method === 'GET') {
        const o = this.orders.get(decodeURIComponent(order[1]!));
        return o ? send(200, o) : send(404, { title: 'pedido não encontrado', status: 404 });
      }
      const act = /^\/v1\/orders\/([^/]+)\/(confirm|ready-for-pickup|dispatch|delivered)$/.exec(
        path,
      );
      if (act && req.method === 'POST') {
        if (fail('action')) return;
        this.actions.push({
          orderId: decodeURIComponent(act[1]!),
          verb: act[2]!,
          body: raw ? JSON.parse(raw) : null,
          store,
        });
        return send(202);
      }
      send(404, { title: 'rota desconhecida', status: 404 });
    });
  }
}

const brl = (value: number) => ({ value, currency: 'BRL' });

/** Pedido do aiqfome como a camada Open Delivery devolve (valores de exemplo). */
export function aiqfomeSample(over: Partial<OdOrder> & { id: string }): OdOrder {
  return {
    type: 'DELIVERY',
    displayId: over.id,
    createdAt: new Date().toISOString(),
    orderTiming: 'INSTANT',
    preparationStartDateTime: new Date().toISOString(),
    merchant: { id: 'loja-pastelaria', name: 'Pastelaria' },
    items: [
      {
        id: 'i1',
        name: 'Pastel de carne',
        unit: 'UN',
        quantity: 2,
        unitPrice: brl(12),
        totalPrice: brl(24),
        options: [
          {
            id: 'o1',
            name: 'Metade queijo',
            unit: 'UN',
            quantity: 1,
            unitPrice: brl(0),
            totalPrice: brl(0),
          },
        ],
      },
    ],
    otherFees: [{ type: 'DELIVERY_FEE', receivedBy: 'MERCHANT', price: brl(5) }],
    discounts: [],
    total: { itemsPrice: brl(24), otherFees: brl(5), discount: brl(0), orderAmount: brl(29) },
    payments: { methods: [{ value: 29, type: 'PREPAID', method: 'CREDIT' }] },
    customer: { name: 'Bruna', phone: { number: '44999998888' } },
    delivery: {
      deliveredBy: 'MERCHANT',
      deliveryAddress: {
        street: 'Rua das Flores',
        number: '10',
        district: 'Zona 7',
        city: 'Maringá',
        formattedAddress: 'Rua das Flores, 10 - Zona 7 - Maringá',
        coordinates: { latitude: -23.42, longitude: -51.93 },
      },
    },
    extraInfo: 'observação no pedido',
    ...over,
  } as OdOrder;
}
