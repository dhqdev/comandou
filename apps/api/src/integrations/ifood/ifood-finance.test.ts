import { describe, expect, it } from 'vitest';
import { addDays, ifoodPayouts, ifoodSale, ifoodSalesPage, payoutStatus } from './ifood-finance';

describe('financeiro do iFood: vendas', () => {
  it('bruto = itens + entrega; saldo e descontos só depois que o iFood fecha a venda', () => {
    expect(
      ifoodSale({
        id: 'pedido-1',
        saleGrossValue: { bag: '61.80', deliveryFee: 5, serviceFee: 0.99 },
        billingSummary: {
          saleBalance: 52.1,
          billingEntries: [
            { type: 'COMMISSION', value: -8 },
            { type: 'PAYMENT_FEE', value: { value: -2.07 } },
            { type: 'ALGO_NOVO', description: 'Ajuste', value: -4.63 },
            { type: 'COMMISSION', value: 0 },
          ],
        },
      }),
    ).toEqual({
      externalId: 'pedido-1',
      gross: '66.80',
      net: '52.10',
      fees: '14.70',
      entries: [
        { label: 'Comissão do iFood', amount: '-8.00' },
        { label: 'Taxa de pagamento', amount: '-2.07' },
        { label: 'Ajuste', amount: '-4.63' },
      ],
    });
    // Saldo 0 sem lançamentos = ainda não fechado.
    expect(
      ifoodSale({ id: 'p2', saleGrossValue: { bag: 10 }, billingSummary: { saleBalance: 0 } }),
    ).toMatchObject({ gross: '10.00', net: null, fees: null, entries: [] });
    // Sem id: fora.
    expect(ifoodSale({ saleGrossValue: { bag: 10 } })).toBeNull();
  });

  it('página de vendas: lista e total de páginas (corpo vazio = nada)', () => {
    expect(ifoodSalesPage({ sales: [{ id: 'a' }, { x: 1 }], pageCount: 3 })).toMatchObject({
      pageCount: 3,
      sales: [{ externalId: 'a' }],
    });
    expect(ifoodSalesPage(null)).toEqual({ sales: [], pageCount: 1 });
  });
});

describe('financeiro do iFood: repasses', () => {
  const body = (item: Record<string, unknown>) => ({
    settlements: [
      {
        startDateCalculation: '2026-11-01',
        endDateCalculation: '2026-11-07T23:59:59',
        closingItems: [{ accountDetails: { accountNumber: '999-1' }, ...item }],
      },
    ],
  });

  it('cai na data antecipada com o valor antecipado; sem dados da conta; id estável', () => {
    const a = ifoodPayouts(
      'loja-1',
      body({
        type: 'ANTECIPACAO',
        originalPaymentAmount: 420.75,
        originalPaymentDate: '2026-11-20',
        anticipatedPaymentAmount: 410.2,
        anticipatedPaymentDate: '2026-11-12',
        feeAmount: -10.55,
        status: 'SCHEDULED',
      }),
    );
    expect(a).toEqual([
      {
        externalId: expect.stringMatching(/^[0-9a-f]{40}$/),
        kind: 'ANTECIPACAO',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-07',
        expectedDate: '2026-11-12',
        amount: '410.20',
        originalAmount: '420.75',
        originalDate: '2026-11-20',
        anticipationFee: '10.55',
        status: 'scheduled',
        channelStatus: 'SCHEDULED',
      },
    ]);
    expect(JSON.stringify(a)).not.toContain('999-1');
    // O mesmo repasse com outro valor tem o mesmo id (o valor muda, a conta é trocada).
    const b = ifoodPayouts(
      'loja-1',
      body({
        type: 'ANTECIPACAO',
        originalPaymentAmount: 420.75,
        originalPaymentDate: '2026-11-20',
        anticipatedPaymentAmount: 400,
        anticipatedPaymentDate: '2026-11-12',
      }),
    );
    expect(b[0]!.externalId).toBe(a[0]!.externalId);
    expect(
      ifoodPayouts(
        'loja-2',
        body({ originalPaymentAmount: 1, originalPaymentDate: '2026-11-20' }),
      )[0]!.externalId,
    ).not.toBe(a[0]!.externalId);
  });

  it('sem data ou valor: fora; situação traduzida', () => {
    expect(ifoodPayouts('l', body({ originalPaymentAmount: 10 }))).toEqual([]);
    expect(ifoodPayouts('l', {})).toEqual([]);
    expect(payoutStatus('PAID')).toBe('paid');
    expect(payoutStatus('TRANSFERRED')).toBe('paid');
    expect(payoutStatus('PAYMENT_FAILED')).toBe('failed');
    expect(payoutStatus('SCHEDULED')).toBe('scheduled');
    expect(payoutStatus(undefined)).toBe('scheduled');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
