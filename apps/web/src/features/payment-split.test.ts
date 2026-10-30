import { describe, expect, it } from 'vitest';
import { replan } from './PaymentModal';

describe('conta dividida: uma parte por pessoa', () => {
  it('divide o saldo em N partes que somam o total', () => {
    const p = replan([], 7870, 5);
    expect(p.map((x) => x.cents)).toEqual([1574, 1574, 1574, 1574, 1574]);
  });

  it('depois de uma parte paga, o resto é redividido só entre quem falta', () => {
    const start = replan([], 10000, 3);
    // Pessoa 1 pagou um pouco mais (40,00) no PIX.
    const marked = start.map((p, i) => (i === 0 ? { cents: 4000, paid: 'pix' as const } : p));
    const next = replan(marked, 6000, 3);
    expect(next).toEqual([{ cents: 4000, paid: 'pix' }, { cents: 3000 }, { cents: 3000 }]);
  });

  it('todos pagaram e ainda sobra: cria mais uma parte com o resto', () => {
    const plan = [
      { cents: 3000, paid: 'cash' as const },
      { cents: 3000, paid: 'pix' as const },
    ];
    expect(replan(plan, 500, 2)).toEqual([...plan, { cents: 500 }]);
  });

  it('aumentar o número de pessoas no meio mantém as partes já pagas', () => {
    const plan = [{ cents: 5000, paid: 'debit' as const }, { cents: 5000 }];
    expect(replan(plan, 5000, 3).map((p) => p.cents)).toEqual([5000, 2500, 2500]);
  });
});
