import type { Courier } from '../lib/types';

/** App aberto há até 2 min conta como "disponível" (o app pergunta a cada 15 s). */
export const ONLINE_MS = 2 * 60_000;

export type CourierState = 'rua' | 'disponivel' | 'offline' | 'sem-acesso' | 'desligado';

export const COURIER_STATE: Record<CourierState, { label: string; order: number }> = {
  rua: { label: 'Na rua', order: 0 },
  disponivel: { label: 'Disponível', order: 1 },
  offline: { label: 'Offline', order: 2 },
  'sem-acesso': { label: 'Sem acesso ao app', order: 3 },
  desligado: { label: 'Desativado', order: 4 },
};

/** Última vez que o entregador apareceu, pelo link ou pelo login (o mais recente). */
export function lastSeen(c: Pick<Courier, 'linkSeenAt' | 'appSeenAt'>): string | null {
  const a = c.linkSeenAt ?? null;
  const b = c.appSeenAt ?? null;
  if (!a || !b) return a ?? b;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Situação do entregador: desativado vale mais que tudo; depois na rua (tem corrida aberta);
 * depois disponível (app ou link aberto agora); sem link nem login não recebe nada no celular.
 */
export function courierState(
  c: Pick<Courier, 'active' | 'userId' | 'linkCreatedAt' | 'linkSeenAt' | 'appSeenAt'>,
  running: number,
  now = Date.now(),
): CourierState {
  if (!c.active) return 'desligado';
  if (running > 0) return 'rua';
  if (!c.userId && !c.linkCreatedAt) return 'sem-acesso';
  const seen = lastSeen(c);
  if (seen && now - new Date(seen).getTime() <= ONLINE_MS) return 'disponivel';
  return 'offline';
}

/** "(11) 98745-2201" a partir do que foi digitado (com ou sem 55). */
export function phoneLabel(p: string | null) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

/** Número para o wa.me: só dígitos, com o 55 do Brasil quando falta. */
export function whatsappNumber(p: string | null) {
  const d = (p ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.length >= 12 ? d : `55${d}`;
}

/** Cores que dá para escolher para o entregador (mapa e calendário de pagamento). */
export const COURIER_COLORS = [
  '#e8590c',
  '#1c7ed6',
  '#2f9e44',
  '#ae3ec9',
  '#e03131',
  '#0c8599',
  '#5c7cfa',
  '#f08c00',
  '#d6336c',
  '#495057',
] as const;
