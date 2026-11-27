import type { Usage } from '../../chat/openrouter';
import type { Env } from '../../config/env';
import { type KeyKind, type KeyRow, recordSystemUsage, systemKey } from '../ai-keys';
import type { PlatformDb } from '../platform-db.service';

/**
 * Criação do restaurante pelo site (comandou.com), paga pela chave do sistema ("OpenRouter ·
 * chave do sistema (esteira)", pedido do David na 0.275: "isso tudo é gasto meu"). Vale para o
 * que a IA faz antes do cadastro (montar o site, ler o cardápio enviado, sugerir o estoque) e
 * para os primeiros passos do restaurante criado, nos primeiros dias e até o limite de Super
 * Admin › Site › Site com IA. Cada chamada fica em `platform_ai_usage` com a etapa, ligada ao
 * rascunho (`generation_id`) ou ao restaurante (`tenant_id`): a aba Criação do restaurante soma.
 */

/** Fonte das chamadas da criação no extrato do sistema (o "montar o site" segue em site_ia). */
export const CREATION_SOURCE = 'criacao';
/** Fonte antiga do site com IA, mantida para o extrato da aba Tokens. */
export const SITE_SOURCE = 'site_ia';
/** Por quantos dias os primeiros passos do restaurante do site saem da chave do sistema. */
export const FIRST_STEPS_DAYS = 7;

/** Etapas da criação, na ordem em que acontecem, com o nome que a aba mostra. */
export const CREATION_STEPS = [
  { key: 'conversa', label: 'Ler o texto e os links', where: 'site' },
  { key: 'anexo', label: 'Ler fotos e PDFs anexados', where: 'site' },
  { key: 'site', label: 'Montar o site', where: 'site' },
  { key: 'cardapio', label: 'Ler o cardápio enviado', where: 'site' },
  { key: 'estoque', label: 'Sugerir o estoque', where: 'site' },
  { key: 'arquivo', label: 'Ler foto ou PDF do cardápio', where: 'sistema' },
  { key: 'link', label: 'Ler o link do cardápio', where: 'sistema' },
  { key: 'texto', label: 'Ler os itens escritos', where: 'sistema' },
  { key: 'maps', label: 'Achar no Google Maps', where: 'sistema' },
  { key: 'fotos', label: 'Fotos dos itens', where: 'sistema' },
] as const;
export type CreationStep = (typeof CREATION_STEPS)[number]['key'];
/** Etapas dos primeiros passos (dentro do sistema, depois do cadastro). */
export type FirstStep = Extract<CreationStep, 'arquivo' | 'link' | 'texto' | 'maps' | 'fotos'>;

/** A chave da criação: a do sistema; sem ela, a dos restaurantes (a aba avisa). */
export async function creationKey(
  env: Env,
  db: PlatformDb,
): Promise<{ key: string; kind: KeyKind } | null> {
  if (!env.INTEGRATIONS_KEY || !db.enabled) return null;
  const [k] = await db.query<KeyRow>(
    `SELECT api_key_enc, owner_api_key_enc FROM platform_ai_settings WHERE id`,
  );
  return k ? systemKey(env.INTEGRATIONS_KEY, k) : null;
}

/** Grava uma chamada da criação no extrato do sistema, com a etapa e a quem pertence. */
export function recordCreation(
  db: PlatformDb,
  p: {
    step: CreationStep;
    model: string;
    usage: Usage;
    key: KeyKind;
    tenantId?: string | null;
    generationId?: string | null;
    ref?: string | null;
  },
) {
  return recordSystemUsage(db, {
    source: p.step === 'site' ? SITE_SOURCE : CREATION_SOURCE,
    ref: p.ref ?? null,
    model: p.model,
    usage: p.usage,
    key: p.key,
    step: p.step,
    tenantId: p.tenantId ?? null,
    generationId: p.generationId ?? null,
  });
}

/**
 * Quanto os primeiros passos deste restaurante ainda podem gastar da chave do sistema. null =
 * não vale (não veio do site, passou dos dias, limite zerado ou acabou): gasta do limite dele.
 */
export async function firstStepsLeft(db: PlatformDb, tenantId: string): Promise<number | null> {
  if (!db.enabled) return null;
  const [r] = await db.query<{ budget: string; used: string }>(
    `SELECT a.first_steps_tokens::text AS budget,
            (SELECT coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)
               FROM platform_ai_usage u
              WHERE u.tenant_id = s.tenant_id AND u.source = $3)::text AS used
       FROM trial_signups s CROSS JOIN platform_site_ai_settings a
      WHERE s.tenant_id = $1 AND a.id AND s.created_at > now() - make_interval(days => $2)`,
    [tenantId, FIRST_STEPS_DAYS, CREATION_SOURCE],
  );
  if (!r) return null;
  const left = Number(r.budget) - Number(r.used);
  return left > 0 ? left : null;
}

const STEP_INFO = new Map<string, (typeof CREATION_STEPS)[number]>(
  CREATION_STEPS.map((s) => [s.key, s]),
);

/**
 * A aba Criação do restaurante: quanto a IA gastou em cada etapa, desde o site (inclusive os
 * "Refazer" da mesma visita) até os primeiros passos. null = o restaurante não veio do site.
 */
export async function creationReport(db: PlatformDb, tenantId: string) {
  const [trial] = await db.query<{
    createdAt: Date;
    sourceKind: string;
    sourceValue: string;
    session: string | null;
    budget: string;
  }>(
    `SELECT s.created_at AS "createdAt", s.source_kind AS "sourceKind",
            s.source_value AS "sourceValue", s.site_session AS session,
            a.first_steps_tokens::text AS budget
       FROM trial_signups s CROSS JOIN platform_site_ai_settings a
      WHERE s.tenant_id = $1 AND a.id`,
    [tenantId],
  );
  if (!trial) return null;
  // Rascunhos desta criação: os ligados ao restaurante e os da mesma visita ao site.
  const rows = await db.query<{
    id: string;
    step: string | null;
    source: string;
    model: string;
    tokens: number;
    costUsd: number;
    key: string | null;
    ref: string | null;
    createdAt: Date;
  }>(
    `WITH gens AS (
       SELECT id FROM site_ai_generations
        WHERE tenant_id = $1 OR ($2::text IS NOT NULL AND session = $2 AND tenant_id IS NULL)
     )
     SELECT u.id::text, u.step, u.source, u.model,
            (u.prompt_tokens + u.completion_tokens)::int AS tokens, u.cost_usd::float8 AS "costUsd",
            u.key_kind AS key, u.ref, u.created_at AS "createdAt"
       FROM platform_ai_usage u
      WHERE u.source IN ($3, $4)
        AND (u.tenant_id = $1 OR u.generation_id IN (SELECT id FROM gens))
      ORDER BY u.created_at`,
    [tenantId, trial.session, CREATION_SOURCE, SITE_SOURCE],
  );
  const steps = new Map<
    string,
    { calls: number; tokens: number; costUsd: number; models: Set<string>; lastAt: Date }
  >();
  for (const r of rows) {
    const k =
      r.step && STEP_INFO.has(r.step) ? r.step : r.source === SITE_SOURCE ? 'site' : 'outro';
    const s = steps.get(k) ?? {
      calls: 0,
      tokens: 0,
      costUsd: 0,
      models: new Set<string>(),
      lastAt: r.createdAt,
    };
    s.calls++;
    s.tokens += r.tokens;
    s.costUsd += r.costUsd;
    s.models.add(r.model);
    s.lastAt = r.createdAt;
    steps.set(k, s);
  }
  const order = [...CREATION_STEPS.map((s) => s.key as string), 'outro'];
  const budget = Number(trial.budget);
  const usedFirst = rows
    .filter((r) => r.source === CREATION_SOURCE && STEP_INFO.get(r.step ?? '')?.where === 'sistema')
    .reduce((n, r) => n + r.tokens, 0);
  const until = new Date(trial.createdAt.getTime() + FIRST_STEPS_DAYS * 86_400_000);
  return {
    createdAt: trial.createdAt,
    sourceKind: trial.sourceKind,
    sourceValue: trial.sourceValue,
    total: {
      calls: rows.length,
      tokens: rows.reduce((n, r) => n + r.tokens, 0),
      costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    },
    steps: order
      .filter((k) => steps.has(k))
      .map((k) => {
        const s = steps.get(k)!;
        const info = STEP_INFO.get(k);
        return {
          step: k,
          label: info?.label ?? 'Outras chamadas',
          where: info?.where ?? 'sistema',
          calls: s.calls,
          tokens: s.tokens,
          costUsd: s.costUsd,
          models: [...s.models],
          lastAt: s.lastAt,
        };
      }),
    /** Primeiros passos pela chave do sistema: limite, usado e até quando vale. */
    firstSteps: {
      budget,
      used: usedFirst,
      until,
      open: budget > 0 && usedFirst < budget && until.getTime() > Date.now(),
    },
    /** Alguma chamada saiu da chave dos restaurantes (a do sistema não estava cadastrada). */
    clientsKey: rows.some((r) => r.key === 'clients'),
    calls: rows
      .slice(-80)
      .reverse()
      .map((r) => ({
        id: r.id,
        step: r.step ?? (r.source === SITE_SOURCE ? 'site' : null),
        label:
          STEP_INFO.get(r.step ?? (r.source === SITE_SOURCE ? 'site' : ''))?.label ??
          'Outra chamada',
        model: r.model,
        tokens: r.tokens,
        costUsd: r.costUsd,
        key: r.key,
        ref: r.ref,
        createdAt: r.createdAt,
      })),
  };
}
