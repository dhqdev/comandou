/**
 * Fotos do Comandou em tamanho de cartão. A API devolve a miniatura com `?w=` (lado maior em
 * px, só 320 ou 640; GET /media/<id>, `media-thumbs.ts` da API): o cartão de 160 px não precisa
 * baixar a original de até 1600 px. Endereço que não é foto do Comandou (blob:, data:, outro
 * site) volta como está.
 */
export type MediaWidth = 320 | 640;

const MEDIA_RE = /^\/api\/v1\/media\/[0-9a-f-]{36}$/i;

export function sizedMedia<T extends string | null | undefined>(src: T, w: MediaWidth): T {
  return (src && MEDIA_RE.test(src) ? `${src}?w=${w}` : src) as T;
}
