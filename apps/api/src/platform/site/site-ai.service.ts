import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { MONTH_START } from '../../chat/ai-quota';
import { OpenRouterClient, OpenRouterError } from '../../chat/openrouter';
import { decodeEntities, extractPage, pageForModel } from '../../chat/store-import';
import { mapsPlaceName } from '../../common/maps-link';
import { safeFetch, SafeFetchError } from '../../common/safe-fetch';
import { open, seal } from '../../common/secret-box';
import { ENV, Env } from '../../config/env';
import { type KeyRow, recordSystemUsage, systemKey } from '../ai-keys';
import { PlatformDb, platformAudit } from '../platform-db.service';
import type { Actor } from '../platform.service';
import {
  draftItems,
  placeForModel,
  publicDraft,
  readSiteDraft,
  SITE_PROMPT,
  type SiteAiKind,
} from './site-ai';

const KEY_CONTEXT = 'ai:openrouter:site';
/** O rascunho pode ser levado para o cadastro por este tempo depois de gerado. */
const CLAIM_HOURS = 3;

export const SiteAiSettingsBody = z.object({
  enabled: z.boolean(),
  /** Ausente: mantém; vazio: apaga (volta a usar a sua chave); texto: troca. */
  apiKey: z.string().trim().max(300).optional(),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: google/gemini-2.5-flash)'),
  maxTokensPerSite: z.number().int().min(500).max(32_000),
  dailyTokens: z.number().int().min(0).max(1_000_000_000),
  monthlyTokens: z.number().int().min(0).max(10_000_000_000),
  perIpDaily: z.number().int().min(1).max(100),
});
export type SiteAiSettingsInput = z.infer<typeof SiteAiSettingsBody>;

export const SiteAiSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('site'), value: z.string().trim().min(4).max(2000) }),
  z.object({ kind: z.literal('maps'), value: z.string().trim().min(8).max(2000) }),
  z.object({ kind: z.literal('text'), value: z.string().trim().min(10).max(6000) }),
]);
export type SiteAiSourceInput = z.infer<typeof SiteAiSource>;

interface SettingsRow {
  enabled: boolean;
  api_key_enc: Buffer | null;
  model: string;
  max_tokens_per_site: number;
  daily_tokens: string;
  monthly_tokens: string;
  per_ip_daily: number;
  updated_at: Date;
}

/** Por que o site com IA está desligado agora (null = ligado). */
export type SiteAiOff = 'disabled' | 'no_key' | 'daily' | 'monthly' | null;

const hash = (token: string) => createHash('sha256').update(token).digest();

/**
 * Site do restaurante criado com IA, no comandou.com. Só funciona com uma chave do OpenRouter
 * (a própria desta seção ou a sua, de Super Admin › Tokens) e dentro dos limites desta seção:
 * tokens por site, por dia e por mês e sites por visitante. Cada site gerado fica registrado
 * (tokens, custo, rascunho) e, se a pessoa criar o restaurante, o rascunho vai junto: os
 * primeiros passos começam por ele sem gastar o limite do restaurante.
 */
@Injectable()
export class SiteAiService {
  private readonly logger = new Logger('SiteAi');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private async row(): Promise<SettingsRow> {
    const [r] = await this.db.query<SettingsRow>(
      `SELECT * FROM platform_site_ai_settings WHERE id`,
    );
    return r!;
  }

  /** A chave que vale: a desta seção; sem ela, a sua (Tokens); sem ela, a dos restaurantes. */
  private async key(
    r: SettingsRow,
  ): Promise<{ key: string; kind: 'site' | 'owner' | 'clients' } | null> {
    const secret = this.env.INTEGRATIONS_KEY;
    if (!secret) return null;
    if (r.api_key_enc) {
      try {
        return { key: open(secret, r.api_key_enc, KEY_CONTEXT), kind: 'site' };
      } catch {
        /* chave salva com outra INTEGRATIONS_KEY: cai para a de Tokens */
      }
    }
    const [k] = await this.db.query<KeyRow>(
      `SELECT api_key_enc, owner_api_key_enc FROM platform_ai_settings WHERE id`,
    );
    return k ? systemKey(secret, k) : null;
  }

  private async spent() {
    const [s] = await this.db.query<{ day: number; month: number }>(
      `SELECT coalesce(sum(prompt_tokens + completion_tokens)
                FILTER (WHERE created_at > now() - interval '24 hours'), 0)::float8 AS day,
              coalesce(sum(prompt_tokens + completion_tokens)
                FILTER (WHERE created_at >= ${MONTH_START}), 0)::float8 AS month
         FROM site_ai_generations WHERE created_at >= least(${MONTH_START}, now() - interval '24 hours')`,
    );
    return s!;
  }

  private async off(r: SettingsRow): Promise<SiteAiOff> {
    if (!r.enabled) return 'disabled';
    if (!(await this.key(r))) return 'no_key';
    const s = await this.spent();
    if (Number(r.daily_tokens) > 0 && s.day >= Number(r.daily_tokens)) return 'daily';
    if (Number(r.monthly_tokens) > 0 && s.month >= Number(r.monthly_tokens)) return 'monthly';
    return null;
  }

  /** O site público pergunta se mostra o "monte com IA". */
  async available(): Promise<boolean> {
    if (!this.db.enabled) return false;
    try {
      return (await this.off(await this.row())) === null;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ gerar
  /** O que a IA vai ler: a página do site, o lugar do Maps ou o texto do dono. */
  private async input(
    src: SiteAiSourceInput,
  ): Promise<{ text: string; images: string[]; ref: string; web?: boolean }> {
    if (src.kind === 'text')
      return {
        text: `O dono escreveu:\n${src.value.slice(0, 6000)}`,
        images: [],
        ref: 'descrição',
      };
    const place = mapsPlaceName(src.value);
    if (src.kind === 'maps' || place !== undefined) {
      let page = null;
      try {
        page = await safeFetch(src.value, {
          maxBytes: 1024 * 1024,
          truncate: true,
          timeoutMs: 10_000,
        });
      } catch {
        /* sem a página: segue só com o nome do link */
      }
      const og = page
        ? /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(
            page.body.toString('utf8').slice(0, 200_000),
          )?.[1]
        : null;
      const [title, ...rest] = decodeEntities(og ?? '').split(' · ');
      const name =
        mapsPlaceName(page?.url ?? src.value) ??
        place ??
        (title && !/google/i.test(title) ? title : null);
      if (!name)
        throw new UnprocessableEntityException('Não consegui ler esse link do Google Maps');
      return {
        text: placeForModel(name, rest.join(' · ').trim() || null, src.value),
        images: [],
        ref: 'Google Maps',
        // O Maps não mostra o cardápio: a IA pesquisa o lugar na internet (site, iFood, Instagram).
        web: true,
      };
    }
    let page;
    try {
      page = await safeFetch(src.value, {
        maxBytes: 3 * 1024 * 1024,
        truncate: true,
        timeoutMs: 15_000,
      });
    } catch (e) {
      throw new UnprocessableEntityException(
        e instanceof SafeFetchError ? e.message : 'Não consegui abrir esse link',
      );
    }
    if (page.status >= 400 || !page.contentType.includes('html'))
      throw new UnprocessableEntityException('Não consegui abrir esse link');
    const info = extractPage(page.body.toString('utf8'), page.url);
    return {
      text: pageForModel(info).slice(0, 60_000),
      images: info.images,
      ref: new URL(page.url).hostname.replace(/^www\./, ''),
    };
  }

  /**
   * Gera o site. Devolve o que o celular da página mostra e o token que leva o rascunho para o
   * cadastro. Fora do ar ou sem limite: 503 (a página segue sem IA).
   */
  async generate(src: SiteAiSourceInput, ip: string | undefined, panel?: Actor) {
    if (!this.db.enabled) throw new ServiceUnavailableException('Site com IA indisponível');
    const r = await this.row();
    const off = await this.off(r);
    if (off && !(panel && off === 'disabled'))
      throw new ServiceUnavailableException(
        off === 'no_key'
          ? 'Coloque a chave do OpenRouter para ligar o site com IA'
          : 'Site com IA indisponível agora',
      );
    if (!panel && ip) {
      const [{ n }] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM site_ai_generations
          WHERE ip = $1 AND NOT from_panel AND created_at > now() - interval '24 hours'`,
        [ip],
      );
      if (n >= r.per_ip_daily)
        throw new HttpException(
          {
            statusCode: 429,
            code: 'site_ai_limit',
            message: 'Você já criou alguns sites hoje. Siga com o último ou volte amanhã.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const key = (await this.key(r))!;
    const { text, images, ref, web } = await this.input(src);
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    const source = { kind: src.kind, value: src.value.slice(0, 2000) };
    let result;
    try {
      result = await client.complete(
        r.model,
        [
          { role: 'system', content: SITE_PROMPT },
          { role: 'user', content: text },
        ],
        {
          json: true,
          maxTokens: r.max_tokens_per_site,
          signal: AbortSignal.timeout(90_000),
          ...(web ? { web: 5 } : {}),
        },
      );
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      this.logger.warn(`site com IA falhou: ${msg}`);
      await this.db.query(
        `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, status, error)
         VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
        [source.kind, source.value, !!panel, ip ?? null, r.model, msg],
      );
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora'
          : 'Não deu para falar com a IA agora',
      );
    }
    const draft = readSiteDraft(result.text, images);
    const items = draftItems(draft);
    const ok = items > 0 || !!draft.store.name;
    const claim = randomBytes(24).toString('base64url');
    const [g] = await this.db.query<{ id: string }>(
      `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, prompt_tokens,
                                        completion_tokens, cost_usd, status, error, draft, items, claim_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        source.kind,
        source.value,
        !!panel,
        ip ?? null,
        r.model,
        result.usage.promptTokens,
        result.usage.completionTokens,
        result.usage.costUsd,
        ok ? 'ok' : 'failed',
        ok ? null : 'A IA não devolveu loja nem itens',
        ok ? JSON.stringify(draft) : null,
        items,
        ok ? hash(claim) : null,
      ],
    );
    await recordSystemUsage(this.db, {
      source: 'site_ia',
      ref: ref.slice(0, 60),
      model: r.model,
      usage: result.usage,
      adminId: panel?.admin.id ?? null,
    }).catch(() => undefined);
    if (!ok)
      throw new UnprocessableEntityException(
        'Não consegui montar o site com isso. Tente outro link ou descreva os itens.',
      );
    return {
      id: g!.id,
      claim,
      tokens: result.usage.promptTokens + result.usage.completionTokens,
      site: publicDraft(draft),
    };
  }

  /** No cadastro: liga o rascunho (de até 3 horas, ainda sem dono) ao restaurante novo. */
  async claim(token: string | undefined, tenantId: string): Promise<string | null> {
    if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
    const [g] = await this.db.query<{ id: string }>(
      `UPDATE site_ai_generations SET tenant_id = $2
        WHERE claim_hash = $1 AND tenant_id IS NULL AND status = 'ok'
          AND created_at > now() - make_interval(hours => $3)
        RETURNING id`,
      [hash(token), tenantId, CLAIM_HOURS],
    );
    return g?.id ?? null;
  }

  // ------------------------------------------------------------------ painel
  async overview() {
    const r = await this.row();
    const [key, off, spent, totals, days, log, clients] = await Promise.all([
      this.key(r),
      this.off(r),
      this.spent(),
      this.db.query<{
        today_n: number;
        today_cost: string;
        month_n: number;
        month_cost: string;
        month_ok: number;
        month_failed: number;
        month_claimed: number;
        all_n: number;
        all_tokens: number;
        all_cost: string;
      }>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today_n,
                coalesce(sum(cost_usd) FILTER (WHERE created_at > now() - interval '24 hours'), 0) AS today_cost,
                count(*) FILTER (WHERE created_at >= ${MONTH_START})::int AS month_n,
                coalesce(sum(cost_usd) FILTER (WHERE created_at >= ${MONTH_START}), 0) AS month_cost,
                count(*) FILTER (WHERE created_at >= ${MONTH_START} AND status = 'ok')::int AS month_ok,
                count(*) FILTER (WHERE created_at >= ${MONTH_START} AND status = 'failed')::int AS month_failed,
                count(*) FILTER (WHERE created_at >= ${MONTH_START} AND tenant_id IS NOT NULL)::int AS month_claimed,
                count(*)::int AS all_n,
                coalesce(sum(prompt_tokens + completion_tokens), 0)::float8 AS all_tokens,
                coalesce(sum(cost_usd), 0) AS all_cost
           FROM site_ai_generations`,
      ),
      this.db.query<{ day: string; tokens: number; sites: number }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                coalesce(sum(g.prompt_tokens + g.completion_tokens), 0)::float8 AS tokens,
                count(g.id)::int AS sites
           FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - 29,
                                (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day') d
           LEFT JOIN site_ai_generations g
             ON (g.created_at AT TIME ZONE 'America/Sao_Paulo')::date = d
          GROUP BY d ORDER BY d`,
      ),
      this.db.query(
        `SELECT g.id, g.source_kind AS "sourceKind", g.source_value AS "sourceValue",
                g.from_panel AS "fromPanel", g.model, g.status, g.error, g.items,
                (g.prompt_tokens + g.completion_tokens)::int AS tokens, g.cost_usd::float8 AS "costUsd",
                g.draft->'store'->>'name' AS "siteName", g.created_at AS "createdAt",
                g.tenant_id AS "tenantId", t.name AS "tenantName", t.slug AS "tenantSlug"
           FROM site_ai_generations g LEFT JOIN tenants t ON t.id = g.tenant_id
          ORDER BY g.created_at DESC LIMIT 80`,
      ),
      // Por cliente: o restaurante que nasceu de um site com IA e quanto o site dele custou.
      this.db.query(
        `SELECT t.id AS "tenantId", t.name, t.slug, t.status, s.status AS subscription,
                count(g.id)::int AS sites,
                sum(g.prompt_tokens + g.completion_tokens)::float8 AS tokens,
                sum(g.cost_usd)::float8 AS "costUsd", max(g.created_at) AS "lastAt"
           FROM site_ai_generations g
           JOIN tenants t ON t.id = g.tenant_id
           LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
          GROUP BY t.id, t.name, t.slug, t.status, s.status
          ORDER BY max(g.created_at) DESC LIMIT 100`,
      ),
    ]);
    const t = totals[0]!;
    return {
      settings: {
        enabled: r.enabled,
        hasOwnKey: !!r.api_key_enc,
        keyConfigured: !!this.env.INTEGRATIONS_KEY,
        /** Qual chave os sites estão usando agora. */
        usingKey: key?.kind ?? null,
        model: r.model,
        maxTokensPerSite: r.max_tokens_per_site,
        dailyTokens: Number(r.daily_tokens),
        monthlyTokens: Number(r.monthly_tokens),
        perIpDaily: r.per_ip_daily,
        updatedAt: r.updated_at,
      },
      off,
      usage: {
        dayTokens: spent.day,
        monthTokens: spent.month,
        todaySites: t.today_n,
        todayCostUsd: Number(t.today_cost),
        monthSites: t.month_n,
        monthOk: t.month_ok,
        monthFailed: t.month_failed,
        monthClaimed: t.month_claimed,
        monthCostUsd: Number(t.month_cost),
        allSites: t.all_n,
        allTokens: t.all_tokens,
        allCostUsd: Number(t.all_cost),
      },
      days,
      log,
      clients,
    };
  }

  async save(b: SiteAiSettingsInput, a: Actor) {
    if (b.apiKey && !this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException('Defina a INTEGRATIONS_KEY para guardar a chave');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_site_ai_settings
            SET enabled = $1, model = $2, max_tokens_per_site = $3, daily_tokens = $4,
                monthly_tokens = $5, per_ip_daily = $6,
                api_key_enc = CASE WHEN $7::boolean THEN NULL
                                   WHEN $8::bytea IS NOT NULL THEN $8 ELSE api_key_enc END,
                updated_at = now()
          WHERE id`,
        [
          b.enabled,
          b.model,
          b.maxTokensPerSite,
          b.dailyTokens,
          b.monthlyTokens,
          b.perIpDaily,
          b.apiKey === '',
          b.apiKey ? seal(this.env.INTEGRATIONS_KEY!, b.apiKey, KEY_CONTEXT) : null,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'site_ai.settings_saved',
        entity: 'site',
        data: {
          enabled: b.enabled,
          model: b.model,
          maxTokensPerSite: b.maxTokensPerSite,
          dailyTokens: b.dailyTokens,
          monthlyTokens: b.monthlyTokens,
          perIpDaily: b.perIpDaily,
          key: b.apiKey === '' ? 'removed' : b.apiKey ? 'changed' : 'kept',
        },
        ip: a.ip,
      });
    });
    return this.overview();
  }

  /** O rascunho completo de um site gerado (o painel mostra o que a IA montou). */
  async draft(id: string) {
    const [g] = await this.db.query<{ draft: unknown }>(
      `SELECT draft FROM site_ai_generations WHERE id = $1`,
      [id],
    );
    return { draft: g?.draft ?? null };
  }
}
