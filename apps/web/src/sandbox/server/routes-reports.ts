import {
  buildDre,
  DEFAULT_COURIER_PAY_RULE,
  DEFAULT_COURIER_TAX_SETTINGS,
  describePayRule,
  CHANNEL_LABELS,
  DEFAULT_PAYMENT_TERMS,
  PAYMENT_METHOD_LABELS,
  REPORT_GROUPS,
  type Dre,
  type OrderChannel,
  type PaymentMethod,
  type ReportDoc,
} from '@comandou/shared';
import { emitLocal } from '../../lib/realtime';
import type { CashFlowDay, FinanceEntry, FinanceSummary } from '../../lib/types';
import { fail, on } from './http';
import {
  categories,
  couriers,
  customers,
  money,
  movements,
  newId,
  orders,
  paidOf,
  products,
  sessions,
  subtotalOf,
  TENANT,
  toCents,
  totalOf,
  USER_NAME,
} from './state';

/**
 * Números do exemplo: o histórico da Fumaça nos últimos meses (sorteado, mas com a cara de uma
 * hamburgueria: sexta e sábado cheios, almoço e jantar) e o dia de hoje tirado dos pedidos de
 * verdade do exemplo. Relatórios, Calendário, Análise e Financeiro leem daqui.
 */

const CHANNELS: OrderChannel[] = ['counter', 'table', 'delivery', 'pickup'];
const CH_SHARE = [0.3, 0.28, 0.3, 0.12];
const METHODS: PaymentMethod[] = ['pix', 'credit', 'debit', 'cash', 'voucher'];
const PAY_SHARE = [0.38, 0.27, 0.2, 0.1, 0.05];
const DOW_BASE = [70, 38, 44, 48, 58, 86, 92];

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s: string) =>
  new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const addDays = (s: string, n: number) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const todayKey = () => dayKey(new Date());

/** Ruído repetível por dia (o mesmo dia mostra sempre os mesmos números). */
function noise(seed: string, k = 0) {
  let h = 2166136261 ^ k;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Peso de cada item (o carro-chefe vende mais). */
const WEIGHT: Record<string, number> = {
  fumaca: 9,
  smash: 7,
  classico: 6,
  'combo-fumaca': 6,
  'combo-classico': 4,
  'combo-smash': 4,
  'egg-bacon': 4,
  picanha: 3,
  crispy: 3,
  cheeseburger: 4,
  triplo: 1,
  veggie: 2,
  batata: 8,
  'batata-cheddar': 5,
  'onion-rings': 3,
  iscas: 2,
  chopp: 7,
  limonada: 5,
  'limonada-suica': 3,
  'agua-gas': 3,
  'shake-chocolate': 3,
  'shake-morango': 2,
  'shake-doce-leite': 2,
  'brownie-sorvete': 2,
  sundae: 2,
  'sundae-morango': 1,
};
/** Itens mostrados no relatório do cardápio online. */
const featured = products.slice(0, 12);
const totalWeight = products.reduce((t, p) => t + (WEIGHT[p.key] ?? 1), 0);

interface DayStat {
  day: string;
  orders: number;
  cancelled: number;
  revenue: number;
  cost: number;
  deliveryFees: number;
  discounts: number;
  byChannel: Record<OrderChannel, { orders: number; revenue: number }>;
  byHour: number[];
  byMethod: Record<PaymentMethod, number>;
  products: Map<string, number>;
}

const cache = new Map<string, DayStat>();

const noChannels = (): DayStat['byChannel'] => ({
  counter: { orders: 0, revenue: 0 },
  table: { orders: 0, revenue: 0 },
  delivery: { orders: 0, revenue: 0 },
  pickup: { orders: 0, revenue: 0 },
});
const noMethods = (): Record<PaymentMethod, number> => ({
  pix: 0,
  credit: 0,
  debit: 0,
  cash: 0,
  voucher: 0,
  other: 0,
});

function liveToday(day: string): DayStat {
  const list = orders.filter(
    (o) => o.createdAt.slice(0, 10) <= day && new Date(o.createdAt) >= parseDay(day),
  );
  const live = list.filter((o) => o.status !== 'cancelled');
  const s: DayStat = {
    day,
    orders: live.length,
    cancelled: list.length - live.length,
    revenue: 0,
    cost: 0,
    deliveryFees: 0,
    discounts: 0,
    byChannel: noChannels(),
    byHour: Array(24).fill(0),
    byMethod: noMethods(),
    products: new Map(),
  };
  for (const o of live) {
    const rev = subtotalOf(o) - o.discount + o.surcharge;
    s.revenue += rev;
    s.deliveryFees += o.deliveryFee;
    s.discounts += o.discount;
    s.byChannel[o.channel].orders++;
    s.byChannel[o.channel].revenue += rev;
    s.byHour[new Date(o.createdAt).getHours()]! += 1;
    for (const p of o.payments)
      s.byMethod[p.method === 'app' ? 'other' : p.method] += toCents(p.amount);
    for (const it of o.items) {
      if (it.status === 'cancelled') continue;
      const q = Number(it.quantity);
      s.products.set(it.productId, (s.products.get(it.productId) ?? 0) + q);
      const prod = products.find((p) => p.id === it.productId);
      s.cost += Math.round(toCents(prod?.cost) * q);
    }
  }
  return s;
}

export function dayStat(day: string): DayStat {
  if (day === todayKey()) return liveToday(day);
  if (day > todayKey()) return liveToday('9999-12-31');
  const hit = cache.get(day);
  if (hit) return hit;
  const dow = parseDay(day).getDay();
  // A loja abriu há um ano; o movimento cresceu um pouco nos últimos meses.
  const growth =
    1 + Math.max(0, 1 - (Date.now() - parseDay(day).getTime()) / (180 * 86_400_000)) * 0.12;
  const orderCount = Math.round(DOW_BASE[dow]! * growth * (0.85 + noise(day) * 0.3));
  const ticket = 6200 + Math.round(noise(day, 1) * 1400);
  const s: DayStat = {
    day,
    orders: orderCount,
    cancelled: Math.round(orderCount * 0.02 * noise(day, 2) * 2),
    revenue: orderCount * ticket,
    cost: 0,
    deliveryFees: 0,
    discounts: Math.round(orderCount * ticket * 0.012),
    byChannel: noChannels(),
    byHour: Array(24).fill(0),
    byMethod: noMethods(),
    products: new Map(),
  };
  CHANNELS.forEach((c, i) => {
    const n = Math.round(orderCount * CH_SHARE[i]! * (0.9 + noise(day, 10 + i) * 0.2));
    s.byChannel[c] = { orders: n, revenue: n * ticket };
  });
  s.deliveryFees = s.byChannel.delivery.orders * 690;
  // Almoço (11–14) e jantar (18–23), com o pico às 20h.
  const curve = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 9, 8, 4, 2, 2, 3, 7, 11, 14, 12, 8, 4];
  const sum = curve.reduce((a, b) => a + b, 0);
  s.byHour = curve.map((w) => Math.round((orderCount * w) / sum));
  METHODS.forEach((m, i) => (s.byMethod[m] = Math.round(s.revenue * PAY_SHARE[i]!)));
  const items = orderCount * 2.6;
  for (const p of products) {
    const q = Math.round(
      ((items * (WEIGHT[p.key] ?? 1)) / totalWeight) * (0.8 + noise(day, p.position ?? 0) * 0.4),
    );
    if (!q) continue;
    s.products.set(p.id, q);
    s.cost += q * toCents(p.cost);
  }
  cache.set(day, s);
  return s;
}

function days(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
function sumRange(from: string, to: string) {
  const list = days(from, to).map(dayStat);
  const t = {
    orders: 0,
    cancelled: 0,
    revenue: 0,
    cost: 0,
    deliveryFees: 0,
    discounts: 0,
    byChannel: noChannels(),
    byHour: Array(24).fill(0) as number[],
    byMethod: noMethods(),
    products: new Map<string, number>(),
    list,
  };
  for (const s of list) {
    t.orders += s.orders;
    t.cancelled += s.cancelled;
    t.revenue += s.revenue;
    t.cost += s.cost;
    t.deliveryFees += s.deliveryFees;
    t.discounts += s.discounts;
    for (const c of CHANNELS) {
      t.byChannel[c].orders += s.byChannel[c].orders;
      t.byChannel[c].revenue += s.byChannel[c].revenue;
    }
    s.byHour.forEach((v, h) => (t.byHour[h]! += v));
    for (const m of Object.keys(t.byMethod) as PaymentMethod[]) t.byMethod[m] += s.byMethod[m];
    for (const [id, q] of s.products) t.products.set(id, (t.products.get(id) ?? 0) + q);
  }
  return t;
}
const span = (from: string, to: string) => days(from, to).length;
const prevRange = (from: string, to: string) => {
  const n = span(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
};
const dayOf = (v: string | null) => (v ? (v.length > 10 ? dayKey(new Date(v)) : v) : todayKey());

function productLines(m: Map<string, number>) {
  return [...m.entries()]
    .map(([id, q]) => {
      const p = products.find((x) => x.id === id)!;
      return {
        productId: id,
        name: p.name,
        quantity: q.toFixed(3),
        revenue: money(Math.round(q * toCents(p.price))),
        cost: money(Math.round(q * toCents(p.cost))),
        hasRecipe: true,
      };
    })
    .sort((a, b) => toCents(b.revenue) - toCents(a.revenue));
}

// ------------------------------------------------------------------------------- financeiro

const ENTRIES: FinanceEntry[] = [];
function seedEntries() {
  const t = todayKey();
  const add = (
    kind: FinanceEntry['kind'],
    description: string,
    category: string,
    counterparty: string,
    amount: number,
    due: number,
    paid: boolean,
    method: string | null = null,
  ) =>
    ENTRIES.push({
      id: newId(),
      kind,
      description,
      category,
      counterparty,
      amount: money(Math.round(amount * 100)),
      dueDate: addDays(t, due),
      status: paid ? 'paid' : 'open',
      paidAt: paid ? `${addDays(t, Math.min(due, 0))}T15:00:00.000Z` : null,
      paidMethod: paid ? (method ?? 'pix') : null,
      cancelReason: null,
      overdue: !paid && due < 0,
    });
  // Contas fixas dos dois meses anteriores, já pagas (a comparação com o mês passado fica justa).
  for (const back of [60, 30]) {
    add(
      'payable',
      'Aluguel do salão',
      'Aluguel',
      'Imobiliária Vila',
      8500,
      -22 - back,
      true,
      'transfer',
    );
    add('payable', 'Folha de pagamento', 'Salários', 'Equipe', 21400, -21 - back, true, 'transfer');
    add(
      'payable',
      'Compra de carnes',
      'Insumos e mercadorias',
      'Frigorífico Boi Bom',
      6180,
      -12 - back,
      true,
    );
    add(
      'payable',
      'Compra de carnes',
      'Insumos e mercadorias',
      'Frigorífico Boi Bom',
      6050,
      -2 - back,
      true,
    );
    add('payable', 'Hortifrúti', 'Insumos e mercadorias', 'Hortifrúti Vila', 1940, -5 - back, true);
    add(
      'payable',
      'Chopp (barris)',
      'Bebidas',
      'Cervejaria Paulistana',
      2260,
      -3 - back,
      true,
      'boleto',
    );
    add('payable', 'Conta de energia', 'Energia', 'Enel', 1790, -1 - back, true, 'boleto');
    add('payable', 'Gás (P45)', 'Gás', 'Ultragaz', 1280, 2 - back, true);
    add('payable', 'Embalagens de delivery', 'Embalagens', 'Embalagens SP', 2300, 4 - back, true);
    add(
      'payable',
      'Simples Nacional',
      'Impostos',
      'Receita Federal',
      5100,
      6 - back,
      true,
      'boleto',
    );
    add('payable', 'Contabilidade', 'Contabilidade', 'Contábil Paulista', 790, 8 - back, true);
    add('payable', 'Internet e telefone', 'Internet e telefone', 'Vivo', 289.9, 10 - back, true);
  }
  add('payable', 'Aluguel do salão', 'Aluguel', 'Imobiliária Vila', 8500, -22, true, 'transfer');
  add('payable', 'Folha de pagamento', 'Salários', 'Equipe', 21400, -21, true, 'transfer');
  add(
    'payable',
    'Compra de carnes',
    'Insumos e mercadorias',
    'Frigorífico Boi Bom',
    6240.5,
    -12,
    true,
  );
  add(
    'payable',
    'Hortifrúti da semana',
    'Insumos e mercadorias',
    'Hortifrúti Vila',
    980.4,
    -5,
    true,
  );
  add('payable', 'Chopp (barris)', 'Bebidas', 'Cervejaria Paulistana', 2310, -3, true, 'boleto');
  add('payable', 'Conta de energia', 'Energia', 'Enel', 1872.33, -1, false);
  add('payable', 'Gás (P45)', 'Gás', 'Ultragaz', 640, 2, false);
  add('payable', 'Embalagens de delivery', 'Embalagens', 'Embalagens SP', 1190, 4, false);
  add('payable', 'Simples Nacional', 'Impostos', 'Receita Federal', 5320.18, 6, false);
  add('payable', 'Contabilidade', 'Contabilidade', 'Contábil Paulista', 790, 8, false);
  add('payable', 'Internet e telefone', 'Internet e telefone', 'Vivo', 289.9, 10, false);
  add(
    'payable',
    'Compra de carnes',
    'Insumos e mercadorias',
    'Frigorífico Boi Bom',
    6100,
    9,
    false,
  );
  add(
    'receivable',
    'Encomenda de 40 burgers (aniversário)',
    'Eventos e encomendas',
    'Camila Ribeiro',
    1680,
    3,
    false,
  );
  add(
    'receivable',
    'Convênio da academia (mês)',
    'Convênios e vendas a prazo',
    'Academia Corpo Livre',
    920,
    -2,
    false,
  );
}
seedEntries();

function monthOf(from: string | null, to: string | null) {
  const t = todayKey();
  const f = from ?? `${t.slice(0, 7)}-01`;
  const end = to ?? dayKey(new Date(parseDay(f).getFullYear(), parseDay(f).getMonth() + 1, 0));
  return { from: f, to: end };
}

function summary(from: string, to: string): FinanceSummary {
  const t = todayKey();
  const open = ENTRIES.filter((e) => e.status === 'open');
  const sumOf = (list: FinanceEntry[]) => money(list.reduce((s, e) => s + toCents(e.amount), 0));
  const inMonth = ENTRIES.filter(
    (e) => e.dueDate >= from && e.dueDate <= to && e.status !== 'cancelled',
  );
  const sales = sumRange(from, t < to ? t : to);
  const fees = Math.round(
    sales.byMethod.credit * 0.032 + sales.byMethod.debit * 0.015 + sales.byMethod.voucher * 0.036,
  );
  const paid = inMonth.filter((e) => e.kind === 'payable' && e.status === 'paid');
  const received = inMonth.filter((e) => e.kind === 'receivable' && e.status === 'paid');
  return {
    payableOpen: sumOf(open.filter((e) => e.kind === 'payable')),
    payableOverdue: sumOf(open.filter((e) => e.kind === 'payable' && e.dueDate < t)),
    payableNext7: sumOf(
      open.filter((e) => e.kind === 'payable' && e.dueDate >= t && e.dueDate <= addDays(t, 7)),
    ),
    receivableOpen: sumOf(open.filter((e) => e.kind === 'receivable')),
    receivableOverdue: sumOf(open.filter((e) => e.kind === 'receivable' && e.dueDate < t)),
    receivableNext7: sumOf(
      open.filter((e) => e.kind === 'receivable' && e.dueDate >= t && e.dueDate <= addDays(t, 7)),
    ),
    month: {
      from,
      to,
      monthStartDay: 1,
      payableDue: sumOf(inMonth.filter((e) => e.kind === 'payable')),
      paid: sumOf(paid),
      payableLeft: sumOf(inMonth.filter((e) => e.kind === 'payable' && e.status === 'open')),
      receivableDue: sumOf(inMonth.filter((e) => e.kind === 'receivable')),
      received: sumOf(received),
      receivableLeft: sumOf(inMonth.filter((e) => e.kind === 'receivable' && e.status === 'open')),
      sales: money(sales.revenue),
      refunds: '0.00',
      fees: money(fees),
      net: money(sales.revenue - fees - paid.reduce((s, e) => s + toCents(e.amount), 0)),
    },
  };
}

function cashFlow(from: string, to: string): CashFlowDay[] {
  return days(from, to).map((day) => {
    const s = dayStat(day);
    const fees = Math.round(s.byMethod.credit * 0.032 + s.byMethod.debit * 0.015);
    const paid = ENTRIES.filter((e) => e.status === 'paid' && e.paidAt?.slice(0, 10) === day);
    const due = ENTRIES.filter((e) => e.status === 'open' && e.dueDate === day);
    const out = paid.filter((e) => e.kind === 'payable').reduce((t, e) => t + toCents(e.amount), 0);
    const inn = paid
      .filter((e) => e.kind === 'receivable')
      .reduce((t, e) => t + toCents(e.amount), 0);
    const future = day > todayKey();
    return {
      day,
      sales: money(future ? 0 : s.revenue),
      refunds: '0.00',
      received: money(inn),
      paid: money(out),
      fees: money(future ? 0 : fees),
      expectedIn: money(
        due.filter((e) => e.kind === 'receivable').reduce((t, e) => t + toCents(e.amount), 0),
      ),
      expectedOut: money(
        due.filter((e) => e.kind === 'payable').reduce((t, e) => t + toCents(e.amount), 0),
      ),
      net: money((future ? 0 : s.revenue - fees) + inn - out),
    };
  });
}

function dreFor(from: string, to: string): Dre {
  const s = sumRange(from, to);
  const scale = span(from, to) / 30;
  const fees = Math.round(
    s.byMethod.credit * 0.032 + s.byMethod.debit * 0.015 + s.byMethod.voucher * 0.036,
  );
  const fixed = (amount: number) => money(Math.round(amount * 100 * scale));
  return buildDre({
    sales: CHANNELS.map((c) => ({ channel: c, amount: money(s.byChannel[c].revenue) })),
    refunds: '0.00',
    orders: s.orders,
    entries: [
      { kind: 'payable', category: 'Aluguel', amount: fixed(8500) },
      { kind: 'payable', category: 'Salários', amount: fixed(21400) },
      { kind: 'payable', category: 'Encargos e benefícios', amount: fixed(6300) },
      { kind: 'payable', category: 'Energia', amount: fixed(1872) },
      { kind: 'payable', category: 'Gás', amount: fixed(1280) },
      { kind: 'payable', category: 'Embalagens', amount: fixed(2380) },
      { kind: 'payable', category: 'Impostos', amount: money(Math.round(s.revenue * 0.06)) },
      { kind: 'payable', category: 'Contabilidade', amount: fixed(790) },
      { kind: 'payable', category: 'Marketing', amount: fixed(1200) },
      { kind: 'payable', category: 'Internet e telefone', amount: fixed(290) },
      { kind: 'payable', category: 'Sistemas', amount: fixed(249) },
    ],
    cardFees: money(fees),
    stockCmv: money(s.cost),
    stockLosses: money(Math.round(s.revenue * 0.004)),
    cashBreaks: '-12.40',
  });
}

// ------------------------------------------------------------------------------- relatórios

function reportDoc(id: string, from: string, to: string): ReportDoc {
  const info = REPORT_GROUPS.flatMap((g) => g.reports.map((r) => ({ ...r, group: g.title }))).find(
    (r) => r.id === id,
  );
  if (!info) throw new Error('relatório');
  const prev = prevRange(from, to);
  const s = sumRange(from, to);
  const p = sumRange(prev.from, prev.to);
  const ticket = s.orders ? Math.round(s.revenue / s.orders) : 0;
  const pticket = p.orders ? Math.round(p.revenue / p.orders) : 0;
  const lines = productLines(s.products);
  const doc: ReportDoc = {
    id,
    group: info.group,
    title: info.title,
    description: info.description,
    restaurant: TENANT.name,
    from,
    to,
    prevFrom: prev.from,
    prevTo: prev.to,
    generatedAt: new Date().toISOString(),
    kpis: [],
    charts: [],
    tables: [],
    notes: ['Exemplo do site: números de uma hamburgueria fictícia, a Fumaça Burger & Co.'],
  };
  const daily = s.list.map((d, i) => ({
    label: d.day.slice(8, 10) + '/' + d.day.slice(5, 7),
    value: d.revenue / 100,
    prev: (p.list[i]?.revenue ?? 0) / 100,
  }));
  const channelPoints = CHANNELS.map((c) => ({
    label: CHANNEL_LABELS[c],
    value: s.byChannel[c].revenue / 100,
  }));
  const hourPoints = s.byHour
    .map((v, h) => ({ label: `${h}h`, value: v }))
    .filter((x) => x.value > 0);
  const productTable = {
    id: 'produtos',
    title: 'Itens vendidos',
    columns: [
      { key: 'name', label: 'Item', fmt: 'text' as const, width: 32 },
      { key: 'quantity', label: 'Qtd.', fmt: 'num' as const },
      { key: 'revenue', label: 'Vendido', fmt: 'money' as const },
      { key: 'cost', label: 'Custo', fmt: 'money' as const },
      { key: 'margin', label: 'Margem', fmt: 'pct' as const },
    ],
    rows: lines.map((l) => ({
      name: l.name,
      quantity: Number(l.quantity),
      revenue: toCents(l.revenue) / 100,
      cost: toCents(l.cost) / 100,
      margin: toCents(l.revenue)
        ? Math.round((1 - toCents(l.cost) / toCents(l.revenue)) * 1000) / 10
        : null,
    })),
    bar: 'revenue',
  };
  switch (id) {
    case 'resultado':
    case 'evolucao':
    case 'extrato':
    case 'ticket':
      doc.kpis = [
        {
          label: 'Vendido',
          value: s.revenue / 100,
          fmt: 'money',
          prev: p.revenue / 100,
          main: true,
        },
        { label: 'Pedidos', value: s.orders, fmt: 'int', prev: p.orders },
        { label: 'Ticket médio', value: ticket / 100, fmt: 'money', prev: pticket / 100 },
        {
          label: 'Margem bruta',
          value: s.revenue ? Math.round((1 - s.cost / s.revenue) * 1000) / 10 : null,
          fmt: 'pct',
        },
      ];
      doc.charts = [
        {
          kind: 'line',
          title: 'Vendas por dia',
          fmt: 'money',
          series: ['Este período', 'Período anterior'],
          points: daily,
          wide: true,
        },
        { kind: 'donut', title: 'Vendas por canal', fmt: 'money', points: channelPoints },
        {
          kind: 'bars',
          title: 'Recebido por forma',
          fmt: 'money',
          points: METHODS.map((m) => ({
            label: PAYMENT_METHOD_LABELS[m],
            value: s.byMethod[m] / 100,
          })),
        },
      ];
      doc.tables = [
        {
          id: 'dias',
          title: 'Dia a dia',
          columns: [
            { key: 'day', label: 'Dia', fmt: 'date' },
            { key: 'orders', label: 'Pedidos', fmt: 'int' },
            { key: 'revenue', label: 'Vendido', fmt: 'money' },
            { key: 'ticket', label: 'Ticket', fmt: 'money' },
          ],
          rows: s.list.map((d) => ({
            day: d.day,
            orders: d.orders,
            revenue: d.revenue / 100,
            ticket: d.orders ? Math.round(d.revenue / d.orders) / 100 : 0,
          })),
          bar: 'revenue',
        },
      ];
      break;
    case 'produtos':
    case 'engenharia':
      doc.kpis = [
        {
          label: 'Itens vendidos',
          value: lines.reduce((t, l) => t + Number(l.quantity), 0),
          fmt: 'int',
          main: true,
        },
        { label: 'Vendido', value: s.revenue / 100, fmt: 'money', prev: p.revenue / 100 },
        { label: 'Custo (fichas)', value: s.cost / 100, fmt: 'money', invert: true },
      ];
      doc.charts = [
        {
          kind: 'bars',
          title: 'Os que mais vendem',
          fmt: 'money',
          points: lines
            .slice(0, 10)
            .map((l) => ({ label: l.name, value: toCents(l.revenue) / 100 })),
          wide: true,
        },
      ];
      if (id === 'engenharia') {
        const avgQ = lines.reduce((t, l) => t + Number(l.quantity), 0) / Math.max(1, lines.length);
        const margins = lines.map(
          (l) => (toCents(l.revenue) - toCents(l.cost)) / Math.max(1, Number(l.quantity)) / 100,
        );
        const avgM = margins.reduce((a, b) => a + b, 0) / Math.max(1, margins.length);
        doc.charts.push({
          kind: 'scatter',
          title: 'Popularidade × margem',
          x: { label: 'Vendidos', fmt: 'int' },
          y: { label: 'Margem por item', fmt: 'money' },
          cut: { x: avgQ, y: avgM },
          groups: [{ id: 'item', label: 'Itens' }],
          points: lines.map((l, i) => ({
            label: l.name,
            x: Number(l.quantity),
            y: margins[i]!,
            group: 'item',
          })),
          wide: true,
        });
      }
      doc.tables = [productTable];
      break;
    case 'horarios':
      doc.kpis = [
        { label: 'Pedidos', value: s.orders, fmt: 'int', prev: p.orders, main: true },
        {
          label: 'Hora mais cheia',
          value: `${s.byHour.indexOf(Math.max(...s.byHour))}h`,
          fmt: 'text',
        },
      ];
      doc.charts = [
        { kind: 'columns', title: 'Pedidos por hora', fmt: 'int', points: hourPoints, wide: true },
      ];
      break;
    default:
      doc.kpis = [
        {
          label: 'Vendido',
          value: s.revenue / 100,
          fmt: 'money',
          prev: p.revenue / 100,
          main: true,
        },
        { label: 'Pedidos', value: s.orders, fmt: 'int', prev: p.orders },
        { label: 'Cancelados', value: s.cancelled, fmt: 'int', prev: p.cancelled, invert: true },
      ];
      doc.charts = [
        {
          kind: 'line',
          title: 'Vendas por dia',
          fmt: 'money',
          series: ['Este período', 'Período anterior'],
          points: daily,
          wide: true,
        },
      ];
      doc.tables = [productTable];
      doc.notes.push(
        'No teste grátis este relatório sai completo, com os dados do seu restaurante.',
      );
  }
  return doc;
}

export function registerReports() {
  on('GET', '/reports/sales', ({ query }) => {
    const from = dayOf(query.get('from'));
    const s = sumRange(from, from);
    const live = orders.filter((o) => dayKey(new Date(o.createdAt)) === from);
    const receivable = live
      .filter((o) => o.status === 'completed')
      .reduce((t, o) => t + Math.max(0, totalOf(o) - paidOf(o)), 0);
    return {
      totals: {
        orders: s.orders,
        cancelled: s.cancelled,
        revenue: money(s.revenue),
        discounts: money(s.discounts),
        surcharges: '0.00',
        deliveryFees: money(s.deliveryFees),
        receivable: money(receivable),
        averageTicket: money(s.orders ? Math.round(s.revenue / s.orders) : 0),
        cost: money(s.cost),
      },
      byChannel: CHANNELS.map((c) => ({
        channel: c,
        orders: s.byChannel[c].orders,
        revenue: money(s.byChannel[c].revenue),
      })),
      received: METHODS.map((m) => ({
        method: m,
        received: money(s.byMethod[m]),
        refunded: '0.00',
        net: money(s.byMethod[m]),
      })),
      topProducts: productLines(s.products).slice(0, 10),
    };
  });
  on('GET', '/reports/calendar', ({ query }) => {
    const month = query.get('month') ?? todayKey().slice(0, 7);
    const first = `${month}-01`;
    const last = dayKey(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const end = last < todayKey() ? last : todayKey();
    const s = sumRange(first, end);
    const prev = prevRange(first, end);
    const p = sumRange(prev.from, prev.to);
    return {
      month,
      today: todayKey(),
      days: s.list.map((d) => ({
        day: d.day,
        orders: d.orders,
        cancelled: d.cancelled,
        revenue: money(d.revenue),
        deliveryFees: money(d.deliveryFees),
        cost: money(d.cost),
      })),
      reservations: [],
      topProducts: productLines(s.products).slice(0, 8),
      coverage: { items: money(s.revenue), withoutRecipe: '0.00' },
      byHour: s.byHour.map((v, hour) => ({ hour, orders: v, revenue: money(v * 6800) })),
      byChannel: CHANNELS.map((c) => ({
        channel: c,
        orders: s.byChannel[c].orders,
        revenue: money(s.byChannel[c].revenue),
      })),
      expenses: {
        paid: money(
          ENTRIES.filter((e) => e.status === 'paid').reduce((t, e) => t + toCents(e.amount), 0),
        ),
        count: ENTRIES.filter((e) => e.status === 'paid').length,
      },
      previous: { orders: p.orders, revenue: money(p.revenue) },
    };
  });
  on('GET', '/reports/insights', ({ query }) => {
    const to = dayOf(query.get('to'));
    const from = dayOf(query.get('from') ?? addDays(to, -29));
    const prev = prevRange(from, to);
    const s = sumRange(from, to);
    const p = sumRange(prev.from, prev.to);
    const totals = (x: typeof s) => ({
      orders: x.orders,
      cancelled: x.cancelled,
      cancelledValue: money(x.cancelled * 6500),
      revenue: money(x.revenue),
      discounts: money(x.discounts),
      deliveryFees: money(x.deliveryFees),
      cost: money(x.cost),
      customers: Math.round(x.orders * 0.42),
    });
    return {
      from,
      to,
      days: span(from, to),
      today: todayKey(),
      channel: null,
      totals: totals(s),
      previous: totals(p),
      daily: s.list.map((d) => ({
        day: d.day,
        orders: d.orders,
        revenue: money(d.revenue),
        cost: money(d.cost),
        deliveryFees: money(d.deliveryFees),
      })),
      heat: s.list.flatMap((d) =>
        d.byHour
          .map((v, hour) => ({
            dow: parseDay(d.day).getDay(),
            hour,
            orders: v,
            revenue: money(v * 6800),
          }))
          .filter((x) => x.orders),
      ),
      products: productLines(s.products).map((l) => {
        const prod = products.find((x) => x.id === l.productId)!;
        const pq = p.products.get(l.productId) ?? 0;
        return {
          ...l,
          category: categories.find((c) => c.id === prod.categoryId)?.name ?? null,
          prevQuantity: pq.toFixed(3),
          prevRevenue: money(Math.round(pq * toCents(prod.price))),
        };
      }),
      idle: [],
      channels: CHANNELS.map((c) => ({
        channel: c,
        orders: s.byChannel[c].orders,
        revenue: money(s.byChannel[c].revenue),
        prevOrders: p.byChannel[c].orders,
        prevRevenue: money(p.byChannel[c].revenue),
      })),
      payments: METHODS.map((m) => ({
        method: m,
        net: money(s.byMethod[m]),
        count: Math.round((s.orders * s.byMethod[m]) / Math.max(1, s.revenue)),
      })),
      cancellations: [
        {
          reason: 'Cliente desistiu',
          count: Math.ceil(s.cancelled * 0.6),
          value: money(Math.ceil(s.cancelled * 0.6) * 6400),
        },
        {
          reason: 'Item em falta',
          count: Math.floor(s.cancelled * 0.4),
          value: money(Math.floor(s.cancelled * 0.4) * 5900),
        },
      ],
      staff: [
        {
          id: newId(),
          name: USER_NAME,
          orders: Math.round(s.orders * 0.4),
          revenue: money(Math.round(s.revenue * 0.4)),
          ticket: money(Math.round(s.revenue / Math.max(1, s.orders))),
        },
        {
          id: newId(),
          name: 'Larissa Costa',
          orders: Math.round(s.orders * 0.35),
          revenue: money(Math.round(s.revenue * 0.35)),
          ticket: money(Math.round(s.revenue / Math.max(1, s.orders))),
        },
        {
          id: newId(),
          name: 'João Pereira (garçom)',
          orders: Math.round(s.orders * 0.25),
          revenue: money(Math.round(s.revenue * 0.25)),
          ticket: money(Math.round(s.revenue / Math.max(1, s.orders))),
        },
      ],
      customers: {
        identified: Math.round(s.orders * 0.42),
        new: Math.round(s.orders * 0.08),
        repeat: Math.round(s.orders * 0.34),
        revenue: money(Math.round(s.revenue * 0.45)),
        top: customers
          .slice(0, 5)
          .map((c) => ({ name: c.name, orders: c.orders, revenue: c.spent })),
      },
      kitchen: { avg: '13.4', p90: '21.0', items: Math.round(s.orders * 2.6) },
      expenses: {
        paid: money(
          ENTRIES.filter((e) => e.status === 'paid').reduce((t, e) => t + toCents(e.amount), 0),
        ),
        count: ENTRIES.filter((e) => e.status === 'paid').length,
      },
    };
  });
  on('GET', '/reports/catalog/:id', ({ params, query }) => {
    const to = dayOf(query.get('to'));
    const from = dayOf(query.get('from') ?? addDays(to, -29));
    try {
      return reportDoc(params.id!, from, to);
    } catch {
      return fail(404, 'Relatório não encontrado');
    }
  });
  on('GET', '/reports/menu-pixel', ({ query }) => {
    const to = dayOf(query.get('to'));
    const from = dayOf(query.get('from') ?? addDays(to, -29));
    const d = days(from, to);
    const visits = d.map((x, i) => 120 + Math.round(noise(x, 40 + i) * 90));
    const tot = visits.reduce((a, b) => a + b, 0);
    const totals = {
      visits: tot,
      visitors: Math.round(tot * 0.72),
      itemViews: tot * 3,
      adds: Math.round(tot * 0.42),
      searches: Math.round(tot * 0.08),
      buyerSessions: Math.round(tot * 0.21),
      orders: Math.round(tot * 0.2),
      revenue: money(Math.round(tot * 0.2) * 7200),
    };
    return {
      from,
      to,
      today: todayKey(),
      days: d.length,
      totals,
      previous: { ...totals, visits: Math.round(tot * 0.9), orders: Math.round(tot * 0.18) },
      funnel: [
        { step: 'visit', sessions: tot },
        { step: 'item', sessions: Math.round(tot * 0.66) },
        { step: 'add', sessions: Math.round(tot * 0.34) },
        { step: 'checkout', sessions: Math.round(tot * 0.25) },
        { step: 'order', sessions: Math.round(tot * 0.2) },
      ],
      daily: d.map((day, i) => ({
        day,
        visits: visits[i]!,
        itemViews: visits[i]! * 3,
        adds: Math.round(visits[i]! * 0.42),
        orders: Math.round(visits[i]! * 0.2),
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        visits: hour < 10 ? 0 : Math.round((tot / 14) * (hour >= 18 && hour <= 21 ? 1.8 : 0.7)),
      })),
      products: featured.map((pr) => ({
        productId: pr.id,
        name: pr.name,
        category: null,
        views: 300 + Math.round(noise(pr.key) * 900),
        viewSessions: 240,
        adds: 60 + Math.round(noise(pr.key, 2) * 200),
        addSessions: 50,
        favorites: Math.round(noise(pr.key, 3) * 40),
        sold: '0',
      })),
      searches: [
        { term: 'batata', count: 42, noResults: 0 },
        { term: 'combo', count: 31, noResults: 0 },
        { term: 'vegetariano', count: 12, noResults: 0 },
        { term: 'refrigerante', count: 9, noResults: 9 },
      ],
      sources: [
        { key: 'instagram', visits: Math.round(tot * 0.46), buyers: Math.round(tot * 0.09) },
        { key: 'google', visits: Math.round(tot * 0.28), buyers: Math.round(tot * 0.06) },
        { key: null, visits: Math.round(tot * 0.26), buyers: Math.round(tot * 0.05) },
      ],
      devices: [
        { key: 'mobile', visits: Math.round(tot * 0.86), buyers: Math.round(tot * 0.17) },
        { key: 'desktop', visits: Math.round(tot * 0.14), buyers: Math.round(tot * 0.03) },
      ],
      campaigns: [],
      categories: categories.map((c, i) => ({ id: c.id, name: c.name, clicks: 400 - i * 45 })),
      banners: [],
    };
  });

  // Financeiro.
  on('GET', '/finance/settings', () => {
    const t = todayKey();
    const m = monthOf(null, null);
    return {
      monthStartDay: 1,
      today: t,
      currentMonth: {
        from: m.from,
        to: m.to,
        year: Number(t.slice(0, 4)),
        month: Number(t.slice(5, 7)),
      },
      paymentTerms: DEFAULT_PAYMENT_TERMS,
    };
  });
  on('GET', '/finance/summary', ({ query }) => {
    const m = monthOf(query.get('from'), query.get('to'));
    return summary(m.from, m.to);
  });
  on('GET', '/finance/cash-flow', ({ query }) => {
    const m = monthOf(query.get('from'), query.get('to'));
    return { days: cashFlow(m.from, m.to) };
  });
  on('GET', '/finance/dre', ({ query }) => {
    const m = monthOf(query.get('from'), query.get('to'));
    const end = m.to < todayKey() ? m.to : todayKey();
    const prev = {
      from: query.get('prevFrom') ?? prevRange(m.from, end).from,
      to: query.get('prevTo') ?? prevRange(m.from, end).to,
    };
    return {
      from: m.from,
      to: m.to,
      basis: (query.get('basis') as 'accrual' | 'cash') ?? 'accrual',
      dre: dreFor(m.from, end),
      previous: { from: prev.from, to: prev.to, dre: dreFor(prev.from, prev.to) },
    };
  });
  on('GET', '/finance/closings', ({ query }) => {
    const m = monthOf(query.get('from'), query.get('to'));
    const end = m.to < todayKey() ? m.to : todayKey();
    return {
      days: days(m.from, end)
        .reverse()
        .slice(0, 31)
        .map((day) => {
          const s = dayStat(day);
          const isToday = day === todayKey();
          const fee = (mth: PaymentMethod) =>
            Math.round(
              s.byMethod[mth] *
                (mth === 'credit'
                  ? 0.032
                  : mth === 'debit'
                    ? 0.015
                    : mth === 'voucher'
                      ? 0.036
                      : 0),
            );
          return {
            day,
            status: isToday ? 'open' : 'posted',
            sessions: isToday
              ? sessions
                  .filter((x) => x.status === 'open')
                  .map((x) => ({
                    id: x.id,
                    number: x.number,
                    status: x.status,
                    registerName: 'Caixa 1',
                    openedAt: x.openedAt,
                    closedAt: x.closedAt,
                    openedByName: x.openedByName,
                    closedByName: null,
                    day,
                    difference: null,
                    cashDifference: null,
                    closingNote: null,
                    posted: false,
                    sales: money(
                      movements
                        .filter((mv) => mv.sessionId === x.id && mv.kind === 'sale')
                        .reduce((t, mv) => t + toCents(mv.amount), 0),
                    ),
                  }))
              : [],
            methods: METHODS.map((mth) => ({
              method: mth,
              gross: money(s.byMethod[mth]),
              fee: money(fee(mth)),
              net: money(s.byMethod[mth] - fee(mth)),
              expectedDate: addDays(
                day,
                mth === 'credit' ? 30 : mth === 'debit' ? 1 : mth === 'voucher' ? 15 : 0,
              ),
              received: mth === 'pix' || mth === 'cash' || (mth === 'debit' && !isToday),
              receivedAmount: money(mth === 'pix' || mth === 'cash' ? s.byMethod[mth] : 0),
              estimated: isToday,
            })),
            totals: {
              gross: money(s.revenue),
              fee: money(METHODS.reduce((t, mth) => t + fee(mth), 0)),
              net: money(s.revenue - METHODS.reduce((t, mth) => t + fee(mth), 0)),
              orders: s.orders,
              ticket: money(s.orders ? Math.round(s.revenue / s.orders) : 0),
              discounts: money(s.discounts),
              deliveryFees: money(s.deliveryFees),
              opening: '200.00',
              supplies: isToday ? '50.00' : '0.00',
              withdrawals: isToday ? '300.00' : '400.00',
              cashDifference: isToday ? '0.00' : '-2.40',
            },
          };
        }),
    };
  });
  on('GET', '/finance/entries', () =>
    ENTRIES.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  );
  on('POST', '/finance/entries', ({ body }) => {
    const b = body as Partial<FinanceEntry> & { amount: string };
    const e: FinanceEntry = {
      id: newId(),
      kind: b.kind ?? 'payable',
      description: String(b.description ?? 'Conta').trim(),
      category: b.category ?? null,
      counterparty: b.counterparty ?? null,
      amount: money(toCents(b.amount)),
      dueDate: b.dueDate ?? todayKey(),
      status: 'open',
      paidAt: null,
      paidMethod: null,
      cancelReason: null,
      overdue: (b.dueDate ?? todayKey()) < todayKey(),
    };
    ENTRIES.push(e);
    emitLocal({ type: 'data.changed', area: 'finance' });
    return e;
  });
  on('POST', '/finance/entries/:id/settle', ({ params, body }) => {
    const e = ENTRIES.find((x) => x.id === params.id);
    if (!e) return fail(404, 'Conta não encontrada');
    e.status = 'paid';
    e.paidAt = new Date().toISOString();
    e.paidMethod = String((body as { method?: string })?.method ?? 'pix');
    e.overdue = false;
    emitLocal({ type: 'data.changed', area: 'finance' });
    return e;
  });
  on('POST', '/finance/entries/:id/cancel', ({ params, body }) => {
    const e = ENTRIES.find((x) => x.id === params.id);
    if (!e) return fail(404, 'Conta não encontrada');
    e.status = 'cancelled';
    e.cancelReason = String((body as { reason?: string })?.reason ?? '');
    emitLocal({ type: 'data.changed', area: 'finance' });
    return e;
  });
  on('GET', '/finance/reconciliation', ({ query }) => {
    const day = query.get('day') ?? todayKey();
    const s = dayStat(day);
    return {
      day,
      methods: METHODS.map((m) => ({
        method: m,
        systemAmount: money(s.byMethod[m]),
        reconciliation: null,
      })),
    };
  });

  // Repasses dos entregadores (Entregas › Acerto e Relatórios › Calendário).
  const RULE = { ...DEFAULT_COURIER_PAY_RULE, mode: 'fixed' as const, fixed: '8.00' };
  const SHARE = [0.4, 0.35, 0.25];
  const monthDays = (month: string) => {
    const first = `${month}-01`;
    const last = dayKey(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    return days(first, last < todayKey() ? last : todayKey());
  };
  const ridesOf = (day: string, i: number) =>
    Math.round(dayStat(day).byChannel.delivery.orders * SHARE[i]!);
  on('GET', '/courier-pay/report', ({ query }) => {
    const month = query.get('month') ?? todayKey().slice(0, 7);
    const list = monthDays(month);
    const lines = couriers.map((c, i) => {
      const worked = list.filter((d) => ridesOf(d, i) > 0);
      const delivered = worked.reduce((t, d) => t + ridesOf(d, i), 0);
      const earned = delivered * 800;
      const paid = Math.round(earned * 0.6);
      return {
        courierId: c.id,
        name: c.name,
        phone: c.phone,
        active: true,
        taxRegime: 'mei' as const,
        pixKey: c.phone,
        ownRule: false,
        payRule: null,
        rule: describePayRule(RULE),
        delivered,
        failed: i === 2 ? 1 : 0,
        daysWorked: worked.length,
        distanceM: delivered * 2400,
        rides: money(earned),
        daily: '0.00',
        earned: money(earned),
        employerEstimate: '0.00',
        costEstimate: money(earned),
        paidCount: 2,
        paidGross: money(paid),
        paidWithheld: '0.00',
        paidNet: money(paid),
        paidEmployer: '0.00',
        pendingRides: delivered - Math.round(delivered * 0.6),
        pendingGross: money(earned - paid),
        pendingWithheld: '0.00',
        pendingNet: money(earned - paid),
      };
    });
    const sum = (k: 'delivered' | 'failed' | 'distanceM') => lines.reduce((t, l) => t + l[k], 0);
    const sumM = (k: 'earned' | 'costEstimate' | 'paidNet' | 'pendingGross' | 'pendingNet') =>
      money(lines.reduce((t, l) => t + toCents(l[k]), 0));
    const deliveryOrders = list.reduce((t, d) => t + dayStat(d).byChannel.delivery.orders, 0);
    return {
      month,
      settings: {
        rule: RULE,
        taxes: DEFAULT_COURIER_TAX_SETTINGS,
        description: describePayRule(RULE),
      },
      totals: {
        delivered: sum('delivered'),
        failed: sum('failed'),
        distanceM: sum('distanceM'),
        earned: sumM('earned'),
        costEstimate: sumM('costEstimate'),
        paidNet: sumM('paidNet'),
        paidWithheld: '0.00',
        paidEmployer: '0.00',
        pendingGross: sumM('pendingGross'),
        pendingNet: sumM('pendingNet'),
        deliveryFees: money(list.reduce((t, d) => t + dayStat(d).deliveryFees, 0)),
        deliveryOrders,
      },
      couriers: lines,
      days: list.map((d) => ({
        day: d,
        deliveries: dayStat(d).byChannel.delivery.orders,
        cost: money(dayStat(d).byChannel.delivery.orders * 800),
      })),
      payouts: [],
    };
  });
  on('GET', '/courier-pay/calendar', ({ query }) => {
    const month = query.get('month') ?? todayKey().slice(0, 7);
    return {
      month,
      couriers: couriers.map((c) => ({ id: c.id, name: c.name, active: true })),
      days: monthDays(month).flatMap((d) =>
        couriers
          .map((c, i) => ({ c, n: ridesOf(d, i) }))
          .filter((x) => x.n > 0)
          .map(({ c, n }) => ({
            day: d,
            courierId: c.id,
            delivered: n,
            failed: 0,
            distanceM: n * 2400,
            rides: money(n * 800),
            daily: '0.00',
            total: money(n * 800),
            collected: money(Math.round(n * 0.1) * 7800),
            first: `${d}T18:05:00`,
            last: `${d}T23:10:00`,
          })),
      ),
    };
  });
  on('GET', '/courier-pay/calendar/day', () => []);
  on('GET', '/courier-pay/settings', () => ({
    rule: RULE,
    taxes: DEFAULT_COURIER_TAX_SETTINGS,
    description: describePayRule(RULE),
  }));
}

export { addDays, todayKey };
