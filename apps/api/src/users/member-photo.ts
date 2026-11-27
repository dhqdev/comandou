import { UnprocessableEntityException } from '@nestjs/common';
import { sniff } from '../common/file-sniff';
import { one } from '../common/sql';
import type { Tx } from '../database/database.service';

/** Foto do perfil da equipe (`member_photos`, migração 0130): até 1 MB, WebP, JPEG ou PNG. */
export const MAX_MEMBER_PHOTO_BYTES = 1024 * 1024;
const PHOTO_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/** Confere a foto enviada no corpo: o tipo pelo conteúdo, não só pelo Content-Type. */
export function checkMemberPhoto(body: unknown, type: string | undefined) {
  const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
  if (!PHOTO_TYPES.has(mime) || !Buffer.isBuffer(body))
    throw new UnprocessableEntityException('Envie a foto em JPG, PNG ou WebP');
  if (body.length === 0 || body.length > MAX_MEMBER_PHOTO_BYTES)
    throw new UnprocessableEntityException('Foto vazia ou maior que 1 MB');
  if (sniff(body) !== mime)
    throw new UnprocessableEntityException('O arquivo não é uma foto válida');
  return { mime, bytes: body };
}

/**
 * Quando a pessoa trocou a foto pela última vez (vai na URL como `?v=`), ou null sem foto. Roda
 * dentro do `withTenant` (o RLS separa o restaurante; o `user_id` separa a pessoa).
 */
export async function memberPhotoAt(tx: Tx, userId: string): Promise<string | null> {
  const r = await one<{ at: Date }>(
    tx,
    `SELECT updated_at AS at FROM member_photos WHERE user_id = $1`,
    [userId],
  );
  return r ? r.at.toISOString() : null;
}
