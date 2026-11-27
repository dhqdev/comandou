import { ActionError, applyActions } from './template-actions';
import {
  readAnswer,
  templateAiPrompt,
  templateAiUserTurn,
  templateProblem,
} from './template-ai-prompt';
import type { TemplateKind } from './templates';

export interface TemplateAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TemplateAiRun {
  kind: TemplateKind;
  /** Modelo que está no editor. */
  body: string;
  /** Falas anteriores do mesmo papel e, por último, o pedido novo. */
  turns: { role: 'user' | 'assistant'; content: string }[];
  /** Pedido de exemplo para conferir o modelo novo (sintaxe e largura). */
  data: Record<string, unknown>;
  /** Como o modelo do editor sai hoje com esse exemplo (null = está com erro). */
  preview: string | null;
  /** Chama a IA com o prazo dado. Lança erro se ela não responder. */
  complete(
    messages: TemplateAiMessage[],
    timeoutMs: number,
  ): Promise<{ text: string; finish: string | null }>;
}

export type TemplateAiResult =
  | { ok: true; resposta: string; modelo: string | null; aviso: string | null }
  | { ok: false; error: string };

/** Prazo da primeira resposta e da segunda chance (somadas, abaixo de 1 minuto e meio). */
export const FIRST_MS = 40_000;
export const RETRY_MS = 30_000;

type Attempt =
  | { ok: true; resposta: string; body: string | null; wide: string | null }
  | { ok: false; error: string };

const WIDE_WARNING =
  'Alguma linha ficou mais larga que o papel e vai sair cortada. Confira na prévia ou peça para eu ajustar.';

/**
 * Uma conversa com a IA do modelo de impressão, sem banco nem rede (a chamada vem de fora): manda
 * o pedido, lê as ações, aplica no modelo do editor e confere. Se a resposta não serve (formato,
 * ação que não achou o trecho, erro de sintaxe, linha larga demais), a IA recebe o problema e tem
 * uma segunda chance. Testado em `template-ai-flow.test.ts` com uma IA falsa.
 */
export async function runTemplateAi(run: TemplateAiRun): Promise<TemplateAiResult> {
  const history = run.turns.slice(-7);
  const last = history.pop();
  if (!last || last.role !== 'user') return { ok: false, error: 'falta o pedido da pessoa' };
  const messages: TemplateAiMessage[] = [
    { role: 'system', content: templateAiPrompt(run.kind) },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: templateAiUserTurn(run.kind, last.content, run.body, run.preview) },
  ];

  const attempt = async (raw: string, finish: string | null): Promise<Attempt> => {
    const a = readAnswer(raw);
    if (!a.ok)
      return {
        ok: false,
        error:
          finish === 'length'
            ? 'a resposta veio cortada (longa demais). Use ações curtas: troque só as linhas que mudam.'
            : a.error,
      };
    if (!a.acoes.length) return { ok: true, resposta: a.resposta, body: null, wide: null };
    let next: string;
    try {
      next = applyActions(run.body, run.kind, a.acoes).body;
    } catch (e) {
      if (e instanceof ActionError) return { ok: false, error: e.message };
      throw e;
    }
    const issue = await templateProblem(next, run.data);
    if (issue?.kind === 'erro')
      return { ok: false, error: `o modelo ficaria com erro: ${issue.text}` };
    return { ok: true, resposta: a.resposta, body: next, wide: issue?.text ?? null };
  };

  const first = await run.complete(messages, FIRST_MS);
  let result = await attempt(first.text, first.finish);
  if (!result.ok || result.wide) {
    messages.push(
      { role: 'assistant', content: first.text.slice(0, 6000) || '(resposta vazia)' },
      {
        role: 'user',
        content: `Isso não deu certo: ${result.ok ? result.wide : result.error}\nO modelo continua como estava (o do pedido acima). Mande de novo o JSON {"resposta": "...", "acoes": [...]} corrigido.`,
      },
    );
    try {
      const second = await run.complete(messages, RETRY_MS);
      const again = await attempt(second.text, second.finish);
      // Fica a segunda se ela serve; com as duas largas (ou as duas com erro), tanto faz.
      if (!result.ok || (again.ok && !again.wide)) result = again;
    } catch (e) {
      // A segunda chance não respondeu: fica a primeira, se ela servia (só a largura).
      if (!result.ok) throw e;
    }
  }
  if (!result.ok) return result;
  return {
    ok: true,
    resposta: result.resposta,
    modelo: result.body,
    aviso: result.wide ? WIDE_WARNING : null,
  };
}
