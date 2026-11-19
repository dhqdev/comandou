import { fromCents, type DriverStatus } from '@comandou/shared';
import type {
  ChannelDriverUpdate,
  ChannelTracking,
  DriverQuote,
} from '../channels/channel-adapter';

/**
 * Entregador do iFood → formato do Comandou (ADR 0015, Fase 5). Só tradução, sem rede.
 *
 * Eventos do grupo DELIVERY: ASSIGN_DRIVER (ADR, com `workerName` e `workerVehicleType`),
 * GOING_TO_ORIGIN (GTO), ARRIVED_AT_ORIGIN (AAO), COLLECTED (CLT), ARRIVED_AT_DESTINATION (AAD).
 * Sob Demanda: REQUEST_DRIVER_SUCCESS (RDS) e REQUEST_DRIVER_FAILED (RDF).
 * Rastreio (`GET /orders/{id}/tracking`): `expectedDelivery`, `pickupEtaStart`, `deliveryEtaEnd`,
 * latitude e longitude (a posição não é guardada).
 */

const STATUS: Record<string, DriverStatus> = {
  ADR: 'assigned',
  ASSIGN_DRIVER: 'assigned',
  GTO: 'to_store',
  GOING_TO_ORIGIN: 'to_store',
  AAO: 'at_store',
  ARRIVED_AT_ORIGIN: 'at_store',
  CLT: 'collected',
  COLLECTED: 'collected',
  AAD: 'at_customer',
  ARRIVED_AT_DESTINATION: 'at_customer',
  RDS: 'requested',
  REQUEST_DRIVER_SUCCESS: 'requested',
  RDF: 'request_failed',
  REQUEST_DRIVER_FAILED: 'request_failed',
};

const VEHICLE: Record<string, string> = {
  MOTORCYCLE: 'Moto',
  MOTO: 'Moto',
  BICYCLE: 'Bicicleta',
  BIKE: 'Bicicleta',
  CAR: 'Carro',
  SCOOTER: 'Patinete',
  WALKER: 'A pé',
};

/** Evento de entrega → aviso do entregador (null = evento que não muda a situação). */
export function ifoodDriverUpdate(
  code: string | undefined,
  fullCode: string | undefined,
  metadata: unknown,
): ChannelDriverUpdate | null {
  const status = [fullCode, code]
    .map((c) => (c ? STATUS[c.toUpperCase()] : undefined))
    .find(Boolean);
  if (!status) return null;
  const m = (metadata ?? {}) as Record<string, unknown>;
  // Só o primeiro nome (o restaurante reconhece quem chegou; o resto não precisa).
  const raw = m.workerName ?? m.driverName;
  const first =
    typeof raw === 'string'
      ? raw
          .trim()
          .split(/\s+/)[0]
          ?.replace(/[^\p{L}'-]/gu, '')
          .slice(0, 40)
      : '';
  const vehicle = VEHICLE[String(m.workerVehicleType ?? m.vehicleType ?? '').toUpperCase()];
  return {
    status,
    ...(first ? { name: first } : {}),
    ...(vehicle ? { vehicle } : {}),
  };
}

/** Número do iFood (segundos daqui a pouco, época em s ou ms) ou data ISO → ISO. */
function when(v: unknown, now: number): string | undefined {
  if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return new Date(v).toISOString();
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : now + n * 1000;
  return new Date(ms).toISOString();
}

export function ifoodTracking(body: unknown, now = Date.now()): ChannelTracking | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const eta = when(b.expectedDelivery, now) ?? when(b.deliveryEtaEnd, now);
  const pickupEta = when(b.pickupEtaStart, now);
  if (!eta && !pickupEta) return null;
  return { ...(eta ? { eta } : {}), ...(pickupEta ? { pickupEta } : {}) };
}

/** `deliveryAvailabilities` → cotação (valor em reais vira string decimal sem float). */
export function ifoodQuote(body: unknown): DriverQuote | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id.slice(0, 100) : '';
  const q = (b.quote ?? {}) as Record<string, unknown>;
  const net = Number(q.netValue ?? q.grossValue);
  if (!id || !Number.isFinite(net) || net < 0) return null;
  const t = (b.deliveryTime ?? {}) as Record<string, unknown>;
  // O iFood manda o tempo em segundos (às vezes em minutos): acima de 3 horas, é segundo.
  const mins = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n > 180 ? n / 60 : n);
  };
  const min = mins(t.min);
  const max = mins(t.max);
  const dist = Number(b.distance);
  const exp = typeof b.expirationAt === 'string' ? Date.parse(b.expirationAt) : NaN;
  return {
    id,
    fee: fromCents(Math.round(net * 100)),
    ...(min ? { minMinutes: min } : {}),
    ...(max ? { maxMinutes: max } : {}),
    ...(Number.isFinite(dist) && dist >= 0 ? { distanceM: Math.round(dist) } : {}),
    ...(Number.isFinite(exp) ? { expiresAt: new Date(exp).toISOString() } : {}),
  };
}
