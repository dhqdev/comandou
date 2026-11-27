import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AI_KEY_CONTEXT } from '../chat/ai.service';
import { chatFallbacks } from '../chat/ai-models';
import { loadAiQuota, recordAiUsage } from '../chat/ai-quota';
import { OpenRouterClient, OpenRouterError, type Usage } from '../chat/openrouter';
import type { Ctx } from '../common/context';
import { open } from '../common/secret-box';
import { one } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { PrintingService } from './printing.service';
import { runTemplateAi } from './template-ai-flow';
import { renderTemplate, sampleData, TemplateKind } from './templates';

/** Conversa que a tela manda: as últimas falas do papel (a última é o pedido novo). */
export interface TemplateAiTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** As ações são curtas; "reescrever" (raro) é o que mais gasta. */
const MAX_TOKENS = 3000;

/**
 * IA que ajuda a ajustar o modelo de impressão (conversa no canto da tela Impressão). Ela não
 * escreve o modelo inteiro: responde com ações curtas (as skills de `template-actions.ts`, com os
 * exemplos em assets/ai/impressao/skills) e o servidor muda o modelo, confere sintaxe e largura e
 * devolve o modelo novo já com a prévia, que a tela troca na hora. Raciocínio desligado e
 * provedores rápidos: o DeepSeek pensava antes de responder, o pensamento comia o limite de tokens
 * e o modelo inteiro chegava cortado ("demorou muito e deu erro", 0.274). A conversa em si
 * (tentativa, segunda chance) mora em `template-ai-flow.ts`, testada sem rede.
 *
 * Nada é salvo aqui: a pessoa salva pelo caminho de sempre (que valida de novo). Usa a mesma
 * chave, modelo e limite do assistente do restaurante; o gasto entra como "print_template".
 */
@Injectable()
export class TemplateAiService {
  private readonly logger = new Logger('TemplateAiService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly printing: PrintingService,
  ) {}

  /** A tela pergunta antes de mostrar a conversa: está ligada? */
  async status(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    const reason =
      !c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY
        ? 'platform'
        : !c.tenant_enabled
          ? 'tenant'
          : qt.blocked
            ? 'limit'
            : null;
    return { enabled: reason === null, reason, name: c.assistant_name };
  }

  private async ready(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException('A IA ainda não foi ligada pelo Comandou');
    if (!c.tenant_enabled)
      throw new ServiceUnavailableException('A IA está desligada para este restaurante');
    if (qt.blocked)
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ai_limit',
          message: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let apiKey: string;
    try {
      apiKey = open(this.env.INTEGRATIONS_KEY, c.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException('A chave da IA precisa ser salva de novo no painel');
    }
    return { model: c.model, client: new OpenRouterClient(this.env.OPENROUTER_BASE_URL, apiKey) };
  }

  /** Exemplo para a IA ver como o modelo sai hoje (null se o modelo do editor tem erro). */
  private async sample(ctx: Ctx, kind: TemplateKind, body: string) {
    const t = await this.db.withTenant(ctx, (tx) =>
      one<{ name: string }>(tx, `SELECT name FROM tenants LIMIT 1`),
    );
    const data = sampleData(kind, t?.name ?? 'Restaurante');
    if (kind !== 'fiscal_footer') data.loja = { ...(data.loja as object), logo: true };
    try {
      return { data, text: await renderTemplate(body, data) };
    } catch {
      return { data, text: null };
    }
  }

  async ask(ctx: Ctx, kind: TemplateKind, body: string, turns: TemplateAiTurn[]) {
    const { model, client } = await this.ready(ctx);
    const { data, text } = await this.sample(ctx, kind, body);
    const total: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    // O modelo que respondeu de fato (a reserva entra se o escolhido falhar): é o que fica no uso.
    let served = model;
    try {
      const r = await runTemplateAi({
        kind,
        body,
        turns,
        data,
        preview: text,
        complete: async (messages, ms) => {
          try {
            const res = await client.complete(model, messages, {
              json: true,
              maxTokens: MAX_TOKENS,
              reasoning: false,
              fast: true,
              signal: AbortSignal.timeout(ms),
              fallbacks: chatFallbacks(model),
            });
            total.promptTokens += res.usage.promptTokens;
            total.completionTokens += res.usage.completionTokens;
            total.costUsd += res.usage.costUsd;
            served = res.model;
            return res;
          } catch (e) {
            this.logger.warn(`IA do modelo de impressão falhou: ${(e as Error).message}`);
            throw new ServiceUnavailableException(
              (e as Error).name === 'TimeoutError'
                ? 'A IA demorou demais para responder. Tente de novo em instantes.'
                : e instanceof OpenRouterError
                  ? 'A IA não respondeu agora. Tente de novo em instantes.'
                  : 'Não deu para falar com a IA. Tente de novo em instantes.',
            );
          }
        },
      });
      if (!r.ok) {
        this.logger.warn(`IA do modelo de impressão: mudança recusada (${r.error})`);
        return {
          resposta:
            'Não consegui fazer essa mudança sem quebrar o papel. Tente pedir de um jeito mais simples, uma coisa por vez.',
          modelo: null,
          aviso: null,
          previa: null,
        };
      }
      // A prévia do modelo novo vem junto (mesmos dados da aba Prévia): a tela troca na hora.
      const previa = r.modelo
        ? await this.printing.previewTemplate(ctx, kind, r.modelo).catch(() => null)
        : null;
      return { resposta: r.resposta, modelo: r.modelo, aviso: r.aviso, previa };
    } finally {
      if (total.promptTokens || total.completionTokens)
        await this.db
          .withCentral(ctx, (tx) =>
            recordAiUsage(tx, {
              userId: ctx.userId,
              model: served,
              usage: total,
              source: 'print_template',
            }),
          )
          .catch((e: Error) => this.logger.warn(`Uso da IA não gravado: ${e.message}`));
    }
  }
}
