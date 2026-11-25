import type { ServerService } from './types';
import type { Level } from './ui';

/**
 * Serviço de execução única que já terminou bem (o comandou-migrate roda uma vez a cada
 * atualização e sai): 0 de 1 rodando é o normal, não um problema.
 */
export const finished = (s: ServerService) => s.running === 0 && s.taskState === 'complete';

/** Situação de um serviço do Swarm, igual na tela Status e em Infraestrutura › Servidor. */
export function serviceLevel(s: ServerService): Level {
  if (s.desired === 0) return 'off';
  if (finished(s)) return 'ok';
  if (s.desired !== null && s.running < s.desired) return s.running === 0 ? 'bad' : 'warn';
  return 'ok';
}

/** Serviços que precisam de atenção (parados ou com réplicas faltando). */
export const servicesWithProblem = (list: ServerService[]) =>
  list.filter((s) => s.desired !== 0 && serviceLevel(s) !== 'ok');
