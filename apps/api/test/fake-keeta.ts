import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  jcs,
  keetaSignature,
  keetaSignatureString,
  type OdOrder,
} from '../src/integrations/opendelivery/od-order';

/**
 * Keeta FALSA para os testes: confere a assinatura (X-App-Signature) de TODA chamada como a Keeta
 * descreve, dá o token (app_level_token), cadastra a loja (merchantOnboarding), entrega eventos
 * só das lojas cadastradas pelo x-polling-merchants, recebe o ack, devolve o pedido e guarda as
 * ações.
 */
export const KEETA_CLIENT_ID = 'cliente-keeta';
export const KEETA_SECRET = 'segredo-da-keeta-123';
const PREFIX = '/api/open/opendelivery';

export interface FakeKeetaEvent {
  eventId: string;
  eventType: string;
  orderId: string;
  merchant: string;
  createdAt: string;
  metadata?: string;
  acked?: boolean;
}

export class FakeKeetaServer {
  server!: Server;
  url = '';
  token = 'tok-keeta-1';
  tokensIssued = 0;
  badSignatures = 0;
  /** merchantId do Comandou → keetaMerchantId (só os cadastrados recebem eventos). */
  readonly onboarded = new Map<string, number>();
  readonly events: FakeKeetaEvent[] = [];
  readonly orders = new Map<string, OdOrder>();
  readonly lookups = new Map<string, number>();
  readonly actions: { orderId: string; verb: string; body: unknown }[] = [];
  readonly polls: string[] = [];
  readonly acks: unknown[] = [];
  /** Respostas forçadas: 'onboarding', 'poll', 'action'. */
  readonly failNext: Record<string, number[]> = { onboarding: [], poll: [], action: [] };

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

  push(e: Omit<FakeKeetaEvent, 'createdAt'> & { createdAt?: string }) {
    this.events.push({ createdAt: new Date().toISOString(), ...e });
  }

  acked(id: string) {
    return this.events.filter((e) => e.eventId === id).every((e) => e.acked);
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b?: unknown) => {
        res.writeHead(code, {
          'Content-Type': code >= 400 ? 'application/problem+json' : 'application/json',
        });
        res.end(b === undefined ? '' : JSON.stringify(b));
      };
      const u = new URL(req.url!, this.url);
      // Assinatura de toda chamada: URL sem query + parâmetros em ordem + corpo como chegou.
      const params = Object.fromEntries(u.searchParams);
      const expected = keetaSignature(
        KEETA_SECRET,
        keetaSignatureString(`${this.url}${u.pathname}`, params, raw || undefined),
      );
      if (req.headers['x-app-signature'] !== expected) {
        this.badSignatures++;
        return send(401, { title: 'assinatura inválida', status: 401 });
      }
      // Corpo canônico (RFC 8785): a Keeta canoniza o que recebe antes de conferir.
      if (raw && raw !== jcs(JSON.parse(raw))) {
        this.badSignatures++;
        return send(400, { title: 'corpo fora da forma canônica', status: 400 });
      }
      if (!u.pathname.startsWith(PREFIX)) return send(404, { title: 'não achei', status: 404 });
      const path = u.pathname.slice(PREFIX.length);
      if (path === '/oauth/token' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}') as Record<string, string>;
        if (
          b.grant_type !== 'app_level_token' ||
          b.client_id !== KEETA_CLIENT_ID ||
          b.client_secret !== KEETA_SECRET
        )
          return send(401, { title: 'credencial inválida', status: 401 });
        this.tokensIssued++;
        return send(200, { access_token: this.token, token_type: 'Bearer', expires_in: 7200 });
      }
      if (req.headers.authorization !== `Bearer ${this.token}`)
        return send(401, { title: 'token expirado', status: 401 });
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { title: `falha forçada ${s}`, status: s });
        return !!s;
      };
      if (path === '/v1/merchantOnboarding' && req.method === 'PUT') {
        if (fail('onboarding')) return;
        const b = JSON.parse(raw || '{}') as { keetaMerchantId?: number };
        const id = u.searchParams.get('merchantId');
        if (!id || typeof b.keetaMerchantId !== 'number')
          return send(400, { title: 'faltou dado', status: 400 });
        this.onboarded.set(id, b.keetaMerchantId);
        return send(201, b);
      }
      if (path === '/v1/events:polling' && req.method === 'GET') {
        const merchants = String(req.headers['x-polling-merchants'] ?? '');
        this.polls.push(merchants);
        if (fail('poll')) return;
        const list = this.events.filter(
          (e) =>
            !e.acked && merchants.split(',').includes(e.merchant) && this.onboarded.has(e.merchant),
        );
        if (!list.length) return send(204);
        return send(
          200,
          list.map(({ acked: _a, merchant: _m, ...e }) => ({
            ...e,
            orderURL: `${this.base}/v1/orders/${e.orderId}`,
          })),
        );
      }
      if (path === '/v1/events/acknowledgment' && req.method === 'POST') {
        const b = JSON.parse(raw || '[]') as { id: string }[];
        this.acks.push(b);
        for (const x of b) for (const e of this.events) if (e.eventId === x.id) e.acked = true;
        return send(202);
      }
      const order = /^\/v1\/orders\/([^/]+)$/.exec(path);
      if (order && req.method === 'GET') {
        const id = decodeURIComponent(order[1]!);
        this.lookups.set(id, (this.lookups.get(id) ?? 0) + 1);
        const o = this.orders.get(id);
        return o ? send(200, o) : send(404, { title: 'pedido não encontrado', status: 404 });
      }
      const act = /^\/v1\/orders\/([^/]+)\/([A-Za-z]+)$/.exec(path);
      if (act && req.method === 'POST') {
        if (fail('action')) return;
        this.actions.push({
          orderId: decodeURIComponent(act[1]!),
          verb: act[2]!,
          body: raw ? JSON.parse(raw) : null,
        });
        return send(act[2] === 'acceptRefund' || act[2] === 'rejectRefund' ? 204 : 202);
      }
      send(404, { title: 'rota desconhecida', status: 404 });
    });
  }
}

const brl = (value: number) => ({ value, currency: 'BRL' });

/** Pedido da Keeta como a Order API devolve (valores de exemplo). */
export function keetaSample(over: Partial<OdOrder> & { id: string }): OdOrder {
  return {
    type: 'DELIVERY',
    displayId: '7781',
    createdAt: new Date().toISOString(),
    orderTiming: 'INSTANT',
    preparationStartDateTime: new Date().toISOString(),
    merchant: { id: '900100', name: 'Loja Keeta' },
    items: [
      {
        id: 'i1',
        name: 'Pizza da Keeta',
        externalCode: 'nao-existe',
        unit: 'UN',
        quantity: 1,
        unitPrice: brl(50),
        totalPrice: brl(50),
        options: [],
      },
    ],
    otherFees: [
      { name: 'Entrega', type: 'DELIVERY_FEE', receivedBy: 'MARKETPLACE', price: brl(7) },
    ],
    discounts: [
      {
        amount: brl(5),
        target: 'CART',
        sponsorshipValues: [{ name: 'MARKETPLACE', amount: brl(5) }],
      },
    ],
    total: { itemsPrice: brl(50), otherFees: brl(7), discount: brl(5), orderAmount: brl(52) },
    payments: { methods: [{ value: 52, type: 'PREPAID', method: 'PIX' }] },
    customer: { name: 'Bruno', phone: { number: '11988887777' } },
    delivery: {
      deliveredBy: 'MARKETPLACE',
      deliveryAddress: {
        street: 'Rua B',
        number: '20',
        district: 'Centro',
        city: 'Campinas',
        formattedAddress: 'Rua B, 20 - Centro - Campinas',
        coordinates: { latitude: -22.9, longitude: -47.06 },
      },
    },
    ...over,
  };
}
