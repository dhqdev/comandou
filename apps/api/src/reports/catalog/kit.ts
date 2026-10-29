import type { ReportChart, ReportDoc, ReportKpi, ReportPoint, ReportTable } from '@comandou/shared';
import { one, q } from '../../common/sql';
import type { Tx } from '../../database/database.service';

/** Período do relatório já resolvido no fuso do restaurante. */
export interface Period {
  tx: Tx;
  /** Datas pedidas (AAAA-MM-DD, "to" inclusive) e o período anterior de mesmo tamanho. */
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  /** Início e fim (exclusivo) em instantes, e o início do período anterior. */
  a: Date;
  b: Date;
  pa: Date;
  tz: string;
  restaurant: string;
}

export type Built = Pick<ReportDoc, 'kpis' | 'charts' | 'tables' | 'notes'>;

/** Venda que conta: nem cancelada nem pedido online ainda em análise. */
export const SOLD = `o.status NOT IN ('cancelled','awaiting')`;

export async function resolvePeriod(tx: Tx, from: string, to: string): Promise<Period> {
  const tzExpr = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;
  const r = await one<{
    a: Date;
    b: Date;
    pa: Date;
    tz: string;
    days: number;
    prevFrom: string;
    prevTo: string;
    name: string;
  }>(
    tx,
    `SELECT ($1::date::timestamp AT TIME ZONE ${tzExpr}) AS a,
            (($2::date + 1)::timestamp AT TIME ZONE ${tzExpr}) AS b,
            (($1::date - ($2::date - $1::date + 1))::timestamp AT TIME ZONE ${tzExpr}) AS pa,
            ${tzExpr} AS tz, ($2::date - $1::date + 1)::int AS days,
            to_char($1::date - ($2::date - $1::date + 1), 'YYYY-MM-DD') AS "prevFrom",
            to_char($1::date - 1, 'YYYY-MM-DD') AS "prevTo",
            COALESCE((SELECT name FROM tenants WHERE id = app_current_tenant()), 'Restaurante') AS name`,
    [from, to],
  );
  return {
    tx,
    from,
    to,
    prevFrom: r!.prevFrom,
    prevTo: r!.prevTo,
    days: r!.days,
    a: r!.a,
    b: r!.b,
    pa: r!.pa,
    tz: r!.tz,
    restaurant: r!.name,
  };
}

export { one, q };

/** Número de uma coluna numeric/texto (2 casas). */
export const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r1 = (v: number) => Math.round(v * 10) / 10;
export const pct = (part: number, whole: number) => (whole ? r1((part / whole) * 100) : 0);
export const sum = <T>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));

const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
export function addDays(day: string, k: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return iso(d);
}
/** Todos os dias de um período (para preencher dias sem venda com zero). */
export const dayList = (from: string, days: number) =>
  Array.from({ length: days }, (_, i) => addDays(from, i));

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const dmy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Expressão SQL: instante → data/hora local "AAAA-MM-DDTHH:MI" (vira data no Excel). */
export const localTs = (col: string, tzParam: string) =>
  `to_char(${col} AT TIME ZONE ${tzParam}, 'YYYY-MM-DD"T"HH24:MI')`;
export const localDay = (col: string, tzParam: string) =>
  `to_char(${col} AT TIME ZONE ${tzParam}, 'YYYY-MM-DD')`;

/** Série diária do período com a comparação do período anterior (dia a dia, alinhada). */
export function dailySeries(
  p: Period,
  cur: Map<string, number>,
  prev: Map<string, number>,
): ReportPoint[] {
  return dayList(p.from, p.days).map((d, i) => ({
    label: p.days > 62 ? dmy(d) : `${WEEKDAYS_SHORT[weekday(d)]} ${dm(d)}`,
    value: r2(cur.get(d) ?? 0),
    prev: r2(prev.get(addDays(p.prevFrom, i)) ?? 0),
  }));
}

/** Junta o rabo de uma lista em "Outros" (gráfico de rosca legível). */
export function topWithOthers(points: ReportPoint[], keep = 6): ReportPoint[] {
  const sorted = [...points].sort((x, y) => y.value - x.value).filter((x) => x.value > 0);
  if (sorted.length <= keep + 1) return sorted;
  const rest = sorted.slice(keep).reduce((s, x) => s + x.value, 0);
  return [...sorted.slice(0, keep), { label: 'Outros', value: r2(rest) }];
}

export const kpi = (k: ReportKpi) => k;
export const chart = (c: ReportChart) => c;
export const table = (t: ReportTable) => t;

/** Chave do cliente: conta no cardápio online ou telefone (só dígitos). */
export const CUSTOMER_KEY = `COALESCE(o.customer_id::text, NULLIF(regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g'), ''))`;

/**
 * Bairro de um endereço de entrega. O cardápio online grava
 * "Rua, nº — complemento — Bairro — Cidade/UF — CEP 00000-000 — Ref.: …"; no PDV o endereço é
 * livre e o bairro costuma vir depois de um hífen ("Rua A, 10 - Centro").
 */
export function districtOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(' — ')
    .map((s) => s.trim())
    .filter((s) => s && !/^CEP\b/i.test(s) && !/^Ref\.?:/i.test(s));
  if (parts.length >= 2) {
    const city = parts.findIndex((s, i) => i > 0 && /\/[A-Z]{2}$/.test(s));
    const pick =
      city > 0 ? parts[city - 1] : parts.length >= 3 ? parts[parts.length - 1] : parts[1];
    return tidy(pick);
  }
  const dash = address.split(/\s[-–]\s/);
  if (dash.length >= 2) {
    const last = dash[dash.length - 1]!.split(',')[0]!.trim();
    if (
      /[a-zà-ú]/i.test(last) &&
      !/\d{3,}/.test(last) &&
      !/^(apto?|ap|casa|bloco|bl|sala|lote|fundos)\b/i.test(last)
    )
      return tidy(last);
  }
  return null;
}

function tidy(s: string | undefined) {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t || /^\d+$/.test(t)) return null;
  // Padroniza a caixa: "VILA MADALENA" e "vila madalena" contam juntos.
  return t
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
}

/**
 * Consultas em sequência na mesma transação (uma conexão não roda duas consultas ao mesmo
 * tempo; Promise.all só enfileiraria e o driver avisa).
 */
export async function serial<T extends unknown[]>(
  ...fns: { [K in keyof T]: () => Promise<T[K]> }
): Promise<T> {
  const out: unknown[] = [];
  for (const f of fns as (() => Promise<unknown>)[]) out.push(await f());
  return out as T;
}
