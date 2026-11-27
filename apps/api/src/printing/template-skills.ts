import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_KINDS, type TemplateKind } from './templates';

/**
 * Skills da IA do modelo de impressão, no jeito das skills do Claude: um .md por pedido comum em
 * apps/api/assets/ai/impressao/skills (título, quando usar, em quais papéis e o corpo com o
 * exemplo de ação e os trechos de Liquid), mais as instruções gerais em instrucoes.md. Mudar o
 * jeito da IA = editar os .md, sem mexer no código. O teste `template-skills.test.ts` aplica cada
 * exemplo nos modelos padrão: exemplo que não funciona na impressora quebra o CI.
 *
 * Skill nova: um .md na pasta, com o cabeçalho
 *   ---
 *   titulo: …
 *   quando:
 *     - frase que o dono costuma escrever
 *   papeis: todos | receipt, delivery_slip, kitchen_ticket, fiscal_footer
 *   ---
 * e blocos ```json (ação) ou ```liquid (trecho). Bloco que só vale em alguns papéis leva os papéis
 * depois da língua: ```json receipt, delivery_slip.
 */
export const PRINT_AI_DIR = join(__dirname, '..', '..', 'assets', 'ai', 'impressao');

export interface SkillBlock {
  lang: 'json' | 'liquid';
  /** Papéis em que o bloco vale (os da skill quando o bloco não diz). */
  papeis: TemplateKind[];
  code: string;
}

export interface PrintSkill {
  /** Nome do arquivo, sem .md. */
  nome: string;
  titulo: string;
  quando: string[];
  papeis: TemplateKind[];
  corpo: string;
  blocos: SkillBlock[];
}

const BLOCK = /```(json|liquid)([^\n]*)\n([\s\S]*?)```/g;

function papers(raw: string, where: string): TemplateKind[] {
  const v = raw.trim();
  if (!v || v === 'todos') return [...TEMPLATE_KINDS];
  return v.split(/[\s,]+/).map((k) => {
    if (!(TEMPLATE_KINDS as readonly string[]).includes(k))
      throw new Error(`${where}: papel desconhecido "${k}"`);
    return k as TemplateKind;
  });
}

/** Lê uma skill (.md com cabeçalho entre ---). Lança erro com o nome do arquivo. */
export function parseSkill(nome: string, md: string): PrintSkill {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md.replace(/\r/g, ''));
  if (!m) throw new Error(`Skill ${nome}: falta o cabeçalho entre ---`);
  const fields: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of m[1]!.split('\n')) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list) {
      list.push(item[1]!.trim());
      continue;
    }
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2]!.trim()) {
      fields[kv[1]!] = kv[2]!.trim();
      list = null;
    } else fields[kv[1]!] = list = [];
  }
  const titulo = typeof fields.titulo === 'string' ? fields.titulo : '';
  const quando = Array.isArray(fields.quando) ? fields.quando : [];
  if (!titulo || !quando.length) throw new Error(`Skill ${nome}: falta titulo ou quando`);
  const skillPapers = papers(typeof fields.papeis === 'string' ? fields.papeis : '', nome);
  const corpo = m[2]!.trim();
  const blocos = [...corpo.matchAll(BLOCK)].map((b) => ({
    lang: b[1] as 'json' | 'liquid',
    papeis: b[2]!.trim() ? papers(b[2]!, `Skill ${nome}`) : skillPapers,
    code: b[3]!.replace(/\n$/, ''),
  }));
  for (const b of blocos)
    if (b.papeis.some((k) => !skillPapers.includes(k)))
      throw new Error(`Skill ${nome}: bloco num papel que a skill não tem`);
  return { nome, titulo, quando, papeis: skillPapers, corpo, blocos };
}

let skillsCache: PrintSkill[] | null = null;
let instructionsCache: string | null = null;

/** Todas as skills da pasta, em ordem de nome (lidas uma vez). */
export function loadSkills(dir = join(PRINT_AI_DIR, 'skills')): PrintSkill[] {
  if (skillsCache && dir === join(PRINT_AI_DIR, 'skills')) return skillsCache;
  const list = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseSkill(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')));
  if (dir === join(PRINT_AI_DIR, 'skills')) skillsCache = list;
  return list;
}

/** Instruções gerais da IA (instrucoes.md), com as marcas <<NOME>> para preencher. */
export function printAiInstructions(): string {
  instructionsCache ??= readFileSync(join(PRINT_AI_DIR, 'instrucoes.md'), 'utf8');
  return instructionsCache;
}

/** Skills do papel, em texto para as instruções (sem os blocos que são de outros papéis). */
export function skillsPrompt(kind: TemplateKind, skills = loadSkills()): string {
  return skills
    .filter((s) => s.papeis.includes(kind))
    .map((s) => {
      const body = s.corpo.replace(BLOCK, (_all, lang: string, info: string, code: string) => {
        const only = info.trim() ? papers(info, s.nome) : null;
        return only && !only.includes(kind) ? '' : `\`\`\`${lang}\n${code}\`\`\``;
      });
      return `### ${s.titulo} (skill ${s.nome})\nPedidos como: ${s.quando
        .map((q) => `"${q}"`)
        .join(', ')}\n${body.replace(/\n{3,}/g, '\n\n').trim()}`;
    })
    .join('\n\n');
}
