import { describe, expect, it } from 'vitest';
import {
  closeTotals,
  percentCents,
  percentFrom,
  percentOf,
  planPayments,
  splitRows,
} from './close-math';

describe('fechar conta do pedido', () => {
  it('soma taxa de serviço e frete e tira o desconto', () => {
    const t = closeTotals({
      subtotal: 4880,
      paid: 0,
      discount: 500,
      surcharge: percentCents(4880 - 500, 10),
      deliveryFee: 700,
    });
    expect(t.surcharge).toBe(438);
    expect(t.total).toBe(4880 - 500 + 438 + 700);
    expect(t.balance).toBe(t.total);
  });

  it('lê percentuais e mostra o percentual já cobrado', () => {
    expect(percentOf('10')).toBe(10);
    expect(percentOf('12,5')).toBe(12.5);
    expect(percentOf('')).toBe(0);
    expect(percentOf('abc')).toBeNull();
    expect(percentOf('150')).toBeNull();
    expect(percentFrom(488, 4880)).toBe('10');
    expect(percentFrom(0, 4880)).toBe('0');
  });

  it('pagamento exato em dois meios', () => {
    const p = planPayments(
      [
        { method: 'pix', amount: '30,00' },
        { method: 'credit', amount: '25,80' },
      ],
      5580,
    );
    expect(p.applied).toEqual([3000, 2580]);
    expect(p.missing).toBe(0);
    expect(p.change).toBe(0);
    expect(p.excess).toBe(0);
  });

  it('dinheiro acima do saldo vira troco; cartão acima não é aceito', () => {
    const cash = planPayments([{ method: 'cash', amount: '60,00' }], 5580);
    expect(cash.applied).toEqual([5580]);
    expect(cash.tendered).toEqual([6000]);
    expect(cash.change).toBe(420);
    expect(cash.excess).toBe(0);
    const card = planPayments([{ method: 'debit', amount: '60,00' }], 5580);
    expect(card.excess).toBe(420);
  });

  it('marca valor inválido e o que falta', () => {
    expect(planPayments([{ method: 'pix', amount: 'xx' }], 1000).invalid).toBe(true);
    expect(planPayments([{ method: 'pix', amount: '4,00' }], 1000).missing).toBe(600);
  });

  it('divide por pessoa mantendo o meio escolhido', () => {
    const rows = splitRows([{ method: 'pix', amount: '55,80' }], 5580, 2);
    expect(rows).toEqual([
      { method: 'pix', amount: '27,90' },
      { method: 'pix', amount: '27,90' },
    ]);
    expect(splitRows(rows, 1000, 3).map((r) => r.amount)).toEqual(['3,34', '3,33', '3,33']);
  });
});
