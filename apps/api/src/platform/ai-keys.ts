import type { Usage } from '../chat/openrouter';
import { open } from '../common/secret-box';
import type { PlatformDb } from './platform-db.service';

/** Contexto do secret-box da chave dos restaurantes (a mesma que a API do restaurante abre). */
export const CLIENT_KEY_CONTEXT = 'ai:openrouter';
/** Contexto da chave do dono (sistema e esteira); nunca sai do banco central. */
export const OWNER_KEY_CONTEXT = 'ai:openrouter:owner';

export type KeyKind = 'owner' | 'clients';

export interface KeyRow {
  api_key_enc: Buffer | null;
  owner_api_key_enc: Buffer | null;
}

/** Abre uma das chaves; null se não tem, ou se a INTEGRATIONS_KEY mudou. */
export function openKey(secret: string | undefined, r: KeyRow, kind: KeyKind): string | null {
  const enc = kind === 'owner' ? r.owner_api_key_enc : r.api_key_enc;
  if (!enc || !secret) return null;
  try {
    return open(secret, enc, kind === 'owner' ? OWNER_KEY_CONTEXT : CLIENT_KEY_CONTEXT);
  } catch {
    return null;
  }
}

/**
 * Chave que o próprio sistema usa (esteira de chamados, testes do painel): a do dono; sem ela,
 * a dos restaurantes. Devolve também qual foi usada, para o registro de uso.
 */
export function systemKey(
  secret: string | undefined,
  r: KeyRow,
): { key: string; kind: KeyKind } | null {
  const own = openKey(secret, r, 'owner');
  if (own) return { key: own, kind: 'owner' };
  const cli = openKey(secret, r, 'clients');
  return cli ? { key: cli, kind: 'clients' } : null;
}

/** Registra uma chamada feita pelo próprio sistema (esteira, teste) no extrato do Super Admin. */
export async function recordSystemUsage(
  db: PlatformDb,
  p: { source: string; ref?: string | null; model: string; usage: Usage; adminId?: string | null },
) {
  await db.query(
    `INSERT INTO platform_ai_usage (source, ref, model, prompt_tokens, completion_tokens, cost_usd, admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      p.source,
      p.ref ?? null,
      p.model,
      p.usage.promptTokens,
      p.usage.completionTokens,
      p.usage.costUsd,
      p.adminId ?? null,
    ],
  );
}
