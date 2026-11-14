import { ConflictException } from '@nestjs/common';
import { isWeakPin } from '@comandou/shared';
import { createHash, randomInt } from 'node:crypto';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';

/** Janela e limite de PINs errados no restaurante inteiro (de qualquer aparelho). */
export const PIN_LOCK_MINUTES = 15;
export const PIN_LOCK_THRESHOLD = 10;

/**
 * Hash do PIN no restaurante. O PIN identifica a pessoa na entrada (sem e-mail), então o hash é
 * determinístico e único por restaurante. O restaurante entra no hash: o mesmo PIN em outro
 * restaurante dá outro valor.
 */
export function pinHash(tenantId: string, pin: string): Buffer {
  return createHash('sha256').update(`comandou-pin:${tenantId}:${pin}`).digest();
}

async function taken(tx: Tx, tenantId: string, pin: string, exceptUser?: string) {
  const r = await one<{ user_id: string }>(
    tx,
    `SELECT user_id FROM memberships WHERE pin_hash = $1 AND ($2::uuid IS NULL OR user_id <> $2)`,
    [pinHash(tenantId, pin), exceptUser ?? null],
  );
  return !!r;
}

/**
 * Grava o PIN da pessoa (o informado ou um sorteado). Recusa PIN fraco ou já usado por outra
 * pessoa do restaurante. Devolve o PIN em claro (a tela mostra uma vez para o gerente).
 */
export async function assignPin(
  tx: Tx,
  tenantId: string,
  userId: string,
  wanted?: string,
): Promise<string> {
  let pin = wanted;
  if (pin) {
    if (isWeakPin(pin))
      throw new ConflictException('PIN fácil demais (repetido ou em sequência). Escolha outro.');
    if (await taken(tx, tenantId, pin, userId))
      throw new ConflictException('Este PIN já é de outra pessoa da equipe. Escolha outro.');
  } else {
    for (let i = 0; i < 50 && !pin; i++) {
      const c = String(randomInt(0, 10_000)).padStart(4, '0');
      if (!isWeakPin(c) && !(await taken(tx, tenantId, c, userId))) pin = c;
    }
    if (!pin) throw new ConflictException('Não foi possível sortear um PIN livre. Tente de novo.');
  }
  await q(tx, `UPDATE memberships SET pin_hash = $2, pin_set_at = now() WHERE user_id = $1`, [
    userId,
    pinHash(tenantId, pin),
  ]).catch((err: { code?: string }) => {
    // Dois gerentes gravando o mesmo PIN ao mesmo tempo: o índice único decide.
    if (err.code === '23505')
      throw new ConflictException('Este PIN já é de outra pessoa da equipe. Escolha outro.');
    throw err;
  });
  return pin;
}
