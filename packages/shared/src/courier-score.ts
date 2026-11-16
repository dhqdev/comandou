/**
 * Score do entregador (perfil no app de entregas). Calculado sozinho pelo sistema, com as corridas
 * encerradas nos últimos 90 dias: 60% é concluir a entrega (não falhar) e 40% é chegar no prazo.
 * Vai de 0 a 5, com uma casa. Com poucas corridas ainda não há nota ("Novo").
 */

/** Dias que entram na conta do score. */
export const COURIER_SCORE_DAYS = 90;
/** Corridas encerradas no período para o score aparecer. */
export const COURIER_SCORE_MIN_RIDES = 5;

/**
 * Minutos que uma corrida pode levar para contar como "no prazo": 10 de saída e entrega mais
 * 5 por quilômetro, com piso de 20. Sem a distância (endereço sem ponto no mapa), vale o piso.
 */
export function rideTargetMinutes(distanceM: number | null | undefined) {
  const km = Math.max(0, distanceM ?? 0) / 1000;
  return Math.max(20, Math.round(10 + 5 * km));
}

export type CourierLevel = 'novo' | 'excelente' | 'muito-bom' | 'bom' | 'atencao';

export const COURIER_LEVEL_LABELS: Record<CourierLevel, string> = {
  novo: 'Novo',
  excelente: 'Excelente',
  'muito-bom': 'Muito bom',
  bom: 'Bom',
  atencao: 'Precisa melhorar',
};

export interface CourierScore {
  /** 0 a 5 com uma casa; null enquanto há poucas corridas. */
  score: number | null;
  level: CourierLevel;
  /** Partes da nota, de 0 a 100 (inteiros), para mostrar no perfil. */
  completionPct: number | null;
  onTimePct: number | null;
}

export function courierScore(r: {
  delivered: number;
  failed: number;
  onTime: number;
}): CourierScore {
  const delivered = Math.max(0, r.delivered);
  const total = delivered + Math.max(0, r.failed);
  if (total < COURIER_SCORE_MIN_RIDES)
    return { score: null, level: 'novo', completionPct: null, onTimePct: null };
  const completion = delivered / total;
  const onTime = delivered ? Math.min(delivered, Math.max(0, r.onTime)) / delivered : 0;
  const score = Math.round(5 * (0.6 * completion + 0.4 * onTime) * 10) / 10;
  const level: CourierLevel =
    score >= 4.7 ? 'excelente' : score >= 4 ? 'muito-bom' : score >= 3 ? 'bom' : 'atencao';
  return {
    score,
    level,
    completionPct: Math.round(completion * 100),
    onTimePct: Math.round(onTime * 100),
  };
}
