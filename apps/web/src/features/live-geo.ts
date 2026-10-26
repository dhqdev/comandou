/** Contas de mapa do rastreio ao vivo: distância, previsão de chegada e "atualizado há". */

export type LatLng = [number, number];

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em linha reta, em metros. */
export function distanceM(a: LatLng, b: LatLng) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rumo de a para b, em graus (0 = norte). */
export function bearing(a: LatLng, b: LatLng) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** As ruas não são retas: a distância real fica em torno de 30% acima da linha reta. */
const ROAD_FACTOR = 1.3;
/** Moto na cidade, com semáforo e trânsito: ~22 km/h de média. */
const CITY_SPEED_MS = 6;

/**
 * Previsão de chegada em minutos. Usa a velocidade do GPS quando o entregador está andando
 * (limitada para não prometer milagre) e a média da cidade quando está parado.
 */
export function etaMinutes(from: LatLng, to: LatLng, speedMs?: number | null) {
  const road = distanceM(from, to) * ROAD_FACTOR;
  if (road < 80) return 0;
  const v = speedMs && speedMs > 2 ? Math.min(Math.max(speedMs, 4), 12) : CITY_SPEED_MS;
  return Math.max(1, Math.round(road / v / 60));
}

export const kmLabel = (m: number) =>
  m < 1000
    ? `${Math.round(m / 10) * 10} m`
    : `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

/** "agora", "há 40 s", "há 3 min". */
export function agoLabel(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
}

/** Sinal do GPS: ao vivo (até 1 min), atrasado (até 5 min) ou perdido. */
export function signalOf(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'none' as const;
  const s = (now - new Date(iso).getTime()) / 1000;
  return s <= 60 ? ('live' as const) : s <= 300 ? ('late' as const) : ('lost' as const);
}

export const toPoint = (lat: string | number | null, lng: string | number | null): LatLng | null =>
  lat != null && lng != null && lat !== '' && lng !== '' ? [Number(lat), Number(lng)] : null;
