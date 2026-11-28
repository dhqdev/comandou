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
import { chatFallbacks } from '../../chat/ai-models';
import { MONTH_START } from '../../chat/ai-quota';
import { type ContentPart, OpenRouterClient, OpenRouterError } from '../../chat/openrouter';
import { readStockGuess, STOCK_PROMPT, stockQuestion } from '../../chat/stock-guess';
import {
  EMPTY_STORE as EMPTY_IMPORTED_STORE,
  extractPage,
  MENU_FILE_PROMPT,
  metaContent,
  pageForModel,
} from '../../chat/store-import';
import { sniff } from '../../common/file-sniff';
import { mapsPlaceName } from '../../common/maps-link';
import { safeFetch, SafeFetchError } from '../../common/safe-fetch';
import { ENV, Env } from '../../config/env';
import type { KeyKind } from '../ai-keys';
import { PlatformDb, platformAudit } from '../platform-db.service';
import type { Actor } from '../platform.service';
import { creationKey, recordCreation } from './creation-ai';
import type { SetupInput } from './site.schemas';
import {
  applyStock,
  COMPOSE_PROMPT,
  draftItems,
  linksIn,
  mergeCompose,
  publicCompose,
  readComposeDraft,
  MENU_MAX_PAGES,
  mergeMenuDrafts,
  placeForModel,
  publicDraft,
  publicMenu,
  readMenuDraft,
  readSiteDraft,
  SITE_PROMPT,
  stockTargets,
  type SiteAiKind,
  type SiteDraft,
} from './site-ai';

/** O rascunho pode ser levado para o cadastro por este tempo depois de gerado. */
const CLAIM_HOURS = 3;
/** Foto ou PDF do cardápio enviado no site. */
export const MENU_FILE_MAX = 3 * 1024 * 1024;
export const MENU_FILE_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'application/pdf',
]);
/** Sessão do visitante no site (número aleatório da aba): junta os rascunhos de uma criação. */
export const SiteSession = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const SiteAiSettingsBody = z.object({
  enabled: z.boolean(),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: google/gemini-2.5-flash)'),
  maxTokensPerSite: z.number().int().min(500).max(32_000),
  dailyTokens: z.number().int().min(0).max(1_000_000_000),
  monthlyTokens: z.number().int().min(0).max(10_000_000_000),
  perIpDaily: z.number().int().min(1).max(100),
  /** Primeiros passos do restaurante criado pelo site pela chave do sistema (0 = desligado). */
  firstStepsTokens: z.number().int().min(0).max(100_000_000).optional(),
});
export type SiteAiSettingsInput = z.infer<typeof SiteAiSettingsBody>;

export const SiteAiSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('site'),
    value: z.string().trim().min(4).max(2000),
    session: SiteSession.optional(),
  }),
  z.object({
    kind: z.literal('maps'),
    value: z.string().trim().min(8).max(2000),
    session: SiteSession.optional(),
  }),
  z.object({
    kind: z.literal('text'),
    value: z.string().trim().min(10).max(6000),
    session: SiteSession.optional(),
  }),
]);
export const SiteStockBody = z.object({ claim: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });
export type SiteAiSourceInput = z.infer<typeof SiteAiSource>;

interface SettingsRow {
  enabled: boolean;
  model: string;
  max_tokens_per_site: number;
  daily_tokens: string;
  monthly_tokens: string;
  per_ip_daily: number;
  first_steps_tokens: string;
  updated_at: Date;
}

/** Por que o site com IA está desligado agora (null = ligado). */
export type SiteAiOff = 'disabled' | 'no_key' | 'daily' | 'monthly' | null;

const hash = (token: string) => createHash('sha256').update(token).digest();

/**
 * Site do restaurante criado com IA, no comandou.com. Só funciona com uma chave do OpenRouter
 * (a do sistema, "OpenRouter · chave do sistema (esteira)", e sem ela a dos restaurantes, de
 * Super Admin › Credenciais) e dentro dos limites desta seção: tokens por site, por dia e por
 * mês e sites por visitante. Também lê o cardápio que a pessoa envia (foto ou PDF) e sugere o
 * estoque de cada item. Cada rascunho fica registrado (tokens, custo, etapa) e, se a pessoa criar
 * o restaurante, vai junto: os primeiros passos começam por ele sem gastar o limite do restaurante.
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

  /** A chave que vale: a do sistema; sem ela, a dos restaurantes (as duas de Credenciais). */
  private key(): Promise<{ key: string; kind: KeyKind } | null> {
    return creationKey(this.env, this.db);
  }

  /** Modelos de Super Admin › Tokens de IA: o que lê o cardápio e o da conversa (estoque). */
  private async models() {
    const [m] = await this.db.query<{ import_model: string; model: string }>(
      `SELECT import_model, model FROM platform_ai_settings WHERE id`,
    );
    return { read: m!.import_model, chat: m!.model };
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
    if (!(await this.key())) return 'no_key';
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

  /** Confere se a IA do site está no ar (o painel testa mesmo desligada). Fora: 503. */
  private async open(panel?: Actor): Promise<SettingsRow> {
    if (!this.db.enabled) throw new ServiceUnavailableException('Site com IA indisponível');
    const r = await this.row();
    const off = await this.off(r);
    if (off && !(panel && off === 'disabled'))
      throw new ServiceUnavailableException(
        off === 'no_key'
          ? 'Coloque a chave do OpenRouter para ligar o site com IA'
          : 'Site com IA indisponível agora',
      );
    return r;
  }

  /** Rascunhos novos por visitante (IP) em 24 horas: site montado ou cardápio enviado. */
  private async perIp(r: SettingsRow, ip: string | undefined) {
    if (!ip) return;
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

  // ------------------------------------------------------------------ cardápio enviado
  /**
   * Lê uma página do cardápio (foto ou PDF) enviada na janela de criar do site e devolve os
   * itens com os preços. Com `claim` de um cardápio já começado (até 3 horas, 8 páginas), junta
   * a página nele; senão começa um rascunho novo (conta no limite por visitante). A sugestão de
   * estoque vem em seguida, por `suggestStock`.
   */
  async readMenu(
    file: Buffer,
    mime: string,
    ip: string | undefined,
    opts: { claim?: string; session?: string } = {},
  ) {
    if (!MENU_FILE_TYPES.has(mime) || file.length === 0 || file.length > MENU_FILE_MAX)
      throw new UnprocessableEntityException(
        'Envie uma foto (JPG, PNG, WebP) ou um PDF de até 3 MB',
      );
    const isPdf = mime === 'application/pdf';
    if (isPdf ? file.toString('latin1', 0, 5) !== '%PDF-' : sniff(file) !== mime)
      throw new UnprocessableEntityException(
        'Envie uma foto (JPG, PNG, WebP) ou um PDF de até 3 MB',
      );
    const r = await this.open();
    // Página a mais de um cardápio já começado (o mesmo visitante, com o token dele).
    let current: { id: string; draft: SiteDraft } | null = null;
    if (opts.claim) {
      const [g] = await this.db.query<{ id: string; draft: SiteDraft }>(
        `SELECT id, draft FROM site_ai_generations
          WHERE claim_hash = $1 AND source_kind = 'menu' AND status = 'ok' AND tenant_id IS NULL
            AND created_at > now() - make_interval(hours => $2)`,
        [hash(opts.claim), CLAIM_HOURS],
      );
      if (!g) throw new UnprocessableEntityException('Envie o cardápio de novo, do começo');
      if ((g.draft.pages ?? 1) >= MENU_MAX_PAGES)
        throw new UnprocessableEntityException(
          `Até ${MENU_MAX_PAGES} páginas por aqui. O resto você manda nos primeiros passos.`,
        );
      current = g;
    } else await this.perIp(r, ip);
    const key = (await this.key())!;
    const { read } = await this.models();
    const data = `data:${mime};base64,${file.toString('base64')}`;
    const attachment: ContentPart = isPdf
      ? { type: 'file', file: { filename: 'cardapio.pdf', file_data: data } }
      : { type: 'image_url', image_url: { url: data } };
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    let result;
    try {
      result = await client.complete(
        read,
        [
          { role: 'system', content: MENU_FILE_PROMPT },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Leia este cardápio e devolva o JSON.' }, attachment],
          },
        ],
        { json: true, maxTokens: 16_000, signal: AbortSignal.timeout(150_000) },
      );
    } catch (e) {
      this.logger.warn(`cardápio do site falhou: ${(e as Error).message.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora. Tente de novo em instantes.'
          : 'Não deu para falar com a IA agora',
      );
    }
    const page = readMenuDraft(result.text);
    const u = result.usage;
    const claim = opts.claim ?? randomBytes(24).toString('base64url');
    const id = await this.db.tx(async (c) => {
      if (current) {
        // Outra página pode ter chegado enquanto a IA lia: junta no que está gravado agora.
        const { rows } = await c.query<{ draft: SiteDraft }>(
          `SELECT draft FROM site_ai_generations WHERE id = $1 FOR UPDATE`,
          [current.id],
        );
        const merged = mergeMenuDrafts(rows[0]?.draft ?? current.draft, page);
        await c.query(
          `UPDATE site_ai_generations
              SET draft = $2, items = $3, prompt_tokens = prompt_tokens + $4,
                  completion_tokens = completion_tokens + $5, cost_usd = cost_usd + $6
            WHERE id = $1`,
          [
            current.id,
            JSON.stringify(merged),
            draftItems(merged),
            u.promptTokens,
            u.completionTokens,
            u.costUsd,
          ],
        );
        return current.id;
      }
      const ok = draftItems(page) > 0;
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, prompt_tokens,
                                          completion_tokens, cost_usd, status, error, draft, items,
                                          claim_hash, session)
         VALUES ('menu', $1, false, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          isPdf ? 'PDF' : 'Foto',
          ip ?? null,
          result.model,
          u.promptTokens,
          u.completionTokens,
          u.costUsd,
          ok ? 'ok' : 'failed',
          ok ? null : 'A IA não achou itens no cardápio enviado',
          ok ? JSON.stringify(page) : null,
          draftItems(page),
          ok ? hash(claim) : null,
          opts.session ?? null,
        ],
      );
      return rows[0]!.id;
    });
    await recordCreation(this.db, {
      step: 'cardapio',
      ref: isPdf ? 'PDF' : 'Foto',
      model: result.model,
      usage: u,
      key: key.kind,
      generationId: id,
    }).catch(() => undefined);
    if (!draftItems(page))
      throw new UnprocessableEntityException(
        current
          ? 'Não achei itens nesta página. Tente uma foto mais nítida, de perto.'
          : 'Não achei itens nesse arquivo. Tente uma foto mais nítida, de perto, ou o PDF do cardápio.',
      );
    const [g] = await this.db.query<{ draft: SiteDraft }>(
      `SELECT draft FROM site_ai_generations WHERE id = $1`,
      [id],
    );
    return { claim, menu: publicMenu(g!.draft) };
  }

  /**
   * Sugere o estoque inicial dos itens que ainda não têm (cardápio enviado ou site montado pela
   * IA), pelo modelo da conversa (o mais barato). Uma vez por item: chamar de novo não gasta.
   * Outra sugestão do mesmo rascunho em andamento: devolve como está, com `busy`.
   */
  async suggestStock(claim: string) {
    if (!this.db.enabled) throw new ServiceUnavailableException('Site com IA indisponível');
    const [g] = await this.db.query<{ id: string; draft: SiteDraft }>(
      `SELECT id, draft FROM site_ai_generations
        WHERE claim_hash = $1 AND status = 'ok' AND draft IS NOT NULL
          AND created_at > now() - make_interval(hours => $2)`,
      [hash(claim), CLAIM_HOURS],
    );
    if (!g) throw new UnprocessableEntityException('Esse cardápio não está mais aqui');
    const targets = stockTargets(g.draft);
    if (!targets.length) return { busy: false, menu: publicMenu(g.draft) };
    // Uma sugestão por vez para o mesmo rascunho (dois cliques não pagam duas vezes).
    const [mine] = await this.db.query<{ id: string }>(
      `UPDATE site_ai_generations SET draft = jsonb_set(draft, '{stockAt}', to_jsonb(now()))
        WHERE id = $1 AND (draft->>'stockAt' IS NULL
                           OR (draft->>'stockAt')::timestamptz < now() - interval '2 minutes')
        RETURNING id`,
      [g.id],
    );
    if (!mine) return { busy: true, menu: publicMenu(g.draft) };
    const release = () =>
      this.db
        .query(`UPDATE site_ai_generations SET draft = draft - 'stockAt' WHERE id = $1`, [g.id])
        .catch(() => undefined);
    const key = await this.key();
    if (!key) {
      await release();
      throw new ServiceUnavailableException('Site com IA indisponível agora');
    }
    const { chat } = await this.models();
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    let result;
    try {
      result = await client.complete(
        chat,
        [
          { role: 'system', content: STOCK_PROMPT },
          { role: 'user', content: stockQuestion(targets) },
        ],
        {
          json: true,
          maxTokens: Math.min(8000, 400 + targets.length * 40),
          signal: AbortSignal.timeout(60_000),
          fallbacks: chatFallbacks(chat),
          reasoning: false,
          fast: true,
        },
      );
    } catch (e) {
      await release();
      this.logger.warn(`estoque do site falhou: ${(e as Error).message.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        'A IA não respondeu agora. Tente de novo em instantes.',
      );
    }
    const guesses = readStockGuess(result.text, targets.length);
    const u = result.usage;
    const draft = await this.db.tx(async (c) => {
      const { rows } = await c.query<{ draft: SiteDraft }>(
        `SELECT draft FROM site_ai_generations WHERE id = $1 FOR UPDATE`,
        [g.id],
      );
      const { stockAt: _s, ...cur } = (rows[0]?.draft ?? g.draft) as SiteDraft & {
        stockAt?: string;
      };
      const next = applyStock(cur, targets, guesses);
      await c.query(
        `UPDATE site_ai_generations
            SET draft = $2, prompt_tokens = prompt_tokens + $3,
                completion_tokens = completion_tokens + $4, cost_usd = cost_usd + $5
          WHERE id = $1`,
        [g.id, JSON.stringify(next), u.promptTokens, u.completionTokens, u.costUsd],
      );
      return next;
    });
    await recordCreation(this.db, {
      step: 'estoque',
      ref: `${targets.length} itens`,
      model: result.model,
      usage: u,
      key: key.kind,
      generationId: g.id,
    }).catch(() => undefined);
    return { busy: false, menu: publicMenu(draft) };
  }

  // ------------------------------------------------------------------ campo único (0.279)

  /**
   * Uma mensagem do campo único da criação: o texto do dono e os links que ele colou (site,
   * Google Maps, cardápio digital). A IA lê só a parte nova e o servidor junta no rascunho
   * (`rascunho` = o token da criação já começada). Rascunho novo conta no limite por visitante.
   */
  async compose(b: { text: string; claim?: string; session?: string }, ip: string | undefined) {
    const r = await this.open();
    const current = b.claim ? await this.composeRow(b.claim) : null;
    if (!current) await this.perIp(r, ip);
    const text = b.text.trim().slice(0, 6000);
    const parts: string[] = [`O dono escreveu:\n${text}`];
    let images: string[] = [];
    let web = false;
    for (const url of linksIn(text)) {
      try {
        const got = await this.input({ kind: 'site', value: url });
        parts.push(`Link ${url}:\n${got.text.slice(0, 20_000)}`);
        // As imagens de cada página continuam numeradas na ordem ([img N] do texto).
        images = images.concat(got.images);
        web ||= !!got.web;
      } catch {
        parts.push(`Link ${url}: não abriu (pode ser Instagram ou iFood); use se souber do lugar.`);
        web = true;
      }
    }
    const key = (await this.key())!;
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    let result;
    try {
      result = await client.complete(
        r.model,
        [
          { role: 'system', content: COMPOSE_PROMPT },
          { role: 'user', content: parts.join('\n\n').slice(0, 60_000) },
        ],
        {
          json: true,
          maxTokens: r.max_tokens_per_site,
          signal: AbortSignal.timeout(90_000),
          ...(web ? { web: 5 } : {}),
        },
      );
    } catch (e) {
      this.logger.warn(`campo único do site falhou: ${(e as Error).message.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora. Tente de novo em instantes.'
          : 'Não deu para falar com a IA agora',
      );
    }
    const { draft } = readComposeDraft(result.text, images);
    return this.composeSave(current, draft, {
      ref: text.slice(0, 2000),
      ip,
      model: result.model,
      usage: result.usage,
      key: key.kind,
      step: 'conversa',
      claim: b.claim,
      session: b.session,
    });
  }

  /**
   * Um arquivo do campo único (foto ou PDF, até 3 MB): a IA diz o que é (logo, cardápio, capa,
   * documento) e tira o que tiver. Logo e capa ficam no rascunho (a imagem em si) e viram o logo,
   * o ícone e a capa da loja nos primeiros passos.
   */
  async composeFile(
    file: Buffer,
    mime: string,
    ip: string | undefined,
    opts: { claim?: string; session?: string; name?: string } = {},
  ) {
    if (!MENU_FILE_TYPES.has(mime) || file.length === 0 || file.length > MENU_FILE_MAX)
      throw new UnprocessableEntityException(
        'Envie uma foto (JPG, PNG, WebP) ou um PDF de até 3 MB',
      );
    const isPdf = mime === 'application/pdf';
    if (isPdf ? file.toString('latin1', 0, 5) !== '%PDF-' : sniff(file) !== mime)
      throw new UnprocessableEntityException(
        'Envie uma foto (JPG, PNG, WebP) ou um PDF de até 3 MB',
      );
    const r = await this.open();
    const current = opts.claim ? await this.composeRow(opts.claim) : null;
    if (!current) await this.perIp(r, ip);
    if ((current?.draft.files?.length ?? 0) >= 12)
      throw new UnprocessableEntityException(
        'Até 12 arquivos por aqui. O resto você manda nos primeiros passos.',
      );
    const key = (await this.key())!;
    const { read } = await this.models();
    const data = `data:${mime};base64,${file.toString('base64')}`;
    const attachment: ContentPart = isPdf
      ? { type: 'file', file: { filename: 'arquivo.pdf', file_data: data } }
      : { type: 'image_url', image_url: { url: data } };
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    let result;
    try {
      result = await client.complete(
        read,
        [
          { role: 'system', content: COMPOSE_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `O dono anexou um arquivo${opts.name ? ` ("${opts.name.replace(/["\n]/g, ' ').slice(0, 80)}")` : ''}. Diga o que é e tire o que tiver dele.`,
              },
              attachment,
            ],
          },
        ],
        { json: true, maxTokens: 16_000, signal: AbortSignal.timeout(150_000) },
      );
    } catch (e) {
      this.logger.warn(`arquivo do site falhou: ${(e as Error).message.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora. Tente de novo em instantes.'
          : 'Não deu para falar com a IA agora',
      );
    }
    const { draft, file: kind } = readComposeDraft(result.text);
    // A imagem do logo ou da capa vai junto no rascunho (até 600 KB; foto maior fica de fora).
    const keep = !isPdf && file.length <= 600 * 1024;
    const store = {
      ...draft.store,
      logoUrl: kind === 'logo' && keep ? data : null,
      coverUrl: kind === 'cover' && keep ? data : null,
      logoBox: null,
      faviconUrl: null,
    };
    return this.composeSave(
      current,
      { ...draft, store, files: [kind ?? 'other'], pages: kind === 'menu' ? 1 : 0 },
      {
        ref: isPdf ? 'PDF' : 'Foto',
        ip,
        model: result.model,
        usage: result.usage,
        key: key.kind,
        step: 'anexo',
        claim: opts.claim,
        session: opts.session,
        kind,
      },
    );
  }

  /** Rascunho do campo único ainda sem dono (até 3 horas). */
  private async composeRow(claim: string) {
    const [g] = await this.db.query<{ id: string; draft: SiteDraft }>(
      `SELECT id, draft FROM site_ai_generations
        WHERE claim_hash = $1 AND source_kind = 'compose' AND status = 'ok' AND tenant_id IS NULL
          AND created_at > now() - make_interval(hours => $2)`,
      [hash(claim), CLAIM_HOURS],
    );
    if (!g) throw new UnprocessableEntityException('Comece de novo: esse rascunho venceu');
    return g;
  }

  /** Grava a parte nova (rascunho novo ou somado ao que já existe) e devolve para a tela. */
  private async composeSave(
    current: { id: string; draft: SiteDraft } | null,
    part: SiteDraft,
    o: {
      ref: string;
      ip: string | undefined;
      model: string;
      usage: { promptTokens: number; completionTokens: number; costUsd: number };
      key: KeyKind;
      step: 'conversa' | 'anexo';
      claim?: string;
      session?: string;
      kind?: string | null;
    },
  ) {
    const u = o.usage;
    const claim = o.claim ?? randomBytes(24).toString('base64url');
    const first: SiteDraft = { ...part, parts: 1, files: part.files ?? [] };
    const id = await this.db.tx(async (c) => {
      if (current) {
        // Outra parte pode ter chegado enquanto a IA lia: junta no que está gravado agora.
        const { rows } = await c.query<{ draft: SiteDraft }>(
          `SELECT draft FROM site_ai_generations WHERE id = $1 FOR UPDATE`,
          [current.id],
        );
        const merged = mergeCompose(rows[0]?.draft ?? current.draft, first);
        await c.query(
          `UPDATE site_ai_generations
              SET draft = $2, items = $3, prompt_tokens = prompt_tokens + $4,
                  completion_tokens = completion_tokens + $5, cost_usd = cost_usd + $6
            WHERE id = $1`,
          [
            current.id,
            JSON.stringify(merged),
            draftItems(merged),
            u.promptTokens,
            u.completionTokens,
            u.costUsd,
          ],
        );
        return current.id;
      }
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, prompt_tokens,
                                          completion_tokens, cost_usd, status, error, draft, items,
                                          claim_hash, session)
         VALUES ('compose', $1, false, $2, $3, $4, $5, $6, 'ok', NULL, $7, $8, $9, $10) RETURNING id`,
        [
          o.ref,
          o.ip ?? null,
          o.model,
          u.promptTokens,
          u.completionTokens,
          u.costUsd,
          JSON.stringify(first),
          draftItems(first),
          hash(claim),
          o.session ?? null,
        ],
      );
      return rows[0]!.id;
    });
    await recordCreation(this.db, {
      step: o.step,
      ref: o.kind ? `${o.ref} (${o.kind})` : o.ref.slice(0, 60),
      model: o.model,
      usage: u,
      key: o.key,
      generationId: id,
    }).catch(() => undefined);
    const [g] = await this.db.query<{ draft: SiteDraft }>(
      `SELECT draft FROM site_ai_generations WHERE id = $1`,
      [id],
    );
    return { claim, kind: o.kind ?? null, ...publicCompose(g!.draft) };
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
        ? metaContent(page.body.toString('utf8').slice(0, 200_000), 'og:title')
        : null;
      const [title, ...rest] = (og ?? '').split(' · ');
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
    const r = await this.open(panel);
    if (!panel) await this.perIp(r, ip);
    const key = (await this.key())!;
    const { text, images, ref, web } = await this.input(src);
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key.key);
    const source = { kind: src.kind, value: src.value.slice(0, 2000) };
    const session = panel ? null : (src.session ?? null);
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
        `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, status, error, session)
         VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`,
        [source.kind, source.value, !!panel, ip ?? null, r.model, msg, session],
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
                                        completion_tokens, cost_usd, status, error, draft, items, claim_hash,
                                        session)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
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
        session,
      ],
    );
    await recordCreation(this.db, {
      step: 'site',
      ref: ref.slice(0, 60),
      model: result.model,
      usage: result.usage,
      key: key.kind,
      generationId: g!.id,
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

  /**
   * No cadastro: liga o rascunho (de até 3 horas, ainda sem dono) ao restaurante novo. `kind`:
   * o site montado pela IA ('site', 'maps' ou 'text', o que veio na geração) ou o cardápio
   * enviado ('menu').
   */
  async claim(
    token: string | undefined,
    tenantId: string,
    what: 'site' | 'menu' = 'site',
  ): Promise<string | null> {
    if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
    const [g] = await this.db.query<{ id: string }>(
      `UPDATE site_ai_generations SET tenant_id = $2
        WHERE claim_hash = $1 AND tenant_id IS NULL AND status = 'ok'
          AND (source_kind = 'menu') = $4
          AND created_at > now() - make_interval(hours => $3)
        RETURNING id`,
      [hash(token), tenantId, CLAIM_HOURS, what === 'menu'],
    );
    return g?.id ?? null;
  }

  /**
   * Guarda o que a pessoa combinou na conversa da criação (0.282) no rascunho do restaurante:
   * o cardápio conferido no lugar do lido (as fotos que a IA achou voltam pelo nome do item), a
   * cara da loja, contato, endereço e, em `setup`, como vende e o tempo de preparo. O sistema lê
   * pelo mesmo caminho dos primeiros passos e aplica sozinho no primeiro acesso. Sem rascunho
   * (a pessoa não mandou nada para a IA), nasce um só com o combinado.
   */
  async saveSetup(generationId: string | null, tenantId: string, s: SetupInput): Promise<string> {
    const nameKey = (v: string) =>
      v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    return this.db.tx(async (c) => {
      const { rows } = generationId
        ? await c.query<{ draft: SiteDraft | null }>(
            `SELECT draft FROM site_ai_generations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
            [generationId, tenantId],
          )
        : { rows: [] as { draft: SiteDraft | null }[] };
      const base: SiteDraft = rows[0]?.draft ?? {
        store: { ...EMPTY_IMPORTED_STORE },
        categories: [],
        tagline: null,
        suggested: false,
      };
      const photos = new Map<string, string>();
      for (const cat of base.categories)
        for (const it of cat.items) if (it.imageUrl) photos.set(nameKey(it.name), it.imageUrl);
      const draft: SiteDraft & { setup: Record<string, unknown> } = {
        ...base,
        suggested: false,
        categories: s.categories.map((cat) => ({
          name: cat.name,
          items: cat.items.map((it) => ({
            name: it.name,
            description: it.description,
            price: it.price,
            imageUrl: it.imageUrl ?? photos.get(nameKey(it.name)) ?? null,
            ...(it.stock !== undefined ? { stock: it.stock } : {}),
          })),
        })),
        store: {
          ...base.store,
          brandColor: s.store.brandColor ?? base.store.brandColor,
          accentColor: s.store.accentColor ?? base.store.accentColor,
          logoUrl: s.store.logoUrl ?? base.store.logoUrl,
          whatsapp: s.store.whatsapp ?? base.store.whatsapp,
          address: s.store.address ?? base.store.address,
        },
        setup: {
          delivery: s.sell.delivery,
          pickup: s.sell.pickup,
          tables: s.sell.tables,
          etaMin: s.eta?.min ?? null,
          etaMax: s.eta ? Math.max(s.eta.min, s.eta.max) : null,
          confirmedAt: new Date().toISOString(),
        },
      };
      if (generationId && rows[0]) {
        await c.query(`UPDATE site_ai_generations SET draft = $2, items = $3 WHERE id = $1`, [
          generationId,
          JSON.stringify(draft),
          draftItems(draft),
        ]);
        return generationId;
      }
      const ins = await c.query<{ id: string }>(
        `INSERT INTO site_ai_generations (source_kind, source_value, from_panel, ip, model, prompt_tokens,
                                          completion_tokens, cost_usd, status, error, draft, items,
                                          claim_hash, session, tenant_id)
         VALUES ('compose', 'conversa', false, NULL, 'conversa', 0, 0, 0, 'ok', NULL, $1, $2,
                 NULL, NULL, $3) RETURNING id`,
        [JSON.stringify(draft), draftItems(draft), tenantId],
      );
      return ins.rows[0]!.id;
    });
  }

  // ------------------------------------------------------------------ painel
  async overview() {
    const r = await this.row();
    const [key, off, spent, totals, days, log, clients] = await Promise.all([
      this.key(),
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
        keyConfigured: !!this.env.INTEGRATIONS_KEY,
        /** Qual chave os sites estão usando agora. */
        usingKey: key?.kind ?? null,
        model: r.model,
        maxTokensPerSite: r.max_tokens_per_site,
        dailyTokens: Number(r.daily_tokens),
        monthlyTokens: Number(r.monthly_tokens),
        perIpDaily: r.per_ip_daily,
        firstStepsTokens: Number(r.first_steps_tokens),
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
    await this.db.tx(async (c) => {
      // A antiga chave própria dos sites sai junto no primeiro salvar (os sites usam a dos
      // restaurantes desde a 0.171).
      await c.query(
        `UPDATE platform_site_ai_settings
            SET enabled = $1, model = $2, max_tokens_per_site = $3, daily_tokens = $4,
                monthly_tokens = $5, per_ip_daily = $6, api_key_enc = NULL,
                first_steps_tokens = coalesce($7, first_steps_tokens), updated_at = now()
          WHERE id`,
        [
          b.enabled,
          b.model,
          b.maxTokensPerSite,
          b.dailyTokens,
          b.monthlyTokens,
          b.perIpDaily,
          b.firstStepsTokens ?? null,
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
          firstStepsTokens: b.firstStepsTokens,
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
