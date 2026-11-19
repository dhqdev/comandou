import { comandouTotals } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import {
  jcs,
  keetaSignature,
  keetaSignatureString,
  odCancelCode,
  odEventKind,
  odRefundDispute,
  odToExternal,
  odVerb,
  type OdOrder,
} from './od-order';

const brl = (value: number) => ({ value, currency: 'BRL' });

/** Pedido da Keeta no formato da Order API (valores de exemplo). */
const keetaOrder = (over: Partial<OdOrder> = {}): OdOrder => ({
  id: 'kt-order-1',
  type: 'DELIVERY',
  displayId: '7781',
  createdAt: '2026-11-19T12:00:00Z',
  orderTiming: 'INSTANT',
  preparationStartDateTime: '2026-11-19T12:00:00Z',
  merchant: { id: '900100', name: 'Loja Keeta' },
  items: [
    {
      id: 'i1',
      name: 'X-Burguer',
      externalCode: 'CMD-abc',
      unit: 'UN',
      quantity: 2,
      unitPrice: brl(20),
      optionsPrice: brl(6),
      totalPrice: brl(46),
      specialInstructions: 'sem cebola',
      options: [
        {
          id: 'o1',
          name: 'Bacon',
          externalCode: 'b',
          quantity: 1,
          unitPrice: brl(3),
          totalPrice: brl(3),
        },
      ],
    },
  ],
  otherFees: [
    { name: 'Entrega', type: 'DELIVERY_FEE', receivedBy: 'MARKETPLACE', price: brl(5.9) },
    { name: 'Serviço', type: 'SERVICE_FEE', receivedBy: 'MARKETPLACE', price: brl(0.99) },
  ],
  discounts: [
    {
      amount: brl(10),
      target: 'CART',
      sponsorshipValues: [
        { name: 'MARKETPLACE', amount: brl(6) },
        { name: 'MERCHANT', amount: brl(4) },
      ],
    },
  ],
  total: {
    itemsPrice: brl(46),
    otherFees: brl(6.89),
    discount: brl(10),
    orderAmount: brl(42.89),
  },
  payments: {
    methods: [{ value: 42.89, type: 'PREPAID', method: 'CREDIT', brand: 'VISA' }],
  },
  customer: {
    name: 'Ana',
    documentNumber: '123.456.789-09',
    phone: { number: '+55 11 99999-0000' },
  },
  delivery: {
    deliveredBy: 'MARKETPLACE',
    pickupCode: '4411',
    deliveryAddress: {
      street: 'Rua A',
      number: '10',
      district: 'Centro',
      city: 'São Paulo',
      formattedAddress: 'Rua A, 10 - Centro - São Paulo',
      complement: 'ap 2',
      coordinates: { latitude: -23.5, longitude: -46.6 },
    },
  },
  ...over,
});

describe('Open Delivery / Keeta: pedido', () => {
  it('traduz itens, taxas, descontos por quem paga e pagamento no app', () => {
    const o = odToExternal(keetaOrder(), 'keeta', 'Keeta');
    expect(o).toMatchObject({
      channel: 'keeta',
      externalId: 'kt-order-1',
      displayCode: '7781',
      fulfillment: 'delivery',
      timing: 'immediate',
      deliveredBy: 'channel',
      pickupCode: '4411',
      customer: { name: 'Ana', phone: '+55 11 99999-0000', taxDocument: '12345678909' },
      totals: { subtotal: '46.00', deliveryFee: '5.90', serviceFee: '0.99', total: '42.89' },
    });
    expect(o.items[0]).toMatchObject({
      externalCode: 'CMD-abc',
      quantity: 2,
      unitPrice: '23.00',
      total: '46.00',
      notes: 'sem cebola',
      options: [{ name: 'Bacon', unitPrice: '3.00', quantity: 1 }],
    });
    expect(o.discounts).toEqual([
      { amount: '6.00', sponsor: 'channel', target: 'items', description: 'Desconto MARKETPLACE' },
      { amount: '4.00', sponsor: 'merchant', target: 'items', description: 'Desconto MERCHANT' },
    ]);
    expect(o.payments).toEqual([
      { prepaid: true, method: 'credit', amount: '42.89', brand: 'VISA' },
    ]);
    expect(o.address).toMatchObject({ text: 'Rua A, 10 - Centro - São Paulo', lat: -23.5 });
    // No Comandou: o desconto do aplicativo não reduz o pedido; o da loja reduz.
    expect(comandouTotals(o)).toMatchObject({
      subtotal: '46.00',
      discount: '4.00',
      total: '48.89',
      channelDiscount: '6.00',
    });
  });

  it('retirada agendada, dinheiro com troco, nome cifrado e telefone que não é número', () => {
    const o = odToExternal(
      keetaOrder({
        type: 'TAKEOUT',
        orderTiming: 'SCHEDULED',
        schedule: {
          scheduledDateTimeStart: '2026-11-19T19:00:00Z',
          scheduledDateTimeEnd: '2026-11-19T19:30:00Z',
        },
        delivery: undefined,
        payments: {
          methods: [{ value: 42.89, type: 'PENDING', method: 'CASH', changeFor: 50 }],
        },
        customer: {
          name: 'QmFzZTY0Q2lmcmFkb0RvTm9tZURvQ2xpZW50ZUtlZXRhMTIz',
          phone: { number: 'enc:xyz' },
        },
      }),
      'keeta',
      'Keeta',
    );
    expect(o).toMatchObject({
      fulfillment: 'takeout',
      timing: 'scheduled',
      scheduledFor: '2026-11-19T19:00:00Z',
      deliveredBy: 'merchant',
      customer: { name: 'Cliente Keeta' },
      payments: [{ prepaid: false, method: 'cash', amount: '42.89', changeFor: '50.00' }],
    });
    expect(o.customer.phone).toBeUndefined();
    expect(o.address).toBeUndefined();
  });

  it('eventos, verbos e motivos de cancelamento', () => {
    expect(odEventKind('CREATED')).toBe('order.created');
    expect(odEventKind('ORDER_COLLECTED')).toBe('order.dispatched');
    expect(odEventKind('USER_REFUND_REQUEST')).toBe('order.dispute');
    expect(odEventKind('REFUNDED')).toBe('order.dispute_settled');
    expect(odEventKind('PICKUP_ONGOING')).toBe('delivery.update');
    expect(odEventKind('RECOMMENDED_PREPARATION_START')).toBe('other');
    expect(odVerb('ready')).toBe('readyForPickup');
    expect(odVerb('reject')).toBe('requestCancellation');
    expect(odVerb('dispute_accept')).toBe('acceptRefund');
    expect(odVerb('dispute_alternative')).toBeNull();
    expect(odCancelCode('unavailable_item')).toBe('UNAVAILABLE_ITEM');
    expect(odCancelCode('503')).toBe('INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT');
    expect(
      odRefundDispute('kt-1', JSON.stringify({ reason: 'Veio frio', refundProducts: [{}, {}] })),
    ).toEqual({
      externalId: 'kt-1:refund',
      kind: 'REFUND_REQUEST',
      message: 'Veio frio · 2 item(ns) no pedido de reembolso',
      alternatives: [],
      acceptReasons: [],
    });
  });
});

describe('Keeta: assinatura', () => {
  it('monta o texto como nos exemplos da Keeta', () => {
    expect(
      keetaSignatureString(
        'https://api.example.com/v1/users',
        { page: '2', limit: '10', sort: 'name' },
        undefined,
      ),
    ).toBe('https://api.example.com/v1/users&limit=10&page=2&sort=name');
    expect(
      keetaSignatureString(
        'https://api.example.com/v1/orders',
        {},
        jcs({ userId: 123, productId: 456, quantity: 2 }),
      ),
    ).toBe('https://api.example.com/v1/orders&{"productId":456,"quantity":2,"userId":123}');
    const s = keetaSignatureString(
      'https://api.example.com/v1/products',
      { version: 'v2', format: 'json' },
      jcs({ name: 'Product A', price: 99.99 }),
    );
    expect(s).toBe(
      'https://api.example.com/v1/products&format=json&version=v2&{"name":"Product A","price":99.99}',
    );
    // Conferido à parte (HMAC-SHA256 em Base64 com o mesmo segredo).
    expect(keetaSignature('segredo-da-keeta', s)).toBe(
      'oMBgmBJ5UAqvyJSRSZ9CJ6mdruQ3vrbJfU3xfZhywMI=',
    );
    // Corpo vazio e "{}" ficam de fora; parâmetro nulo vira "chave=".
    expect(keetaSignatureString('https://x.test/a', { b: null }, '{}')).toBe('https://x.test/a&b=');
  });

  it('JSON canônico: chaves em ordem em todos os níveis, sem espaço e sem undefined', () => {
    expect(jcs({ b: [3, { z: 1, a: 'é' }], a: null, c: undefined, d: 1.5 })).toBe(
      '{"a":null,"b":[3,{"a":"é","z":1}],"d":1.5}',
    );
  });
});
