import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * PagBank falso para os testes do pagamento pelo app (pedido e conta da mesa): Connect, chave do
 * cartão, pedidos com cartão (aprovado ou recusado pelo conteúdo cifrado) e Pix (QR Code pago
 * por `payPix`), consulta, estorno e respostas que se perdem.
 */
export const PB = {
  PLATFORM_TOKEN: 'token-da-conta-comandou-0123456789',
  CLIENT_SECRET: 'segredo-da-aplicacao-0123456789',
  SELLER_TOKEN: 'token-do-restaurante-0123456789',
  PLATFORM_ACCOUNT: 'ACCO_COMANDOU0001',
  SELLER_ACCOUNT: 'ACCO_RESTAURANTE01',
  CARD_OK: 'C'.repeat(200),
  CARD_DECLINE: 'D'.repeat(200),
};

export interface FakeOrder {
  id: string;
  reference_id: string;
  body: Record<string, unknown>;
  charges: { id: string; status: string; amount: { value: number } }[];
  qr_codes?: { id: string; text: string; expiration_date: string }[];
}

export interface FakePagBank {
  url: string;
  orders: Map<string, FakeOrder>;
  /** Pedido criado por chave de idempotência (repetir a chave devolve o mesmo pedido). */
  byIdem: Map<string, string>;
  /** Resposta perdida: 'once' = só o primeiro envio de cada chave; 'always' = todos. */
  lose: null | 'once' | 'always';
  lost: Set<string>;
  cancels: { chargeId: string; value: number; auth: string; idem: string }[];
  tokenCalls: { auth: string; clientId: string; secret: string; body: Record<string, unknown> }[];
  auths: string[];
  /** O cliente pagou o Pix no app do banco. */
  payPix(pbOrderId: string): void;
  close(): void;
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d ? JSON.parse(d) : {}));
  });
}

export async function startFakePagBank(): Promise<FakePagBank> {
  const fake = {
    orders: new Map<string, FakeOrder>(),
    byIdem: new Map<string, string>(),
    lose: null as null | 'once' | 'always',
    lost: new Set<string>(),
    cancels: [] as FakePagBank['cancels'],
    tokenCalls: [] as FakePagBank['tokenCalls'],
    auths: [] as string[],
  };

  async function handler(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const auth = String(req.headers.authorization ?? '');
    const body = await readBody(req);
    const url = req.url ?? '';
    if (req.method === 'POST' && url === '/oauth2/token') {
      fake.tokenCalls.push({
        auth,
        clientId: String(req.headers.x_client_id ?? ''),
        secret: String(req.headers.x_client_secret ?? ''),
        body,
      });
      if (body.code !== 'codigo-bom')
        return send(400, { error_messages: [{ description: 'invalid code' }] });
      return send(200, {
        access_token: PB.SELLER_TOKEN,
        refresh_token: 'refresh-1',
        expires_in: 31_536_000,
        account_id: PB.SELLER_ACCOUNT,
      });
    }
    if (req.method === 'POST' && url === '/public-keys') {
      if (auth !== `Bearer ${PB.SELLER_TOKEN}`) return send(401, {});
      return send(201, { public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA-chave' });
    }
    if (req.method === 'POST' && url === '/orders') {
      fake.auths.push(auth);
      if (auth !== `Bearer ${PB.SELLER_TOKEN}`) return send(401, {});
      const key = String(req.headers['x-idempotency-key'] ?? '');
      const lose = () => {
        if (fake.lose === 'always') return true;
        if (fake.lose === 'once' && !fake.lost.has(key)) return !!fake.lost.add(key);
        return false;
      };
      const known = key ? fake.orders.get(fake.byIdem.get(key) ?? '') : undefined;
      if (known) {
        // Mesma chave: o PagBank devolve o pedido que já criou (não cobra de novo).
        if (lose()) return send(502, {});
        return send(201, {
          id: known.id,
          reference_id: known.reference_id,
          charges: known.charges,
        });
      }
      const id = `ORDE_${randomBytes(6).toString('hex')}`;
      const charges = (body.charges as Record<string, unknown>[] | undefined) ?? [];
      const o: FakeOrder = { id, reference_id: String(body.reference_id), body, charges: [] };
      if (charges.length) {
        const pm = charges[0]!.payment_method as { card: { encrypted: string } };
        const value = (charges[0]!.amount as { value: number }).value;
        o.charges.push({
          id: `CHAR_${randomBytes(6).toString('hex')}`,
          status: pm.card.encrypted === PB.CARD_DECLINE ? 'DECLINED' : 'PAID',
          amount: { value },
        });
      } else {
        o.qr_codes = [
          {
            id: `QRCO_${id}`,
            text: `00020101021226pix-${id}`,
            expiration_date: '2099-01-01T00:00:00-03:00',
          },
        ];
      }
      fake.orders.set(id, o);
      if (key) fake.byIdem.set(key, id);
      // Criou o pedido (e cobrou), mas a resposta não chega.
      if (lose()) return send(502, {});
      return send(201, {
        id,
        reference_id: o.reference_id,
        charges: o.charges.map((c) => ({
          ...c,
          payment_response:
            c.status === 'DECLINED'
              ? { code: '20007', message: 'saldo insuficiente' }
              : { code: '20000' },
          payment_method: { type: 'CREDIT_CARD', card: { brand: 'visa', last_digits: '1111' } },
        })),
        qr_codes: o.qr_codes,
      });
    }
    const get = /^\/orders\/(ORDE_[a-f0-9]+)$/.exec(url);
    if (req.method === 'GET' && get) {
      const o = fake.orders.get(get[1]!);
      if (!o || auth !== `Bearer ${PB.SELLER_TOKEN}`) return send(404, {});
      return send(200, {
        id: o.id,
        reference_id: o.reference_id,
        charges: o.charges,
        qr_codes: o.qr_codes,
      });
    }
    const cancel = /^\/charges\/(CHAR_[a-f0-9]+)\/cancel$/.exec(url);
    if (req.method === 'POST' && cancel) {
      const value = (body.amount as { value: number }).value;
      fake.cancels.push({
        chargeId: cancel[1]!,
        value,
        auth,
        idem: String(req.headers['x-idempotency-key'] ?? ''),
      });
      return send(201, { id: cancel[1], status: 'CANCELED' });
    }
    send(404, { error_messages: [{ description: 'not found' }] });
  }

  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return Object.assign(fake, {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    payPix(pbOrderId: string) {
      const o = fake.orders.get(pbOrderId)!;
      const value = (o.body.qr_codes as { amount: { value: number } }[])[0]!.amount.value;
      o.charges.push({
        id: `CHAR_${randomBytes(6).toString('hex')}`,
        status: 'PAID',
        amount: { value },
      });
    },
    close() {
      server.close();
    },
  });
}
