import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RappiOrderDetail } from '../src/integrations/rappi/rappi-order';

/**
 * Rappi FALSA (Orders Rests API) para os testes: token por JSON, cabeçalho x-authorization, pedido
 * novo entregue UMA vez (a busca marca SENT), lista dos SENT dos últimos 10 minutos, take (com ou
 * sem cooking_time), reject com cancel_type e ready-for-pickup.
 */
export const RAPPI_CLIENT_ID = 'cliente-rappi';
export const RAPPI_SECRET = 'segredo-da-rappi-123';
export const RAPPI_HOOK_SECRET = 'segredo-do-webhook-rappi';

interface FakeOrder {
  detail: RappiOrderDetail;
  store: string;
  status: 'READY' | 'SENT' | 'TAKEN' | 'REJECT';
  sentAt?: number;
}

export class FakeRappiServer {
  server!: Server;
  url = '';
  token = 'tok-rappi-1';
  tokensIssued = 0;
  readonly orders = new Map<string, FakeOrder>();
  readonly actions: { orderId: string; verb: string; path: string; body: unknown }[] = [];
  readonly gets: string[] = [];
  readonly failNext: Record<string, number[]> = { orders: [], action: [] };

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  add(store: string, detail: RappiOrderDetail) {
    this.orders.set(String(detail.order_id), { detail, store, status: 'READY' });
  }

  status(id: string) {
    return this.orders.get(id)?.status;
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b?: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(b === undefined ? '' : JSON.stringify(b));
      };
      const path = new URL(req.url!, this.url).pathname;
      if (path === '/restaurants/auth/v1/token/login/integrations' && req.method === 'POST') {
        const b = JSON.parse(raw || '{}') as Record<string, string>;
        if (b.client_id !== RAPPI_CLIENT_ID || b.client_secret !== RAPPI_SECRET)
          return send(401, { message: 'credencial inválida' });
        this.tokensIssued++;
        return send(200, { access_token: this.token, token_type: 'Bearer', expires_in: 86400 });
      }
      if (req.headers['x-authorization'] !== `Bearer ${this.token}`)
        return send(401, { message: 'token inválido' });
      const fail = (k: string) => {
        const s = this.failNext[k]!.shift();
        if (s) send(s, { message: `falha forçada ${s}` });
        return !!s;
      };
      this.gets.push(`${req.method} ${path}`);
      const storeOrders = /^\/restaurants\/orders\/v1\/stores\/([^/]+)\/orders$/.exec(path);
      if (storeOrders && req.method === 'GET') {
        if (fail('orders')) return;
        // Busca única: o que vem aqui vira SENT e não volta mais por este caminho.
        const list = [...this.orders.values()].filter(
          (o) => o.store === storeOrders[1] && o.status === 'READY',
        );
        for (const o of list) {
          o.status = 'SENT';
          o.sentAt = Date.now();
        }
        return send(
          200,
          list.map((o) => ({ order_detail: o.detail })),
        );
      }
      if (path === '/restaurants/orders/v1/orders/status/sent' && req.method === 'GET') {
        const list = [...this.orders.values()].filter(
          (o) => o.status === 'SENT' && Date.now() - (o.sentAt ?? 0) < 10 * 60_000,
        );
        return send(
          200,
          list.map((o) => ({ order_detail: o.detail })),
        );
      }
      const act =
        /^\/restaurants\/orders\/v1\/stores\/([^/]+)\/orders\/([^/]+)\/(take|cooking_time\/\d+\/take|cancel_type\/[A-Z_]+\/reject|ready-for-pickup)$/.exec(
          path,
        );
      if (act) {
        if (fail('action')) return;
        const o = this.orders.get(act[2]!);
        if (!o || o.store !== act[1]) return send(404, { message: 'pedido não encontrado' });
        const verb = act[3]!.endsWith('take')
          ? 'take'
          : act[3]!.endsWith('reject')
            ? 'reject'
            : 'ready';
        this.actions.push({
          orderId: act[2]!,
          verb,
          path: act[3]!,
          body: raw ? JSON.parse(raw) : null,
        });
        if (verb === 'take') o.status = 'TAKEN';
        if (verb === 'reject') o.status = 'REJECT';
        return send(200);
      }
      send(404, { message: 'rota desconhecida' });
    });
  }
}

/** Pedido da Rappi como a Orders Rests API devolve (valores de exemplo, em reais). */
export function rappiSample(id: string, store: string, over: Partial<RappiOrderDetail> = {}) {
  const d: RappiOrderDetail = {
    order_id: id,
    cooking_time: 15,
    created_at: new Date().toISOString(),
    delivery_method: 'delivery',
    payment_method: 'credit_card',
    totals: {
      total_products: 64.8,
      total_products_without_discount: 64.8,
      total_discounts: 10,
      total_order: 54.8,
      total_to_pay: 0,
      charges: { shipping: 7.99, service_fee: 0.99 },
      other_totals: { tip: 0, total_rappi_pay: 0, total_rappi_credits: 0 },
    },
    items: [
      {
        sku: 'CMD-x',
        id: '101',
        name: 'Pizza Rappi',
        type: 'product',
        comments: 'sem azeitona',
        price: 29.9,
        quantity: 2,
        subitems: [
          { sku: 'b1', id: '201', name: 'Borda', type: 'topping', price: 2.5, quantity: 1 },
        ],
      },
    ],
    customer: { first_name: 'Rafael', last_name: 'Souza', phone_number: '11977776666' },
    store: { internal_id: store, external_id: 'loja-x', name: 'Loja Rappi' },
    discounts: [
      {
        value: 10,
        title: 'Cupom',
        type: 'order_discount',
        amount_by_rappi: 6,
        amount_by_partner: 4,
      },
    ],
    ...over,
  };
  return d;
}
