import { describe, expect, it } from 'vitest';
import {
  centsOf,
  closeTotals,
  percentCents,
  percentFrom,
  percentOf,
  planPayments,
  resplitRows,
  splitRows,
  type KeyedPayRow,
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

  it('lê ponto como vírgula só quando é a casa decimal', () => {
    expect(centsOf('12.90')).toBe(1290);
    expect(centsOf('100.00')).toBe(10000);
    expect(centsOf('50.5')).toBe(5050);
    expect(centsOf('0.5')).toBe(50);
    expect(centsOf('1.234')).toBe(123400);
    expect(centsOf('1.234,56')).toBe(123456);
    expect(centsOf('12,9')).toBe(1290);
    expect(centsOf('')).toBe(0);
  });

  describe('nova tentativa depois de um pagamento que parou no meio', () => {
    let n = 0;
    const key = () => `k${++n}`;
    const rows: KeyedPayRow[] = [
      { method: 'pix', amount: '50,00', key: 'a', done: true },
      { method: 'credit', amount: '50,00', key: 'b' },
    ];

    it('linha já recebida não abate de novo o saldo (que já a desconta)', () => {
      const p = planPayments(rows, 5000);
      expect(p.applied).toEqual([0, 5000]);
      expect(p.typed).toBe(5000);
      expect(p.missing).toBe(0);
      expect(p.excess).toBe(0);
    });

    it('refaz a divisão só nas linhas que faltam e mantém a chave quando o valor é o mesmo', () => {
      const out = resplitRows(rows, 5000, 2, key);
      expect(out).toEqual([rows[0], { method: 'credit', amount: '50,00', key: 'b' }]);
    });

    it('linha com valor novo ganha chave nova; a recebida fica como está', () => {
      const out = resplitRows(rows, 3000, 2, key);
      expect(out[0]).toBe(rows[0]);
      expect(out[1]!.amount).toBe('30,00');
      expect(out[1]!.key).not.toBe('b');
      expect(out[1]!.done).toBeUndefined();
    });

    it('dividir por 3 com uma já recebida reparte o saldo entre as outras duas', () => {
      const out = resplitRows(rows, 5000, 3, key);
      expect(out.map((r) => [r.amount, !!r.done])).toEqual([
        ['50,00', true],
        ['25,00', false],
        ['25,00', false],
      ]);
      expect(out[1]!.key).not.toBe('b');
      expect(new Set(out.map((r) => r.key)).size).toBe(3);
    });

    it('tudo recebido: não cria linha nova; saldo novo ganha uma linha só para ele', () => {
      const all = rows.map((r) => ({ ...r, done: true }));
      expect(resplitRows(all, 0, 2, key)).toBe(all);
      const more = resplitRows(all, 700, 2, key);
      expect(more.slice(0, 2)).toEqual(all);
      expect(more[2]).toMatchObject({ method: 'credit', amount: '7,00' });
      expect(more[2]!.done).toBeUndefined();
    });
  });
});
