import type { ChannelShift, ChannelStoreState } from '@comandou/shared';
import type { ChannelStoreStatus } from '../channels/channel-adapter';

/**
 * Situação, pausas e horários da loja no iFood → formato do Comandou (ADR 0015, Fase 4). Só
 * tradução, sem rede; tolera campo faltando (o iFood muda a resposta sem aviso).
 *
 * Status (`GET /merchants/{id}/status`): uma linha por operação (DELIVERY, TAKEOUT, INDOOR) com
 * `available`, `state` (OK, WARNING, CLOSED, ERROR), `message` e `validations` (is-connected,
 * opening-hours, unavailabilities, radius-restriction, payout-blocked...).
 * Interrupção (`/interruptions`): `{ id, description, start, end }`, de 1 minuto a 7 dias.
 */

interface IfoodMessage {
  title?: string;
  subtitle?: string;
  description?: string;
}
interface IfoodStatus {
  operation?: string;
  available?: boolean;
  state?: string;
  message?: IfoodMessage | null;
  validations?: { id?: string; code?: string; state?: string; message?: IfoodMessage | null }[];
}
interface IfoodInterruption {
  id?: string;
  description?: string;
  start?: string;
  end?: string;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Interrupção valendo agora (começou e não terminou). */
export function activeInterruption(body: unknown, now = Date.now()) {
  const list = (Array.isArray(body) ? body : []) as IfoodInterruption[];
  for (const i of list) {
    const id = text(i?.id, 100);
    const start = Date.parse(i?.start ?? '');
    const end = Date.parse(i?.end ?? '');
    if (!id || !Number.isFinite(end) || end <= now) continue;
    if (Number.isFinite(start) && start > now) continue;
    return {
      id,
      until: new Date(end).toISOString(),
      ...(text(i.description, 200) ? { reason: text(i.description, 200) } : {}),
    };
  }
  return null;
}

/** Status + interrupções → situação única da loja (a operação de entrega manda). */
export function ifoodStoreStatus(
  statusBody: unknown,
  interruptions: unknown,
  now = Date.now(),
): ChannelStoreStatus {
  const list = (
    Array.isArray(statusBody) ? statusBody : statusBody ? [statusBody] : []
  ) as IfoodStatus[];
  const s =
    list.find((x) => String(x?.operation ?? '').toUpperCase() === 'DELIVERY') ?? list[0] ?? null;
  const pause = activeInterruption(interruptions, now);
  if (!s) return { state: 'unknown', pause };
  const raw = String(s.state ?? '').toUpperCase();
  let state: ChannelStoreState =
    raw === 'OK'
      ? 'open'
      : raw === 'WARNING'
        ? 'warning'
        : raw === 'CLOSED'
          ? 'closed'
          : raw === 'ERROR'
            ? 'error'
            : s.available
              ? 'open'
              : 'unknown';
  if (state === 'open' && s.available === false) state = 'closed';
  if (pause && (state === 'closed' || state === 'error' || s.available === false)) state = 'paused';
  // A frase do iFood: a da linha ou, faltando, a da primeira validação com problema.
  const bad = (s.validations ?? []).find((v) => String(v?.state ?? 'OK').toUpperCase() !== 'OK');
  const msg = s.message?.title ? s.message : (bad?.message ?? null);
  const title = text(msg?.title, 200);
  const detail = text(msg?.subtitle ?? msg?.description, 300);
  return {
    state,
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    pause,
  };
}

const DAYS: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/** `GET /opening-hours` → turnos (dia, início HH:MM, duração em minutos). */
export function ifoodShifts(body: unknown): ChannelShift[] {
  const b = (body ?? {}) as { shifts?: unknown };
  const list = Array.isArray(b.shifts) ? b.shifts : Array.isArray(body) ? body : [];
  const out: ChannelShift[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const day = DAYS[String(raw?.dayOfWeek ?? '').toUpperCase()];
    const m = /^(\d{2}):(\d{2})/.exec(String(raw?.start ?? ''));
    const minutes = Number(raw?.duration);
    if (day === undefined || !m || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440)
      continue;
    out.push({ day, start: `${m[1]}:${m[2]}`, minutes });
  }
  return out.slice(0, 50);
}
