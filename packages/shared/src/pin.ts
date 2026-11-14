import type { Role } from './roles';

/** Papéis que entram com PIN de 4 números (garçom em /garcom, entregador em /entregas). */
export const PIN_ROLES = ['waiter', 'driver'] as const satisfies readonly Role[];
export type PinRole = (typeof PIN_ROLES)[number];

export const isPinRole = (role: string): role is PinRole =>
  (PIN_ROLES as readonly string[]).includes(role);

/** Exatamente 4 números. */
export const isPinFormat = (pin: string) => /^[0-9]{4}$/.test(pin);

/**
 * PIN fácil de adivinhar: números repetidos (1111), em sequência (1234, 9876) ou em pares (1212).
 * O restaurante não escolhe esses; o PIN gerado também nunca é um deles.
 */
export function isWeakPin(pin: string): boolean {
  if (!isPinFormat(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1]! - d[0]!;
  if (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return true;
  if (d[0] === d[2] && d[1] === d[3]) return true;
  return false;
}

/**
 * Conta de quem foi cadastrado só com PIN (sem e-mail): o sistema cria um endereço interno que
 * nunca recebe mensagem. A tela mostra "Entra com PIN" no lugar dele.
 */
export const PIN_ONLY_EMAIL_DOMAIN = 'pin.comandou.invalid';
export const isPinOnlyEmail = (email: string | null | undefined) =>
  !!email && email.toLowerCase().endsWith(`@${PIN_ONLY_EMAIL_DOMAIN}`);
