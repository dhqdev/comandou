import { comandouTotals } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { parseExternalOrder } from '../channels/external-order.schema';
import { ifoodSample } from '../../../test/fake-ifood';
import {
  ifoodCancelReasons,
  ifoodCents,
  ifoodDispute,
  ifoodEventKind,
  ifoodPatchChanges,
  ifoodSettlement,
  ifoodToExternal,
  ifoodVerb,
} from './ifood-order';

describe('iFood: eventos', () => {
  it('traduz o código curto e o longo', () => {
    expect(ifoodEventKind('PLC', 'PLACED')).toBe('order.created');
    expect(ifoodEventKind('CFM')).toBe('order.confirmed');
    expect(ifoodEventKind(undefined, 'READY_TO_PICKUP')).toBe('order.ready');
    expect(ifoodEventKind('CAN', 'CANCELLED')).toBe('order.cancelled');
    expect(ifoodEventKind('CARF')).toBe('order.cancellation_denied');
    expect(ifoodEventKind('HSD')).toBe('order.dispute');
    expect(ifoodEventKind('ADR', 'ASSIGN_DRIVER')).toBe('delivery.update');
    expect(ifoodEventKind('XYZ', 'NOVO_EVENTO')).toBe('other');
  });

  it('pedido alterado pelo cliente e pedido de outro endereço viram aviso (não "other")', () => {
    expect(ifoodEventKind('OPA', 'ORDER_PATCHED')).toBe('order.patched');
    expect(ifoodEventKind(undefined, 'ORDER_PATCHED')).toBe('order.patched');
    expect(ifoodEventKind('DAR', 'DELIVERY_ADDRESS_CHANGE_REQUESTED')).toBe(
      'order.address_changed',
    );
    // Só o tipo da mudança, sem itens, valores nem dados do cliente.
    expect(
      ifoodPatchChanges({
        changes: [
          { changeType: 'ADD_ITEMS', items: [{ name: 'X' }] },
          { changeType: 'add_items' },
          { changeType: 'EDIT_ITEMS' },
          { changeType: '<x>' },
        ],
        total: { subtotal: { from: 10, to: 20 } },
      }),
    ).toEqual(['ADD_ITEMS', 'EDIT_ITEMS']);
    expect(ifoodPatchChanges(undefined)).toEqual([]);
  });

  it('ações: entregue não existe no iFood (ele conclui sozinho)', () => {
    expect(ifoodVerb('confirm')).toBe('confirm');
    expect(ifoodVerb('ready')).toBe('readyToPickup');
    expect(ifoodVerb('reject')).toBe('requestCancellation');
    expect(ifoodVerb('delivered')).toBeNull();
  });
});

describe('iFood: pedido', () => {
  it('centavos sem erro de ponto flutuante', () => {
    expect(ifoodCents(0.1 + 0.2)).toBe(30);
    expect(ifoodCents(62.79)).toBe(6279);
    expect(ifoodCents('12.9')).toBe(1290);
    expect(ifoodCents(undefined)).toBe(0);
  });

  it('pedido pago online: valores, descontos por quem paga e prazo de 8 minutos', () => {
    const o = parseExternalOrder(ifoodToExternal(ifoodSample()));
    expect(o).toMatchObject({
      channel: 'ifood',
      displayCode: '4821',
      storeId: 'aaaa1111-2222-3333-4444-555555555555',
      fulfillment: 'delivery',
      timing: 'immediate',
      deliveredBy: 'channel',
      pickupCode: '7788',
      customer: { name: 'Maria Cliente', phoneLocator: '12345678', taxDocument: '12345678909' },
      // Taxa do iFood (additionalFees 0,99) é receita do iFood: fora do pedido pago online.
      totals: { subtotal: '61.80', deliveryFee: '5.00', serviceFee: '0.00', total: '62.79' },
      payments: [{ prepaid: true, method: 'credit', amount: '62.79', brand: 'VISA' }],
      deadlines: { confirmBy: '2026-11-18T19:08:00.000Z' },
    });
    expect(o.items[0]).toMatchObject({
      externalCode: 'CMD-abcdef012345',
      quantity: 2,
      unitPrice: '27.90',
      total: '55.80',
      notes: 'Sem cebola',
      options: [{ name: 'Bacon', externalCode: 'OP-0123456789ab', unitPrice: '2.00' }],
    });
    expect(o.discounts).toEqual([
      { amount: '2.00', sponsor: 'channel', target: 'items', description: 'Benefício IFOOD' },
      { amount: '3.00', sponsor: 'merchant', target: 'items', description: 'Benefício MERCHANT' },
    ]);
    // No Comandou: só o desconto do restaurante reduz; o do iFood volta no repasse.
    expect(comandouTotals(o)).toMatchObject({
      discount: '3.00',
      surcharge: '0.00',
      total: '63.80',
      channelDiscount: '2.00',
    });
    expect(o.address).toMatchObject({ text: 'Rua das Flores, 10', lat: -23.5, lng: -46.6 });
  });

  it('dinheiro na entrega com troco, entrega própria e cupom de frete do iFood', () => {
    const o = ifoodToExternal(
      ifoodSample({
        benefits: [
          { value: 5, target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'IFOOD', value: 5 }] },
        ],
        total: { subTotal: 61.8, deliveryFee: 5, benefits: 5, orderAmount: 61.8 },
        payments: {
          prepaid: 0,
          pending: 61.8,
          methods: [
            {
              value: 61.8,
              method: 'CASH',
              type: 'OFFLINE',
              prepaid: false,
              cash: { changeFor: 100 },
            },
          ],
        },
        delivery: {
          deliveredBy: 'MERCHANT',
          deliveryAddress: { streetName: 'Rua A', streetNumber: '5' },
        },
      }),
    );
    expect(o.deliveredBy).toBe('merchant');
    expect(o.payments).toEqual([
      { prepaid: false, method: 'cash', amount: '61.80', changeFor: '100.00' },
    ]);
    expect(o.discounts).toEqual([
      { amount: '5.00', sponsor: 'channel', target: 'delivery', description: 'Benefício IFOOD' },
    ]);
    expect(o.address?.text).toBe('Rua A, 5');
    expect(o.totals.serviceFee).toBe('0.00');
  });

  it('taxa do iFood no dinheiro na entrega: entra só o que falta para o valor a cobrar', () => {
    const cash = (benefits: number, orderAmount: number, ifoodCoupon: number) =>
      parseExternalOrder(
        ifoodToExternal(
          ifoodSample({
            benefits: ifoodCoupon
              ? [{ value: ifoodCoupon, sponsorshipValues: [{ name: 'IFOOD', value: ifoodCoupon }] }]
              : [],
            total: { subTotal: 61.8, deliveryFee: 5, benefits, additionalFees: 0.99, orderAmount },
            additionalFees: [{ type: 'SMALL_ORDER_FEE', value: 0.99 }],
            payments: {
              prepaid: 0,
              pending: orderAmount,
              methods: [
                {
                  value: orderAmount,
                  method: 'CASH',
                  type: 'OFFLINE',
                  prepaid: false,
                  cash: { changeFor: 100 },
                },
              ],
            },
            delivery: { deliveredBy: 'MERCHANT', deliveryAddress: { streetName: 'Rua A' } },
          }),
        ),
      );
    // Sem cupom: o cliente paga 67,79 ao entregador da loja (com a taxa). O pedido fica com 67,79
    // para o "cobrar na entrega" e o troco baterem; o iFood desconta a taxa no repasse.
    const a = cash(0, 67.79, 0);
    expect(a.totals.serviceFee).toBe('0.99');
    expect(comandouTotals(a).total).toBe('67.79');
    // Cupom do iFood de 2,00 cobre a taxa: nada entra; o iFood paga 1,01 (2,00 − 0,99) no app.
    const b = cash(2, 65.79, 2);
    expect(b.totals.serviceFee).toBe('0.00');
    expect(comandouTotals(b)).toMatchObject({ total: '66.80', channelDiscount: '2.00' });
  });

  it('cupom de parceiro (EXTERNAL) volta no repasse; o da rede (CHAIN) segue como custo da loja', () => {
    const o = ifoodToExternal(
      ifoodSample({
        benefits: [
          {
            value: 6,
            target: 'CART',
            sponsorshipValues: [
              { name: 'CHAIN', value: 3 },
              { name: 'EXTERNAL', value: 1 },
              { name: 'MERCHANT', value: 2 },
            ],
          },
        ],
      }),
    );
    expect(o.discounts.map((d) => [d.description, d.sponsor])).toEqual([
      ['Benefício CHAIN', 'merchant'],
      ['Benefício EXTERNAL', 'channel'],
      ['Benefício MERCHANT', 'merchant'],
    ]);
    expect(comandouTotals(o)).toMatchObject({ discount: '5.00', channelDiscount: '1.00' });
  });

  it('complemento com addition: preço de cada = unitPrice + addition', () => {
    const o = ifoodToExternal(
      ifoodSample({
        items: [
          {
            id: 'item-1',
            name: 'Pizza',
            quantity: 1,
            unitPrice: 40,
            optionsPrice: 6,
            totalPrice: 46,
            options: [
              {
                id: 'op-1',
                name: 'Borda',
                quantity: 2,
                unitPrice: 2,
                addition: 1,
                price: 6,
                customizations: [
                  { id: 'c-1', name: 'Catupiry', quantity: 1, unitPrice: 0, addition: 1.5 },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(o.items[0]!.options).toMatchObject([
      { name: 'Borda', quantity: 2, unitPrice: '3.00' },
      { name: 'Catupiry', quantity: 1, unitPrice: '1.50' },
    ]);
  });

  it('retirada agendada: prazo conta do início do preparo; quem entrega é o restaurante', () => {
    const o = ifoodToExternal(
      ifoodSample({
        orderType: 'TAKEOUT',
        orderTiming: 'SCHEDULED',
        preparationStartDateTime: '2026-11-18T21:30:00.000Z',
        takeout: { takeoutDateTime: '2026-11-18T22:00:00.000Z' },
        delivery: undefined,
      }),
    );
    expect(o).toMatchObject({
      fulfillment: 'takeout',
      timing: 'scheduled',
      deliveredBy: 'merchant',
      scheduledFor: '2026-11-18T22:00:00.000Z',
      prepareFrom: '2026-11-18T21:30:00.000Z',
      deadlines: { confirmBy: '2026-11-18T21:38:00.000Z' },
    });
    expect(o.address).toBeUndefined();
  });

  it('dados faltando ou estranhos não derrubam o pedido', () => {
    const o = parseExternalOrder(
      ifoodToExternal({
        id: 'x-1',
        merchant: { id: 'm1' },
        customer: { documentNumber: '123' },
        items: [{ name: '  ', quantity: 0.25, unit: 'KG', totalPrice: 12.5 }],
        total: { subTotal: 12.5, orderAmount: 12.5 },
      }),
    );
    expect(o.items[0]).toMatchObject({
      name: 'Item do iFood',
      unit: 'kg',
      quantity: 0.25,
      total: '12.50',
    });
    expect(o.customer.taxDocument).toBeUndefined();
    expect(o.displayCode).toBe('x-1');
  });
});

describe('iFood: negociação e motivos', () => {
  it('guarda só o necessário da negociação (sem fotos), com limites e códigos limpos', () => {
    const d = ifoodDispute({
      disputeId: 'd-1',
      action: 'proposed_amount_refund',
      message: '  Veio frio  ',
      expiresAt: '2026-11-18T19:05:00.000Z',
      timeoutAction: 'REJECT_CANCELLATION',
      evidences: [{ url: 'https://foto/1.jpg' }],
      alternatives: [
        { id: 'a1', type: 'REFUND', metadata: { maxAmount: { value: 1250, currency: 'BRL' } } },
        {
          id: 'a2',
          type: 'ADDITIONAL_TIME',
          metadata: { allowedsAdditionalTimeInMinutes: [10, 999] },
        },
        { id: '', type: 'BENEFIT' },
      ],
      metadata: { acceptCancellationReasons: ['customer_request', '<x>'] },
    });
    expect(d).toEqual({
      externalId: 'd-1',
      kind: 'PROPOSED_AMOUNT_REFUND',
      message: 'Veio frio',
      expiresAt: '2026-11-18T19:05:00.000Z',
      timeoutAction: 'REJECT_CANCELLATION',
      alternatives: [
        { id: 'a1', type: 'REFUND', maxAmount: '12.50' },
        { id: 'a2', type: 'ADDITIONAL_TIME', minutes: [10] },
      ],
      acceptReasons: ['CUSTOMER_REQUEST'],
    });
    expect(JSON.stringify(d)).not.toContain('foto');
    expect(ifoodDispute({})).toBeNull();
    expect(ifoodSettlement({ disputeId: 'd-1', status: 'ACCEPTED' })).toEqual({
      externalId: 'd-1',
      outcome: 'ACCEPTED',
    });
  });

  it('motivos de cancelamento: só código válido e texto legível', () => {
    expect(
      ifoodCancelReasons([
        { cancelCodeId: '503', description: 'ITEM INDISPONIVEL' },
        { cancelCodeId: 'a b', description: 'ruim' },
        { code: '509', name: 'Dificuldades internas' },
      ]),
    ).toEqual([
      { code: '503', label: 'Item indisponivel' },
      { code: '509', label: 'Dificuldades internas' },
    ]);
  });
});
