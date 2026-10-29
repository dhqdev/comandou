import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { AI_KEY_CONTEXT } from '../chat/ai.service';
import { listModels, ModelInfo, OpenRouterClient } from '../chat/openrouter';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import type { Actor } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';

export const AiSettingsBody = z.object({
  enabled: z.boolean(),
  /** Vazio mantém a chave salva. */
  apiKey: z.string().trim().max(300).optional(),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: google/gemini-2.5-flash-lite)'),
  assistantName: z.string().trim().min(1).max(30),
  defaultMonthlyTokens: z.number().int().min(0).max(1_000_000_000),
  lowBalanceUsd: z.number().min(0).max(100_000),
});
export type AiSettingsInput = z.infer<typeof AiSettingsBody>;

export const TenantAiBody = z.object({
  enabled: z.boolean(),
  /** null = usa o padrão; 0 = sem limite. */
  monthlyTokens: z.number().int().min(0).max(1_000_000_000).nullable(),
});

interface Row {
  enabled: boolean;
  api_key_enc: Buffer | null;
  model: string;
  assistant_name: string;
  default_monthly_tokens: number;
  low_balance_usd: string;
  updated_at: Date;
}

const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;

/**
 * Assistente de IA no painel Super Admin: chave do OpenRouter (cifrada, nunca volta para o
 * navegador), modelo, limite padrão por restaurante, saldo da conta e o consumo de cada cliente.
 */
@Injectable()
export class PlatformAiService {
  private accountCache: { at: number; value: unknown } | null = null;
  private modelsCache: { at: number; value: ModelInfo[] } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private async row(): Promise<Row> {
    const [r] = await this.db.query<Row>(`SELECT * FROM platform_ai_settings WHERE id`);
    return r!;
  }

  private key(r: Row): string | null {
    if (!r.api_key_enc || !this.env.INTEGRATIONS_KEY) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, r.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      return null;
    }
  }

  private async account(r: Row, fresh = false) {
    const key = this.key(r);
    if (!key) return null;
    if (!fresh && this.accountCache && Date.now() - this.accountCache.at < 60_000)
      return this.accountCache.value as Awaited<ReturnType<OpenRouterClient['account']>>;
    const value = await new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key).account();
    if (!value.error || value.remainingUsd !== null) this.accountCache = { at: Date.now(), value };
    return value;
  }

  /** Tudo da tela: configuração, saldo do OpenRouter, consumo do mês e por restaurante. */
  async overview(fresh = false) {
    const r = await this.row();
    // Preço do modelo: só o que já estiver em cache (a lista completa vem em /models).
    if (!this.modelsCache) void this.models().catch(() => undefined);
    const models = this.modelsCache?.value ?? [];
    const [account, tenants, month, days] = await Promise.all([
      this.account(r, fresh).catch((e: Error) => ({ error: e.message }) as never),
      this.db.query<{
        id: string;
        name: string;
        slug: string;
        status: string;
        enabled: boolean | null;
        override: number | null;
        tokens: number;
        prompt: number;
        completion: number;
        cost: string;
        calls: number;
        users: number;
        lastAt: Date | null;
        totalTokens: number;
      }>(
        `SELECT t.id, t.name, t.slug, t.status, s.enabled, s.monthly_tokens AS override,
                coalesce(m.tokens, 0)::int AS tokens, coalesce(m.prompt, 0)::int AS prompt,
                coalesce(m.completion, 0)::int AS completion, coalesce(m.cost, 0) AS cost,
                coalesce(m.calls, 0)::int AS calls, coalesce(m.users, 0)::int AS users,
                a.last_at AS "lastAt", coalesce(a.total, 0)::bigint::float8 AS "totalTokens"
           FROM tenants t
           LEFT JOIN tenant_ai_settings s ON s.tenant_id = t.id
           LEFT JOIN (
             SELECT tenant_id, sum(prompt_tokens + completion_tokens) AS tokens,
                    sum(prompt_tokens) AS prompt, sum(completion_tokens) AS completion,
                    sum(cost_usd) AS cost, count(*) AS calls, count(DISTINCT user_id) AS users
               FROM ai_usage WHERE created_at >= ${MONTH_START} GROUP BY tenant_id) m
             ON m.tenant_id = t.id
           LEFT JOIN (
             SELECT tenant_id, max(created_at) AS last_at, sum(prompt_tokens + completion_tokens) AS total
               FROM ai_usage GROUP BY tenant_id) a ON a.tenant_id = t.id
          WHERE t.status <> 'deleting'
          ORDER BY coalesce(m.tokens, 0) DESC, t.name`,
      ),
      this.db.query<{ tokens: number; cost: string; calls: number }>(
        `SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint::float8 AS tokens,
                coalesce(sum(cost_usd), 0) AS cost, count(*)::int AS calls
           FROM ai_usage WHERE created_at >= ${MONTH_START}`,
      ),
      this.db.query<{ day: string; tokens: number; cost: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint::float8 AS tokens,
                coalesce(sum(u.cost_usd), 0) AS cost
           FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 29,
                                (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day') d
           LEFT JOIN ai_usage u ON (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d
          GROUP BY d ORDER BY d`,
      ),
    ]);
    const price = models.find((m) => m.id === r.model) ?? null;
    return {
      settings: {
        enabled: r.enabled,
        hasApiKey: !!r.api_key_enc,
        keyReadable: !!this.key(r),
        keyConfigured: !!this.env.INTEGRATIONS_KEY,
        model: r.model,
        modelPrice: price,
        assistantName: r.assistant_name,
        defaultMonthlyTokens: r.default_monthly_tokens,
        lowBalanceUsd: Number(r.low_balance_usd),
        updatedAt: r.updated_at,
      },
      account,
      month: {
        tokens: month[0]!.tokens,
        costUsd: Number(month[0]!.cost),
        calls: month[0]!.calls,
      },
      days: days.map((d) => ({ day: d.day, tokens: d.tokens, costUsd: Number(d.cost) })),
      tenants: tenants.map((t) => {
        const limit = t.override ?? r.default_monthly_tokens;
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          enabled: t.enabled ?? true,
          override: t.override,
          limit,
          tokens: t.tokens,
          promptTokens: t.prompt,
          completionTokens: t.completion,
          costUsd: Number(t.cost),
          calls: t.calls,
          users: t.users,
          percent: limit > 0 ? Math.round((t.tokens / limit) * 1000) / 10 : null,
          lastAt: t.lastAt,
          totalTokens: t.totalTokens,
        };
      }),
    };
  }

  async save(b: AiSettingsInput, a: Actor) {
    const current = await this.row();
    let enc = current.api_key_enc;
    if (b.apiKey) {
      if (!this.env.INTEGRATIONS_KEY)
        throw new UnprocessableEntityException(
          'Servidor sem INTEGRATIONS_KEY: não é possível guardar a chave com segurança',
        );
      enc = seal(this.env.INTEGRATIONS_KEY, b.apiKey, AI_KEY_CONTEXT);
      this.accountCache = null;
    }
    if (b.enabled && !enc) throw new UnprocessableEntityException('Informe a chave do OpenRouter');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_ai_settings SET enabled = $1, api_key_enc = $2, model = $3,
                assistant_name = $4, default_monthly_tokens = $5, low_balance_usd = $6,
                updated_at = now(), updated_by = $7
          WHERE id`,
        [
          b.enabled,
          enc,
          b.model,
          b.assistantName,
          b.defaultMonthlyTokens,
          b.lowBalanceUsd,
          a.admin.id,
        ],
      );
      const { apiKey: _k, ...safe } = b;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.ai_settings_updated',
        entity: 'ai',
        data: { ...safe, apiKeyChanged: !!b.apiKey },
        ip: a.ip,
      });
    });
    return this.overview();
  }

  async saveTenant(tenantId: string, b: z.infer<typeof TenantAiBody>, a: Actor) {
    await this.db.tx(async (c) => {
      const t = await c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
      if (!t.rowCount) throw new UnprocessableEntityException('Restaurante não encontrado');
      await c.query(
        `INSERT INTO tenant_ai_settings (tenant_id, enabled, monthly_tokens, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (tenant_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, monthly_tokens = EXCLUDED.monthly_tokens, updated_at = now()`,
        [tenantId, b.enabled, b.monthlyTokens],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.ai_tenant_updated',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: b,
        ip: a.ip,
      });
    });
    return { ok: true };
  }

  /** Testa a chave (a do formulário ou a salva) com uma pergunta curtinha. */
  async test(apiKey: string | undefined, model: string) {
    const r = await this.row();
    const key = apiKey || this.key(r);
    if (!key) throw new UnprocessableEntityException('Informe a chave do OpenRouter');
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key);
    const started = Date.now();
    try {
      const out = await client.stream(
        model,
        [{ role: 'user', content: 'Responda só: "Olá! Estou pronto para ajudar."' }],
        () => undefined,
        { maxTokens: 30 },
      );
      return {
        ok: true,
        reply: out.text.trim().slice(0, 200),
        ms: Date.now() - started,
        usage: out.usage,
        account: await client.account(),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message, ms: Date.now() - started };
    }
  }

  /** Modelos do OpenRouter do mais barato ao mais caro (cache de 1 hora). */
  async models(): Promise<ModelInfo[]> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < 3_600_000) return this.modelsCache.value;
    const value = await listModels(this.env.OPENROUTER_BASE_URL);
    this.modelsCache = { at: Date.now(), value };
    return value;
  }
}
