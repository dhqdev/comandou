import { validateTenantSlug } from '@comandou/shared';

/** Endereço a partir do nome: "Fumaça Burger & Co." -> "fumaca-burger-co". */
export function trialSlug(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  if (s.length < 3) s = `restaurante-${s}`.replace(/-+$/, '');
  if (!validateTenantSlug(s).ok) s = `meu-${s}`.slice(0, 34).replace(/-+$/, '');
  return s;
}
