import {
  daysBetween,
  formatBRL,
  toCents,
  type Dre,
  type FinanceMonth,
  type PaymentMethod,
} from '@comandou/shared';
import type { CashFlowDay, FinanceSummary } from '../../lib/types';
import type { ClosingDay } from './types';

/**
 * Leituras do mês: frases curtas que o dono do restaurante entende de cara, tiradas dos números
 * que o Financeiro já tem (resumo, fluxo de caixa, fechamentos e DRE). Tudo em centavos inteiros.
 * Ordem: o que pede ação (vencido, falta no caixa) vem antes do que é só bom saber.
 */

export type InsightTone = 'bad' | 'warn' | 'good' | 'info';
export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  text: string;
  /** Aba do Financeiro que mostra o assunto (?aba=). */
  tab?: 'entries' | 'closings' | 'reconcile' | 'flow' | 'dre';
}

export interface InsightInput {
  period: FinanceMonth;
  /** Nome curto do mês anterior ("outubro"), para as comparações. */
  previousName: string;
  /** Hoje no fuso do restaurante (AAAA-MM-DD). */
  today: string;
  summary: FinanceSummary;
  prevSummary?: FinanceSummary | null;
  flow?: CashFlowDay[] | null;
  closings?: ClosingDay[] | null;
  dre?: Dre | null;
  prevDre?: Dre | null;
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
const METHOD_NAMES: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'PIX',
  voucher: 'Vale-refeição',
  other: 'Outros',
};
const EXPENSE_LINES: Record<string, string> = {
  cmv: 'O CMV (insumos)',
  taxes: 'Impostos sobre vendas',
  selling: 'Aplicativos, entregadores e marketing',
  payroll: 'Pessoal',
  occupancy: 'Ocupação',
  utilities: 'Energia, água, gás e internet',
  admin: 'Despesas administrativas',
  financial: 'Tarifas bancárias e juros',
};
const ORDER: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, info: 3 };

export const money = (cents: number) => formatBRL(cents);
export const pctText = (v: number, digits = 1) =>
  `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD, sem depender do fuso do navegador. */
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const weekdayName = (dow: number) => WEEKDAYS[dow]!;

/** Quanto do período já passou: dias corridos até hoje (inclusive) e o total de dias. */
export function periodProgress(period: Pick<FinanceMonth, 'from' | 'to'>, today: string) {
  const total = daysBetween(period.from, period.to) + 1;
  const elapsed =
    today < period.from ? 0 : today > period.to ? total : daysBetween(period.from, today) + 1;
  return { total, elapsed, running: elapsed > 0 && elapsed < total };
}

/** Média de vendas por dia da semana, só com os dias que tiveram venda. */
export function weekdayAverages(days: ClosingDay[]) {
  const acc = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const d of days) {
    const g = toCents(d.totals.gross);
    if (g <= 0) continue;
    const a = acc[weekdayOf(d.day)]!;
    a.sum += g;
    a.n += 1;
  }
  return acc.map((a, dow) => ({ dow, avg: a.n ? Math.round(a.sum / a.n) : 0, days: a.n }));
}

/** Vendas e taxa efetiva por forma de pagamento, somando os dias do período. */
export function methodTotals(days: ClosingDay[]) {
  const map = new Map<PaymentMethod, { gross: number; fee: number }>();
  for (const d of days)
    for (const m of d.methods) {
      const cur = map.get(m.method) ?? { gross: 0, fee: 0 };
      cur.gross += toCents(m.gross);
      cur.fee += toCents(m.fee);
      map.set(m.method, cur);
    }
  return [...map.entries()]
    .map(([method, v]) => ({
      method,
      name: METHOD_NAMES[method] ?? method,
      gross: v.gross,
      fee: v.fee,
      feePct: v.gross > 0 ? (v.fee / v.gross) * 100 : 0,
    }))
    .filter((m) => m.gross > 0)
    .sort((a, b) => b.gross - a.gross);
}

/** Variação percentual com uma casa (null sem base de comparação). */
export function change(cur: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((cur - before) / Math.abs(before)) * 1000) / 10;
}

const lineCents = (dre: Dre | null | undefined, id: string) => {
  const l = dre?.lines.find((x) => x.id === id);
  return l ? toCents(l.value) : 0;
};

export function buildInsights(input: InsightInput): Insight[] {
  const { summary, prevSummary, period, today, previousName, closings, dre, prevDre } = input;
  const out: Insight[] = [];
  const m = summary.month;
  const prog = periodProgress(period, today);

  // 1. Contas vencidas: é o que mais pede ação.
  const overdue = toCents(summary.payableOverdue);
  if (overdue > 0)
    out.push({
      id: 'payable-overdue',
      tone: 'bad',
      title: `${money(overdue)} em contas vencidas`,
      text: 'Contas a pagar que já passaram do vencimento. Pague ou renegocie para evitar juros.',
      tab: 'entries',
    });
  const recOverdue = toCents(summary.receivableOverdue);
  if (recOverdue > 0)
    out.push({
      id: 'receivable-overdue',
      tone: 'warn',
      title: `${money(recOverdue)} a receber atrasados`,
      text: 'Clientes ou repasses que deveriam ter entrado e ainda não entraram.',
      tab: 'entries',
    });

  // 2. Ritmo de vendas: projeção do mês corrente ou o fechamento de um mês que já passou.
  const sales = toCents(m.sales);
  const prevSales = prevSummary ? toCents(prevSummary.month.sales) : 0;
  if (sales > 0 && prog.running && prog.elapsed >= 3) {
    const projected = Math.round((sales / prog.elapsed) * prog.total);
    const d = change(projected, prevSales);
    out.push({
      id: 'sales-pace',
      tone: d === null ? 'info' : d >= 0 ? 'good' : 'warn',
      title: `O mês deve fechar em ${money(projected)} de vendas`,
      text:
        d === null
          ? `No ritmo dos últimos ${prog.elapsed} dias (média de ${money(Math.round(sales / prog.elapsed))} por dia).`
          : `No ritmo atual, ${pctText(Math.abs(d))} ${d >= 0 ? 'acima' : 'abaixo'} de ${previousName} (${money(prevSales)}).`,
      tab: 'flow',
    });
  } else if (sales > 0 && !prog.running && prevSales > 0) {
    const d = change(sales, prevSales)!;
    out.push({
      id: 'sales-month',
      tone: d >= 0 ? 'good' : 'warn',
      title: `Vendas ${d >= 0 ? 'subiram' : 'caíram'} ${pctText(Math.abs(d))}`,
      text: `${money(sales)} no mês, contra ${money(prevSales)} em ${previousName}.`,
      tab: 'flow',
    });
  }

  // 3. Ponto de equilíbrio: quanto falta vender para pagar as despesas fixas.
  const be = dre?.indicators.find((i) => i.id === 'breakeven');
  const net = toCents(dre?.totals.netRevenue ?? '0');
  if (be && be.value !== null && net > 0) {
    const need = toCents(be.value as string);
    if (net >= need)
      out.push({
        id: 'breakeven',
        tone: 'good',
        title: 'Despesas fixas já pagas pelas vendas',
        text: `O ponto de equilíbrio do mês é ${money(need)}. Daqui em diante, o que sobra das vendas vira lucro.`,
        tab: 'dre',
      });
    else
      out.push({
        id: 'breakeven',
        tone: prog.running ? 'warn' : 'bad',
        title: `Faltam ${money(need - net)} para o ponto de equilíbrio`,
        text: prog.running
          ? `É preciso vender ${money(need)} no mês para pagar as despesas fixas. Faltam ${prog.total - prog.elapsed} dias.`
          : `O mês fechou abaixo dos ${money(need)} necessários para pagar as despesas fixas.`,
        tab: 'dre',
      });
  } else if (be && be.value === null && be.status === 'bad')
    out.push({
      id: 'breakeven',
      tone: 'bad',
      title: 'Cada venda está dando prejuízo',
      text: 'O custo das mercadorias e as despesas de venda passam do que entra. Revise preços e CMV.',
      tab: 'dre',
    });

  // 4. Indicadores do DRE fora da referência (CMV, pessoal, prime cost).
  for (const id of ['cmv', 'payroll', 'prime'] as const) {
    const i = dre?.indicators.find((x) => x.id === id);
    if (!i || i.value === null || (i.status !== 'warn' && i.status !== 'bad')) continue;
    out.push({
      id: `ind-${id}`,
      tone: i.status,
      title: `${i.label} em ${pctText(i.value as number)} da receita`,
      text: `A referência para restaurante é ${i.reference}. ${i.explain}`,
      tab: 'dre',
    });
  }

  // 5. Despesa que mais cresceu sobre o mês anterior (só com o mês fechado: no meio do mês o
  //    CMV e as contas ainda estão pela metade).
  if (dre && prevDre && !prog.running) {
    let best: { id: string; cur: number; before: number } | null = null;
    for (const id of Object.keys(EXPENSE_LINES)) {
      const cur = -lineCents(dre, id);
      const before = -lineCents(prevDre, id);
      if (before <= 0 || cur <= before) continue;
      const up = cur - before;
      if (up / before < 0.1 || up < 5000) continue;
      if (!best || up > best.cur - best.before) best = { id, cur, before };
    }
    if (best) {
      const d = change(best.cur, best.before)!;
      out.push({
        id: 'expense-up',
        tone: 'warn',
        title: `${EXPENSE_LINES[best.id]} subiu ${pctText(d)}`,
        text: `${money(best.cur)} neste mês, ${money(best.cur - best.before)} a mais que em ${previousName}.`,
        tab: 'dre',
      });
    }
  }

  // 6. Melhor e pior dia da semana.
  if (closings && closings.length) {
    const avgs = weekdayAverages(closings).filter((w) => w.days > 0);
    if (avgs.length >= 3) {
      const top = avgs.reduce((a, b) => (b.avg > a.avg ? b : a));
      const low = avgs.reduce((a, b) => (b.avg < a.avg ? b : a));
      const ratio = low.avg > 0 ? top.avg / low.avg : null;
      out.push({
        id: 'weekday',
        tone: 'info',
        title: `${weekdayName(top.dow)} é o seu dia mais forte`,
        text:
          ratio && ratio >= 1.15
            ? `Média de ${money(top.avg)}, ${ratio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× a de ${weekdayName(low.dow).toLowerCase()} (${money(low.avg)}). Bom dia para reforçar a equipe; o mais fraco pede promoção.`
            : `Média de ${money(top.avg)} em vendas. Os outros dias ficam perto disso.`,
        tab: 'closings',
      });
    }

    // 7. Taxas das maquininhas e a forma de pagamento mais cara.
    const methods = methodTotals(closings);
    const gross = methods.reduce((s, x) => s + x.gross, 0);
    const fees = methods.reduce((s, x) => s + x.fee, 0);
    if (fees > 0 && gross > 0) {
      const dear = methods.filter((x) => x.fee > 0).reduce((a, b) => (b.feePct > a.feePct ? b : a));
      out.push({
        id: 'fees',
        tone: (fees / gross) * 100 > 3 ? 'warn' : 'info',
        title: `Maquininhas levaram ${money(fees)}`,
        text: `${pctText((fees / gross) * 100)} de tudo que foi vendido. ${dear.name} é a mais cara: ${pctText(dear.feePct)} de taxa.`,
        tab: 'closings',
      });
    }

    // 8. Sobras e faltas de caixa.
    const breaks = closings.reduce((s, d) => s + toCents(d.totals.cashDifference), 0);
    if (breaks < 0)
      out.push({
        id: 'cash-breaks',
        tone: breaks <= -5000 ? 'bad' : 'warn',
        title: `Faltaram ${money(-breaks)} nas gavetas`,
        text: 'Diferença entre o dinheiro contado e o esperado nos fechamentos. Confira quem fechou cada caixa.',
        tab: 'closings',
      });

    const pending = closings.filter((d) => d.status === 'pending').length;
    if (pending > 0)
      out.push({
        id: 'pending',
        tone: 'warn',
        title: `${pending} ${pending === 1 ? 'dia fora' : 'dias fora'} do financeiro`,
        text: 'Caixas fechados que ainda não foram lançados. Os números do mês ficam incompletos até lançar.',
        tab: 'closings',
      });
  }

  // 9. O que vence logo.
  const next7 = toCents(summary.payableNext7);
  if (next7 > 0)
    out.push({
      id: 'next7',
      tone: 'info',
      title: `${money(next7)} vencem nos próximos 7 dias`,
      text: 'Contas a pagar em aberto até a semana que vem.',
      tab: 'entries',
    });

  // 10. Margem saudável: só quando nada acima pede atenção ao resultado.
  const margin = dre?.indicators.find((i) => i.id === 'margin');
  if (margin && margin.status === 'good' && margin.value !== null)
    out.push({
      id: 'margin',
      tone: 'good',
      title: `Margem líquida de ${pctText(margin.value as number)}`,
      text: `De cada R$ 100 vendidos, sobram ${money(Math.round((margin.value as number) * 100))} de lucro.`,
      tab: 'dre',
    });

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => ORDER[a.x.tone] - ORDER[b.x.tone] || a.i - b.i)
    .map(({ x }) => x);
}
