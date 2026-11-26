import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { MONTH_START } from '../chat/ai-quota';
import { listModels, ModelInfo, OpenRouterClient } from '../chat/openrouter';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import {
  ADMIN_KEY_CONTEXT,
  CLIENT_KEY_CONTEXT,
  KeyKind,
  OWNER_KEY_CONTEXT,
  openKey,
  recordSystemUsage,
} from './ai-keys';
import type { Actor } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';

export const AiSettingsBody = z.object({
  enabled: z.boolean(),
  /** Chave dos restaurantes. Vazio mantém a salva. */
  apiKey: z.string().trim().max(300).optional(),
  /** Sua chave (sistema e esteira). Vazio mantém a salva. */
  ownerApiKey: z.string().trim().max(300).optional(),
  /** Apaga a sua chave (o sistema volta a usar a dos restaurantes). */
  clearOwnerKey: z.boolean().optional(),
  /** Chave de gerenciamento (só para ler o saldo da conta). Vazio mantém a salva. */
  adminApiKey: z.string().trim().max(300).optional(),
  clearAdminKey: z.boolean().optional(),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: google/gemini-2.5-flash-lite)'),
  assistantName: z.string().trim().min(1).max(30),
  defaultMonthlyTokens: z.number().int().min(0).max(1_000_000_000),
  lowBalanceUsd: z.number().min(0).max(100_000),
  /** Botão "Melhorar a foto" dos itens do cardápio. Sem o campo, mantém. */
  photoAiEnabled: z.boolean().optional(),
  /** "Fazer o 3D pela foto" dos itens do cardápio. Sem o campo, mantém. */
  model3dAiEnabled: z.boolean().optional(),
  /** Modelo que olha a foto do item (o mais barato que lê imagem). */
  visionModel: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: google/gemini-2.5-flash-lite)')
    .optional(),
  /** Modelo que edita a foto (fundo limpo), pela API de imagens do OpenRouter. */
  imageModel: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: openai/gpt-image-2)')
    .optional(),
});
export type AiSettingsInput = z.infer<typeof AiSettingsBody>;

export const TenantAiBody = z.object({
  enabled: z.boolean(),
  /** null = usa o padrão; 0 = sem limite. */
  monthlyTokens: z.number().int().min(0).max(1_000_000_000).nullable(),
});

/** Doar (positivo) ou retirar (negativo) tokens extras de um restaurante. Só o Super Admin. */
export const TokenGrantBody = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((n) => n !== 0, 'Informe quantos tokens'),
  note: z.string().trim().max(200).optional(),
});

export const AiTestBody = z.object({
  apiKey: z.string().trim().max(300).optional(),
  /** Qual chave salva testar quando apiKey vem vazio. */
  key: z.enum(['owner', 'clients', 'admin']).default('clients'),
  model: AiSettingsBody.shape.model,
});

interface Row {
  enabled: boolean;
  api_key_enc: Buffer | null;
  owner_api_key_enc: Buffer | null;
  admin_api_key_enc: Buffer | null;
  model: string;
  assistant_name: string;
  default_monthly_tokens: number;
  low_balance_usd: string;
  photo_ai_enabled: boolean;
  model3d_ai_enabled: boolean;
  vision_model: string;
  image_model: string;
  updated_at: Date;
}

type Account = Awaited<ReturnType<OpenRouterClient['account']>>;

/** Saldo mostrado no topo da aba Tokens e de onde ele veio. */
interface Credits {
  totalUsd: number | null;
  usedUsd: number | null;
  remainingUsd: number | null;
  /** conta = créditos da conta; clients/owner = o que sobra no limite daquela chave. */
  from: 'conta' | 'clients' | 'owner' | null;
  error: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  chat: 'Chat da equipe',
  whatsapp: 'WhatsApp',
  esteira: 'Esteira de chamados',
  teste: 'Teste no painel',
  menu_import: 'Importar cardápio',
  menu_photo: 'Foto do cardápio',
  menu_place: 'Busca no Google Maps',
  agent_test: 'Teste do assistente do WhatsApp',
  site_page: 'Página do restaurante',
  site_ia: 'Sites com IA (comandou.com)',
  photo_tune: 'Melhorar a foto do item',
  photo_clean: 'Foto do item com fundo limpo',
  photo_create: 'Foto do item criada pela IA',
  menu_model: 'Item em 3D pela foto',
};

/**
 * Aba Tokens do Super Admin: as duas chaves do OpenRouter (a sua, para o sistema e a esteira, e
 * a dos restaurantes), cifradas e que nunca voltam para o navegador; modelo; limite do mês de
 * cada restaurante e os tokens extras que só o Super Admin doa; extrato de uso e o inventário de
 * todas as outras chaves do sistema.
 */
@Injectable()
export class PlatformAiService {
  private modelsCache: { at: number; value: ModelInfo[] } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private async row(): Promise<Row> {
    const [r] = await this.db.query<Row>(`SELECT * FROM platform_ai_settings WHERE id`);
    return r!;
  }

  private key(r: Row, kind: KeyKind = 'clients'): string | null {
    return openKey(this.env.INTEGRATIONS_KEY, r, kind);
  }

  /** A chave de gerenciamento aberta; null se não tem, ou se a INTEGRATIONS_KEY mudou. */
  private adminKey(r: Row): string | null {
    if (!r.admin_api_key_enc || !this.env.INTEGRATIONS_KEY) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, r.admin_api_key_enc, ADMIN_KEY_CONTEXT);
    } catch {
      return null;
    }
  }

  private accounts: Partial<Record<KeyKind, { at: number; value: Account }>> = {};
  private creditsCache: { at: number; value: Credits } | null = null;

  /**
   * Saldo da conta no OpenRouter. Com a chave de gerenciamento: créditos comprados menos os
   * gastos (o saldo de verdade). Sem ela, o que sobra no limite da chave dos restaurantes (ou
   * da sua); sem limite nas chaves, não dá para saber.
   */
  private async balance(
    r: Row,
    fresh: boolean,
    account: Account | null,
    ownerAccount: Account | null,
  ): Promise<Credits> {
    const key = this.adminKey(r);
    if (key) {
      const hit = this.creditsCache;
      if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.value;
      try {
        const c = await new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key).credits();
        const value: Credits = { ...c, from: 'conta', error: null };
        this.creditsCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        return {
          totalUsd: null,
          usedUsd: null,
          remainingUsd: null,
          from: null,
          error: `Chave de gerenciamento: ${(e as Error).message}`,
        };
      }
    }
    // Uma chave comum que por acaso é de gerenciamento já traz os créditos.
    const acc =
      account?.totalUsd != null ? account : ownerAccount?.totalUsd != null ? ownerAccount : null;
    if (acc)
      return {
        totalUsd: acc.totalUsd,
        usedUsd: acc.usedUsd,
        remainingUsd: acc.remainingUsd,
        from: 'conta',
        error: null,
      };
    const limited = account?.remainingUsd != null ? account : ownerAccount;
    return {
      totalUsd: limited?.keyLimitUsd ?? null,
      usedUsd: null,
      remainingUsd: limited?.remainingUsd ?? null,
      from: limited?.remainingUsd != null ? (limited === account ? 'clients' : 'owner') : null,
      error: null,
    };
  }

  /** Saldo e uso da chave no OpenRouter (cache de 1 minuto por chave). */
  private async account(r: Row, fresh = false, kind: KeyKind = 'clients'): Promise<Account | null> {
    const key = this.key(r, kind);
    if (!key) return null;
    const hit = this.accounts[kind];
    if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.value;
    const value = await new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key).account();
    if (!value.error || value.remainingUsd !== null)
      this.accounts[kind] = { at: Date.now(), value };
    return value;
  }

  /**
   * Tudo da aba Tokens: as duas chaves (saldo e uso no OpenRouter), consumo do mês, cada
   * restaurante com limite e tokens extras, o extrato de uso e as outras chaves do sistema.
   */
  async overview(fresh = false) {
    const r = await this.row();
    // Preço do modelo: só o que já estiver em cache (a lista completa vem em /models).
    if (!this.modelsCache) void this.models().catch(() => undefined);
    const models = this.modelsCache?.value ?? [];
    const accountOf = (kind: KeyKind) =>
      this.account(r, fresh, kind).catch((e: Error) => ({ error: e.message }) as Account);
    const [account, ownerAccount, tenants, month, system, days, log, grants] = await Promise.all([
      accountOf('clients'),
      accountOf('owner'),
      this.db.query<{
        id: string;
        name: string;
        slug: string;
        status: string;
        enabled: boolean | null;
        override: number | null;
        bonus: number;
        tokens: number;
        prompt: number;
        completion: number;
        bonusUsed: number;
        cost: string;
        calls: number;
        users: number;
        lastAt: Date | null;
        totalTokens: number;
        granted: number;
      }>(
        `SELECT t.id, t.name, t.slug, t.status, s.enabled, s.monthly_tokens AS override,
                  coalesce(s.bonus_tokens, 0)::float8 AS bonus,
                  coalesce(m.tokens, 0)::float8 AS tokens, coalesce(m.prompt, 0)::float8 AS prompt,
                  coalesce(m.completion, 0)::float8 AS completion,
                  coalesce(m.bonus_used, 0)::float8 AS "bonusUsed", coalesce(m.cost, 0) AS cost,
                  coalesce(m.calls, 0)::int AS calls, coalesce(m.users, 0)::int AS users,
                  a.last_at AS "lastAt", coalesce(a.total, 0)::float8 AS "totalTokens",
                  coalesce(g.granted, 0)::float8 AS granted
             FROM tenants t
             LEFT JOIN tenant_ai_settings s ON s.tenant_id = t.id
             LEFT JOIN (
               SELECT tenant_id, sum(prompt_tokens + completion_tokens) AS tokens,
                      sum(prompt_tokens) AS prompt, sum(completion_tokens) AS completion,
                      sum(bonus_tokens) AS bonus_used,
                      sum(cost_usd) AS cost, count(*) AS calls, count(DISTINCT user_id) AS users
                 FROM ai_usage WHERE created_at >= ${MONTH_START} GROUP BY tenant_id) m
               ON m.tenant_id = t.id
             LEFT JOIN (
               SELECT tenant_id, max(created_at) AS last_at, sum(prompt_tokens + completion_tokens) AS total
                 FROM ai_usage GROUP BY tenant_id) a ON a.tenant_id = t.id
             LEFT JOIN (
               SELECT tenant_id, sum(delta) FILTER (WHERE delta > 0) AS granted
                 FROM platform_ai_token_grants GROUP BY tenant_id) g ON g.tenant_id = t.id
            WHERE t.status <> 'deleting'
            ORDER BY coalesce(m.tokens, 0) DESC, t.name`,
      ),
      this.db.query<{ tokens: number; cost: string; calls: number }>(
        `SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::float8 AS tokens,
                  coalesce(sum(cost_usd), 0) AS cost, count(*)::int AS calls
             FROM ai_usage WHERE created_at >= ${MONTH_START}`,
      ),
      this.db.query<{
        source: string;
        key: string;
        tokens: number;
        cost: string;
        calls: number;
      }>(
        `SELECT source, coalesce(key_kind, 'owner') AS key,
                  coalesce(sum(prompt_tokens + completion_tokens), 0)::float8 AS tokens,
                  coalesce(sum(cost_usd), 0) AS cost, count(*)::int AS calls
             FROM platform_ai_usage WHERE created_at >= ${MONTH_START}
            GROUP BY 1, 2 ORDER BY 3 DESC`,
      ),
      this.db.query<{ day: string; tokens: number; cost: string; system: number }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                  coalesce((SELECT sum(u.prompt_tokens + u.completion_tokens) FROM ai_usage u
                             WHERE (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d), 0)::float8 AS tokens,
                  coalesce((SELECT sum(u.cost_usd) FROM ai_usage u
                             WHERE (u.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d), 0) AS cost,
                  coalesce((SELECT sum(p.prompt_tokens + p.completion_tokens) FROM platform_ai_usage p
                             WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d), 0)::float8 AS system
             FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 29,
                                  (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day') d
            ORDER BY d`,
      ),
      this.usageLog(),
      this.db.query<{
        id: string;
        tenantId: string;
        tenantName: string;
        delta: number;
        balanceAfter: number;
        note: string | null;
        adminName: string | null;
        at: Date;
      }>(
        `SELECT g.id::text, g.tenant_id AS "tenantId", t.name AS "tenantName",
                  g.delta::float8 AS delta, g.balance_after::float8 AS "balanceAfter", g.note,
                  a.name AS "adminName", g.created_at AS at
             FROM platform_ai_token_grants g
             JOIN tenants t ON t.id = g.tenant_id
             LEFT JOIN platform_admins a ON a.id = g.admin_id
            ORDER BY g.created_at DESC, g.id DESC LIMIT 30`,
      ),
    ]);
    const price = models.find((m) => m.id === r.model) ?? null;
    // Quanto o sistema gastou de cada chave (a esteira cai na dos restaurantes sem a sua).
    const byKey = { owner: 0, clients: 0, site: 0, typed: 0 } as Record<string, number>;
    for (const x of system) byKey[x.key] = (byKey[x.key] ?? 0) + Number(x.cost);
    const bySource = new Map<string, { tokens: number; costUsd: number; calls: number }>();
    for (const x of system) {
      const cur = bySource.get(x.source) ?? { tokens: 0, costUsd: 0, calls: 0 };
      bySource.set(x.source, {
        tokens: cur.tokens + x.tokens,
        costUsd: cur.costUsd + Number(x.cost),
        calls: cur.calls + x.calls,
      });
    }
    const balance = await this.balance(r, fresh, account, ownerAccount);
    const systemTotal = system.reduce(
      (acc, x) => ({
        tokens: acc.tokens + x.tokens,
        costUsd: acc.costUsd + Number(x.cost),
        calls: acc.calls + x.calls,
      }),
      { tokens: 0, costUsd: 0, calls: 0 },
    );
    const ownerReady = !!this.key(r, 'owner');
    return {
      settings: {
        enabled: r.enabled,
        hasApiKey: !!r.api_key_enc,
        keyReadable: !!this.key(r),
        hasOwnerKey: !!r.owner_api_key_enc,
        ownerKeyReadable: ownerReady,
        hasAdminKey: !!r.admin_api_key_enc,
        adminKeyReadable: !!this.adminKey(r),
        keyConfigured: !!this.env.INTEGRATIONS_KEY,
        model: r.model,
        modelPrice: price,
        assistantName: r.assistant_name,
        defaultMonthlyTokens: r.default_monthly_tokens,
        lowBalanceUsd: Number(r.low_balance_usd),
        photoAiEnabled: r.photo_ai_enabled,
        model3dAiEnabled: r.model3d_ai_enabled,
        visionModel: r.vision_model,
        imageModel: r.image_model,
        updatedAt: r.updated_at,
      },
      account,
      ownerAccount,
      balance,
      /** Qual chave o sistema (esteira, testes) está usando agora. */
      systemKey: ownerReady ? 'owner' : this.key(r) ? 'clients' : null,
      month: {
        tokens: month[0]!.tokens,
        costUsd: Number(month[0]!.cost),
        calls: month[0]!.calls,
      },
      system: {
        ...systemTotal,
        /** US$ do mês que o sistema gastou de cada chave. */
        byKey: { owner: byKey.owner!, clients: byKey.clients!, site: byKey.site! },
        bySource: [...bySource]
          .map(([source, x]) => ({ source, label: SOURCE_LABEL[source] ?? source, ...x }))
          .sort((a, b) => b.tokens - a.tokens),
      },
      days: days.map((d) => ({
        day: d.day,
        tokens: d.tokens,
        costUsd: Number(d.cost),
        system: d.system,
      })),
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
          bonus: t.bonus,
          bonusUsed: t.bonusUsed,
          granted: t.granted,
          available: limit > 0 ? Math.max(0, limit - t.tokens) + t.bonus : null,
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
      log,
      grants,
    };
  }

  /** Extrato das últimas chamadas de IA: restaurantes (chave deles) e o próprio sistema (sua). */
  async usageLog(limit = 60, tenantId?: string) {
    const rows = await this.db.query<{
      id: string;
      key: KeyKind;
      via: string;
      source: string;
      tenantId: string | null;
      tenantName: string | null;
      ref: string | null;
      model: string;
      tokens: number;
      bonus: number;
      cost: string;
      at: Date;
    }>(
      `SELECT * FROM (
         SELECT 'r' || u.id AS id, 'clients' AS key, 'clients' AS via, u.source, u.tenant_id AS "tenantId",
                t.name AS "tenantName", NULL::text AS ref, u.model,
                (u.prompt_tokens + u.completion_tokens)::float8 AS tokens,
                u.bonus_tokens::float8 AS bonus, u.cost_usd AS cost, u.created_at AS at
           FROM ai_usage u JOIN tenants t ON t.id = u.tenant_id
          WHERE ($2::uuid IS NULL OR u.tenant_id = $2)
         UNION ALL
         SELECT 's' || p.id, 'owner', coalesce(p.key_kind, 'owner'), p.source, NULL, NULL, p.ref, p.model,
                (p.prompt_tokens + p.completion_tokens)::float8, 0, p.cost_usd, p.created_at
           FROM platform_ai_usage p
          WHERE $2::uuid IS NULL
       ) x ORDER BY at DESC LIMIT $1`,
      [limit, tenantId ?? null],
    );
    return rows.map(({ cost, ...x }) => ({
      ...x,
      sourceLabel: SOURCE_LABEL[x.source] ?? x.source,
      costUsd: Number(cost),
    }));
  }

  async save(b: AiSettingsInput, a: Actor) {
    const current = await this.row();
    let enc = current.api_key_enc;
    let ownerEnc = current.owner_api_key_enc;
    let adminEnc = current.admin_api_key_enc;
    if (b.apiKey || b.ownerApiKey || b.adminApiKey) {
      if (!this.env.INTEGRATIONS_KEY)
        throw new UnprocessableEntityException(
          'Servidor sem INTEGRATIONS_KEY: não é possível guardar a chave com segurança',
        );
    }
    if (b.apiKey) {
      enc = seal(this.env.INTEGRATIONS_KEY!, b.apiKey, CLIENT_KEY_CONTEXT);
      delete this.accounts.clients;
    }
    if (b.clearOwnerKey) ownerEnc = null;
    if (b.ownerApiKey)
      ownerEnc = seal(this.env.INTEGRATIONS_KEY!, b.ownerApiKey, OWNER_KEY_CONTEXT);
    if (b.ownerApiKey || b.clearOwnerKey) delete this.accounts.owner;
    if (b.clearAdminKey) adminEnc = null;
    if (b.adminApiKey)
      adminEnc = seal(this.env.INTEGRATIONS_KEY!, b.adminApiKey, ADMIN_KEY_CONTEXT);
    if (b.adminApiKey || b.clearAdminKey) this.creditsCache = null;
    if (b.enabled && !enc)
      throw new UnprocessableEntityException('Informe a chave do OpenRouter dos restaurantes');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_ai_settings SET enabled = $1, api_key_enc = $2, model = $3,
                assistant_name = $4, default_monthly_tokens = $5, low_balance_usd = $6,
                owner_api_key_enc = $8, admin_api_key_enc = $9,
                photo_ai_enabled = $10, model3d_ai_enabled = $11, vision_model = $12,
                image_model = $13, updated_at = now(), updated_by = $7
          WHERE id`,
        [
          b.enabled,
          enc,
          b.model,
          b.assistantName,
          b.defaultMonthlyTokens,
          b.lowBalanceUsd,
          a.admin.id,
          ownerEnc,
          adminEnc,
          b.photoAiEnabled ?? current.photo_ai_enabled,
          b.model3dAiEnabled ?? current.model3d_ai_enabled,
          b.visionModel ?? current.vision_model,
          b.imageModel ?? current.image_model,
        ],
      );
      const { apiKey: _k, ownerApiKey: _o, adminApiKey: _a, ...safe } = b;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.ai_settings_updated',
        entity: 'ai',
        data: {
          ...safe,
          apiKeyChanged: !!b.apiKey,
          ownerKeyChanged: !!b.ownerApiKey,
          adminKeyChanged: !!b.adminApiKey,
        },
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

  /**
   * Doa (ou retira) tokens extras de um restaurante. Os extras não vencem e só são gastos depois
   * do limite do mês. Fica no extrato com quem fez; retirar nunca deixa o saldo negativo.
   */
  async grant(tenantId: string, b: z.infer<typeof TokenGrantBody>, a: Actor) {
    return this.db.tx(async (c) => {
      const t = await c.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
        tenantId,
      ]);
      if (!t.rowCount) throw new UnprocessableEntityException('Restaurante não encontrado');
      await c.query(
        `INSERT INTO tenant_ai_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );
      // Trava a linha: uma resposta da IA ao mesmo tempo não gasta o extra que está saindo.
      const cur = await c.query<{ bonus: string }>(
        `SELECT bonus_tokens AS bonus FROM tenant_ai_settings WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId],
      );
      const before = Number(cur.rows[0]!.bonus);
      const delta = b.delta < 0 ? -Math.min(before, -b.delta) : b.delta;
      if (delta === 0)
        throw new UnprocessableEntityException(
          'Este restaurante não tem tokens extras para retirar',
        );
      const after = before + delta;
      await c.query(
        `UPDATE tenant_ai_settings SET bonus_tokens = $2, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, after],
      );
      await c.query(
        `INSERT INTO platform_ai_token_grants (tenant_id, delta, balance_after, note, admin_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, delta, after, b.note || null, a.admin.id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: delta > 0 ? 'platform.ai_tokens_granted' : 'platform.ai_tokens_removed',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { delta, balanceAfter: after, note: b.note || null },
        ip: a.ip,
      });
      return { ok: true, bonus: after, delta, tenantName: t.rows[0]!.name };
    });
  }

  /** Extrato de um restaurante: últimas chamadas e as doações/retiradas de tokens. */
  async tenantHistory(tenantId: string) {
    const [usage, grants] = await Promise.all([
      this.usageLog(50, tenantId),
      this.db.query(
        `SELECT g.id::text, g.delta::float8 AS delta, g.balance_after::float8 AS "balanceAfter",
                g.note, a.name AS "adminName", g.created_at AS at
           FROM platform_ai_token_grants g
           LEFT JOIN platform_admins a ON a.id = g.admin_id
          WHERE g.tenant_id = $1 ORDER BY g.created_at DESC, g.id DESC LIMIT 50`,
        [tenantId],
      ),
    ]);
    return { usage, grants };
  }

  /**
   * Testa uma chave (a digitada ou uma das salvas) com uma pergunta curtinha. O teste com
   * uma chave salva entra no extrato do sistema.
   */
  /**
   * Confere uma chave salva sem gastar nada: a comum lê os dados dela (/key) e a de
   * gerenciamento lê o saldo da conta (/credits). Usado em Credenciais › Conferir todas.
   */
  async checkKey(kind: KeyKind | 'admin'): Promise<{ ok: boolean; detail: string }> {
    const r = await this.row();
    const key = kind === 'admin' ? this.adminKey(r) : this.key(r, kind);
    if (!key) return { ok: false, detail: 'A chave salva não abre: cole de novo' };
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key);
    const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;
    try {
      if (kind === 'admin') {
        const c = await client.credits();
        return {
          ok: true,
          detail: c.remainingUsd == null ? 'saldo lido' : `saldo da conta ${usd(c.remainingUsd)}`,
        };
      }
      const k = await client.keyInfo();
      return {
        ok: true,
        detail: [
          k.label && `chave “${k.label}”`,
          k.limitUsd == null
            ? 'sem limite de gasto'
            : `sobra ${usd(k.remainingUsd ?? 0)} de ${usd(k.limitUsd)}`,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async test(b: z.infer<typeof AiTestBody>, a?: Actor) {
    const r = await this.row();
    const key = b.apiKey || (b.key === 'admin' ? this.adminKey(r) : this.key(r, b.key));
    if (!key) throw new UnprocessableEntityException('Informe a chave do OpenRouter');
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key);
    const started = Date.now();
    // A chave de gerenciamento não conversa com a IA: o teste é ler o saldo da conta.
    if (b.key === 'admin') {
      try {
        const credits = await client.credits();
        return { ok: true, ms: Date.now() - started, credits };
      } catch (e) {
        return { ok: false, error: (e as Error).message, ms: Date.now() - started };
      }
    }
    try {
      const out = await client.stream(
        b.model,
        [{ role: 'user', content: 'Responda só: "Olá! Estou pronto para ajudar."' }],
        () => undefined,
        { maxTokens: 30 },
      );
      await recordSystemUsage(this.db, {
        source: 'teste',
        ref: b.apiKey
          ? 'chave digitada'
          : b.key === 'owner'
            ? 'sua chave'
            : 'chave dos restaurantes',
        model: b.model,
        usage: out.usage,
        adminId: a?.admin.id,
        key: b.apiKey ? 'typed' : b.key,
      }).catch(() => undefined);
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
    if (this.modelsCache && Date.now() - this.modelsCache.at < 3_600_000)
      return this.modelsCache.value;
    const value = await listModels(this.env.OPENROUTER_BASE_URL);
    this.modelsCache = { at: Date.now(), value };
    return value;
  }
}
