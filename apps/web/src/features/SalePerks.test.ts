import { describe, expect, it } from 'vitest';
import { perkQuote, type PerkCart, type SalePerk } from './SalePerks';
import type { PinCoupon, PinReward } from './CustomerPin';

const cart = (over: Partial<PerkCart> = {}): PerkCart => ({
  channel: 'counter',
  subtotalCents: 5000,
  feeCents: 0,
  unitByProduct: new Map([['p1', 2590]]),
  ...over,
});
const reward = (r: Partial<PinReward>): SalePerk => ({
  kind: 'reward',
  reward: {
    id: 'r',
    name: 'Recompensa',
    cost: 10,
    kind: 'discount',
    amount: '10.00',
    productId: null,
    productName: null,
    productPrice: null,
    ...r,
  },
});
const coupon = (c: Partial<PinCoupon>): SalePerk => ({
  kind: 'coupon',
  coupon: {
    id: 'c',
    code: 'BEMVINDO',
    title: 'Boas-vindas',
    kind: 'percent',
    value: '10',
    maxDiscount: null,
    minOrder: '0',
    blocked: null,
    ...c,
  },
});

describe('perkQuote (Nova venda)', () => {
  it('sem escolha, sem desconto', () => {
    expect(perkQuote(null, cart())).toEqual({
      discountCents: 0,
      freeDelivery: false,
      problem: null,
    });
  });
  it('recompensa em reais nunca passa do valor dos itens', () => {
    expect(perkQuote(reward({}), cart()).discountCents).toBe(1000);
    expect(perkQuote(reward({ amount: '80.00' }), cart()).discountCents).toBe(5000);
  });
  it('produto grátis pede o produto no pedido e desconta uma unidade', () => {
    const r = reward({ kind: 'product', amount: null, productId: 'p1', productName: 'X-Burguer' });
    expect(perkQuote(r, cart()).discountCents).toBe(2590);
    expect(perkQuote(r, cart({ unitByProduct: new Map() })).problem).toMatch(/X-Burguer/);
  });
  it('cupom: porcentagem, pedido mínimo e entrega grátis só na entrega', () => {
    expect(perkQuote(coupon({}), cart()).discountCents).toBe(500);
    expect(perkQuote(coupon({ minOrder: '60.00' }), cart()).problem).toMatch(/a partir de/);
    const free = coupon({ kind: 'free_delivery', value: null });
    expect(perkQuote(free, cart()).problem).toMatch(/só na entrega/);
    expect(perkQuote(free, cart({ channel: 'delivery', feeCents: 700 }))).toEqual({
      discountCents: 700,
      freeDelivery: true,
      problem: null,
    });
  });
});
