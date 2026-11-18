import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IfoodOrder } from '../src/integrations/ifood/ifood-order';

/**
 * iFood FALSO para os testes dos pedidos: token (que pode vencer), loja, polling com
 * x-polling-merchants, ack, detalhes do pedido e as ações da Order API. Guarda o que recebeu
 * para o teste conferir (cabeçalhos, corpos e quantas consultas por pedido).
 */
export interface FakeIfoodEvent {
  id: string;
  code: string;
  fullCode: string;
  orderId: string;
  merchantId: string;
  createdAt: string;
  salesChannel?: string;
  metadata?: Record<string, unknown>;
  acked?: boolean;
}

export class FakeIfoodServer {
  server!: Server;
  url = '';
  token = 'tok-ifood-1';
  tokensIssued = 0;
  readonly merchants = new Map<string, string>();
  readonly events: FakeIfoodEvent[] = [];
  readonly orders = new Map<string, IfoodOrder>();
  readonly lookups = new Map<string, number>();
  readonly actions: { orderId: string; verb: string; body: unknown }[] = [];
  readonly polls: { merchants: string; auth?: string }[] = [];
  readonly acks: unknown[] = [];
  /** Próximas respostas forçadas por rota: 'poll', 'ack', 'order', 'action'. */
  readonly failNext: Record<string, number[]> = { poll: [], ack: [], order: [], action: [] };

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  /** O token atual "vence": a próxima chamada com ele leva 401. */
  expireToken() {
    this.token = `tok-ifood-${Number(this.token.split('-').pop()) + 1}`;
  }

  push(
    e: Omit<FakeIfoodEvent, 'createdAt' | 'fullCode'> & { createdAt?: string; fullCode?: string },
  ) {
    this.events.push({
      createdAt: new Date().toISOString(),
      fullCode: e.code,
      salesChannel: 'IFOOD',
      ...e,
    });
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
      const path = new URL(req.url!, 'http://x').pathname;
      if (path === '/authentication/v1.0/oauth/token') {
        const f = new URLSearchParams(raw);
        if (f.get('clientSecret') !== 'segredo-ifood') return send(401, { message: 'invalid' });
        this.tokensIssued++;
        return send(200, { accessToken: this.token, type: 'bearer', expiresIn: 21600 });
      }
      if (req.headers.authorization !== `Bearer ${this.token}`)
        return send(401, { message: 'token expirado' });
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { message: `falha forçada ${s}` });
        return !!s;
      };
      const m = /^\/merchant\/v1\.0\/merchants\/([^/]+)$/.exec(path);
      if (m) {
        const name = this.merchants.get(m[1]!);
        return name ? send(200, { id: m[1], name }) : send(404, { message: 'not found' });
      }
      if (req.method === 'GET' && path === '/events/v1.0/events:polling') {
        if (fail('poll')) return;
        const merchants = String(req.headers['x-polling-merchants'] ?? '');
        this.polls.push({ merchants, auth: req.headers.authorization });
        const ids = merchants.split(',').map((x) => x.toLowerCase());
        const list = this.events
          .filter((e) => !e.acked && ids.includes(e.merchantId.toLowerCase()))
          .map(({ acked: _a, ...e }) => e);
        return list.length ? send(200, list) : send(204);
      }
      if (req.method === 'POST' && path === '/events/v1.0/events/acknowledgment') {
        if (fail('ack')) return;
        const body = JSON.parse(raw) as { id: string }[];
        this.acks.push(body);
        for (const e of this.events) if (body.some((b) => b.id === e.id)) e.acked = true;
        return send(202);
      }
      const o = /^\/order\/v1\.0\/orders\/([^/]+)(?:\/([A-Za-z]+))?$/.exec(path);
      if (o && req.method === 'GET' && !o[2]) {
        this.lookups.set(o[1]!, (this.lookups.get(o[1]!) ?? 0) + 1);
        if (fail('order')) return;
        const found = this.orders.get(o[1]!);
        return found ? send(200, found) : send(404, { message: 'pedido não existe' });
      }
      if (o && req.method === 'POST' && o[2]) {
        if (fail('action')) return;
        this.actions.push({ orderId: o[1]!, verb: o[2], body: raw ? JSON.parse(raw) : null });
        return send(202);
      }
      send(404, { message: `rota falsa ausente: ${req.method} ${path}` });
    });
  }
}

/** Pedido do iFood como a Order API devolve (valores em reais, números). */
export function ifoodSample(over: Partial<IfoodOrder> = {}): IfoodOrder {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    displayId: '4821',
    orderType: 'DELIVERY',
    orderTiming: 'IMMEDIATE',
    salesChannel: 'IFOOD',
    createdAt: '2026-11-18T19:00:00.000Z',
    merchant: { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'Loja' },
    customer: {
      name: 'Maria Cliente',
      documentNumber: '123.456.789-09',
      phone: { number: '0800 705 0505', localizer: '12345678' },
    },
    items: [
      {
        id: 'item-1',
        name: 'X-Burguer',
        externalCode: 'CMD-abcdef012345',
        unit: 'UN',
        quantity: 2,
        unitPrice: 25.9,
        price: 51.8,
        optionsPrice: 4,
        totalPrice: 55.8,
        observations: 'Sem cebola',
        options: [
          {
            id: 'op-1',
            name: 'Bacon',
            externalCode: 'OP-0123456789ab',
            quantity: 2,
            unitPrice: 2,
            price: 4,
          },
        ],
      },
      { id: 'item-2', name: 'Refrigerante', unit: 'UN', quantity: 1, unitPrice: 6, totalPrice: 6 },
    ],
    benefits: [
      {
        value: 5,
        target: 'CART',
        sponsorshipValues: [
          { name: 'IFOOD', value: 2 },
          { name: 'MERCHANT', value: 3 },
        ],
      },
    ],
    total: {
      subTotal: 61.8,
      deliveryFee: 5,
      benefits: 5,
      additionalFees: 0.99,
      orderAmount: 62.79,
    },
    payments: {
      prepaid: 62.79,
      pending: 0,
      methods: [
        { value: 62.79, method: 'CREDIT', type: 'ONLINE', prepaid: true, card: { brand: 'VISA' } },
      ],
    },
    delivery: {
      deliveredBy: 'IFOOD',
      pickupCode: '7788',
      deliveryAddress: {
        formattedAddress: 'Rua das Flores, 10',
        neighborhood: 'Centro',
        complement: 'Apto 2',
        reference: 'Perto da praça',
        coordinates: { latitude: -23.5, longitude: -46.6 },
      },
    },
    ...over,
  } as IfoodOrder;
}
