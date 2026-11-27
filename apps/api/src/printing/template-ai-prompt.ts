import {
  parsePrintLines,
  PRINT_BIG_WIDTH,
  PRINT_TEMPLATE_FILTERS,
  PRINT_TEMPLATE_HELP,
  PRINT_TEMPLATE_LABELS,
  PRINT_TEMPLATE_VARS,
  printLineColumns,
} from '@comandou/shared';
import { z } from 'zod';
import { ActionError, readActions, templateFacts, type TemplateAction } from './template-actions';
import { printAiInstructions, skillsPrompt } from './template-skills';
import {
  BIG,
  checkTemplate,
  DEFAULT_TEMPLATES,
  renderTemplate,
  TEMPLATE_MAX,
  type TemplateKind,
  WIDTH,
} from './templates';

/**
 * Instruções da IA que ajuda o restaurante a mudar o modelo de impressão (Impressão › Modelos de
 * impressão, conversa no canto da tela). O texto fica em assets/ai/impressao/instrucoes.md e as
 * skills em assets/ai/impressao/skills/*.md; aqui só se preenchem as marcas <<NOME>> com o papel,
 * as variáveis, os ajudantes, o modelo padrão e as skills do papel. A mensagem do sistema não
 * muda entre perguntas do mesmo papel (sai do cache do provedor); o que muda vai na do usuário.
 */
export function templateAiPrompt(kind: TemplateKind): string {
  const fill: Record<string, string> = {
    PAPEL: PRINT_TEMPLATE_LABELS[kind],
    AJUDA: PRINT_TEMPLATE_HELP[kind],
    LARGURA: String(WIDTH),
    GRANDE: String(BIG),
    LIMITE: String(TEMPLATE_MAX),
    VARIAVEIS: PRINT_TEMPLATE_VARS[kind].map(([v, d]) => `- ${v}: ${d}`).join('\n'),
    AJUDANTES: PRINT_TEMPLATE_FILTERS.map(([v, d]) => `- ${v} → ${d}`).join('\n'),
    PADRAO: DEFAULT_TEMPLATES[kind],
    SKILLS: skillsPrompt(kind),
  };
  return printAiInstructions()
    .replace(/<<([A-Z]+)>>/g, (all, k: string) => fill[k] ?? all)
    .trim();
}

/**
 * Mensagem do usuário: o papel, o pedido, o que o papel mostra hoje (os nomes certos para a ação
 * remover), o modelo do editor e como ele sai hoje com um pedido de exemplo.
 */
/** Comentário do editor visual (`compileLayout` do shared). */
const VISUAL_TAG = /^\{% comment %\}comandou-visual [A-Za-z0-9+/=]*\{% endcomment %\}/;

export function templateAiUserTurn(
  kind: TemplateKind,
  ask: string,
  body: string,
  preview: string | null,
) {
  // Os blocos do editor visual ficam num comentário no começo: a IA não precisa ler.
  body = body.replace(VISUAL_TAG, '');
  const f = templateFacts(body);
  return `Papel: ${PRINT_TEMPLATE_LABELS[kind]}

Pedido da pessoa:
${ask}

O que o papel mostra hoje:
- logo: ${f.logo ? 'sim' : 'não'}
- dados: ${f.vars.join(', ') || 'nenhum'}
- textos fixos: ${f.texts.map((t) => JSON.stringify(t)).join(', ') || 'nenhum'}

Modelo que está no editor agora (copie daqui o "de" da ação trocar):
<<<MODELO
${body}
MODELO>>>
${
  preview !== null
    ? `
Como ele sai no papel com um pedido de exemplo ("@@N@@" no começo = negrito, "@@G@@" = letra grande, "@@LOGO@@" = logo; nunca escreva essas marcas):
<<<PAPEL
${preview}
PAPEL>>>`
    : `
O modelo do editor tem um erro e não monta o papel agora: conserte com trocar ou volte ao padrão.`
}`;
}

const Answer = z.object({
  resposta: z.string().trim().min(1).max(2000),
  acoes: z.unknown().optional(),
  // A IA às vezes manda o modelo inteiro (o formato antigo): vale como "reescrever".
  modelo: z.string().max(TEMPLATE_MAX).nullable().optional(),
});

export type ReadAnswer =
  { ok: true; resposta: string; acoes: TemplateAction[] } | { ok: false; error: string };

/** Lê o JSON da IA (tolera cerca de código em volta) e as ações dentro dele. */
export function readAnswer(raw: string): ReadAnswer {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  const format =
    'A resposta não veio no formato pedido. Mande só o JSON {"resposta": "...", "acoes": [...]}.';
  if (start < 0 || end <= start) return { ok: false, error: format };
  let json: unknown;
  try {
    json = JSON.parse(t.slice(start, end + 1));
  } catch {
    return { ok: false, error: format };
  }
  const r = Answer.safeParse(json);
  if (!r.success) return { ok: false, error: format };
  try {
    const acoes = readActions(r.data.acoes);
    const whole = r.data.modelo?.trim();
    if (!acoes.length && whole) acoes.push({ tipo: 'reescrever', modelo: whole });
    return { ok: true, resposta: r.data.resposta, acoes };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Linhas que passam da bobina no papel de exemplo (a letra grande conta em dobro). */
export function overflowLines(text: string): string[] {
  return parsePrintLines(text)
    .filter((l) => printLineColumns(l) > WIDTH)
    .map((l) =>
      'text' in l ? `${l.kind === 'big' ? `(grande, máx. ${PRINT_BIG_WIDTH}) ` : ''}${l.text}` : '',
    );
}

/**
 * O modelo proposto funciona? `erro` = não monta (não vai para o editor); `largura` = monta, mas
 * alguma linha passa do papel (vai, com aviso, se a segunda chance não resolver).
 */
export async function templateProblem(
  body: string,
  data: Record<string, unknown>,
): Promise<{ kind: 'erro' | 'largura'; text: string } | null> {
  if (body.includes('@@'))
    return {
      kind: 'erro',
      text: 'o modelo tem marcas "@@" escritas à mão. Use os filtros negrito e grande e a variável loja.logo.',
    };
  try {
    checkTemplate(body);
    const out = await renderTemplate(body, data);
    const wide = overflowLines(out);
    if (wide.length)
      return {
        kind: 'largura',
        text: `estas linhas passam de ${WIDTH} colunas no papel (a letra grande conta em dobro): ${wide
          .slice(0, 5)
          .map((l) => JSON.stringify(l))
          .join('; ')}`,
      };
    return null;
  } catch (e) {
    return { kind: 'erro', text: (e as Error).message };
  }
}
