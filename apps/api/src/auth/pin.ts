import { ConflictException } from '@nestjs/common';
import { isWeakPin } from '@comandou/shared';
import { createHash, randomInt } from 'node:crypto';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';

/** Janela e limite de PINs errados de aparelhos desconhecidos no restaurante inteiro. */
export const PIN_LOCK_MINUTES = 15;
export const PIN_LOCK_THRESHOLD = 10;
/** PINs errados num mesmo aparelho, na mesma janela, que travam só ele. */
export const PIN_DEVICE_LOCK_THRESHOLD = 5;
/** Cookie que identifica o aparelho na entrada por PIN (sorteado, sem dado da pessoa). */
export const PIN_DEVICE_COOKIE = 'cm_pdev';
/** Tamanho do PIN novo (o de 4 números, de antes, continua entrando). */
export const PIN_DIGITS = 6;

/** Aparelho no restaurante (o cookie nunca vai para o banco como veio). */
export function pinDeviceHash(tenantId: string, device: string): string {
  return createHash('sha256').update(`comandou-pin-device:${tenantId}:${device}`).digest('hex').slice(0, 40);
}

/**
 * Hash do PIN no restaurante. O PIN identifica a pessoa na entrada (sem e-mail), então o hash é
 * determinístico e único por restaurante. O restaurante entra no hash: o mesmo PIN em outro
 * restaurante dá outro valor.
 */
export function pinHash(tenantId: string, pin: string): Buffer {
  return createHash('sha256').update(`comandou-pin:${tenantId}:${pin}`).digest();
}

/**
 * A conta (e-mail e senha) é uma só em todos os restaurantes da pessoa. PIN só para conta que é
 * SÓ deste restaurante: senão o administrador daqui, ao pôr o e-mail de alguém na equipe e dar um
 * PIN, entraria como essa pessoa e mexeria na conta que ela usa em outro restaurante (ver 0055).
 */
export const SHARED_ACCOUNT_PIN_MESSAGE =
  'Esta pessoa usa a mesma conta (e-mail) em outro restaurante. Por segurança, ela entra com o e-mail e a senha dela, sem PIN.';

/** A conta também entra em outro restaurante (ou no painel)? */
export async function accountShared(tx: Tx, userId: string): Promise<boolean> {
  const r = await one<{ shared: boolean }>(tx, `SELECT app_member_account_shared($1) AS shared`, [
    userId,
  ]);
  return !!r?.shared;
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
 * Grava o PIN da pessoa (o informado ou um sorteado). Recusa conta usada em outro restaurante,
 * PIN fraco ou já usado por outra pessoa do restaurante. Devolve o PIN em claro (a tela mostra
 * uma vez para o gerente).
 */
export async function assignPin(
  tx: Tx,
  tenantId: string,
  userId: string,
  wanted?: string,
): Promise<string> {
  if (await accountShared(tx, userId)) throw new ConflictException(SHARED_ACCOUNT_PIN_MESSAGE);
  let pin = wanted;
  if (pin) {
    if (isWeakPin(pin))
      throw new ConflictException('PIN fácil demais (repetido ou em sequência). Escolha outro.');
    if (await taken(tx, tenantId, pin, userId))
      throw new ConflictException('Este PIN já é de outra pessoa da equipe. Escolha outro.');
  } else {
    for (let i = 0; i < 50 && !pin; i++) {
      const c = String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
      if (!isWeakPin(c) && !(await taken(tx, tenantId, c, userId))) pin = c;
    }
    if (!pin) throw new ConflictException('Não foi possível sortear um PIN livre. Tente de novo.');
  }
  await q(
    tx,
    `UPDATE memberships SET pin_hash = $2, pin_set_at = now(), pin_digits = $3 WHERE user_id = $1`,
    [userId, pinHash(tenantId, pin), pin.length],
  ).catch((err: { code?: string }) => {
    // Dois gerentes gravando o mesmo PIN ao mesmo tempo: o índice único decide.
    if (err.code === '23505')
      throw new ConflictException('Este PIN já é de outra pessoa da equipe. Escolha outro.');
    throw err;
  });
  return pin;
}
