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
  /** Respostas à negociação: aceitar, recusar ou alternativa (com o corpo). */
  readonly disputeCalls: { disputeId: string; verb: string; altId?: string; body: unknown }[] = [];
  /** Motivos de cancelamento por pedido (vazio = 404, e o Comandou usa a lista padrão). */
  readonly cancelReasons = new Map<string, { cancelCodeId: string; description: string }[]>();
  reasonLookups = 0;
  /** Situação da loja por merchant (resposta do /status) e quantas leituras. */
  readonly status = new Map<string, unknown>();
  statusReads = 0;
  /** Interrupções (pausas) por merchant, como o iFood guarda. */
  readonly interruptions = new Map<
    string,
    { id: string; description: string; start: string; end: string }[]
  >();
  readonly interruptionCalls: { merchant: string; verb: string; body: unknown }[] = [];
  readonly hours = new Map<string, unknown>();
  /** Rastreio por pedido (resposta do /tracking) e quantas leituras. */
  readonly tracking = new Map<string, unknown>();
  trackingReads = 0;
  /** Cotação do Sob Demanda por pedido (resposta do deliveryAvailabilities). */
  readonly quotes = new Map<string, unknown>();
  readonly shippingCalls: { orderId: string; verb: string; body: unknown }[] = [];
  readonly driverCancelReasons = new Map<string, { cancelCodeId: string; description: string }[]>();
  /** Financeiro: vendas (uma página) e repasses por merchant, e o que foi pedido. */
  readonly sales = new Map<string, unknown[]>();
  readonly settlements = new Map<string, unknown[]>();
  readonly financeCalls: { merchant: string; kind: string; query: Record<string, string> }[] = [];
  readonly polls: { merchants: string; auth?: string }[] = [];
  readonly acks: unknown[] = [];
  /** Próximas respostas forçadas por rota: 'poll', 'ack', 'order', 'action'. */
  readonly failNext: Record<string, number[]> = {
    poll: [],
    ack: [],
    order: [],
    action: [],
    status: [],
    pause: [],
    shipping: [],
    finance: [],
  };

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
      const fin = /^\/financial\/v3\.0\/merchants\/([^/]+)\/(sales|settlements)$/.exec(path);
      if (fin && req.method === 'GET') {
        const id = fin[1]!.toLowerCase();
        const query = Object.fromEntries(new URL(req.url!, 'http://x').searchParams);
        this.financeCalls.push({ merchant: id, kind: fin[2]!, query });
        if (fail('finance')) return;
        if (fin[2] === 'sales') {
          const list = this.sales.get(id) ?? [];
          if (!list.length) return send(204);
          return send(200, {
            page: 1,
            size: list.length,
            total: list.length,
            pageCount: 1,
            sales: list,
          });
        }
        return send(200, {
          merchantId: id,
          settlements: this.settlements.get(id) ?? [],
        });
      }
      const ms =
        /^\/merchant\/v1\.0\/merchants\/([^/]+)\/(status|interruptions|opening-hours)(?:\/([^/]+))?$/.exec(
          path,
        );
      if (ms) {
        const id = ms[1]!.toLowerCase();
        if (ms[2] === 'status') {
          this.statusReads++;
          if (fail('status')) return;
          return send(200, this.status.get(id) ?? []);
        }
        if (ms[2] === 'opening-hours') return send(200, this.hours.get(id) ?? { shifts: [] });
        const list = this.interruptions.get(id) ?? [];
        this.interruptions.set(id, list);
        if (req.method === 'GET') return send(200, list);
        if (req.method === 'POST') {
          if (fail('pause')) return;
          const b = JSON.parse(raw) as {
            id: string;
            description: string;
            start: string;
            end: string;
          };
          this.interruptionCalls.push({ merchant: id, verb: 'create', body: b });
          if (!b.id || !b.description || !b.start || !b.end)
            return send(400, { message: 'interrupção inválida' });
          list.push(b);
          return send(201, b);
        }
        if (req.method === 'DELETE' && ms[3]) {
          this.interruptionCalls.push({ merchant: id, verb: 'delete', body: ms[3] });
          const i = list.findIndex((x) => x.id === decodeURIComponent(ms[3]!));
          if (i < 0) return send(404, { message: 'não existe' });
          list.splice(i, 1);
          return send(204);
        }
      }
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
      const sh = /^\/shipping\/v1\.0\/orders\/([^/]+)\/([A-Za-z]+)$/.exec(path);
      if (sh) {
        const [, id, verb] = sh as unknown as [string, string, string];
        if (fail('shipping')) return;
        this.shippingCalls.push({ orderId: id, verb, body: raw ? JSON.parse(raw) : null });
        if (req.method === 'GET' && verb === 'deliveryAvailabilities') {
          const qt = this.quotes.get(id);
          return qt ? send(200, qt) : send(400, { message: 'sem entregador na região' });
        }
        if (req.method === 'GET' && verb === 'cancellationReasons') {
          const list = this.driverCancelReasons.get(id);
          return list ? send(200, list) : send(404, { message: 'sem motivos' });
        }
        if (req.method === 'POST' && (verb === 'requestDriver' || verb === 'cancelRequestDriver'))
          return send(202);
      }
      const o = /^\/order\/v1\.0\/orders\/([^/]+)(?:\/([A-Za-z]+))?$/.exec(path);
      if (o && req.method === 'GET' && o[2] === 'tracking') {
        this.trackingReads++;
        const t = this.tracking.get(o[1]!);
        return t ? send(200, t) : send(404, { message: 'sem rastreio' });
      }
      if (o && req.method === 'GET' && o[2] === 'cancellationReasons') {
        this.reasonLookups++;
        const list = this.cancelReasons.get(o[1]!);
        return list ? send(200, list) : send(404, { message: 'sem motivos' });
      }
      const d =
        /^\/order\/v1\.0\/disputes\/([^/]+)\/(accept|reject|alternatives)(?:\/([^/]+))?$/.exec(
          path,
        );
      if (d && req.method === 'POST') {
        if (fail('action')) return;
        this.disputeCalls.push({
          disputeId: decodeURIComponent(d[1]!),
          verb: d[2]!,
          ...(d[3] ? { altId: decodeURIComponent(d[3]) } : {}),
          body: raw ? JSON.parse(raw) : null,
        });
        return send(201);
      }
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
