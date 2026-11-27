import { stageInfo, TICKET_STAGES } from '@comandou/shared';
import { z } from 'zod';
import { MONTH_START } from '../chat/ai-quota';
import type { PlatformDb } from '../platform/platform-db.service';

/** Período das métricas de IA da esteira (Chamados › Uso de IA). */
export const PipelinePeriod = z.enum(['month', 'last', 'all']).catch('month');
export type PipelinePeriod = z.infer<typeof PipelinePeriod>;

const RANGE: Record<PipelinePeriod, { from: string; to: string }> = {
  month: { from: MONTH_START, to: 'now()' },
  last: { from: `(${MONTH_START}) - interval '1 month'`, to: MONTH_START },
  all: { from: `'-infinity'::timestamptz`, to: 'now()' },
};

/** Só o que a esteira gastou (o uso dos restaurantes fica em ai_usage, em Tokens de IA). */
const ESTEIRA = `source = 'esteira'`;

/**
 * Métricas de IA da esteira de chamados (pedido do David, 0.269: "separado da parte dos
 * restaurantes"): total, dias, modelos, etapas (cada agente), chamados que mais gastaram, a chave
 * que pagou e as últimas chamadas. Tudo de `platform_ai_usage` com `source = 'esteira'`.
 */
export async function pipelineAiUsage(db: PlatformDb, period: PipelinePeriod) {
  const r = RANGE[period];
  const where = `${ESTEIRA} AND created_at >= ${r.from} AND created_at < ${r.to}`;
  const [total, days, models, steps, tickets, keys, recent] = await Promise.all([
    db.query<{ tokens: number; cost: string; calls: number; tickets: number }>(
      `SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::float8 AS tokens,
              coalesce(sum(cost_usd), 0) AS cost, count(*)::int AS calls,
              count(DISTINCT ref)::int AS tickets
         FROM platform_ai_usage WHERE ${where}`,
    ),
    db.query<{ day: string; tokens: number; cost: string; calls: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::float8 AS tokens,
              coalesce(sum(u.cost_usd), 0) AS cost, count(u.id)::int AS calls
         FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 29,
                              (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day') d
         LEFT JOIN platform_ai_usage u
           ON u.${ESTEIRA} AND (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d
        GROUP BY d ORDER BY d`,
    ),
    db.query<{ model: string; tokens: number; cost: string; calls: number }>(
      `SELECT model, sum(prompt_tokens + completion_tokens)::float8 AS tokens,
              sum(cost_usd) AS cost, count(*)::int AS calls
         FROM platform_ai_usage WHERE ${where}
        GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 8`,
    ),
    db.query<{ step: string | null; tokens: number; cost: string; calls: number }>(
      `SELECT step, sum(prompt_tokens + completion_tokens)::float8 AS tokens,
              sum(cost_usd) AS cost, count(*)::int AS calls
         FROM platform_ai_usage WHERE ${where}
        GROUP BY 1`,
    ),
    db.query<{
      ref: string | null;
      id: string | null;
      number: number | null;
      title: string | null;
      stage: string | null;
      tokens: number;
      cost: string;
      calls: number;
      lastAt: Date;
    }>(
      `SELECT u.ref, t.id, t.number, t.title, t.stage,
              sum(u.prompt_tokens + u.completion_tokens)::float8 AS tokens,
              sum(u.cost_usd) AS cost, count(*)::int AS calls, max(u.created_at) AS "lastAt"
         FROM platform_ai_usage u
         LEFT JOIN platform_tickets t
           ON u.ref ~ '^#CH-[0-9]{1,9}$' AND t.number = substring(u.ref FROM 5)::int
        WHERE u.${ESTEIRA} AND u.created_at >= ${r.from} AND u.created_at < ${r.to}
        GROUP BY u.ref, t.id, t.number, t.title, t.stage
        ORDER BY sum(u.cost_usd) DESC, sum(u.prompt_tokens + u.completion_tokens) DESC
        LIMIT 12`,
    ),
    db.query<{ key: string; tokens: number; cost: string; calls: number }>(
      `SELECT coalesce(key_kind, 'owner') AS key,
              sum(prompt_tokens + completion_tokens)::float8 AS tokens,
              sum(cost_usd) AS cost, count(*)::int AS calls
         FROM platform_ai_usage WHERE ${where}
        GROUP BY 1`,
    ),
    db.query<{
      id: string;
      ref: string | null;
      step: string | null;
      model: string;
      key: string;
      tokens: number;
      cost: string;
      at: Date;
    }>(
      `SELECT id::text, ref, step, model, coalesce(key_kind, 'owner') AS key,
              (prompt_tokens + completion_tokens)::float8 AS tokens, cost_usd AS cost,
              created_at AS at
         FROM platform_ai_usage WHERE ${where}
        ORDER BY created_at DESC, id DESC LIMIT 25`,
    ),
  ]);
  const t = total[0]!;
  const usd = (v: string | number) => Math.round(Number(v) * 1e6) / 1e6;
  const byStep = new Map(steps.map((s) => [s.step ?? '', s]));
  return {
    period,
    total: {
      tokens: t.tokens,
      costUsd: usd(t.cost),
      calls: t.calls,
      /** Chamados diferentes que gastaram IA no período. */
      tickets: t.tickets,
      /** Custo médio por chamado (US$). */
      perTicketUsd: t.tickets ? usd(Number(t.cost) / t.tickets) : 0,
    },
    days: days.map((d) => ({ day: d.day, tokens: d.tokens, costUsd: usd(d.cost), calls: d.calls })),
    models: models.map((m) => ({
      model: m.model,
      tokens: m.tokens,
      costUsd: usd(m.cost),
      calls: m.calls,
    })),
    /** Uma linha por agente, na ordem da esteira; "Antes da 0.269" junta o uso sem etapa. */
    steps: [
      ...TICKET_STAGES.map((s) => ({ id: s.id as string, label: s.label, agent: s.agent })),
      { id: '', label: 'Sem etapa (antes da 0.269)', agent: '' },
    ]
      .map((s) => {
        const x = byStep.get(s.id);
        return {
          ...s,
          tokens: x?.tokens ?? 0,
          costUsd: usd(x?.cost ?? 0),
          calls: x?.calls ?? 0,
        };
      })
      .filter((s) => s.calls > 0 || s.id !== ''),
    tickets: tickets.map((x) => ({
      ref: x.ref,
      id: x.id,
      number: x.number,
      title: x.title,
      stage: x.stage,
      stageLabel: x.stage ? stageInfo(x.stage).label : null,
      tokens: x.tokens,
      costUsd: usd(x.cost),
      calls: x.calls,
      lastAt: x.lastAt,
    })),
    /** Quanto saiu de cada chave: a do sistema ('owner') ou a dos restaurantes ('clients'). */
    keys: keys.map((k) => ({ key: k.key, tokens: k.tokens, costUsd: usd(k.cost), calls: k.calls })),
    recent: recent.map((x) => ({
      id: x.id,
      ref: x.ref,
      step: x.step,
      stepLabel: x.step ? stageInfo(x.step).label : null,
      agent: x.step ? stageInfo(x.step).agent : null,
      model: x.model,
      key: x.key,
      tokens: x.tokens,
      costUsd: usd(x.cost),
      at: x.at,
    })),
  };
}
