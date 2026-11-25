/**
 * Áreas de entrega: geometria simples (sem PostGIS). As áreas de um restaurante são poucas e
 * pequenas; a conta é feita na API, que sempre decide a taxa (o navegador só mostra).
 */
import { zoneNamesDistrict } from '@comandou/shared';

export type LatLng = [number, number];

export interface Zone {
  id: string;
  name: string;
  color: string;
  kind: 'polygon' | 'radius';
  polygon: LatLng[] | null;
  centerLat: string | null;
  centerLng: string | null;
  radiusM: number | null;
  fee: string;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
  active: boolean;
  position: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em metros entre dois pontos (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ponto dentro do polígono (ray casting). Bom para áreas de bairro/cidade. */
export function insidePolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function zoneContains(z: Zone, p: LatLng): boolean {
  if (z.kind === 'radius')
    return (
      z.centerLat !== null &&
      z.centerLng !== null &&
      z.radiusM !== null &&
      distanceM([Number(z.centerLat), Number(z.centerLng)], p) <= z.radiusM
    );
  return !!z.polygon && z.polygon.length >= 3 && insidePolygon(p, z.polygon);
}

/** Primeira área ativa (menor posição) que contém o ponto. */
export function findZone(zones: Zone[], p: LatLng): Zone | undefined {
  return [...zones]
    .filter((z) => z.active)
    .sort((a, b) => a.position - b.position)
    .find((z) => zoneContains(z, p));
}

/**
 * Área do pedido: a que contém o ponto no mapa; se nenhuma contém (área desenhada um pouco
 * menor que o bairro, pino no limite), a área com o nome do bairro informado.
 */
export function findZoneFor(zones: Zone[], p: LatLng, district?: string | null): Zone | undefined {
  const byPoint = findZone(zones, p);
  if (byPoint || !district?.trim()) return byPoint;
  return [...zones]
    .filter((z) => z.active)
    .sort((a, b) => a.position - b.position)
    .find((z) => zoneNamesDistrict(z.name, district));
}

/** Centro de uma área (onde a loja atende, para a busca de endereço). */
export function zoneCenter(z: Zone | undefined): { lat: number; lng: number } | undefined {
  if (!z) return undefined;
  if (z.kind === 'radius' && z.centerLat && z.centerLng)
    return { lat: Number(z.centerLat), lng: Number(z.centerLng) };
  if (!z.polygon?.length) return undefined;
  const lat = z.polygon.reduce((a, p) => a + p[0], 0) / z.polygon.length;
  const lng = z.polygon.reduce((a, p) => a + p[1], 0) / z.polygon.length;
  return { lat, lng };
}

/**
 * Onde procurar o endereço do cliente: perto da loja e das áreas, na cidade dela. O mesmo
 * contexto na busca do cardápio e na conferência do pedido (a busca guardada é achada de novo).
 */
export function locateContext(
  s: { storeLat: string | null; storeLng: string | null },
  region: { city: string | null; state: string | null },
  zones: Zone[],
) {
  const refs = zones
    .filter((z) => z.active)
    .map((z) => zoneCenter(z))
    .filter((p): p is { lat: number; lng: number } => !!p);
  const store =
    s.storeLat && s.storeLng ? { lat: Number(s.storeLat), lng: Number(s.storeLng) } : undefined;
  return { near: store ?? refs[0], refs, city: region.city, state: region.state };
}
