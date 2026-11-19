import { comandouTotals } from '@comandou/shared';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseRappiSignature,
  rappiEventKind,
  rappiRejectCode,
  rappiToExternal,
  verifyRappiSignature,
  type RappiOrderDetail,
} from './rappi-order';

const detail = (over: Partial<RappiOrderDetail> = {}): RappiOrderDetail => ({
  order_id: 392625,
  created_at: '2026-11-19T12:00:00Z',
  delivery_method: 'marketplace',
  payment_method: 'cash',
  totals: {
    total_products: 50,
    charges: { shipping: 6, service_fee: 0 },
    other_totals: { tip: 2 },
    total_to_pay: 58,
  },
  items: [
    {
      sku: 'CMD-1',
      id: '1',
      name: 'Açaí 500 ml',
      type: 'product',
      price: 20,
      quantity: 2,
      comments: ['sem granola'],
      subitems: [
        { sku: 'l', id: '9', name: 'Leite em pó', type: 'topping', price: 5, quantity: 1 },
      ],
    },
  ],
  customer: {
    first_name: 'Bia',
    last_name: 'Lima',
    phone_number: '+55 11 95555-4444',
    document_number: '123.456.789-09',
  },
  store: { internal_id: 900200300 },
  delivery_information: {
    complete_address: 'Rua D, 40 - Centro - Campinas',
    complement: 'casa 2',
  },
  discounts: [],
  ...over,
});

describe('Rappi: pedido', () => {
  it('entrega da loja, dinheiro a cobrar, complemento por unidade e gorjeta como taxa', () => {
    const o = rappiToExternal({ order_detail: detail() });
    expect(o).toMatchObject({
      channel: 'rappi',
      externalId: '392625',
      storeId: '900200300',
      fulfillment: 'delivery',
      deliveredBy: 'merchant',
      customer: { name: 'Bia L.', phone: '+55 11 95555-4444', taxDocument: '12345678909' },
      address: { text: 'Rua D, 40 - Centro - Campinas', complement: 'casa 2' },
      totals: { subtotal: '50.00', deliveryFee: '6.00', serviceFee: '2.00', total: '58.00' },
      payments: [{ prepaid: false, method: 'cash', amount: '58.00' }],
    });
    expect(o.items[0]).toMatchObject({
      externalCode: 'CMD-1',
      quantity: 2,
      unitPrice: '25.00',
      total: '50.00',
      notes: 'sem granola',
      options: [{ name: 'Leite em pó', unitPrice: '5.00', quantity: 1 }],
    });
  });

  it('entregador da Rappi, pago no app e cupom dividido entre Rappi e loja', () => {
    const o = rappiToExternal(
      detail({
        delivery_method: 'delivery',
        payment_method: 'credit_card',
        totals: { total_products: 50, charges: { shipping: 6 }, total_to_pay: 0 },
        discounts: [{ value: 10, title: 'Cupom', amount_by_rappi: 7, amount_by_partner: 3 }],
      }),
    );
    expect(o).toMatchObject({
      deliveredBy: 'channel',
      totals: { total: '46.00' },
      payments: [{ prepaid: true, method: 'credit', amount: '46.00' }],
      discounts: [
        { amount: '7.00', sponsor: 'channel', description: 'Cupom' },
        { amount: '3.00', sponsor: 'merchant', description: 'Cupom' },
      ],
    });
    expect(comandouTotals(o)).toMatchObject({ discount: '3.00', total: '53.00' });
    expect(rappiToExternal(detail({ delivery_method: 'pickup' })).fulfillment).toBe('takeout');
  });

  it('eventos e motivos de recusa', () => {
    expect(rappiEventKind('canceled_with_charge')).toBe('order.cancelled');
    expect(rappiEventKind('canceled_by_user')).toBe('order.cancelled');
    expect(rappiEventKind('taken_visible_order')).toBe('other');
    expect(rappiRejectCode('item_stockout')).toBe('ITEM_STOCKOUT');
    expect(rappiRejectCode('503')).toBe('POS_INTERNAL_ERROR');
  });
});

describe('Rappi: assinatura do webhook', () => {
  const secret = 'segredo-do-webhook';
  const raw = Buffer.from('{"event":"canceled_with_charge","order_id":"106","store_id":"9"}');
  const now = 1_795_000_000_000;
  const t = String(now / 1000);
  // Conferido à parte: HMAC-SHA256("t.corpo") em hexadecimal.
  const sign = createHmac('sha256', secret).update(`${t}.${raw.toString()}`).digest('hex');

  it('lê o cabeçalho e confere em tempo constante, com prazo', () => {
    expect(parseRappiSignature(`t=${t}, sign=${sign}`)).toEqual({ t, sign });
    expect(parseRappiSignature('t=1,sign=xyz')).toBeNull();
    expect(verifyRappiSignature(secret, `t=${t},sign=${sign}`, raw, now)).toBe(true);
    expect(verifyRappiSignature(secret, `sign=${sign},t=${t}`, raw, now)).toBe(true);
    // Timestamp em milissegundos também vale.
    const ms = String(now);
    const signMs = createHmac('sha256', secret).update(`${ms}.${raw.toString()}`).digest('hex');
    expect(verifyRappiSignature(secret, `t=${ms},sign=${signMs}`, raw, now)).toBe(true);
    expect(verifyRappiSignature('outro', `t=${t},sign=${sign}`, raw, now)).toBe(false);
    expect(verifyRappiSignature(secret, `t=${t},sign=${sign}`, Buffer.from('{}'), now)).toBe(false);
    expect(verifyRappiSignature(secret, `t=${t},sign=${sign}`, raw, now + 3600_000)).toBe(false);
    expect(verifyRappiSignature(secret, undefined, raw, now)).toBe(false);
  });
});
