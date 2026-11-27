import { one } from '../common/sql';
import type { Tx } from '../database/database.service';
import type { Usage } from './openrouter';

/** Início do mês no relógio de Brasília. */
export const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;

/** O que app_ai_config() devolve para o restaurante da transação. */
export interface AiConfig {
  enabled: boolean;
  tenant_enabled: boolean;
  model: string;
  assistant_name: string;
  api_key_enc: Buffer | null;
  /** Limite do mês já resolvido (0 = sem limite). */
  monthly_tokens: number;
  /** Tokens extras doados pelo Super Admin (gastos só depois do limite do mês). */
  bonus_tokens: number;
  /** Botão "Melhorar a foto" dos itens do cardápio (Super Admin › Tokens). */
  photo_ai_enabled: boolean;
  /** Modelo que olha a foto (o mais barato que lê imagem). */
  vision_model: string;
  /** Modelo que edita a foto (fundo limpo), pela API de imagens. */
  image_model: string;
  /** Modelo que lê o cardápio (PDF, foto, link, texto) e acha o restaurante no Google. */
  import_model: string;
  /** Modelo do atendimento no WhatsApp (só o Super Admin troca, em Tokens de IA). */
  whatsapp_model: string;
}

export interface AiQuota {
  config: AiConfig;
  /** Tokens usados no mês (todas as fontes: chat da equipe, WhatsApp...). */
  used: number;
  /** Quanto ainda dá para usar (limite que sobra + extras); null = sem limite. */
  available: number | null;
  /** Acabou o limite do mês e os extras. */
  blocked: boolean;
}

/** Cota de um restaurante em um número: limite que sobra no mês + extras (null = sem limite). */
export function availableTokens(limit: number, used: number, bonus: number): number | null {
  if (limit <= 0) return null;
  return Math.max(0, limit - used) + Math.max(0, bonus);
}

/**
 * Configuração e cota da IA do restaurante da transação. Chame dentro de db.withCentral.
 * Todo uso de IA de um restaurante (chat, WhatsApp...) confere aqui antes de chamar o modelo.
 */
export async function loadAiQuota(tx: Tx): Promise<AiQuota> {
  const c = await one<AiConfig>(tx, `SELECT * FROM app_ai_config()`);
  const u = await one<{ n: number }>(
    tx,
    `SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint::float8 AS n
       FROM ai_usage WHERE created_at >= ${MONTH_START}`,
  );
  const config = { ...c!, bonus_tokens: Number(c!.bonus_tokens) };
  const used = u!.n;
  const available = availableTokens(config.monthly_tokens, used, config.bonus_tokens);
  return { config, used, available, blocked: available !== null && available <= 0 };
}

/**
 * Grava o uso de uma resposta (tokens e custo do OpenRouter) no banco central. O que passar do
 * limite do mês sai dos tokens extras, numa transação só. Chame dentro de db.withCentral.
 */
export async function recordAiUsage(
  tx: Tx,
  p: { userId: string | null; model: string; usage: Usage; source: 'chat' | 'whatsapp' | string },
) {
  const r = await one<{ used_month: string; bonus_left: string; bonus_used: string }>(
    tx,
    `SELECT * FROM app_ai_record_usage($1, $2, $3, $4, $5, $6)`,
    [p.userId, p.model, p.usage.promptTokens, p.usage.completionTokens, p.usage.costUsd, p.source],
  );
  return {
    usedMonth: Number(r!.used_month),
    bonusLeft: Number(r!.bonus_left),
    bonusUsed: Number(r!.bonus_used),
  };
}
