/**
 * Áreas de entrega: geometria simples (sem PostGIS). As áreas de um restaurante são poucas e
 * pequenas; a conta é feita na API, que sempre decide a taxa (o navegador só mostra).
 */
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
