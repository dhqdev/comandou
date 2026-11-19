import { describe, expect, it } from 'vitest';
import {
  shiftsLabel,
  actionForTransition,
  channelPath,
  channelInfo,
  channelMovesForward,
  comandouTotals,
  type ExternalOrder,
  orderChannelOf,
  secondsToDeadline,
  statusForEvent,
} from './channels';

const base: ExternalOrder = {
  channel: 'ifood',
  externalId: 'abc',
  displayCode: '1234',
  storeId: 'loja',
  createdAt: '2026-11-18T12:00:00Z',
  fulfillment: 'delivery',
  timing: 'immediate',
  deliveredBy: 'merchant',
  customer: { name: 'Ana' },
  items: [{ name: 'X-Burger', quantity: 2, unitPrice: '25.00', total: '50.00', options: [] }],
  totals: { subtotal: '50.00', deliveryFee: '7.00', serviceFee: '0.99', total: '47.99' },
  discounts: [
    { amount: '5.00', sponsor: 'merchant', target: 'items' },
    { amount: '5.00', sponsor: 'channel', target: 'items' },
  ],
  payments: [{ prepaid: true, method: 'credit', amount: '47.99' }],
};

describe('canais de delivery', () => {
  it('desconto do aplicativo não reduz o pedido; o do restaurante reduz', () => {
    expect(comandouTotals(base)).toEqual({
      subtotal: '50.00',
      discount: '5.00',
      surcharge: '0.99',
      deliveryFee: '7.00',
      total: '52.99',
      channelDiscount: '5.00',
    });
  });

  it('o canal só empurra o pedido para a frente', () => {
    expect(channelMovesForward('ready', 'new')).toBe(false);
    expect(channelMovesForward('new', 'ready')).toBe(true);
    expect(channelMovesForward('completed', 'cancelled')).toBe(false);
    expect(channelMovesForward('in_production', 'cancelled')).toBe(true);
    expect(channelMovesForward('cancel_requested', 'new')).toBe(true);
    expect(channelMovesForward('ready', 'ready')).toBe(false);
  });

  it('evento vira estado e mudança vira ação', () => {
    expect(statusForEvent('order.concluded')).toBe('completed');
    expect(statusForEvent('order.dispute')).toBeNull();
    expect(actionForTransition('awaiting', 'new', 'channel')).toBe('confirm');
    expect(actionForTransition('awaiting', 'cancelled', 'channel')).toBe('reject');
    expect(actionForTransition('ready', 'dispatched', 'channel')).toBeNull();
    expect(actionForTransition('ready', 'dispatched', 'merchant')).toBe('dispatch');
    expect(actionForTransition('dispatched', 'completed', 'merchant')).toBe('delivered');
    expect(actionForTransition('dispatched', 'ready', 'merchant')).toBeNull();
    expect(actionForTransition('new', 'cancel_requested', null)).toBe('request_cancellation');
  });

  it('tipo, selo e prazo', () => {
    expect(orderChannelOf('takeout')).toBe('pickup');
    expect(orderChannelOf('dine_in')).toBe('counter');
    expect(channelInfo('ifood').label).toBe('iFood');
    expect(channelInfo('od-meuapp', 'Meu App').label).toBe('Meu App');
    expect(secondsToDeadline('2026-11-18T12:08:00Z', Date.parse('2026-11-18T12:00:00Z'))).toBe(480);
    expect(secondsToDeadline(null)).toBeNull();
  });
});

describe('channelPath', () => {
  it('anda pelos passos permitidos', () => {
    expect(channelPath('new', 'dispatched', 'delivery')).toEqual(['ready', 'dispatched']);
    expect(channelPath('awaiting', 'completed', 'delivery')).toEqual(['new', 'ready', 'completed']);
    expect(channelPath('in_production', 'completed', 'pickup')).toEqual(['ready', 'completed']);
    expect(channelPath('cancel_requested', 'ready', 'delivery')).toEqual(['ready']);
  });
  it('retirada não passa por "saiu para entrega"', () => {
    expect(channelPath('new', 'dispatched', 'pickup')).toEqual(['ready']);
  });
  it('não volta e não muda pedido encerrado', () => {
    expect(channelPath('ready', 'new', 'delivery')).toEqual([]);
    expect(channelPath('completed', 'cancelled', 'delivery')).toEqual([]);
  });
  it('cancelar depois de sair para entrega não dá', () => {
    expect(channelPath('dispatched', 'cancelled', 'delivery')).toBeNull();
    expect(channelPath('new', 'cancelled', 'delivery')).toEqual(['cancelled']);
  });
});

describe('horários da loja no aplicativo', () => {
  it('ordena por dia e passa da meia-noite sem quebrar', () => {
    expect(
      shiftsLabel([
        { day: 5, start: '18:00', minutes: 420 },
        { day: 1, start: '11:00', minutes: 660 },
      ]),
    ).toBe('Seg 11:00–22:00 · Sex 18:00–01:00');
    expect(shiftsLabel([])).toBe('');
  });
});
