/**
 * Avatares desenhados que o cliente do cardápio online pode escolher para o perfil (quando não
 * põe foto). O desenho de cada um fica no web (pages/public/avatars.tsx); aqui só a lista de
 * nomes, que a API usa para validar a escolha.
 */
export const CUSTOMER_AVATARS = [
  'curto',
  'cacheado',
  'chef',
  'bone',
  'oculos',
  'coque',
  'barba',
  'gorro',
  'crespo',
  'capacete',
  'grisalho',
  'longo',
] as const;
export type CustomerAvatar = (typeof CUSTOMER_AVATARS)[number];

/** Avatar de quem ainda não escolheu: sempre o mesmo para a mesma conta (pelo id). */
export function autoAvatar(id: string): CustomerAvatar {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CUSTOMER_AVATARS[h % CUSTOMER_AVATARS.length]!;
}
