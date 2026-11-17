import { daysBetween, foldText } from '@comandou/shared';

/** Linha do extrato ainda sem conciliação (valor em centavos, com sinal). */
export interface MatchLine {
  id: string;
  date: string;
  cents: number;
  description: string;
}
/** Recebível de um caixa fechado ainda não conciliado (líquido em centavos). */
export interface MatchSettlement {
  id: string;
  method: string;
  day: string;
  expectedDate: string;
  cents: number;
}
/** Conta do financeiro candidata (em aberto ou paga e ainda sem linha do extrato). */
export interface MatchEntry {
  id: string;
  kind: 'payable' | 'receivable';
  cents: number;
  /** Vencimento (em aberto) ou data do pagamento (paga). */
  date: string;
  open: boolean;
}

export type Proposal =
  | { kind: 'settlement'; lineIds: string[]; settlementIds: string[]; auto: boolean }
  | { kind: 'entry'; lineIds: string[]; entryId: string; settle: boolean; auto: boolean };

/** Dias de folga entre o previsto e o dia em que o banco lançou (feriado, atraso de 1 dia). */
const SETTLEMENT_WINDOW = 3;
const PAID_ENTRY_WINDOW = 5;
const OPEN_ENTRY_WINDOW = 10;
/** Diferença aceita numa sugestão (a taxa real da maquininha difere da cadastrada). */
const nearEnough = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(100, Math.round(Math.abs(b) * 0.02));
const isPix = (s: string) => /\bpix\b/.test(foldText(s));

/**
 * Propõe conciliações para as linhas do extrato, do mais seguro para o menos seguro, sem usar um
 * item duas vezes. `auto` = pode ser aplicada sozinha (valor exato e data perto); o resto é
 * sugestão para a pessoa confirmar.
 *
 * 1. Uma linha = um recebível (mesmo valor, data perto).
 * 2. Uma linha = vários recebíveis do mesmo dia previsto (a maquininha deposita tudo junto).
 * 3. Várias linhas de PIX do dia = os recebíveis de PIX do dia (cada cliente é uma linha).
 * 4. Linha = conta já paga no financeiro (só liga) ou conta em aberto (sugestão de baixa).
 * 5. Valor quase igual ao de recebíveis (taxa diferente): sugestão.
 */
export function proposeMatches(
  lines: MatchLine[],
  settlements: MatchSettlement[],
  entries: MatchEntry[],
): Proposal[] {
  const out: Proposal[] = [];
  const usedL = new Set<string>();
  const usedS = new Set<string>();
  const usedE = new Set<string>();
  const freeS = () => settlements.filter((s) => !usedS.has(s.id));
  const take = (p: Proposal) => {
    out.push(p);
    p.lineIds.forEach((id) => usedL.add(id));
    if (p.kind === 'settlement') p.settlementIds.forEach((id) => usedS.add(id));
    else usedE.add(p.entryId);
  };
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents);
  const dist = (a: string, b: string) => Math.abs(daysBetween(a, b));

  // 1. Uma linha, um recebível com o mesmo valor.
  for (const l of sorted) {
    if (l.cents <= 0) continue;
    const c = freeS()
      .filter((s) => s.cents === l.cents && dist(s.expectedDate, l.date) <= SETTLEMENT_WINDOW)
      .sort((a, b) => dist(a.expectedDate, l.date) - dist(b.expectedDate, l.date))[0];
    if (c) take({ kind: 'settlement', lineIds: [l.id], settlementIds: [c.id], auto: true });
  }

  // 2. Uma linha, vários recebíveis do mesmo dia previsto (mesma forma ou todas juntas).
  for (const l of sorted) {
    if (usedL.has(l.id) || l.cents <= 0) continue;
    const near = freeS().filter(
      (s) => s.method !== 'pix' && dist(s.expectedDate, l.date) <= SETTLEMENT_WINDOW,
    );
    const groups = new Map<string, MatchSettlement[]>();
    for (const s of near) {
      for (const k of [`${s.expectedDate}|${s.method}`, `${s.expectedDate}|*`]) {
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
    }
    const hit = [...groups.entries()]
      .filter(([, g]) => g.length > 1 && g.reduce((a, s) => a + s.cents, 0) === l.cents)
      .sort(([a], [b]) => dist(a.split('|')[0]!, l.date) - dist(b.split('|')[0]!, l.date))[0];
    if (hit)
      take({
        kind: 'settlement',
        lineIds: [l.id],
        settlementIds: hit[1].map((s) => s.id),
        auto: true,
      });
  }

  // 3. PIX: as linhas de PIX recebido do dia somam os recebíveis de PIX do dia.
  const pixDays = new Set(
    freeS()
      .filter((s) => s.method === 'pix')
      .map((s) => s.day),
  );
  for (const day of [...pixDays].sort()) {
    const ss = freeS().filter((s) => s.method === 'pix' && s.day === day);
    const ls = sorted.filter(
      (l) => !usedL.has(l.id) && l.cents > 0 && l.date === day && isPix(l.description),
    );
    const total = ss.reduce((a, s) => a + s.cents, 0);
    if (ls.length && ls.reduce((a, l) => a + l.cents, 0) === total)
      take({
        kind: 'settlement',
        lineIds: ls.map((l) => l.id),
        settlementIds: ss.map((s) => s.id),
        auto: true,
      });
  }

  // 4. Contas do financeiro.
  for (const l of sorted) {
    if (usedL.has(l.id)) continue;
    const kind = l.cents < 0 ? 'payable' : 'receivable';
    const cand = entries
      .filter((e) => !usedE.has(e.id) && e.kind === kind && e.cents === Math.abs(l.cents))
      .filter((e) => dist(e.date, l.date) <= (e.open ? OPEN_ENTRY_WINDOW : PAID_ENTRY_WINDOW))
      // Paga primeiro (só liga), depois a mais perto da data.
      .sort(
        (a, b) => Number(a.open) - Number(b.open) || dist(a.date, l.date) - dist(b.date, l.date),
      );
    const e = cand[0];
    if (e) take({ kind: 'entry', lineIds: [l.id], entryId: e.id, settle: e.open, auto: !e.open });
  }

  // 5. Quase igual: uma linha e um recebível, ou os recebíveis do mesmo dia previsto.
  for (const l of sorted) {
    if (usedL.has(l.id) || l.cents <= 0) continue;
    const near = freeS().filter((s) => dist(s.expectedDate, l.date) <= SETTLEMENT_WINDOW);
    const single = near
      .filter((s) => nearEnough(l.cents, s.cents))
      .sort((a, b) => Math.abs(a.cents - l.cents) - Math.abs(b.cents - l.cents))[0];
    if (single) {
      take({ kind: 'settlement', lineIds: [l.id], settlementIds: [single.id], auto: false });
      continue;
    }
    const byDay = new Map<string, MatchSettlement[]>();
    for (const s of near) byDay.set(s.expectedDate, [...(byDay.get(s.expectedDate) ?? []), s]);
    const g = [...byDay.values()].find(
      (g) =>
        g.length > 1 &&
        nearEnough(
          l.cents,
          g.reduce((a, s) => a + s.cents, 0),
        ),
    );
    if (g)
      take({ kind: 'settlement', lineIds: [l.id], settlementIds: g.map((s) => s.id), auto: false });
  }
  return out;
}
