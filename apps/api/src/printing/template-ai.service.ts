import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parsePrintLines, PRINT_BIG_WIDTH, printLineColumns } from '@comandou/shared';
import { z } from 'zod';
import { AI_KEY_CONTEXT } from '../chat/ai.service';
import { loadAiQuota, recordAiUsage } from '../chat/ai-quota';
import { OpenRouterClient, OpenRouterError, type Usage } from '../chat/openrouter';
import type { Ctx } from '../common/context';
import { open } from '../common/secret-box';
import { one } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { templateAiPrompt, templateAiUserTurn } from './template-ai-prompt';
import {
  checkTemplate,
  renderTemplate,
  sampleData,
  TEMPLATE_MAX,
  TemplateKind,
  WIDTH,
} from './templates';

/** Conversa que a tela manda: as últimas falas (a última é o pedido novo). */
export interface TemplateAiTurn {
  role: 'user' | 'assistant';
  content: string;
}

const Answer = z.object({
  resposta: z.string().trim().min(1).max(2000),
  modelo: z.string().max(TEMPLATE_MAX).nullable().optional(),
});

/** Linhas que passam da bobina no papel de exemplo (a letra grande conta em dobro). */
export function overflowLines(text: string): string[] {
  return parsePrintLines(text)
    .filter((l) => printLineColumns(l) > WIDTH)
    .map((l) =>
      'text' in l ? `${l.kind === 'big' ? `(grande, máx. ${PRINT_BIG_WIDTH}) ` : ''}${l.text}` : '',
    );
}

/** Lê o JSON da IA (tolera cerca de código em volta). */
export function readAnswer(raw: string) {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const r = Answer.safeParse(JSON.parse(t.slice(start, end + 1)));
    return r.success ? { resposta: r.data.resposta, modelo: r.data.modelo?.trim() || null } : null;
  } catch {
    return null;
  }
}

/**
 * IA que ajuda a ajustar o modelo de impressão (conversa ao lado do editor). Ela só propõe: a
 * proposta volta para a tela, a pessoa aplica no editor, vê a prévia e salva pelo caminho de
 * sempre (que valida de novo). Nada é salvo aqui. Usa a mesma chave, modelo e limite do
 * assistente do restaurante; o gasto entra como "print_template".
 */
@Injectable()
export class TemplateAiService {
  private readonly logger = new Logger('TemplateAiService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
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
    data.loja = { ...(data.loja as object), logo: true };
    try {
      return { data, text: await renderTemplate(body, data) };
    } catch {
      return { data, text: null };
    }
  }

  /** O modelo proposto é válido? Devolve o problema em palavras (para a IA corrigir) ou null. */
  private async problem(body: string, data: Record<string, unknown>) {
    if (body.includes('@@'))
      return 'O modelo tem marcas "@@" escritas à mão. Use os filtros negrito e grande e a variável loja.logo.';
    try {
      checkTemplate(body);
      const out = await renderTemplate(body, data);
      const wide = overflowLines(out);
      if (wide.length)
        return `Estas linhas passam de 42 colunas no papel (letra grande conta em dobro): ${wide
          .slice(0, 5)
          .map((l) => JSON.stringify(l))
          .join('; ')}`;
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async ask(ctx: Ctx, kind: TemplateKind, body: string, turns: TemplateAiTurn[]) {
    const { model, client } = await this.ready(ctx);
    const { data, text } = await this.sample(ctx, kind, body);
    const history = turns.slice(-8);
    const last = history.pop()!;
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: templateAiPrompt(kind) },
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: templateAiUserTurn(last.content, body, text) },
    ];
    const total: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    const call = async () => {
      let r: Awaited<ReturnType<OpenRouterClient['complete']>>;
      try {
        r = await client.complete(model, messages, {
          json: true,
          maxTokens: 6000,
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        this.logger.warn(`IA do modelo de impressão falhou: ${(e as Error).message}`);
        throw new ServiceUnavailableException(
          e instanceof OpenRouterError
            ? 'A IA não respondeu agora. Tente de novo em instantes.'
            : 'Não deu para falar com a IA. Tente de novo em instantes.',
        );
      }
      total.promptTokens += r.usage.promptTokens;
      total.completionTokens += r.usage.completionTokens;
      total.costUsd += r.usage.costUsd;
      return r.text;
    };
    try {
      let raw = await call();
      let answer = readAnswer(raw);
      let issue = answer?.modelo ? await this.problem(answer.modelo, data) : null;
      // Uma segunda chance: a IA recebe o erro (ou a resposta que não deu para ler) e corrige.
      if (!answer || issue) {
        messages.push(
          { role: 'assistant', content: raw.slice(0, TEMPLATE_MAX + 2000) },
          {
            role: 'user',
            content: answer
              ? `O modelo que você mandou tem um problema: ${issue}\nCorrija e mande de novo o JSON completo.`
              : 'Sua resposta não veio no formato pedido. Mande só o JSON {"resposta": "...", "modelo": "..." ou null}.',
          },
        );
        raw = await call();
        const again = readAnswer(raw);
        if (again) {
          answer = again;
          issue = again.modelo ? await this.problem(again.modelo, data) : null;
        }
      }
      if (!answer)
        return {
          resposta: 'Não consegui montar a mudança agora. Pode pedir de outro jeito?',
          modelo: null,
          aviso: null,
        };
      // Erro de sintaxe não vai para o editor; linha comprida vai, com o aviso (a prévia mostra).
      const broken = !!issue && !issue.startsWith('Estas linhas');
      return {
        resposta: answer.resposta,
        modelo: broken ? null : answer.modelo,
        aviso: broken
          ? `A mudança proposta tinha um erro e não foi aplicada (${issue}). Tente pedir de outro jeito.`
          : issue,
      };
    } finally {
      if (total.promptTokens || total.completionTokens)
        await this.db
          .withCentral(ctx, (tx) =>
            recordAiUsage(tx, {
              userId: ctx.userId,
              model,
              usage: total,
              source: 'print_template',
            }),
          )
          .catch((e: Error) => this.logger.warn(`Uso da IA não gravado: ${e.message}`));
    }
  }
}
