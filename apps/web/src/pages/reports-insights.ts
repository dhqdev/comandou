/**
 * Inteligência dos relatórios: períodos prontos, engenharia de cardápio, curva ABC e os
 * "insights" (frases curtas com o que o gerente deve olhar). Tudo puro, sem tela, para testar.
 */
import { CHANNEL_LABELS, formatBRL, toCents } from '@comandou/shared';
import type { OrderChannel, PaymentMethod } from '@comandou/shared';

export interface PeriodTotals {
  orders: number;
  cancelled: number;
  cancelledValue: string;
  revenue: string;
  discounts: string;
  deliveryFees: string;
  cost: string;
  customers: number;
}

export interface InsightProduct {
  productId: string;
  name: string;
  category: string | null;
  quantity: string;
  revenue: string;
  cost: string;
  prevQuantity: string;
  prevRevenue: string;
  hasRecipe: boolean;
}

export interface InsightsData {
  from: string;
  to: string;
  days: number;
  today: string;
  channel: OrderChannel | null;
  totals: PeriodTotals;
  previous: PeriodTotals;
  daily: { day: string; orders: number; revenue: string; cost: string; deliveryFees: string }[];
  heat: { dow: number; hour: number; orders: number; revenue: string }[];
  products: InsightProduct[];
  idle: { productId: string; name: string; category: string; price: string }[];
  channels: {
    channel: OrderChannel;
    orders: number;
    revenue: string;
    prevOrders: number;
    prevRevenue: string;
  }[];
  payments: { method: PaymentMethod; net: string; count: number }[];
  cancellations: { reason: string; count: number; value: string }[];
  staff: { id: string; name: string; orders: number; revenue: string; ticket: string }[];
  customers: {
    identified: number;
    new: number;
    repeat: number;
    revenue: string;
    top: { name: string; orders: number; revenue: string }[];
  };
  kitchen: { avg: string | null; p90: string | null; items: number };
  expenses: { paid: string; count: number };
}

/* ---------- Datas ---------- */

export type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) =>
  new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));

export function addDays(day: string, n: number) {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function daysBetween(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

/** Período de um atalho, contado a partir de "hoje" (AAAA-MM-DD, fuso do restaurante). */
export function presetRange(p: Exclude<Preset, 'custom'>, today: string) {
  const t = parse(today);
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const last = new Date(t.getFullYear(), t.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
  }
}

export const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* ---------- Números ---------- */

/** Variação em %, ou null quando não há base de comparação. */
export function change(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export const fmtPct = (v: number, digits = 1) =>
  `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;

const brl = (cents: number) => formatBRL(cents);

/** Lucro bruto = faturamento − taxas de entrega − custo dos insumos. */
export const grossProfit = (t: { revenue: string; deliveryFees: string; cost: string }) =>
  toCents(t.revenue) - toCents(t.deliveryFees) - toCents(t.cost);

/* ---------- Curva ABC ---------- */

/** A = itens que somam os primeiros 80% do faturamento, B = até 95%, C = o resto. */
export function abcClasses(rows: { productId: string; revenue: string }[]) {
  const sorted = [...rows].sort((a, b) => toCents(b.revenue) - toCents(a.revenue));
  const total = sorted.reduce((n, r) => n + toCents(r.revenue), 0);
  const out = new Map<string, 'A' | 'B' | 'C'>();
  let acc = 0;
  for (const r of sorted) {
    const before = total ? acc / total : 1;
    out.set(r.productId, before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C');
    acc += toCents(r.revenue);
  }
  return out;
}

/* ---------- Engenharia de cardápio ---------- */

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';

export const MENU_CLASS: Record<MenuClass, { label: string; hint: string }> = {
  star: {
    label: 'Estrelas',
    hint: 'Vendem muito e deixam bom lucro por unidade. Mantenha em destaque.',
  },
  plowhorse: {
    label: 'Burros de carga',
    hint: 'Vendem muito, mas deixam pouco lucro por unidade. Revise preço, porção ou ficha técnica.',
  },
  puzzle: {
    label: 'Quebra-cabeças',
    hint: 'Lucro por unidade alto, mas vendem pouco. Destaque no cardápio, foto melhor ou sugestão do garçom.',
  },
  dog: {
    label: 'Abacaxis',
    hint: 'Vendem pouco e deixam pouco lucro. Reformule ou tire do cardápio.',
  },
};

/**
 * Matriz de Kasavana & Smith: popularidade alta = participação ≥ 70% da média (1/n);
 * margem alta = margem de contribuição unitária ≥ média ponderada. Só produtos com ficha técnica
 * (sem custo não dá para medir margem).
 */
export function menuMatrix(rows: InsightProduct[]) {
  const sold = rows.filter((r) => r.hasRecipe && Number(r.quantity) > 0);
  const out = new Map<string, MenuClass>();
  if (sold.length < 2) return out;
  const qtyTotal = sold.reduce((n, r) => n + Number(r.quantity), 0);
  const unitMargin = (r: InsightProduct) =>
    (toCents(r.revenue) - toCents(r.cost)) / Number(r.quantity);
  const avgMargin = sold.reduce((n, r) => n + (toCents(r.revenue) - toCents(r.cost)), 0) / qtyTotal;
  const popLine = (1 / sold.length) * 0.7;
  for (const r of sold) {
    const popular = Number(r.quantity) / qtyTotal >= popLine;
    const rich = unitMargin(r) >= avgMargin;
    out.set(r.productId, popular ? (rich ? 'star' : 'plowhorse') : rich ? 'puzzle' : 'dog');
  }
  return out;
}

/* ---------- Insights ---------- */

export type Tone = 'good' | 'warn' | 'bad' | 'info';

export interface Insight {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** Maior = mais importante. */
  weight: number;
  link?: { label: string; to: string };
}

/** Projeção do fechamento quando o período ainda está correndo (termina hoje ou depois). */
export function projection(d: InsightsData) {
  if (d.to < d.today || d.days < 3) return null;
  const elapsed = daysBetween(d.from, d.today);
  if (elapsed < 2 || elapsed >= d.days) return null;
  // O dia de hoje ainda não acabou: projeta pelos dias fechados.
  const closed = d.daily
    .filter((x) => x.day >= d.from && x.day < d.today)
    .reduce((n, x) => n + toCents(x.revenue), 0);
  const perDay = closed / (elapsed - 1);
  return Math.round(perDay * d.days);
}

export function buildInsights(d: InsightsData): Insight[] {
  const out: Insight[] = [];
  const t = d.totals;
  const p = d.previous;
  const rev = toCents(t.revenue);
  const prevRev = toCents(p.revenue);
  const profit = grossProfit(t);

  if (t.orders === 0) {
    return [
      {
        id: 'empty',
        tone: 'info',
        title: 'Sem vendas no período',
        detail: 'Escolha outro período ou outro canal para ver a análise.',
        weight: 1,
      },
    ];
  }

  // Faturamento x período anterior.
  const g = change(rev, prevRev);
  if (g !== null && Math.abs(g) >= 3) {
    out.push({
      id: 'revenue',
      tone: g > 0 ? 'good' : 'bad',
      title: g > 0 ? `Faturamento subiu ${fmtPct(g)}` : `Faturamento caiu ${fmtPct(-g)}`,
      detail: `${brl(rev)} contra ${brl(prevRev)} nos ${d.days} dias anteriores (${g > 0 ? '+' : '−'}${brl(Math.abs(rev - prevRev))}).`,
      weight: 90 + Math.min(Math.abs(g), 50) / 5,
    });
  }

  // Projeção.
  const proj = projection(d);
  if (proj) {
    out.push({
      id: 'projection',
      tone: 'info',
      title: `No ritmo atual, o período fecha em ${brl(proj)}`,
      detail:
        prevRev > 0
          ? `Média dos dias já fechados. O período anterior fechou em ${brl(prevRev)}.`
          : 'Média dos dias já fechados.',
      weight: 85,
    });
  }

  // Ticket médio.
  const ticket = t.orders ? rev / t.orders : 0;
  const prevTicket = p.orders ? prevRev / p.orders : 0;
  const tg = change(ticket, prevTicket);
  if (tg !== null && Math.abs(tg) >= 5) {
    out.push({
      id: 'ticket',
      tone: tg > 0 ? 'good' : 'warn',
      title: tg > 0 ? `Ticket médio subiu ${fmtPct(tg)}` : `Ticket médio caiu ${fmtPct(-tg)}`,
      detail:
        tg > 0
          ? `Cada pedido rende ${brl(Math.round(ticket))} em média.`
          : `${brl(Math.round(ticket))} por pedido. Combos, adicionais e sugestão de bebida ajudam a subir.`,
      weight: 60,
    });
  }

  // CMV.
  const cmv = rev ? (toCents(t.cost) / rev) * 100 : 0;
  if (cmv > 35) {
    out.push({
      id: 'cmv',
      tone: cmv > 42 ? 'bad' : 'warn',
      title: `Custo dos insumos em ${fmtPct(cmv)} do faturamento`,
      detail:
        'O ideal em restaurante fica entre 25% e 35%. Confira preços de compra e as fichas técnicas dos mais vendidos.',
      weight: 80,
      link: { label: 'Abrir estoque', to: '/estoque' },
    });
  } else if (cmv > 0 && rev > 0) {
    out.push({
      id: 'margin',
      tone: 'good',
      title: `Margem bruta de ${fmtPct((profit / rev) * 100)}`,
      detail: `Custo dos insumos em ${fmtPct(cmv)} do faturamento, dentro do saudável (até 35%).`,
      weight: 30,
    });
  }

  // Resultado depois das despesas.
  const expenses = toCents(d.expenses.paid);
  if (expenses > 0 && profit - expenses < 0) {
    out.push({
      id: 'result',
      tone: 'bad',
      title: `Despesas maiores que o lucro bruto`,
      detail: `Lucro bruto ${brl(profit)} − despesas pagas ${brl(expenses)} = ${brl(profit - expenses)}.`,
      weight: 88,
      link: { label: 'Ver financeiro', to: '/financeiro' },
    });
  }

  // Pico e vale da semana.
  if (d.heat.length) {
    const top = [...d.heat].sort((a, b) => b.orders - a.orders)[0]!;
    out.push({
      id: 'peak',
      tone: 'info',
      title: `Seu pico: ${WEEKDAY_NAMES[top.dow]} às ${top.hour}h`,
      detail: `${top.orders} pedidos nesse horário no período. Garanta equipe e preparo adiantado.`,
      weight: 55,
    });
    const byDow = Array.from({ length: 7 }, (_, dow) =>
      d.heat.filter((h) => h.dow === dow).reduce((n, h) => n + toCents(h.revenue), 0),
    );
    const open = byDow.map((v, i) => [v, i] as const).filter(([v]) => v > 0);
    if (open.length >= 4 && d.days >= 7) {
      const [low, i] = open.sort((a, b) => a[0] - b[0])[0]!;
      const avg = open.reduce((n, [v]) => n + v, 0) / open.length;
      if (low < avg * 0.6)
        out.push({
          id: 'valley',
          tone: 'warn',
          title: `${cap(WEEKDAY_NAMES[i]!)} é o dia mais fraco`,
          detail: `Vende ${fmtPct((1 - low / avg) * 100, 0)} abaixo da média dos dias abertos. Uma promoção nesse dia pode puxar movimento.`,
          weight: 50,
        });
    }
  }

  // Produtos em alta e em queda (precisa de volume mínimo).
  const trend = d.products
    .map((r) => ({ r, q: Number(r.quantity), pq: Number(r.prevQuantity) }))
    .filter((x) => x.q + x.pq >= 10 && x.pq > 0);
  const up = trend.map((x) => ({ ...x, g: change(x.q, x.pq)! })).sort((a, b) => b.g - a.g)[0];
  if (up && up.g >= 25)
    out.push({
      id: 'rising',
      tone: 'good',
      title: `${up.r.name} está em alta (+${fmtPct(up.g, 0)})`,
      detail: `${qtyLabel(up.q)} vendidos contra ${qtyLabel(up.pq)} no período anterior. Garanta estoque.`,
      weight: 58,
    });
  const down = trend.map((x) => ({ ...x, g: change(x.q, x.pq)! })).sort((a, b) => a.g - b.g)[0];
  if (down && down.g <= -25)
    out.push({
      id: 'falling',
      tone: 'warn',
      title: `${down.r.name} caiu ${fmtPct(-down.g, 0)}`,
      detail: `${qtyLabel(down.q)} vendidos contra ${qtyLabel(down.pq)} antes. Vale checar qualidade, preço ou disponibilidade.`,
      weight: 57,
    });

  // Engenharia de cardápio.
  const matrix = menuMatrix(d.products);
  const byClass = (c: MenuClass) => d.products.filter((r) => matrix.get(r.productId) === c);
  const horses = byClass('plowhorse').slice(0, 3);
  if (horses.length)
    out.push({
      id: 'plowhorse',
      tone: 'warn',
      title: `${horses.length === 1 ? 'Um campeão de vendas deixa' : `${horses.length} campeões de vendas deixam`} pouco lucro por unidade`,
      detail: `${list(horses.map((h) => h.name))}: lucro por unidade abaixo da média do cardápio. Como vendem muito, um ajuste pequeno de preço aqui rende mais que em qualquer outro item.`,
      weight: 70,
    });
  const puzzles = byClass('puzzle').slice(0, 3);
  if (puzzles.length)
    out.push({
      id: 'puzzle',
      tone: 'info',
      title: `Itens lucrativos que vendem pouco`,
      detail: `${list(puzzles.map((h) => h.name))}: dê destaque no cardápio ou peça para a equipe sugerir.`,
      weight: 45,
    });

  // Dependência dos mais vendidos.
  const ranked = [...d.products].sort((a, b) => toCents(b.revenue) - toCents(a.revenue));
  const itemsTotal = ranked.reduce((n, r) => n + toCents(r.revenue), 0);
  const top3 = ranked.slice(0, 3).reduce((n, r) => n + toCents(r.revenue), 0);
  if (ranked.length >= 6 && itemsTotal && top3 / itemsTotal >= 0.5)
    out.push({
      id: 'concentration',
      tone: 'info',
      title: `3 produtos fazem ${fmtPct((top3 / itemsTotal) * 100, 0)} das vendas`,
      detail: `${list(ranked.slice(0, 3).map((r) => r.name))}. Falta de insumo deles pesa muito: mantenha estoque de segurança.`,
      weight: 40,
    });

  // Produtos parados.
  if (d.idle.length >= 3)
    out.push({
      id: 'idle',
      tone: 'warn',
      title: `${d.idle.length >= 30 ? '30 ou mais' : d.idle.length} produtos não venderam nada`,
      detail: `Ex.: ${list(d.idle.slice(0, 3).map((i) => i.name))}. Cardápio enxuto vende mais e desperdiça menos.`,
      weight: 42,
      link: { label: 'Abrir cardápio', to: '/cardapio' },
    });

  // Ficha técnica.
  const noRecipe = d.products
    .filter((r) => !r.hasRecipe)
    .reduce((n, r) => n + toCents(r.revenue), 0);
  if (itemsTotal && noRecipe / itemsTotal >= 0.1)
    out.push({
      id: 'recipe',
      tone: 'warn',
      title: `${fmtPct((noRecipe / itemsTotal) * 100, 0)} das vendas sem ficha técnica`,
      detail: 'O custo desses itens conta como zero e o lucro aparece maior que o real.',
      weight: 65,
      link: { label: 'Abrir estoque', to: '/estoque' },
    });

  // Cancelamentos.
  const all = t.orders + t.cancelled;
  const cr = all ? (t.cancelled / all) * 100 : 0;
  if (t.cancelled > 0 && cr >= 3) {
    const reason = d.cancellations[0];
    out.push({
      id: 'cancel',
      tone: cr >= 6 ? 'bad' : 'warn',
      title: `${fmtPct(cr)} dos pedidos foram cancelados`,
      detail: `${t.cancelled} pedidos, ${brl(toCents(t.cancelledValue))} que não entraram.${reason ? ` Motivo mais comum: "${reason.reason}".` : ''}`,
      weight: 75,
    });
  }

  // Descontos.
  const disc = toCents(t.discounts);
  if (rev && disc / (rev + disc) >= 0.08)
    out.push({
      id: 'discount',
      tone: 'warn',
      title: `Descontos somam ${brl(disc)}`,
      detail: `${fmtPct((disc / (rev + disc)) * 100)} do valor bruto. Confira se estão trazendo pedidos a mais.`,
      weight: 52,
    });

  // Cozinha.
  const p90 = d.kitchen.p90 ? Number(d.kitchen.p90) : 0;
  if (d.kitchen.items >= 10 && p90 >= 30)
    out.push({
      id: 'kitchen',
      tone: p90 >= 45 ? 'bad' : 'warn',
      title: `1 em cada 10 itens leva mais de ${Math.round(p90)} min para sair`,
      detail: `Média de ${Number(d.kitchen.avg).toLocaleString('pt-BR')} min do pedido até o item ficar pronto. Veja os horários de pico.`,
      weight: 62,
      link: { label: 'Abrir cozinha', to: '/cozinha' },
    });

  // Clientes.
  const c = d.customers;
  if (c.identified >= 5) {
    const repeatPct = (c.repeat / c.identified) * 100;
    out.push({
      id: 'customers',
      tone: repeatPct >= 25 ? 'good' : 'info',
      title: `${c.new} clientes novos, ${c.repeat} voltaram mais de uma vez`,
      detail:
        repeatPct >= 25
          ? `${fmtPct(repeatPct, 0)} dos clientes identificados repetiram no período. Ótimo sinal de fidelidade.`
          : `Só ${fmtPct(repeatPct, 0)} repetiram no período. O programa de fidelidade ajuda a trazer de volta.`,
      weight: 48,
      link: repeatPct < 25 ? { label: 'Fidelidade', to: '/loja-online?aba=fidelidade' } : undefined,
    });
  }

  // Canal que mais cresceu.
  if (!d.channel) {
    const grew = d.channels
      .map((x) => ({ x, g: change(toCents(x.revenue), toCents(x.prevRevenue)) }))
      .filter((x) => x.g !== null && toCents(x.x.revenue) >= rev * 0.1)
      .sort((a, b) => b.g! - a.g!)[0];
    if (grew && grew.g! >= 20)
      out.push({
        id: 'channel',
        tone: 'good',
        title: `${CHANNEL_LABELS[grew.x.channel]} cresceu ${fmtPct(grew.g!, 0)}`,
        detail: `${brl(toCents(grew.x.revenue))} no período, contra ${brl(toCents(grew.x.prevRevenue))} antes.`,
        weight: 46,
      });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const qtyLabel = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;

/* ---------- Exportação ---------- */

/** CSV (separador ";" e vírgula decimal, como o Excel em pt-BR abre direto). */
export function productsCsv(rows: InsightProduct[]) {
  const num = (v: string | number) => String(v).replace('.', ',');
  const abc = abcClasses(rows);
  const matrix = menuMatrix(rows);
  const head = [
    'Produto',
    'Categoria',
    'Quantidade',
    'Vendas',
    'Custo',
    'Lucro',
    'Qtd. período anterior',
    'Curva ABC',
    'Engenharia de cardápio',
  ];
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) =>
    [
      esc(r.name),
      esc(r.category ?? ''),
      num(r.quantity),
      num(r.revenue),
      r.hasRecipe ? num(r.cost) : '',
      r.hasRecipe ? num(((toCents(r.revenue) - toCents(r.cost)) / 100).toFixed(2)) : '',
      num(r.prevQuantity),
      abc.get(r.productId) ?? '',
      matrix.has(r.productId) ? MENU_CLASS[matrix.get(r.productId)!].label : '',
    ].join(';'),
  );
  return `﻿${[head.join(';'), ...lines].join('\r\n')}`;
}
