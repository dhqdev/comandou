import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { roleHas, type Role } from '@comandou/shared';
import { Ctx } from '../common/context';
import { open } from '../common/secret-box';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { systemPrompt } from './ai-guide';
import { availableTokens, loadAiQuota, recordAiUsage } from './ai-quota';
import { ChatService } from './chat.service';
import { ChatTurn, OpenRouterClient, OpenRouterError } from './openrouter';

/** Contexto da chave no secret-box (a mesma usada pelo painel). */
export const AI_KEY_CONTEXT = 'ai:openrouter';
/** Mensagens anteriores que vão junto em cada pergunta (memória curta, para gastar pouco). */
const HISTORY = 10;
/** Avisa os gestores quando o restaurante passa destas porcentagens do limite do mês. */
const WARN_AT = [80, 100];

export interface Prepared {
  ctx: Ctx;
  model: string;
  name: string;
  apiKey: string;
  limit: number;
  usedBefore: number;
  bonus: number;
  turns: ChatTurn[];
}

/**
 * Assistente de IA do chat: guia a equipe no uso do sistema. Fala com o OpenRouter usando a
 * chave do painel Super Admin, grava a conversa no banco do restaurante e o uso (tokens e custo)
 * no banco central, onde o painel soma tudo. Cada restaurante tem um limite de tokens por mês.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
  ) {}

  private async config(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    return { c: qt.config, used: qt.used, blocked: qt.blocked };
  }

  /** Uso do mês para a tela: limite, extras doados pelo Comandou e quanto ainda dá. */
  private usageView(used: number, limit: number, bonus: number) {
    return {
      used,
      limit,
      bonus,
      available: availableTokens(limit, used, bonus),
      percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : null,
    };
  }

  /** O que a aba IA precisa para abrir: ligado ou não, nome, uso do mês e a conversa. */
  async status(ctx: Ctx) {
    const { c, used, blocked } = await this.config(ctx);
    const messages = await this.db.withTenant(ctx, (tx) =>
      q<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: Date }>(
        tx,
        `SELECT id, role, content, created_at AS "createdAt" FROM (
           SELECT * FROM ai_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60) x
          ORDER BY created_at`,
        [ctx.userId],
      ),
    );
    const reason = !c.enabled
      ? 'platform'
      : !c.tenant_enabled
        ? 'tenant'
        : !this.env.INTEGRATIONS_KEY
          ? 'platform'
          : blocked
            ? 'limit'
            : null;
    return {
      enabled: reason === null,
      reason,
      name: c.assistant_name,
      usage: this.usageView(used, c.monthly_tokens, c.bonus_tokens),
      messages,
    };
  }

  /** Confere tudo antes de abrir o streaming (erros aqui viram resposta HTTP normal). */
  async prepare(
    ctx: Ctx,
    content: string,
    screen: string | null,
    tenantName: string,
  ): Promise<Prepared> {
    const { c, used, blocked } = await this.config(ctx);
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException('O assistente ainda não foi ligado pelo Comandou');
    if (!c.tenant_enabled)
      throw new ServiceUnavailableException('O assistente está desligado para este restaurante');
    if (blocked)
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ai_limit',
          message:
            'O limite de uso do assistente neste mês acabou. Fale com o suporte do Comandou.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let apiKey: string;
    try {
      apiKey = open(this.env.INTEGRATIONS_KEY, c.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException(
        'A chave do assistente precisa ser salva de novo no painel',
      );
    }
    const history = await this.db.withTenant(ctx, async (tx) => {
      const rows = await q<{ role: 'user' | 'assistant'; content: string }>(
        tx,
        `SELECT role, content FROM (
           SELECT role, content, created_at FROM ai_messages WHERE user_id = $1
            ORDER BY created_at DESC LIMIT ${HISTORY}) x ORDER BY created_at`,
        [ctx.userId],
      );
      await q(
        tx,
        `INSERT INTO ai_messages (tenant_id, user_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [ctx.tenantId, ctx.userId, content],
      );
      return rows;
    });
    const state = await this.snapshot(ctx);
    const turns: ChatTurn[] = [
      {
        role: 'system',
        content: systemPrompt({
          assistantName: c.assistant_name,
          userName: ctx.user.name,
          role: ctx.user.role,
          tenantName,
          screen,
          now: new Date(),
          state,
        }),
      },
      ...history,
      { role: 'user', content },
    ];
    return {
      ctx,
      model: c.model,
      name: c.assistant_name,
      apiKey,
      limit: c.monthly_tokens,
      usedBefore: used,
      bonus: c.bonus_tokens,
      turns,
    };
  }

  /**
   * Retrato curto da operação para o assistente diagnosticar ("não consigo receber" com o caixa
   * fechado, por exemplo). Uma consulta só; se falhar, o assistente segue sem ele.
   */
  async snapshot(ctx: Ctx): Promise<string[]> {
    try {
      const r = await this.db.withTenant(ctx, (tx) =>
        one<{
          cash_open: number;
          tabs_open: number;
          tabs_bill: number;
          orders_active: number;
          orders_cancel_req: number;
          sold_out: number;
          store_enabled: boolean | null;
          store_open: boolean | null;
          fiscal_enabled: boolean | null;
          fiscal_env: string | null;
          fiscal_cnpj: boolean | null;
          fiscal_cert_until: string | null;
          printers_online: number;
          printers: number;
          whatsapp: boolean | null;
        }>(
          tx,
          `SELECT
             (SELECT count(*)::int FROM cash_sessions WHERE status = 'open') AS cash_open,
             (SELECT count(*)::int FROM tabs WHERE status = 'open') AS tabs_open,
             (SELECT count(*)::int FROM tabs WHERE status = 'open' AND bill_requested_at IS NOT NULL) AS tabs_bill,
             (SELECT count(*)::int FROM orders
               WHERE status IN ('awaiting', 'new', 'in_production', 'ready', 'dispatched')) AS orders_active,
             (SELECT count(*)::int FROM orders WHERE status = 'cancel_requested') AS orders_cancel_req,
             (SELECT count(*)::int FROM products WHERE active AND sold_out) AS sold_out,
             (SELECT enabled FROM tenant_store_settings LIMIT 1) AS store_enabled,
             (SELECT is_open FROM tenant_store_settings LIMIT 1) AS store_open,
             (SELECT enabled FROM tenant_fiscal_settings LIMIT 1) AS fiscal_enabled,
             (SELECT environment FROM tenant_fiscal_settings LIMIT 1) AS fiscal_env,
             (SELECT cnpj IS NOT NULL FROM tenant_fiscal_settings LIMIT 1) AS fiscal_cnpj,
             (SELECT certificate_valid_until::text FROM tenant_fiscal_settings LIMIT 1) AS fiscal_cert_until,
             (SELECT count(*)::int FROM print_agents
               WHERE active AND last_seen_at > now() - interval '2 minutes') AS printers_online,
             (SELECT count(*)::int FROM print_agents WHERE active) AS printers,
             (SELECT enabled FROM tenant_messaging_settings LIMIT 1) AS whatsapp`,
        ),
      );
      if (!r) return [];
      const costs = await this.costLines(ctx);
      const out = [
        r.cash_open
          ? `Caixa: ${r.cash_open} aberto(s).`
          : 'Caixa: nenhum aberto (sem caixa aberto não dá para receber).',
        `Comandas abertas: ${r.tabs_open}${r.tabs_bill ? ` (${r.tabs_bill} pediram a conta)` : ''}.`,
        `Pedidos em andamento: ${r.orders_active}${r.orders_cancel_req ? `; ${r.orders_cancel_req} com cancelamento pedido esperando aprovação` : ''}.`,
        `Itens esgotados no cardápio: ${r.sold_out}.`,
        r.store_enabled
          ? `Loja online: ligada, ${r.store_open === false ? 'fechada agora' : 'aberta'}.`
          : 'Loja online: desligada.',
        r.fiscal_enabled
          ? `Nota fiscal: ligada em ${r.fiscal_env === 'producao' ? 'produção' : 'homologação (teste)'}${r.fiscal_cert_until ? `, certificado vale até ${r.fiscal_cert_until.slice(0, 10)}` : ', sem certificado'}.`
          : `Nota fiscal: desligada${r.fiscal_cnpj ? '' : ' (CNPJ não informado)'}.`,
        r.printers
          ? `Impressão: ${r.printers_online} de ${r.printers} computador(es) de impressão online.`
          : 'Impressão: nenhum computador de impressão conectado.',
        `WhatsApp: ${r.whatsapp ? 'ligado' : 'desligado'}.`,
        ...costs,
      ];
      return out;
    } catch (e) {
      this.logger.warn(`Retrato da operação falhou: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Custos para quem vê custos (estoque ou relatórios): as últimas mudanças automáticas e os
   * itens do cardápio em que o custo da ficha mais pesa no preço. Assim o assistente responde
   * "quanto custa fazer o X?" ou "por que minha margem caiu?" com números de verdade.
   */
  private async costLines(ctx: Ctx): Promise<string[]> {
    const role = ctx.user?.role as Role | undefined;
    if (!role || !(roleHas(role, 'stock:write') || roleHas(role, 'reports:read'))) return [];
    try {
      return await this.db.withTenant(ctx, async (tx) => {
        const changes = await q<{
          source: string;
          label: string | null;
          created_at: Date;
          items: { name: string; unit: string; oldCost: string; newCost: string }[];
          products: { name: string }[];
        }>(
          tx,
          `SELECT source, label, created_at, items, products FROM stock_cost_changes
            WHERE created_at > now() - interval '30 days' AND jsonb_array_length(products) > 0
            ORDER BY created_at DESC LIMIT 3`,
        );
        const menu = await q<{ name: string; price: string; cost: string }>(
          tx,
          `SELECT p.name, p.price::text AS price, round(sum(r.quantity * si.avg_cost), 2)::text AS cost
             FROM products p
             JOIN product_recipes r ON r.product_id = p.id
             JOIN stock_items si ON si.id = r.stock_item_id
            WHERE p.active AND p.price > 0
            GROUP BY p.id
            ORDER BY sum(r.quantity * si.avg_cost) / p.price DESC
            LIMIT 12`,
        );
        const out: string[] = [];
        const when = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        for (const c of changes) {
          const it = c.items
            .slice(0, 3)
            .map((i) => `${i.name} ${money(i.oldCost)} → ${money(i.newCost)}/${i.unit}`)
            .join(', ');
          out.push(
            `Custo mudou em ${when(c.created_at)} (${c.label ?? c.source}): ${it}; ${c.products.length} item(ns) do cardápio recalculado(s) sozinho(s).`,
          );
        }
        if (menu.length)
          out.push(
            `Custo pela ficha técnica agora (itens em que o custo mais pesa no preço): ${menu
              .map(
                (m) =>
                  `${m.name} custa ${money(m.cost)} e vende a ${money(m.price)} (${Math.round((Number(m.cost) / Number(m.price)) * 100)}% do preço)`,
              )
              .join('; ')}.`,
          );
        return out;
      });
    } catch (e) {
      this.logger.warn(`Custos para o assistente falharam: ${(e as Error).message}`);
      return [];
    }
  }

  /** Conversa com o modelo, grava a resposta e o uso. */
  async run(p: Prepared, onDelta: (t: string) => void, signal?: AbortSignal) {
    const client = new OpenRouterClient(this.env.OPENROUTER_BASE_URL, p.apiKey);
    let text = '';
    let usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    try {
      const r = await client.stream(p.model, p.turns, onDelta, { signal });
      text = r.text;
      usage = r.usage;
    } catch (e) {
      if (e instanceof OpenRouterError) {
        this.logger.warn(`OpenRouter: ${e.message}`);
        throw new ServiceUnavailableException(
          e.status === 402 || e.status === 401
            ? 'O assistente está indisponível agora. Avise o suporte do Comandou.'
            : 'O assistente não conseguiu responder agora. Tente de novo em instantes.',
        );
      }
      throw e;
    }
    const answer = text.trim() || 'Não consegui responder agora. Pode perguntar de outro jeito?';
    const tokens = usage.promptTokens + usage.completionTokens;
    const saved = await this.db.withTenant(p.ctx, (tx) =>
      one<{ id: string; createdAt: Date }>(
        tx,
        `INSERT INTO ai_messages (tenant_id, user_id, role, content, tokens)
         VALUES ($1, $2, 'assistant', $3, $4) RETURNING id, created_at AS "createdAt"`,
        [p.ctx.tenantId, p.ctx.userId, answer.slice(0, 12000), tokens],
      ),
    );
    const rec = await this.db.withCentral(p.ctx, (tx) =>
      recordAiUsage(tx, { userId: p.ctx.userId, model: p.model, usage, source: 'chat' }),
    );
    const usedAfter = Math.max(rec.usedMonth, p.usedBefore + tokens);
    await this.warnIfCrossed(p, usedAfter, rec.bonusLeft);
    return {
      id: saved!.id,
      content: answer,
      createdAt: saved!.createdAt,
      usage: this.usageView(usedAfter, p.limit, rec.bonusLeft),
    };
  }

  /** Passou de 80% ou 100% do limite do mês: aviso para administradores e gerentes. */
  private async warnIfCrossed(p: Prepared, usedAfter: number, bonusLeft: number) {
    if (p.limit <= 0) return;
    const before = (p.usedBefore / p.limit) * 100;
    const after = (usedAfter / p.limit) * 100;
    const crossed = WARN_AT.filter((w) => before < w && after >= w).pop();
    if (crossed === undefined) return;
    const managers = await this.db.withTenant(p.ctx, async (tx) => {
      const rows = await q<{ id: string }>(
        tx,
        `SELECT user_id AS id FROM memberships WHERE status = 'active' AND role IN ('owner','manager')`,
      );
      for (const r of rows)
        await this.chat.notice(tx, p.ctx, r.id, {
          kind: 'ai',
          title:
            crossed >= 100
              ? `O assistente ${p.name} atingiu o limite do mês`
              : `O assistente ${p.name} já usou ${crossed}% do limite do mês`,
          body:
            crossed >= 100
              ? bonusLeft > 0
                ? `Agora ele usa os tokens extras que o Comandou liberou (sobram ${bonusLeft.toLocaleString('pt-BR')}).`
                : 'Até o mês virar, ele não responde. Para aumentar o limite, fale com o suporte do Comandou.'
              : 'Quando chegar a 100%, ele para de responder até o próximo mês.',
        });
      return rows.map((r) => r.id);
    });
    this.realtime.publishToUsers(p.ctx.tenantId, managers, { type: 'chat.notice' });
  }

  async clear(ctx: Ctx) {
    await this.db.withTenant(ctx, (tx) =>
      q(tx, `DELETE FROM ai_messages WHERE user_id = $1`, [ctx.userId]),
    );
    return { ok: true };
  }
}

/** "12.5" → "R$ 12,50". */
function money(v: string): string {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}
