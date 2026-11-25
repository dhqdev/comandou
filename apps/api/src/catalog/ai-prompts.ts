import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Os textos que guiam a IA das fotos e do 3D dos itens ficam em .md, em apps/api/assets/ai, para
 * quem cuida do cardápio ajustar o jeito da IA sem mexer no código. Lidos uma vez e guardados.
 */
export const AI_PROMPTS_DIR = join(__dirname, '..', '..', 'assets', 'ai');

export type PromptFile = 'melhorar-foto' | 'item-3d';

const cache = new Map<PromptFile, string>();

export function aiPrompt(file: PromptFile): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(join(AI_PROMPTS_DIR, `${file}.md`), 'utf8');
    cache.set(file, text);
  }
  return text;
}

/**
 * O melhorar-foto.md tem duas partes, separadas por uma linha "---": a leitura da foto (o que vai
 * para o modelo que olha) e, depois do título e da explicação, o pedido da foto com fundo limpo.
 */
export function photoPrompts(md: string): { analysis: string; clean: string } {
  const at = md.search(/\n---\s*\n/);
  if (at < 0) return { analysis: md.trim(), clean: '' };
  const analysis = md.slice(0, at).trim();
  const paras = md
    .slice(at)
    .replace(/^\n---\s*\n/, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // [0] = título "## Fundo limpo...", [1] = explicação; o pedido vem depois.
  const clean = paras
    .slice(2)
    .map((p) => p.replace(/\s*\n\s*/g, ' '))
    .join('\n\n');
  return { analysis, clean };
}

/** Pedido da foto com fundo limpo para um item (o nome vai entre aspas, sem quebras). */
export function cleanPrompt(template: string, item: string): string {
  const name = itemName(item);
  return template.replaceAll('{{item}}', name);
}

/** Nome do item para pôr entre aspas num pedido à IA: sem aspas, sem quebras, curto. */
export function itemName(item: string): string {
  return (
    item
      .replace(/["\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'item do cardápio'
  );
}
