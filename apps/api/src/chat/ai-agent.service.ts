import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { menuTreeSql } from '../catalog/menu-sql';
import { Ctx } from '../common/context';
import { open } from '../common/secret-box';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { GatewayClient } from '../messaging/gateway.client';
import { WhatsAppUnavailableError } from '../messaging/whatsapp.client';
import { WhatsAppInbound, WhatsAppInboundService } from '../messaging/whatsapp-inbound.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StoreHour, withinHours } from '../store/store.service';
import {
  AGENT_DEFAULTS,
  AgentMenuCategory,
  AgentSettings,
  AgentStore,
  customerPrompt,
  hoursText,
  parseReply,
} from './ai-agent-prompt';
import { loadAiQuota, recordAiUsage } from './ai-quota';
import { AI_KEY_CONTEXT } from './ai.service';
import { ChatService } from './chat.service';
import { ChatTurn, OpenRouterClient, OpenRouterError } from './openrouter';

/** Mensagens anteriores da conversa com o cliente que vão junto (memória curta). */
const HISTORY = 12;
/** A IA fica quieta nesta conversa por este tempo depois de chamar alguém da equipe. */
const HANDOFF_PAUSE_HOURS = 12;
/** Teto de tokens de cada resposta ao cliente (mensagem de WhatsApp é curta). */
const MAX_REPLY_TOKENS = 600;

const SETTINGS_COLS = `whatsapp_enabled AS "whatsappEnabled", agent_name AS "agentName", tone,
  greeting, about, rules, handoff_message AS "handoffMessage", suggest_items AS "suggestItems",
  show_prices AS "showPrices", send_store_link AS "sendStoreLink", reply_when AS "replyWhen"`;

const COLUMN: Record<keyof AgentSettings, string> = {
  whatsappEnabled: 'whatsapp_enabled',
  agentName: 'agent_name',
  tone: 'tone',
  greeting: 'greeting',
  about: 'about',
  rules: 'rules',
  handoffMessage: 'handoff_message',
  suggestItems: 'suggest_items',
  showPrices: 'show_prices',
  sendStoreLink: 'send_store_link',
  replyWhen: 'reply_when',
};

/** Mensagem recebida no WhatsApp do restaurante (entregue pelo gateway). */
export interface InboundMessage {
  tenantId: string;
  /** Telefone do cliente, só dígitos. */
  from: string;
  jid?: string;
  id?: string;
  text: string;
  pushName?: string | null;
  timestamp?: number;
}

/** Resposta para o WhatsApp: o texto e quanto tempo mostrar "digitando…" antes. */
export interface AgentReply {
  text: string;
  typingMs: number;
  /** A IA passou a conversa para a equipe (e fica quieta nela por um tempo). */
  handoff: boolean;
}

/** Item como o gerente vê na lista "o que a IA pode oferecer". */
interface MenuRow {
  id: string;
  name: string;
  category: string;
  price: string;
  soldOut: boolean;
  /** Preço por kg (sorveteria, comida por quilo). */
  soldByWeight: boolean;
  aiVisible: boolean;
}

/**
 * IA que atende o cliente. O gerente configura (nome, jeito de falar, regras, sobre a casa) e
 * escolhe os itens do cardápio que ela enxerga. Usa a chave, o modelo e o limite do mês
 * definidos pelo Comandou (mesmo limite do assistente da equipe).
 */
@Injectable()
export class AiAgentService implements OnModuleInit {
  private readonly logger = new Logger('AiAgentService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly inbound: WhatsAppInboundService,
    private readonly gateway: GatewayClient,
  ) {}

  onModuleInit() {
    this.inbound.onMessage((m) => this.onWhatsApp(m));
  }

  /**
   * Mensagem recebida no WhatsApp (gateway Baileys): marca como lida e mostra "digitando…" só
   * quando a IA vai mesmo responder, e responde na mesma conversa (m.jid, que pode ser @lid).
   */
  async onWhatsApp(m: WhatsAppInbound) {
    if (!m.text?.trim()) return;
    const key = m.from ?? m.jid.split('@')[0]!.replace(/\D/g, '');
    const r = await this.handle(
      { tenantId: m.tenantId, from: key, jid: m.jid, id: m.id, text: m.text, pushName: m.pushName },
      async () => {
        await this.gateway.markRead(m.tenantId, m.jid, m.id).catch(() => false);
        await this.gateway.typing(m.tenantId, m.jid, 25_000).catch(() => false);
      },
    );
    if (!r) return;
    try {
      const sent = await this.gateway.send(m.tenantId, m.jid, r.text, {
        typingMs: Math.min(r.typingMs, 2500),
      });
      if (!sent.ok) this.logger.warn(`Resposta da IA não saiu (${m.tenantId}): ${sent.error}`);
    } catch (e) {
      if (e instanceof WhatsAppUnavailableError)
        this.logger.warn(`WhatsApp desconectado; resposta da IA perdida (${m.tenantId})`);
      else throw e;
    }
  }

  // ------------------------------------------------------------ configuração

  async settingsIn(tx: Tx): Promise<AgentSettings> {
    const r = await one<AgentSettings>(tx, `SELECT ${SETTINGS_COLS} FROM ai_agent_settings`);
    return r ?? { ...AGENT_DEFAULTS };
  }

  /** Tudo o que a tela do gerente precisa: configuração, situação da IA e uso do mês. */
  async overview(ctx: Ctx) {
    const settings = await this.db.withTenant(ctx, (tx) => this.settingsIn(tx));
    const { c, used, blocked } = await this.platform(ctx);
    const reason =
      !c.enabled || !this.env.INTEGRATIONS_KEY
        ? 'platform'
        : !c.tenant_enabled
          ? 'tenant'
          : c.monthly_tokens > 0 && used >= c.monthly_tokens
            ? 'limit'
            : null;
    return {
      settings,
      defaultName: c.assistant_name,
      available: reason === null,
      reason,
      usage: {
        used,
        limit: c.monthly_tokens,
        percent:
          c.monthly_tokens > 0
            ? Math.min(100, Math.round((used / c.monthly_tokens) * 1000) / 10)
            : null,
      },
    };
  }

  async save(ctx: Ctx, patch: Partial<AgentSettings>) {
    const keys = (Object.keys(patch) as (keyof AgentSettings)[]).filter(
      (k) => COLUMN[k] && patch[k] !== undefined,
    );
    await this.db.withTenant(ctx, async (tx) => {
      const cur = await this.settingsIn(tx);
      const next = { ...cur, ...patch };
      const cols = Object.values(COLUMN);
      const vals = (Object.keys(COLUMN) as (keyof AgentSettings)[]).map((k) => {
        const v = next[k];
        return typeof v === 'string' ? v.trim() || null : v;
      });
      await q(
        tx,
        `INSERT INTO ai_agent_settings (tenant_id, updated_by, ${cols.join(', ')})
         VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET updated_by = EXCLUDED.updated_by,
           ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        [ctx.tenantId, ctx.userId, ...vals],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'ai_agent.settings_updated',
        entity: 'ai_agent_settings',
        entityId: ctx.tenantId,
        data: { fields: keys },
        ip: ctx.ip,
      });
    });
    return this.overview(ctx);
  }

  /** Itens ativos com a marca "a IA pode oferecer", na ordem do cardápio. */
  menuItems(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q<MenuRow>(
        tx,
        `SELECT p.id, p.name, c.name AS category, p.price::text AS price, p.sold_out AS "soldOut",
                p.sold_by_weight AS "soldByWeight", p.ai_visible AS "aiVisible"
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.active AND c.active
          ORDER BY c.position, c.name, p.position, p.name`,
      ),
    );
  }

  /** Liga ou desliga itens para a IA (um, vários ou todos quando `ids` vem vazio com all). */
  async setVisible(ctx: Ctx, b: { ids?: string[]; all?: boolean; visible: boolean }) {
    const n = await this.db.withTenant(ctx, async (tx) => {
      const rows = b.all
        ? await q<{ id: string }>(
            tx,
            `UPDATE products SET ai_visible = $1 WHERE active AND ai_visible <> $1 RETURNING id`,
            [b.visible],
          )
        : await q<{ id: string }>(
            tx,
            `UPDATE products SET ai_visible = $1 WHERE id = ANY($2::uuid[]) AND ai_visible <> $1 RETURNING id`,
            [b.visible, b.ids ?? []],
          );
      if (rows.length)
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: b.visible ? 'ai_agent.items_enabled' : 'ai_agent.items_disabled',
          entity: 'products',
          entityId: ctx.tenantId,
          data: { count: rows.length, all: !!b.all },
          ip: ctx.ip,
        });
      return rows.length;
    });
    return { changed: n };
  }

  /**
   * O cardápio que a IA enxerga: o de delivery (o mesmo do cardápio online), só com os itens
   * que o gerente liberou. Categorias sem item liberado somem.
   */
  async menuForAi(tx: Tx): Promise<AgentMenuCategory[]> {
    const rows = await q<{
      name: string;
      products: (AgentMenuCategory['products'][number] & { aiVisible: boolean })[];
    }>(tx, menuTreeSql(`'aiVisible', p.ai_visible,`), ['delivery']);
    return rows
      .map((c) => ({
        name: c.name,
        products: c.products
          .filter((p) => p.aiVisible)
          .map((p) => ({
            name: p.name,
            description: p.description,
            price: p.price,
            soldOut: p.soldOut,
            soldByWeight: !!p.soldByWeight,
            optionGroups: (p.optionGroups ?? []).map((g) => ({
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              options: g.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
            })),
          })),
      }))
      .filter((c) => c.products.length > 0);
  }

  /** Loja online agora (aberta, horário, entrega) e o link do cardápio. */
  private async storeIn(tx: Tx, storeUrl: string | null): Promise<AgentStore & { tz: string }> {
    const s = await one<{
      enabled: boolean;
      is_open: boolean;
      accepts_delivery: boolean;
      accepts_pickup: boolean;
      delivery_fee: string;
      min_order: string;
      eta_min: number;
      eta_max: number;
      address: string | null;
      hours_enabled: boolean;
      hours: StoreHour[];
      tz: string;
      dow: number;
      hhmm: string;
    }>(
      tx,
      `SELECT s.enabled, s.is_open, s.accepts_delivery, s.accepts_pickup, s.delivery_fee::text,
              s.min_order::text, s.eta_min, s.eta_max, s.address, s.hours_enabled, s.hours, z.tz,
              extract(dow FROM now() AT TIME ZONE z.tz)::int AS dow,
              to_char(now() AT TIME ZONE z.tz, 'HH24:MI') AS hhmm
         FROM (SELECT COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()),
                               'America/Sao_Paulo') AS tz) z
         LEFT JOIN tenant_store_settings s ON true`,
    );
    const enabled = s?.enabled ?? true;
    const hours = s?.hours ?? [];
    const openNow =
      enabled && (s?.is_open ?? true) && (!s?.hours_enabled || withinHours(hours, s.dow, s.hhmm));
    return {
      storeUrl: enabled ? storeUrl : null,
      openNow,
      acceptsDelivery: s?.accepts_delivery ?? true,
      acceptsPickup: s?.accepts_pickup ?? true,
      deliveryFee: s?.delivery_fee ?? null,
      minOrder: s?.min_order ?? null,
      etaMin: s?.eta_min ?? null,
      etaMax: s?.eta_max ?? null,
      address: s?.address ?? null,
      hours: s?.hours_enabled ? hoursText(hours) : null,
      tz: s?.tz ?? 'America/Sao_Paulo',
    };
  }

  /** Nome do restaurante e o endereço do cardápio online (domínio próprio ou subdomínio). */
  private async tenantInfo(ctx: { tenantId: string }) {
    return this.db.withCentral(ctx, async (tx) => {
      const t = await one<{ name: string; slug: string; host: string | null }>(
        tx,
        `SELECT t.name, t.slug,
                (SELECT d.hostname::text FROM tenant_domains d
                  WHERE d.tenant_id = t.id AND d.verified_at IS NOT NULL AND d.removed_at IS NULL
                  ORDER BY d.verified_at DESC LIMIT 1) AS host
           FROM tenants t WHERE t.id = $1`,
        [ctx.tenantId],
      );
      const base = this.env.COMANDOU_BASE_DOMAIN;
      const host = t?.host ?? (t ? `${t.slug}.${base}` : null);
      const scheme = base.endsWith('localhost') && !t?.host ? 'http' : 'https';
      return {
        name: t?.name ?? 'Restaurante',
        storeUrl: host ? `${scheme}://${host}/pedir` : null,
      };
    });
  }

  // ------------------------------------------------------------ IA (cota e chamada)

  private async platform(ctx: { tenantId: string }) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    return { c: qt.config, used: qt.used, blocked: qt.blocked };
  }

  /** Confere se a IA pode responder e devolve o cliente do OpenRouter. */
  private async client(ctx: { tenantId: string }) {
    const { c, blocked } = await this.platform(ctx);
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException('A IA ainda não foi ligada pelo Comandou');
    if (!c.tenant_enabled)
      throw new ServiceUnavailableException('A IA está desligada para este restaurante');
    if (blocked)
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ai_limit',
          message: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let key: string;
    try {
      key = open(this.env.INTEGRATIONS_KEY, c.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException('A chave da IA precisa ser salva de novo no painel');
    }
    return { client: new OpenRouterClient(this.env.OPENROUTER_BASE_URL, key), c };
  }

  private async recordUsage(
    ctx: { tenantId: string; userId: string | null },
    model: string,
    usage: { promptTokens: number; completionTokens: number; costUsd: number },
    source: 'whatsapp' | 'agent_test',
  ) {
    await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage, source }),
    );
  }

  /** Monta o prompt com o que o gerente configurou (ou com um rascunho, no teste). */
  private async prompt(
    ctx: { tenantId: string; userId?: string | null },
    fallbackName: string,
    draft?: Partial<AgentSettings>,
    customerName?: string | null,
  ) {
    const info = await this.tenantInfo(ctx);
    const { settings, menu, store } = await this.db.withTenant(ctx, async (tx) => ({
      settings: await this.settingsIn(tx),
      menu: await this.menuForAi(tx),
      store: await this.storeIn(tx, info.storeUrl),
    }));
    const s = { ...settings, ...(draft ?? {}) };
    return {
      settings: s,
      store,
      system: customerPrompt({
        settings: s,
        fallbackName,
        tenantName: info.name,
        menu,
        store,
        customerName,
        now: new Date(),
        timezone: store.tz,
      }),
    };
  }

  private async complete(client: OpenRouterClient, model: string, turns: ChatTurn[]) {
    try {
      return await client.stream(model, turns, () => undefined, {
        maxTokens: MAX_REPLY_TOKENS,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (e instanceof OpenRouterError) {
        this.logger.warn(`OpenRouter: ${e.message}`);
        throw new ServiceUnavailableException(
          'A IA não conseguiu responder agora. Tente de novo em instantes.',
        );
      }
      throw e;
    }
  }

  /**
   * Teste do gerente: conversa como se fosse um cliente, com a configuração da tela (mesmo sem
   * salvar). Não grava a conversa; o uso conta no limite do mês.
   */
  async test(
    ctx: Ctx,
    b: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      draft?: Partial<AgentSettings>;
    },
  ) {
    const { client, c } = await this.client(ctx);
    const p = await this.prompt(ctx, c.assistant_name, b.draft, null);
    const r = await this.complete(client, c.model, [
      { role: 'system', content: p.system },
      ...b.messages.slice(-HISTORY),
    ]);
    await this.recordUsage(ctx, c.model, r.usage, 'agent_test');
    const reply = parseReply(r.text);
    return {
      text: reply.text || 'Não consegui responder agora.',
      handoff: reply.handoff,
      tokens: r.usage.promptTokens + r.usage.completionTokens,
    };
  }

  // ------------------------------------------------------------ WhatsApp

  /**
   * Mensagem do cliente no WhatsApp. Devolve a resposta para enviar, ou null quando a IA não
   * deve responder (desligada pelo gerente, fora do horário escolhido, conversa com a equipe,
   * sem cota). Nunca lança erro para quem chama: falha vira log e null.
   */
  async handle(msg: InboundMessage, onThinking?: () => Promise<void>): Promise<AgentReply | null> {
    try {
      return await this.reply(msg, onThinking);
    } catch (e) {
      this.logger.warn(`Resposta no WhatsApp falhou (${msg.tenantId}): ${(e as Error).message}`);
      return null;
    }
  }

  private async reply(
    msg: InboundMessage,
    onThinking?: () => Promise<void>,
  ): Promise<AgentReply | null> {
    const text = msg.text?.trim();
    const phone = (msg.from ?? '').replace(/\D/g, '');
    if (!text || phone.length < 8 || phone.length > 20) return null;
    const ctx = { tenantId: msg.tenantId, userId: null };
    const settings = await this.db.withTenant(ctx, (tx) => this.settingsIn(tx));
    if (!settings.whatsappEnabled) return null;

    let ai: Awaited<ReturnType<AiAgentService['client']>>;
    try {
      ai = await this.client(ctx);
    } catch {
      return null; // IA desligada ou sem cota: a equipe responde pelo celular.
    }
    const p = await this.prompt(ctx, ai.c.assistant_name, undefined, msg.pushName ?? null);
    if (settings.replyWhen === 'open' && !p.store.openNow) return null;

    const name = msg.pushName?.trim().slice(0, 80) || null;
    let known: string | null = name;
    const history = await this.db.withTenant(ctx, async (tx) => {
      const chat = await one<{ paused: boolean; name: string | null }>(
        tx,
        `INSERT INTO ai_customer_chats (tenant_id, phone, name) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, phone) DO UPDATE
           SET last_at = now(), name = COALESCE(EXCLUDED.name, ai_customer_chats.name)
         RETURNING COALESCE(paused_until > now(), false) AS paused, name`,
        [ctx.tenantId, phone, name],
      );
      if (chat!.paused) return null;
      known = chat!.name;
      const rows = await q<{ role: 'user' | 'assistant'; content: string }>(
        tx,
        `SELECT role, content FROM (
           SELECT role, content, created_at FROM ai_customer_messages WHERE phone = $1
            ORDER BY created_at DESC LIMIT ${HISTORY}) x ORDER BY created_at`,
        [phone],
      );
      await q(
        tx,
        `INSERT INTO ai_customer_messages (tenant_id, phone, role, content) VALUES ($1, $2, 'user', $3)`,
        [ctx.tenantId, phone, text.slice(0, 4000)],
      );
      return rows;
    });
    if (!history) return null;
    await onThinking?.();

    const r = await this.complete(ai.client, ai.c.model, [
      { role: 'system', content: p.system },
      ...history,
      { role: 'user', content: text.slice(0, 4000) },
    ]);
    await this.recordUsage(ctx, ai.c.model, r.usage, 'whatsapp');
    const out = parseReply(r.text);
    if (!out.text) return null;
    const tokens = r.usage.promptTokens + r.usage.completionTokens;

    const managers = await this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `INSERT INTO ai_customer_messages (tenant_id, phone, role, content, tokens)
         VALUES ($1, $2, 'assistant', $3, $4)`,
        [ctx.tenantId, phone, out.text.slice(0, 4000), tokens],
      );
      if (!out.handoff) return [];
      await q(
        tx,
        `UPDATE ai_customer_chats SET paused_until = now() + interval '${HANDOFF_PAUSE_HOURS} hours'
          WHERE phone = $1`,
        [phone],
      );
      const rows = await q<{ id: string }>(
        tx,
        `SELECT user_id AS id FROM memberships WHERE status = 'active' AND role IN ('owner','manager','attendant')`,
      );
      for (const m of rows)
        await this.chat.notice(tx, ctx, m.id, {
          kind: 'ai',
          title: `Cliente pediu atendimento no WhatsApp${known ? `: ${known}` : ''}`,
          body: `Responda pelo WhatsApp da loja (${phone}). A IA fica quieta nessa conversa por ${HANDOFF_PAUSE_HOURS} horas. Última mensagem: "${text.slice(0, 160)}"`,
        });
      return rows.map((m) => m.id);
    });
    if (managers.length)
      this.realtime.publishToUsers(ctx.tenantId, managers, { type: 'chat.notice' });

    return { text: out.text, typingMs: typingMs(out.text), handoff: out.handoff };
  }
}

/** "Digitando…" proporcional ao tamanho da resposta: entre 1,2 s e 6 s. */
export function typingMs(text: string): number {
  return Math.max(1200, Math.min(6000, Math.round(text.length * 35)));
}
