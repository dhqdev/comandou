/**
 * Busca de telas e atalhos. Os itens moram em @comandou/shared (nav-catalog), que o assistente
 * de IA também usa para mandar a pessoa à tela certa.
 */
import type { StaticEntry } from '@comandou/shared';
export { STATIC_ENTRIES } from '@comandou/shared';
export type { StaticEntry, StaticIcon } from '@comandou/shared';

/** Minúsculas e sem acento: "Cardápio" e "cardapio" batem. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Pontua um item pela busca: todas as palavras precisam aparecer (título, onde fica ou
 * sinônimos). Título que começa com a busca vem antes. 0 = não serve.
 */
export function scoreEntry(e: StaticEntry, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const title = fold(e.title);
  const hay = `${title} ${fold(e.hint ?? '')} ${e.words ?? ''}`;
  if (!words.every((w) => hay.includes(w))) return 0;
  const q = words.join(' ');
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (words.every((w) => title.includes(w))) return 60;
  return e.group === 'Telas' ? 30 : 20;
}

export function filterStatic(
  entries: StaticEntry[],
  query: string,
  can: (perms?: string[]) => boolean,
  limit = 8,
): StaticEntry[] {
  return entries
    .filter((e) => can(e.perms))
    .map((e) => ({ e, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}
