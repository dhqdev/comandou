import { z } from 'zod';
import { q } from '../common/sql';
import type { Tx } from '../database/database.service';
import { groupParts } from '../platform/ai-parts';
import { MONTH_START } from './ai-quota';

/** Período do painel Conta › Uso de IA (o mesmo do Super Admin). */
export const UsagePeriod = z.enum(['month', 'last', 'all']).catch('month');
export type UsagePeriod = z.infer<typeof UsagePeriod>;

/** Começo e fim (SQL) de cada período, no relógio de Brasília (o mesmo do limite do mês). */
const RANGE: Record<UsagePeriod, { from: string; to: string }> = {
  month: { from: MONTH_START, to: 'now()' },
  last: { from: `(${MONTH_START}) - interval '1 month'`, to: MONTH_START },
  all: { from: `'-infinity'::timestamptz`, to: 'now()' },
};

/**
 * Uso de IA do restaurante da transação (banco central, RLS por restaurante), para o painel da
 * Conta: total, partes do sistema (a mesma divisão do Super Admin), dias e quem usou. Sem US$:
 * o restaurante vê tokens e quantas vezes usou; o custo fica com o Comandou.
 */
export async function tenantAiUsage(tx: Tx, period: UsagePeriod) {
  const r = RANGE[period];
  const [sources, days, people] = await Promise.all([
    q<{ source: string; tokens: number; calls: number; bonus: number }>(
      tx,
      `SELECT source, sum(prompt_tokens + completion_tokens)::float8 AS tokens,
              count(*)::int AS calls, sum(bonus_tokens)::float8 AS bonus
         FROM ai_usage WHERE created_at >= ${r.from} AND created_at < ${r.to}
        GROUP BY 1`,
    ),
    q<{ day: string; tokens: number; calls: number }>(
      tx,
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::float8 AS tokens,
              count(u.id)::int AS calls
         FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 29,
                              (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day') d
         LEFT JOIN ai_usage u ON (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d
        GROUP BY d ORDER BY d`,
    ),
    q<{ userId: string | null; tokens: number; calls: number }>(
      tx,
      `SELECT user_id AS "userId", sum(prompt_tokens + completion_tokens)::float8 AS tokens,
              count(*)::int AS calls
         FROM ai_usage WHERE created_at >= ${r.from} AND created_at < ${r.to}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    ),
  ]);
  const parts = groupParts(sources.map((s) => ({ ...s, costUsd: 0 }))).map((p) => ({
    key: p.key,
    label: p.label,
    tokens: p.tokens,
    calls: p.calls,
    percent: p.percent,
    sources: p.sources.map((s) => ({
      source: s.source,
      label: s.label,
      tokens: s.tokens,
      calls: s.calls,
    })),
  }));
  return {
    period,
    total: {
      tokens: sources.reduce((n, s) => n + s.tokens, 0),
      calls: sources.reduce((n, s) => n + s.calls, 0),
      /** Quanto do período saiu dos tokens extras que o Comandou liberou. */
      bonusTokens: sources.reduce((n, s) => n + Number(s.bonus ?? 0), 0),
    },
    parts,
    days,
    /** Quem mais usou (null = uso sem pessoa, como a IA do WhatsApp respondendo clientes). */
    people,
  };
}
