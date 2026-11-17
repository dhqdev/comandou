/**
 * Financeiro gerencial do restaurante: plano de contas (categorias → linhas do DRE), taxas e
 * prazos das maquininhas, o DRE com os indicadores do setor e o leitor de extrato OFX.
 *
 * Tudo em centavos inteiros (nunca float) e datas AAAA-MM-DD sem fuso: quem chama já passa as
 * datas no fuso do restaurante. Usado pela API (DRE, fechamento, conciliação), pela tela e pelo
 * assistente de IA, para os três falarem a mesma língua.
 *
 * Referências do setor (Abrasel, Sebrae e mercado): CMV de 25% a 35% (pratos até 40%), pessoal
 * até 30%, ocupação até 10%, CMV + pessoal ("prime cost") até 65% e margem líquida de 10% ou mais.
 */
import { fromCents, toCents } from './money';
import { CHANNEL_LABELS, type OrderChannel, type PaymentMethod } from './orders';

// ------------------------------------------------------------------------------ plano de contas

/** Grupo do DRE em que cada categoria de conta entra. */
export type DreGroup =
  | 'cmv'
  | 'taxes'
  | 'selling'
  | 'payroll'
  | 'occupancy'
  | 'utilities'
  | 'admin'
  | 'financial'
  | 'investments'
  | 'other_income'
  | 'sales_received';

export const DRE_GROUP_LABELS: Record<DreGroup, string> = {
  cmv: 'Insumos e mercadorias (CMV)',
  taxes: 'Impostos sobre vendas',
  selling: 'Aplicativos, entregadores e marketing',
  payroll: 'Pessoal',
  occupancy: 'Ocupação (aluguel, condomínio, IPTU)',
  utilities: 'Energia, água, gás e internet',
  admin: 'Administrativas e outras',
  financial: 'Tarifas bancárias e juros',
  investments: 'Investimentos, empréstimos e retiradas',
  other_income: 'Outras receitas',
  sales_received: 'Repasse de vendas (fica fora do DRE)',
};

export interface FinanceCategory {
  name: string;
  kind: 'payable' | 'receivable';
  group: DreGroup;
  /** Palavras (sem acento, minúsculas) que levam uma categoria escrita à mão a este grupo. */
  words: string[];
}

/** Plano de contas padrão de restaurante. O lojista ainda pode escrever a categoria que quiser. */
export const FINANCE_CATEGORIES: FinanceCategory[] = [
  {
    name: 'Insumos e mercadorias',
    kind: 'payable',
    group: 'cmv',
    words: [
      'insumo',
      'mercadoria',
      'materia prima',
      'ingrediente',
      'hortifruti',
      'verdura',
      'legume',
      'fruta',
      'carne',
      'acougue',
      'frango',
      'peixe',
      'frios',
      'laticinio',
      'padaria',
      'atacad',
      'supermercado',
      'mercado',
      'fornecedor',
      'compra',
    ],
  },
  {
    name: 'Bebidas',
    kind: 'payable',
    group: 'cmv',
    words: ['bebida', 'cerveja', 'chope', 'refrigerante', 'distribuidora', 'vinho', 'destilado'],
  },
  {
    name: 'Embalagens',
    kind: 'payable',
    group: 'cmv',
    words: ['embalage', 'descartave', 'sacola', 'marmitex', 'guardanapo'],
  },
  {
    name: 'Impostos',
    kind: 'payable',
    group: 'taxes',
    words: [
      'imposto',
      'das',
      'simples nacional',
      'icms',
      'iss',
      'pis',
      'cofins',
      'darf',
      'tributo',
    ],
  },
  {
    name: 'Taxas de aplicativos',
    kind: 'payable',
    group: 'selling',
    words: ['ifood', 'rappi', 'aiqfome', '99food', 'aplicativo', 'marketplace', 'comissao do app'],
  },
  {
    name: 'Entregadores',
    kind: 'payable',
    group: 'selling',
    words: ['entregador', 'motoboy', 'motoqueiro', 'frete', 'combustivel', 'gasolina'],
  },
  {
    name: 'Marketing',
    kind: 'payable',
    group: 'selling',
    words: ['marketing', 'publicidade', 'anuncio', 'propaganda', 'panfleto', 'influenciador'],
  },
  {
    name: 'Salários',
    kind: 'payable',
    group: 'payroll',
    words: [
      'salario',
      'folha',
      'funcionario',
      'freela',
      'diarista',
      'extra',
      'ferias',
      'decimo terceiro',
      '13o',
      'rescisao',
      'gorjeta',
      'taxa de servico',
    ],
  },
  {
    name: 'Encargos e benefícios',
    kind: 'payable',
    group: 'payroll',
    words: [
      'encargo',
      'fgts',
      'inss',
      'esocial',
      'vale transporte',
      'beneficio',
      'plano de saude',
      'uniforme',
    ],
  },
  {
    name: 'Pró-labore',
    kind: 'payable',
    group: 'payroll',
    words: ['pro-labore', 'pro labore', 'prolabore'],
  },
  {
    name: 'Aluguel',
    kind: 'payable',
    group: 'occupancy',
    words: ['aluguel', 'condominio', 'iptu', 'locacao do imovel'],
  },
  {
    name: 'Energia',
    kind: 'payable',
    group: 'utilities',
    words: ['energia', 'luz', 'eletric', 'enel', 'cemig', 'copel', 'cpfl', 'coelba', 'celpe'],
  },
  {
    name: 'Água',
    kind: 'payable',
    group: 'utilities',
    words: ['agua', 'saneamento', 'esgoto', 'sabesp', 'copasa', 'cedae', 'embasa'],
  },
  {
    name: 'Gás',
    kind: 'payable',
    group: 'utilities',
    words: ['gas', 'glp', 'botijao', 'comgas'],
  },
  {
    name: 'Internet e telefone',
    kind: 'payable',
    group: 'utilities',
    words: ['internet', 'telefone', 'celular', 'vivo', 'claro', 'tim'],
  },
  {
    name: 'Contabilidade',
    kind: 'payable',
    group: 'admin',
    words: ['contador', 'contabil', 'contabilidade'],
  },
  {
    name: 'Sistemas',
    kind: 'payable',
    group: 'admin',
    words: ['sistema', 'software', 'assinatura', 'licenca', 'comandou'],
  },
  {
    name: 'Manutenção',
    kind: 'payable',
    group: 'admin',
    words: ['manutencao', 'conserto', 'reparo', 'dedetizacao'],
  },
  {
    name: 'Limpeza',
    kind: 'payable',
    group: 'admin',
    words: ['limpeza', 'higiene'],
  },
  { name: 'Outras despesas', kind: 'payable', group: 'admin', words: [] },
  {
    name: 'Tarifas bancárias',
    kind: 'payable',
    group: 'financial',
    words: ['tarifa', 'bancari', 'juros', 'iof', 'multa', 'anuidade', 'aluguel da maquininha'],
  },
  {
    name: 'Equipamentos e reformas',
    kind: 'payable',
    group: 'investments',
    words: ['equipamento', 'reforma', 'obra', 'investimento', 'mobilia', 'freezer', 'forno'],
  },
  {
    name: 'Empréstimos',
    kind: 'payable',
    group: 'investments',
    words: ['emprestimo', 'financiamento', 'consorcio'],
  },
  {
    name: 'Retirada dos sócios',
    kind: 'payable',
    group: 'investments',
    words: ['retirada', 'socio', 'distribuicao de lucro', 'dividendo'],
  },
  {
    name: 'Eventos e encomendas',
    kind: 'receivable',
    group: 'other_income',
    words: ['evento', 'encomenda', 'buffet', 'festa'],
  },
  {
    name: 'Convênios e vendas a prazo',
    kind: 'receivable',
    group: 'other_income',
    words: ['convenio', 'fiado', 'a prazo'],
  },
  {
    name: 'Rendimentos',
    kind: 'receivable',
    group: 'other_income',
    words: ['rendimento', 'aplicacao', 'cashback'],
  },
  {
    // As vendas já entram pelos caixas; o repasse da maquininha ou do aplicativo é o mesmo
    // dinheiro chegando depois. Lançado como conta a receber, ficaria contado duas vezes.
    name: 'Repasse de vendas',
    kind: 'receivable',
    group: 'sales_received',
    words: ['venda', 'repasse', 'cartao', 'maquininha', 'ifood', 'antecipacao'],
  },
  { name: 'Outras receitas', kind: 'receivable', group: 'other_income', words: [] },
];

/** Minúsculas, sem acento e com espaços simples (para comparar categorias escritas à mão). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Palavras mais longas primeiro: "aluguel da maquininha" vence "aluguel", "gasolina" vence "gas".
const WORDS = FINANCE_CATEGORIES.flatMap((c) =>
  c.words.map((w) => ({ w, kind: c.kind, group: c.group, name: c.name })),
).sort((a, b) => b.w.length - a.w.length);
const BY_NAME = new Map(FINANCE_CATEGORIES.map((c) => [`${c.kind}:${foldText(c.name)}`, c]));

/**
 * Em que linha do DRE uma conta entra, pela categoria. Nome do plano padrão vale direto; texto
 * livre ("Conta de luz", "DAS outubro") é reconhecido pelas palavras; o resto vai para
 * "Administrativas e outras" (a pagar) ou "Outras receitas" (a receber).
 */
export function dreGroupOf(category: string | null | undefined, kind: 'payable' | 'receivable') {
  const fallback: DreGroup = kind === 'receivable' ? 'other_income' : 'admin';
  const f = foldText(category ?? '');
  if (!f) return fallback;
  const exact = BY_NAME.get(`${kind}:${f}`);
  if (exact) return exact.group;
  // Palavra curta ("das", "iss", "luz") só vale inteira; as longas valem como começo de palavra
  // ("embalage" pega "embalagens").
  const hit = WORDS.find(
    (x) =>
      x.kind === kind &&
      new RegExp(`(^|[^a-z0-9])${escapeRe(x.w)}${x.w.length <= 3 ? '($|[^a-z0-9])' : ''}`).test(f),
  );
  return hit?.group ?? fallback;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Categoria do plano padrão sugerida por um texto livre (ex.: a descrição de uma linha do
 * extrato, "TARIFA PACOTE DE SERVICOS" → "Tarifas bancárias"). Nada reconhecido: null.
 */
export function suggestCategory(text: string, kind: 'payable' | 'receivable'): string | null {
  const f = foldText(text);
  if (!f) return null;
  for (const w of WORDS) {
    if (w.kind !== kind) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(w.w)}${w.w.length <= 3 ? '($|[^a-z0-9])' : ''}`);
    if (re.test(f)) return w.name;
  }
  return null;
}

// --------------------------------------------------------------------- maquininhas e prazos

export interface PaymentTerm {
  /** Taxa cobrada pela maquininha/operadora sobre a venda, em % ("3.20"). */
  feePercent: string;
  /** Em quantos dias o dinheiro cai na conta (0 = no mesmo dia). */
  days: number;
}
export type PaymentTerms = Record<PaymentMethod, PaymentTerm>;

/**
 * Padrão de mercado no Brasil: débito em 1 dia útil, crédito à vista em 30 dias, PIX e dinheiro na
 * hora e vale-refeição/alimentação com o teto das regras novas do PAT (taxa de até 3,6% e repasse
 * em até 15 dias corridos). Cada restaurante ajusta para o contrato dele.
 */
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = {
  cash: { feePercent: '0.00', days: 0 },
  pix: { feePercent: '0.00', days: 0 },
  debit: { feePercent: '1.50', days: 1 },
  credit: { feePercent: '3.20', days: 30 },
  voucher: { feePercent: '3.60', days: 15 },
  other: { feePercent: '0.00', days: 0 },
};
export const PAYMENT_TERM_MAX_FEE = 20;
export const PAYMENT_TERM_MAX_DAYS = 120;

/** Junta o que o restaurante salvou com o padrão (forma faltando ou inválida volta ao padrão). */
export function normalizePaymentTerms(saved: unknown): PaymentTerms {
  const out = { ...DEFAULT_PAYMENT_TERMS };
  if (!saved || typeof saved !== 'object') return out;
  for (const m of Object.keys(out) as PaymentMethod[]) {
    const t = (saved as Record<string, Partial<PaymentTerm> | undefined>)[m];
    if (!t) continue;
    const fee = typeof t.feePercent === 'string' ? t.feePercent : String(t.feePercent ?? '');
    const okFee = /^\d{1,2}(\.\d{1,2})?$/.test(fee) && Number(fee) <= PAYMENT_TERM_MAX_FEE;
    const okDays =
      Number.isInteger(t.days) && (t.days as number) >= 0 && t.days! <= PAYMENT_TERM_MAX_DAYS;
    out[m] = {
      feePercent: okFee ? fromCents(toCents(fee)) : out[m].feePercent,
      days: okDays ? (t.days as number) : out[m].days,
    };
  }
  return out;
}

/** Taxa em centavos (arredondada ao centavo). Venda zerada ou negativa (estorno) não paga taxa. */
export function feeCents(grossCents: number, feePercent: string): number {
  if (grossCents <= 0) return 0;
  return Math.round((grossCents * toCents(feePercent)) / 10000);
}

/** Dia previsto do dinheiro na conta: soma os dias e, caindo no sábado ou domingo, vai à segunda. */
export function settlementDate(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const wd = d.getUTCDay();
  if (days > 0 && wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (days > 0 && wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias corridos entre duas datas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ----------------------------------------------------------------------------------------- DRE

/** Números crus do período, já somados pela API (valores positivos, em string decimal). */
export interface DreRaw {
  /** Vendas recebidas no caixa por canal (antes dos estornos). */
  sales: { channel: string; amount: string }[];
  /** Estornos devolvidos ao cliente. */
  refunds: string;
  /** Pedidos com venda recebida no período (para o ticket médio). */
  orders: number;
  /** Contas do período (competência: pelo vencimento; caixa: pela data do pagamento). */
  entries: { kind: 'payable' | 'receivable'; category: string | null; amount: string }[];
  /** Taxas das maquininhas (previstas no fechamento, já com os ajustes da conciliação). */
  cardFees: string;
  /** Insumos consumidos pelas fichas técnicas (custo do momento da venda). */
  stockCmv: string;
  /** Perdas e desperdícios lançados no estoque. */
  stockLosses: string;
  /** Sobras (+) e faltas (−) de dinheiro nos fechamentos de caixa. */
  cashBreaks: string;
}

export type DreLineKind = 'total' | 'group' | 'item' | 'result';
export interface DreLine {
  id: string;
  label: string;
  kind: DreLineKind;
  /** Valor com sinal do efeito no resultado (despesa negativa, receita positiva). */
  value: string;
  /** % da receita líquida (null quando não há receita). */
  pct: number | null;
  hint?: string;
}

export type IndicatorStatus = 'good' | 'warn' | 'bad' | 'none';
export interface DreIndicator {
  id: 'cmv' | 'payroll' | 'occupancy' | 'prime' | 'margin' | 'breakeven' | 'ticket';
  label: string;
  /** Percentual (cmv, payroll…) ou valor em reais (breakeven, ticket). */
  value: string | number | null;
  unit: 'pct' | 'brl';
  reference: string;
  status: IndicatorStatus;
  explain: string;
}

export interface Dre {
  lines: DreLine[];
  totals: {
    grossRevenue: string;
    netRevenue: string;
    cmv: string;
    grossProfit: string;
    variable: string;
    contribution: string;
    fixed: string;
    operating: string;
    netProfit: string;
    afterInvestments: string;
  };
  cmvSource: 'stock' | 'purchases' | 'none';
  indicators: DreIndicator[];
  notes: string[];
}

const pct1 = (part: number, base: number) =>
  base > 0 ? Math.round((part / base) * 1000) / 10 : null;

/**
 * Monta o DRE gerencial (do faturamento ao lucro) e os indicadores do restaurante.
 *
 * CMV: com ficha técnica, vale o consumo real de insumos (mais as perdas) e as compras de
 * insumos viram estoque, não despesa; sem ficha técnica, as compras do período fazem as vezes do
 * CMV (aproximação usada por quem não controla estoque).
 */
export function buildDre(raw: DreRaw): Dre {
  const c = (v: string) => toCents(v);
  const byGroup = new Map<DreGroup, number>();
  for (const e of raw.entries) {
    const g = dreGroupOf(e.category, e.kind);
    byGroup.set(g, (byGroup.get(g) ?? 0) + c(e.amount));
  }
  const g = (k: DreGroup) => byGroup.get(k) ?? 0;

  const salesByChannel = new Map<string, number>();
  for (const s of raw.sales)
    salesByChannel.set(s.channel, (salesByChannel.get(s.channel) ?? 0) + c(s.amount));
  const sales = [...salesByChannel.values()].reduce((a, b) => a + b, 0);
  const otherIncome = g('other_income');
  const gross = sales + otherIncome;
  const taxes = g('taxes');
  const refunds = c(raw.refunds);
  const net = gross - taxes - refunds;

  const stockCmv = c(raw.stockCmv);
  const losses = c(raw.stockLosses);
  const purchases = g('cmv');
  const cmvSource: Dre['cmvSource'] = stockCmv > 0 ? 'stock' : purchases > 0 ? 'purchases' : 'none';
  const cmv = cmvSource === 'stock' ? stockCmv + losses : purchases;
  const grossProfit = net - cmv;

  const cardFees = c(raw.cardFees);
  const selling = g('selling');
  const variable = cardFees + selling;
  const contribution = grossProfit - variable;

  const payroll = g('payroll');
  const occupancy = g('occupancy');
  const utilities = g('utilities');
  const admin = g('admin');
  const fixed = payroll + occupancy + utilities + admin;
  const operating = contribution - fixed;

  const financial = g('financial');
  const breaks = c(raw.cashBreaks);
  const netProfit = operating - financial + breaks;
  const investments = g('investments');
  const afterInvestments = netProfit - investments;

  const lines: DreLine[] = [];
  const add = (id: string, label: string, kind: DreLineKind, cents: number, hint?: string) =>
    lines.push({ id, label, kind, value: fromCents(cents), pct: pct1(cents, net), hint });

  add('gross', 'Receita bruta', 'total', gross);
  for (const [ch, v] of [...salesByChannel.entries()].sort((a, b) => b[1] - a[1]))
    add(
      `sales_${ch}`,
      `Vendas · ${CHANNEL_LABELS[ch as OrderChannel] ?? 'Outros'}`,
      'item',
      v,
      'Recebido no caixa, em todas as formas de pagamento.',
    );
  if (otherIncome) add('other_income', DRE_GROUP_LABELS.other_income, 'item', otherIncome);
  add('deductions', 'Deduções', 'group', -(taxes + refunds));
  add('taxes', DRE_GROUP_LABELS.taxes, 'item', -taxes, 'DAS, ICMS, ISS e outros sobre a venda.');
  add('refunds', 'Estornos e devoluções', 'item', -refunds);
  add('net', 'Receita líquida', 'total', net);
  add('cmv', 'Custo das mercadorias vendidas (CMV)', 'group', -cmv);
  if (cmvSource === 'stock') {
    add('cmv_stock', 'Insumos consumidos (fichas técnicas)', 'item', -stockCmv);
    if (losses) add('cmv_losses', 'Perdas e desperdício', 'item', -losses);
  } else {
    add(
      'cmv_purchases',
      'Compras de insumos, bebidas e embalagens',
      'item',
      -purchases,
      'Sem ficha técnica, as compras do período fazem as vezes do CMV.',
    );
  }
  add('gross_profit', 'Lucro bruto', 'result', grossProfit);
  add('variable', 'Despesas variáveis de venda', 'group', -variable);
  add(
    'card_fees',
    'Taxas das maquininhas e do vale-refeição',
    'item',
    -cardFees,
    'Calculadas no fechamento do caixa pelas taxas cadastradas, com os acertos da conciliação.',
  );
  add('selling', DRE_GROUP_LABELS.selling, 'item', -selling);
  add('contribution', 'Margem de contribuição', 'result', contribution);
  add('fixed', 'Despesas fixas', 'group', -fixed);
  add('payroll', DRE_GROUP_LABELS.payroll, 'item', -payroll);
  add('occupancy', DRE_GROUP_LABELS.occupancy, 'item', -occupancy);
  add('utilities', DRE_GROUP_LABELS.utilities, 'item', -utilities);
  add('admin', DRE_GROUP_LABELS.admin, 'item', -admin);
  add('operating', 'Resultado operacional', 'result', operating);
  add('other', 'Resultado financeiro e outros', 'group', breaks - financial);
  add('financial', DRE_GROUP_LABELS.financial, 'item', -financial);
  add('cash_breaks', 'Sobras e faltas de caixa', 'item', breaks);
  add('net_profit', 'Lucro líquido', 'result', netProfit);
  add(
    'investments',
    DRE_GROUP_LABELS.investments,
    'item',
    -investments,
    'Não é despesa do mês: é dinheiro que sai do caixa para investir, pagar empréstimo ou para os sócios.',
  );
  add('after_investments', 'Sobra de caixa do período', 'result', afterInvestments);

  const notes: string[] = [];
  if (cmvSource === 'stock' && purchases > 0)
    notes.push(
      `As compras de insumos do período (${brlText(purchases)}) viraram estoque: o CMV usa o que as fichas técnicas consumiram.`,
    );
  if (cmvSource === 'none' && sales > 0)
    notes.push(
      'Sem CMV: cadastre as fichas técnicas no Estoque ou lance as compras de insumos como conta a pagar.',
    );
  if (g('sales_received') > 0)
    notes.push(
      `${brlText(g('sales_received'))} em contas a receber de repasse de vendas (cartão, aplicativo) ficaram fora: as vendas já entram pelos caixas. Para conferir o repasse, use a Conciliação.`,
    );
  if (!taxes && sales > 0)
    notes.push('Nenhum imposto no período: lance o DAS como conta a pagar na categoria Impostos.');
  if (!payroll && sales > 0)
    notes.push('Nenhuma despesa de pessoal no período: lance salários, encargos e pró-labore.');

  const indicators: DreIndicator[] = [];
  if (net > 0) {
    const p = (v: number) => pct1(v, net)!;
    const status = (v: number, good: number, warn: number, has = true): IndicatorStatus =>
      !has ? 'none' : v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
    indicators.push({
      id: 'cmv',
      label: 'CMV',
      value: cmv ? p(cmv) : null,
      unit: 'pct',
      reference: '25% a 35%',
      status: status(p(cmv), 35, 40, cmv > 0),
      explain:
        'Quanto do que entra vai para insumos. Acima de 35%, revise preços, porções e perdas.',
    });
    indicators.push({
      id: 'payroll',
      label: 'Pessoal',
      value: payroll ? p(payroll) : null,
      unit: 'pct',
      reference: 'até 30%',
      status: status(p(payroll), 30, 35, payroll > 0),
      explain: 'Salários, encargos, benefícios e pró-labore sobre a receita.',
    });
    indicators.push({
      id: 'occupancy',
      label: 'Ocupação',
      value: occupancy ? p(occupancy) : null,
      unit: 'pct',
      reference: 'até 10%',
      status: status(p(occupancy), 10, 15, occupancy > 0),
      explain: 'Aluguel, condomínio e IPTU sobre a receita.',
    });
    indicators.push({
      id: 'prime',
      label: 'CMV + pessoal',
      value: cmv && payroll ? p(cmv + payroll) : null,
      unit: 'pct',
      reference: 'até 65%',
      status: status(p(cmv + payroll), 60, 65, cmv > 0 && payroll > 0),
      explain:
        'O "prime cost": os dois maiores custos juntos. Acima de 65% sobra pouco para o resto.',
    });
    indicators.push({
      id: 'margin',
      label: 'Margem líquida',
      value: p(netProfit),
      unit: 'pct',
      reference: '10% ou mais',
      status: p(netProfit) >= 10 ? 'good' : netProfit >= 0 ? 'warn' : 'bad',
      explain: 'O lucro líquido sobre a receita líquida.',
    });
    const cPct = contribution / net;
    const breakEven = cPct > 0 ? Math.round(fixed / cPct) : null;
    indicators.push({
      id: 'breakeven',
      label: 'Ponto de equilíbrio',
      value: breakEven === null ? null : fromCents(breakEven),
      unit: 'brl',
      reference: breakEven === null ? 'margem negativa' : `receita do período ${brlText(net)}`,
      status: breakEven === null ? 'bad' : net >= breakEven ? 'good' : 'bad',
      explain:
        breakEven === null
          ? 'A margem de contribuição está negativa: cada venda dá prejuízo antes das despesas fixas.'
          : 'Quanto é preciso vender no período para pagar as despesas fixas, sem lucro nem prejuízo.',
    });
  }
  if (raw.orders > 0 && sales > 0)
    indicators.push({
      id: 'ticket',
      label: 'Ticket médio',
      value: fromCents(Math.round(sales / raw.orders)),
      unit: 'brl',
      reference: `${raw.orders} ${raw.orders === 1 ? 'pedido' : 'pedidos'}`,
      status: 'none',
      explain: 'Quanto cada pedido deixou, em média.',
    });

  return {
    lines,
    totals: {
      grossRevenue: fromCents(gross),
      netRevenue: fromCents(net),
      cmv: fromCents(cmv),
      grossProfit: fromCents(grossProfit),
      variable: fromCents(variable),
      contribution: fromCents(contribution),
      fixed: fromCents(fixed),
      operating: fromCents(operating),
      netProfit: fromCents(netProfit),
      afterInvestments: fromCents(afterInvestments),
    },
    cmvSource,
    indicators,
    notes,
  };
}

function brlText(cents: number): string {
  const v = fromCents(Math.abs(cents)).replace('.', ',');
  const [i, d] = v.split(',');
  return `${cents < 0 ? '-' : ''}R$ ${i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
}

// ---------------------------------------------------------------------------- extrato (OFX)

export interface StatementLine {
  /** Data do lançamento no banco (AAAA-MM-DD). */
  date: string;
  /** Valor com sinal: entrada positiva, saída negativa ("-120.50"). */
  amount: string;
  description: string;
  /** Identificador do banco para a linha (FITID), quando vem. */
  fitId: string | null;
}

export interface Statement {
  bankId: string | null;
  accountId: string | null;
  lines: StatementLine[];
  /** Saldo final informado pelo banco, quando vem. */
  balance: { amount: string; date: string | null } | null;
}

/** Valor do banco ("-1.234,56", "1234.5", "+10") em string decimal com 2 casas. */
export function normalizeBankAmount(raw: string): string | null {
  let s = raw.replace(/\s|R\$/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  if (s.includes(',') && s.includes('.')) {
    // O último separador é o decimal.
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  if (!/^\d{1,12}(\.\d+)?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  let cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (f.length > 2 && Number(f[2]) >= 5) cents += 1;
  return fromCents(neg ? -cents : cents);
}

function ofxDate(raw: string | null): string | null {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Lê o extrato OFX que todo banco brasileiro exporta (versão 1, SGML, sem fechar as tags; ou
 * versão 2, XML). Devolve as linhas com data, valor com sinal, descrição e o FITID.
 */
export function parseOfx(text: string): Statement {
  const leaf = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
    const v = m?.[1]?.trim();
    return v ? decodeEntities(v) : null;
  };
  const acct = text.match(
    /<(?:BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/(?:BANKACCTFROM|CCACCTFROM)>/i,
  );
  const lines: StatementLine[] = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const b = m[1]!;
    const date = ofxDate(leaf(b, 'DTPOSTED') ?? leaf(b, 'DTUSER'));
    const amount = normalizeBankAmount(leaf(b, 'TRNAMT') ?? '');
    if (!date || !amount || toCents(amount) === 0) continue;
    const memo = leaf(b, 'MEMO');
    const name = leaf(b, 'NAME');
    const description =
      [name, memo]
        .filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
        .join(' · ')
        .replace(/\s+/g, ' ')
        .slice(0, 200) || (toCents(amount) > 0 ? 'Crédito' : 'Débito');
    lines.push({ date, amount, description, fitId: leaf(b, 'FITID')?.slice(0, 120) ?? null });
  }
  const bal = text.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1];
  const balAmount = bal ? normalizeBankAmount(leaf(bal, 'BALAMT') ?? '') : null;
  return {
    bankId: acct ? leaf(acct[1]!, 'BANKID') : null,
    accountId: acct ? leaf(acct[1]!, 'ACCTID') : null,
    lines,
    balance: balAmount
      ? { amount: balAmount, date: ofxDate(bal ? leaf(bal, 'DTASOF') : null) }
      : null,
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Chave de cada linha do extrato para não importar duas vezes o mesmo arquivo: FITID + data +
 * valor (há bancos que repetem o FITID em linhas diferentes). Sem FITID, a data, o valor, a
 * descrição e a ordem dela entre as iguais do arquivo.
 */
export function statementKeys(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = l.fitId
      ? `f:${l.fitId}|${l.date}|${l.amount}`
      : `h:${l.date}|${l.amount}|${foldText(l.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return (n > 1 ? `${base}#${n}` : base).slice(0, 300);
  });
}

/** Nome dos bancos mais comuns pelo código (BANKID do OFX), para sugerir o nome da conta. */
export const BANK_NAMES: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '077': 'Inter',
  '104': 'Caixa',
  '197': 'Stone',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '403': 'Cora',
  '422': 'Safra',
  '655': 'Votorantim',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

/** Nome do banco pelo código do OFX ("0341", "341" → "Itaú"). */
export function bankName(bankId: string | null | undefined): string | null {
  if (!bankId) return null;
  const n = bankId.replace(/\D/g, '');
  if (!n) return null;
  return BANK_NAMES[n.slice(-3).padStart(3, '0')] ?? null;
}
