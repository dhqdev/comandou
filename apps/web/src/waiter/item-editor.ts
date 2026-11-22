import { optionsTotalCents, toCents } from '@comandou/shared';
import type { MenuGroup, MenuProduct } from '../lib/types';

/** Como o grupo se escolhe na edição do item: uma opção, adicionais, várias ou retirar. */
export type GroupMode = 'single' | 'add' | 'multi' | 'remove';

export function groupMode(g: Pick<MenuGroup, 'kind' | 'maxSelect'>): GroupMode {
  if (g.kind === 'remove') return 'remove';
  if (g.maxSelect <= 1) return 'single';
  return g.kind === 'additional' || !g.kind ? 'add' : 'multi';
}

/** Frase curta embaixo do nome do grupo. */
export function groupHint(g: Pick<MenuGroup, 'kind' | 'minSelect' | 'maxSelect'>): string {
  const mode = groupMode(g);
  if (mode === 'remove') return 'Toque no que o cliente não quer';
  if (mode === 'single') return g.minSelect > 0 ? 'Escolha 1 opção' : 'Opcional, escolha 1';
  if (g.minSelect > 0)
    return g.minSelect === g.maxSelect
      ? `Escolha ${g.minSelect}`
      : `Escolha de ${g.minSelect} a ${g.maxSelect}`;
  return `Escolha até ${g.maxSelect}`;
}

/** Primeiro grupo que ainda não tem o mínimo escolhido (na ordem da tela). */
export function missingGroup(
  groups: MenuGroup[],
  sel: Record<string, string[] | undefined>,
): MenuGroup | null {
  return groups.find((g) => (sel[g.id]?.length ?? 0) < g.minSelect) ?? null;
}

/** Preço de exibição de uma unidade com as opções; o servidor recalcula e é a fonte oficial. */
export function unitCents(p: Pick<MenuProduct, 'price' | 'optionGroups'>, optionIds: string[]) {
  return toCents(p.price) + optionsTotalCents(p.optionGroups, optionIds);
}
