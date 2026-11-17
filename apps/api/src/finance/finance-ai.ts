import {
  buildDre,
  financeMonth,
  financeMonthName,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type Dre,
} from '@comandou/shared';
import { one } from '../common/sql';
import type { Tx } from '../database/database.service';
import { loadPaymentTerms } from './closing';
import { loadDreRaw } from './dre-data';

/** "1234.5" → "R$ 1.234,50". */
function brl(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (v: number | null | string) => (v === null ? '—' : `${String(v).replace('.', ',')}%`);

function dreLine(d: Dre): string {
  const t = d.totals;
  const net = Number(t.netRevenue);
  const p = (v: string) => (net > 0 ? ` (${pct(Math.round((Number(v) / net) * 1000) / 10)})` : '');
  return [
    `receita bruta ${brl(t.grossRevenue)}`,
    `receita líquida ${brl(t.netRevenue)}`,
    `CMV ${brl(t.cmv)}${p(t.cmv)}${d.cmvSource === 'stock' ? ' pelas fichas técnicas' : d.cmvSource === 'purchases' ? ' pelas compras de insumos' : ''}`,
    `lucro bruto ${brl(t.grossProfit)}`,
    `despesas variáveis (taxas de maquininha, apps, entregadores) ${brl(t.variable)}${p(t.variable)}`,
    `margem de contribuição ${brl(t.contribution)}${p(t.contribution)}`,
    `despesas fixas ${brl(t.fixed)}${p(t.fixed)}`,
    `lucro líquido ${brl(t.netProfit)}${p(t.netProfit)}`,
  ].join('; ');
}

/**
 * Números do financeiro para o assistente de IA (só para quem vê o financeiro): o DRE do mês
 * financeiro até hoje e do mês anterior, os indicadores, as contas, os recebíveis das
 * maquininhas, o extrato e os caixas sem lançamento. Assim ele responde "quanto lucrei?",
 * "meu CMV está bom?" ou "o que vence esta semana?" com os números de verdade.
 */
export async function financeSnapshot(tx: Tx): Promise<string[]> {
  const s = await one<{ day: number | null; today: string }>(
    tx,
    `SELECT (SELECT month_start_day FROM finance_settings) AS day,
            (now() AT TIME ZONE timezone)::date::text AS today FROM tenants`,
  );
  if (!s) return [];
  const startDay = s.day ?? 1;
  const month = financeMonth(s.today, startDay);
  const prev = financeMonth(s.today, startDay, -1);
  const upTo = month.to < s.today ? month.to : s.today;
  const cur = buildDre(await loadDreRaw(tx, month.from, upTo, 'accrual'));
  const before = buildDre(await loadDreRaw(tx, prev.from, prev.to, 'accrual'));
  const today = buildDre(await loadDreRaw(tx, s.today, s.today, 'accrual'));
  const out: string[] = [];
  out.push(
    `Financeiro, mês de ${financeMonthName(month)} (${br(month.from)} a ${br(month.to)}, contas pelo vencimento), até hoje ${br(s.today)}: ${dreLine(cur)}.`,
  );
  if (cur.indicators.length)
    out.push(
      `Indicadores do mês: ${cur.indicators
        .map(
          (i) =>
            `${i.label} ${i.value === null ? 'sem lançamentos' : i.unit === 'pct' ? pct(i.value) : brl(i.value)} (referência ${i.reference}${i.status === 'good' ? ', bom' : i.status === 'warn' ? ', atenção' : i.status === 'bad' ? ', ruim' : ''})`,
        )
        .join('; ')}.`,
    );
  if (cur.notes.length) out.push(`Falta no DRE do mês: ${cur.notes.join(' ')}`);
  out.push(
    `Mês anterior (${financeMonthName(prev)}, ${br(prev.from)} a ${br(prev.to)}): ${dreLine(before)}.`,
  );
  const ticket = today.indicators.find((i) => i.id === 'ticket');
  out.push(
    `Hoje: vendas recebidas ${brl(today.totals.grossRevenue)}${ticket ? `, ${ticket.reference}, ticket médio ${brl(ticket.value as string)}` : ''}.`,
  );

  const r = await one<Record<string, string | number>>(
    tx,
    `WITH t AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM tenants)
     SELECT
       (SELECT COALESCE(sum(amount), 0) FROM finance_entries WHERE status = 'open' AND kind = 'payable')::text AS pay_open,
       (SELECT COALESCE(sum(amount), 0) FROM finance_entries, t WHERE status = 'open' AND kind = 'payable' AND due_date < t.d)::text AS pay_late,
       (SELECT count(*) FROM finance_entries, t WHERE status = 'open' AND kind = 'payable' AND due_date < t.d)::int AS pay_late_n,
       (SELECT COALESCE(sum(amount), 0) FROM finance_entries, t WHERE status = 'open' AND kind = 'payable' AND due_date BETWEEN t.d AND t.d + 7)::text AS pay_next7,
       (SELECT COALESCE(sum(amount), 0) FROM finance_entries WHERE status = 'open' AND kind = 'receivable')::text AS rec_open,
       (SELECT COALESCE(sum(amount), 0) FROM finance_entries, t WHERE status = 'open' AND kind = 'receivable' AND due_date < t.d)::text AS rec_late,
       (SELECT COALESCE(sum(net), 0) FROM finance_settlements WHERE reconciliation_id IS NULL)::text AS st_open,
       (SELECT COALESCE(sum(net), 0) FROM finance_settlements, t WHERE reconciliation_id IS NULL AND expected_date < t.d)::text AS st_late,
       (SELECT COALESCE(sum(net), 0) FROM finance_settlements, t WHERE reconciliation_id IS NULL AND expected_date BETWEEN t.d AND t.d + 7)::text AS st_next7,
       (SELECT count(*) FROM bank_accounts WHERE active)::int AS accounts,
       (SELECT count(*) FROM bank_statement_lines WHERE reconciliation_id IS NULL)::int AS lines_open,
       (SELECT max(posted_at)::text FROM bank_statement_lines) AS last_line,
       (SELECT count(*) FROM cash_sessions cs WHERE cs.status = 'closed'
          AND cs.closed_at > now() - interval '60 days'
          AND NOT EXISTS (SELECT 1 FROM finance_settlements fs WHERE fs.cash_session_id = cs.id)
          AND EXISTS (SELECT 1 FROM cash_movements m WHERE m.cash_session_id = cs.id AND m.kind = 'sale'))::int AS unposted`,
  );
  if (r) {
    out.push(
      `Contas a pagar em aberto: ${brl(r.pay_open!)} (vencidas ${brl(r.pay_late!)} em ${r.pay_late_n} conta(s); vencem nos próximos 7 dias ${brl(r.pay_next7!)}). A receber em aberto: ${brl(r.rec_open!)} (vencido ${brl(r.rec_late!)}).`,
    );
    out.push(
      `Recebíveis dos caixas fechados ainda não conciliados (maquininhas, PIX, vale): ${brl(r.st_open!)}; atrasados ${brl(r.st_late!)}; previstos para os próximos 7 dias ${brl(r.st_next7!)}.`,
    );
    out.push(
      Number(r.accounts) === 0
        ? 'Conciliação bancária: nenhuma conta do banco cadastrada nem extrato importado.'
        : `Conciliação bancária: ${r.lines_open} linha(s) do extrato sem conciliar; último extrato até ${r.last_line ? br(String(r.last_line)) : '—'}.`,
    );
    if (Number(r.unposted) > 0)
      out.push(
        `Caixas fechados sem lançamento no financeiro: ${r.unposted} (botão Lançar no financeiro, aba Fechamentos).`,
      );
  }
  const terms = await loadPaymentTerms(tx);
  out.push(
    `Taxas e prazos cadastrados das maquininhas: ${PAYMENT_METHODS.filter((m) => m !== 'cash')
      .map(
        (m) =>
          `${PAYMENT_METHOD_LABELS[m]} ${terms[m].feePercent.replace('.', ',')}% em ${terms[m].days} dia(s)`,
      )
      .join('; ')}.`,
  );
  return out;
}
