import { describe, expect, it } from 'vitest';
import {
  buildDre,
  DEFAULT_PAYMENT_TERMS,
  dreGroupOf,
  suggestCategory,
  feeCents,
  normalizeBankAmount,
  normalizePaymentTerms,
  parseOfx,
  settlementDate,
  statementKeys,
  type DreRaw,
} from './finance-plan';
import { toCents } from './money';

describe('plano de contas', () => {
  it('reconhece o plano padrão e o texto escrito à mão', () => {
    expect(dreGroupOf('Aluguel', 'payable')).toBe('occupancy');
    expect(dreGroupOf('Conta de luz', 'payable')).toBe('utilities');
    expect(dreGroupOf('ENERGIA ELÉTRICA', 'payable')).toBe('utilities');
    expect(dreGroupOf('DAS outubro', 'payable')).toBe('taxes');
    expect(dreGroupOf('Compra das verduras', 'payable')).toBe('cmv');
    expect(dreGroupOf('Embalagens', 'payable')).toBe('cmv');
    expect(dreGroupOf('Comissão iFood', 'payable')).toBe('selling');
    expect(dreGroupOf('Gasolina da moto', 'payable')).toBe('selling');
    expect(dreGroupOf('Gás', 'payable')).toBe('utilities');
    expect(dreGroupOf('Aluguel da maquininha', 'payable')).toBe('financial');
    expect(dreGroupOf('Pró-labore', 'payable')).toBe('payroll');
    expect(dreGroupOf('Entregadores', 'payable')).toBe('selling');
    expect(dreGroupOf('Freezer novo', 'payable')).toBe('investments');
    expect(dreGroupOf('Qualquer coisa', 'payable')).toBe('admin');
    expect(dreGroupOf(null, 'payable')).toBe('admin');
    expect(dreGroupOf('Aluguel', 'receivable')).toBe('other_income');
    expect(dreGroupOf('Repasse do cartão', 'receivable')).toBe('sales_received');
    expect(suggestCategory('TARIFA PACOTE DE SERVICOS', 'payable')).toBe('Tarifas bancárias');
    expect(suggestCategory('PIX ENVIADO JOAO', 'payable')).toBeNull();
    expect(dreGroupOf('Vendas', 'receivable')).toBe('sales_received');
    expect(dreGroupOf('Encomenda de bolo', 'receivable')).toBe('other_income');
    expect(dreGroupOf('Convênios e vendas a prazo', 'receivable')).toBe('other_income');
  });
});

describe('maquininhas', () => {
  it('calcula a taxa ao centavo e não cobra taxa de estorno', () => {
    expect(feeCents(10000, '3.20')).toBe(320);
    expect(feeCents(3333, '1.50')).toBe(50);
    expect(feeCents(-500, '3.20')).toBe(0);
    expect(feeCents(10000, '0.00')).toBe(0);
  });

  it('prevê o dia do dinheiro pulando o fim de semana', () => {
    // 2026-11-13 é sexta.
    expect(settlementDate('2026-11-13', 1)).toBe('2026-11-16');
    expect(settlementDate('2026-11-13', 0)).toBe('2026-11-13');
    expect(settlementDate('2026-11-16', 1)).toBe('2026-11-17');
    expect(settlementDate('2026-11-14', 30)).toBe('2026-12-14');
    // 15 dias corridos a partir de 2026-11-07 (sábado) = 22 (domingo) → segunda 23.
    expect(settlementDate('2026-11-07', 15)).toBe('2026-11-23');
  });

  it('completa as taxas salvas com o padrão e descarta valor inválido', () => {
    const t = normalizePaymentTerms({
      credit: { feePercent: '2.9', days: 1 },
      debit: { feePercent: '99', days: 1 },
    });
    expect(t.credit).toEqual({ feePercent: '2.90', days: 1 });
    expect(t.debit).toEqual({ feePercent: DEFAULT_PAYMENT_TERMS.debit.feePercent, days: 1 });
    expect(t.voucher).toEqual(DEFAULT_PAYMENT_TERMS.voucher);
    expect(normalizePaymentTerms(null)).toEqual(DEFAULT_PAYMENT_TERMS);
  });
});

const raw = (over: Partial<DreRaw> = {}): DreRaw => ({
  sales: [
    { channel: 'table', amount: '60000.00' },
    { channel: 'delivery', amount: '40000.00' },
  ],
  refunds: '0.00',
  orders: 1000,
  entries: [
    { kind: 'payable', category: 'Impostos', amount: '6000.00' },
    { kind: 'payable', category: 'Insumos e mercadorias', amount: '20000.00' },
    { kind: 'payable', category: 'Salários', amount: '18000.00' },
    { kind: 'payable', category: 'Aluguel', amount: '8000.00' },
    { kind: 'payable', category: 'Energia', amount: '3000.00' },
    { kind: 'payable', category: 'Contabilidade', amount: '1000.00' },
    { kind: 'payable', category: 'Comissão iFood', amount: '4000.00' },
    { kind: 'payable', category: 'Tarifas bancárias', amount: '200.00' },
    { kind: 'payable', category: 'Equipamentos e reformas', amount: '5000.00' },
  ],
  cardFees: '2000.00',
  stockCmv: '0.00',
  stockLosses: '0.00',
  cashBreaks: '-50.00',
  ...over,
});

describe('DRE', () => {
  it('vai do faturamento ao lucro, com as compras fazendo as vezes do CMV sem ficha técnica', () => {
    const d = buildDre(raw());
    expect(d.cmvSource).toBe('purchases');
    expect(d.totals.grossRevenue).toBe('100000.00');
    expect(d.totals.netRevenue).toBe('94000.00');
    expect(d.totals.cmv).toBe('20000.00');
    expect(d.totals.grossProfit).toBe('74000.00');
    expect(d.totals.contribution).toBe('68000.00');
    expect(d.totals.fixed).toBe('30000.00');
    expect(d.totals.operating).toBe('38000.00');
    // 38000 − 200 de tarifa − 50 de falta de caixa.
    expect(d.totals.netProfit).toBe('37750.00');
    expect(d.totals.afterInvestments).toBe('32750.00');
    const line = (id: string) => d.lines.find((l) => l.id === id)!;
    expect(line('sales_table').value).toBe('60000.00');
    expect(line('taxes').value).toBe('-6000.00');
    expect(line('net').pct).toBe(100);
    const ind = (id: string) => d.indicators.find((i) => i.id === id)!;
    expect(ind('cmv').value).toBe(21.3);
    expect(ind('cmv').status).toBe('good');
    expect(ind('payroll').status).toBe('good');
    expect(ind('occupancy').value).toBe(8.5);
    expect(ind('ticket').value).toBe('100.00');
    // Ponto de equilíbrio = fixas ÷ (margem de contribuição ÷ receita líquida).
    expect(ind('breakeven').value).toBe('41470.59');
    expect(ind('breakeven').status).toBe('good');
  });

  it('com ficha técnica, o CMV é o consumo real e as compras viram estoque', () => {
    const d = buildDre(raw({ stockCmv: '30000.00', stockLosses: '1000.00' }));
    expect(d.cmvSource).toBe('stock');
    expect(d.totals.cmv).toBe('31000.00');
    expect(d.notes.join(' ')).toContain('viraram estoque');
    expect(d.indicators.find((i) => i.id === 'cmv')!.status).toBe('good');
  });

  it('sem venda não inventa indicador e avisa o que falta lançar', () => {
    const d = buildDre({
      sales: [],
      refunds: '0.00',
      orders: 0,
      entries: [],
      cardFees: '0.00',
      stockCmv: '0.00',
      stockLosses: '0.00',
      cashBreaks: '0.00',
    });
    expect(d.indicators).toHaveLength(0);
    expect(d.totals.netProfit).toBe('0.00');
    expect(d.lines.every((l) => l.pct === null)).toBe(true);
  });

  it('repasse de vendas lançado como conta a receber não conta a venda duas vezes', () => {
    const base = buildDre(raw());
    const d = buildDre(
      raw({
        entries: [
          ...raw().entries,
          { kind: 'receivable', category: 'Repasse do cartão', amount: '15000.00' },
          { kind: 'receivable', category: 'Eventos e encomendas', amount: '1000.00' },
        ],
      }),
    );
    expect(d.totals.grossRevenue).toBe('101000.00');
    expect(toCents(d.totals.netProfit) - toCents(base.totals.netProfit)).toBe(100000);
    expect(d.notes.join(' ')).toContain('ficaram fora');
  });

  it('pago no aplicativo entra como venda e a taxa do aplicativo como despesa variável', () => {
    const base = buildDre(raw());
    const d = buildDre(
      raw({
        appSales: [
          { app: 'ifood', amount: '5000.00', orders: 100 },
          { app: 'rappi', amount: '0.00', orders: 0 },
        ],
        appFees: '1250.00',
      }),
    );
    expect(toCents(d.totals.grossRevenue) - toCents(base.totals.grossRevenue)).toBe(500000);
    const line = d.lines.find((l) => l.id === 'sales_app_ifood')!;
    expect(line).toMatchObject({ label: 'Vendas · iFood (pago no aplicativo)', value: '5000.00' });
    expect(d.lines.some((l) => l.id === 'sales_app_rappi')).toBe(false);
    expect(d.lines.find((l) => l.id === 'app_fees')!.value).toBe('-1250.00');
    expect(toCents(d.totals.variable) - toCents(base.totals.variable)).toBe(125000);
    // Ticket médio com os pedidos dos aplicativos.
    const t = d.indicators.find((i) => i.reference?.endsWith('pedidos'))!;
    expect(t.reference).toBe('1100 pedidos');
    expect(base.lines.some((l) => l.id === 'app_fees')).toBe(false);
  });

  it('margem negativa não tem ponto de equilíbrio', () => {
    const d = buildDre(raw({ cardFees: '90000.00' }));
    const be = d.indicators.find((i) => i.id === 'breakeven')!;
    expect(be.value).toBeNull();
    expect(be.status).toBe('bad');
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261101
<DTEND>20261116
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261113120000[-3:BRT]
<TRNAMT>1.234,56
<FITID>A1
<MEMO>REDE CRED &amp; DEB
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261114
<TRNAMT>-35.9
<NAME>TARIFA
<MEMO>PACOTE SERVICOS
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261114
<TRNAMT>0.00
<FITID>Z
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>5000.10<DTASOF>20261116</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('extrato OFX', () => {
  it('lê o OFX 1 (SGML) com vírgula decimal e sem FITID', () => {
    const s = parseOfx(OFX_SGML);
    expect(s.bankId).toBe('0341');
    expect(s.accountId).toBe('12345-6');
    expect(s.lines).toEqual([
      { date: '2026-11-13', amount: '1234.56', description: 'REDE CRED & DEB', fitId: 'A1' },
      {
        date: '2026-11-14',
        amount: '-35.90',
        description: 'TARIFA · PACOTE SERVICOS',
        fitId: null,
      },
    ]);
    expect(s.balance).toEqual({ amount: '5000.10', date: '2026-11-16' });
  });

  it('lê o OFX 2 (XML)', () => {
    const s = parseOfx(
      `<?xml version="1.0"?><OFX><BANKACCTFROM><BANKID>001</BANKID><ACCTID>99</ACCTID></BANKACCTFROM>
       <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261110</DTPOSTED><TRNAMT>50.00</TRNAMT><FITID>x</FITID><MEMO>PIX RECEBIDO</MEMO></STMTTRN></OFX>`,
    );
    expect(s.lines).toEqual([
      { date: '2026-11-10', amount: '50.00', description: 'PIX RECEBIDO', fitId: 'x' },
    ]);
  });

  it('normaliza valores do banco', () => {
    expect(normalizeBankAmount('-1.234,56')).toBe('-1234.56');
    expect(normalizeBankAmount('1,234.56')).toBe('1234.56');
    expect(normalizeBankAmount('+10')).toBe('10.00');
    expect(normalizeBankAmount('12.345')).toBe('12.35');
    expect(normalizeBankAmount('abc')).toBeNull();
  });

  it('dá chaves diferentes para linhas iguais e repetidas no mesmo arquivo', () => {
    const l = { date: '2026-11-10', amount: '10.00', description: 'PIX', fitId: null };
    const k = statementKeys([l, l, { ...l, fitId: 'F' }]);
    expect(new Set(k).size).toBe(3);
    expect(statementKeys([l])[0]).toBe(k[0]);
  });
});
