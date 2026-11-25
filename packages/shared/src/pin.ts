import type { Role } from './roles';

/** Papéis que entram com PIN de 6 números (garçom em /garcom, entregador em /entregas). */
export const PIN_ROLES = ['waiter', 'driver'] as const satisfies readonly Role[];
export type PinRole = (typeof PIN_ROLES)[number];

export const isPinRole = (role: string): role is PinRole =>
  (PIN_ROLES as readonly string[]).includes(role);

/** Números do PIN novo (o de 4, de antes da 0.248, ainda entra até o gerente gerar outro). */
export const PIN_LENGTH = 6;

/** Exatamente 6 números (o formato de um PIN novo). */
export const isPinFormat = (pin: string) => /^[0-9]{6}$/.test(pin);

/** O que a tela de entrada aceita: o PIN de 6 ou o antigo, de 4. */
export const isPinLoginFormat = (pin: string) => /^[0-9]{4}([0-9]{2})?$/.test(pin);

/**
 * PIN fácil de adivinhar: números repetidos (111111), em sequência (123456, 987654) ou um pedaço
 * que se repete (121212, 123123). O restaurante não escolhe esses; o sorteado também nunca é um.
 */
export function isWeakPin(pin: string): boolean {
  if (!isPinFormat(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1]! - d[0]!;
  if (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return true;
  for (const size of [2, 3])
    if (pin.length % size === 0 && pin === pin.slice(0, size).repeat(pin.length / size))
      return true;
  return false;
}

/**
 * Conta de quem foi cadastrado só com PIN (sem e-mail): o sistema cria um endereço interno que
 * nunca recebe mensagem. A tela mostra "Entra com PIN" no lugar dele.
 */
export const PIN_ONLY_EMAIL_DOMAIN = 'pin.comandou.invalid';
export const isPinOnlyEmail = (email: string | null | undefined) =>
  !!email && email.toLowerCase().endsWith(`@${PIN_ONLY_EMAIL_DOMAIN}`);
