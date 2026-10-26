/**
 * Desafios do garçom: selos por número de pedidos lançados (como no app do garçom do Anota AI)
 * e metas do dia. A contagem vem do servidor (pedidos não cancelados lançados pelo garçom).
 */

export type SealTier = 'welcome' | 'bronze' | 'silver' | 'gold' | 'diamond';

export interface WaiterSeal {
  /** Pedidos necessários (0 = só entrar no app). */
  orders: number;
  name: string;
  hint: string;
  tier: SealTier;
}

export const WAITER_SEALS: readonly WaiterSeal[] = [
  { orders: 0, name: 'Bem-vindo', hint: 'entrou no app', tier: 'welcome' },
  { orders: 1, name: 'Iniciante', hint: 'primeiro pedido', tier: 'bronze' },
  { orders: 5, name: 'Aprendiz', hint: '5 pedidos', tier: 'bronze' },
  { orders: 10, name: 'Profissional', hint: '10 pedidos', tier: 'bronze' },
  { orders: 15, name: 'Avançado', hint: '15 pedidos', tier: 'bronze' },
  { orders: 20, name: 'Sênior', hint: '20 pedidos', tier: 'silver' },
  { orders: 40, name: 'Especialista', hint: '40 pedidos', tier: 'silver' },
  { orders: 80, name: 'Mestre', hint: '80 pedidos', tier: 'silver' },
  { orders: 150, name: 'Craque', hint: '150 pedidos', tier: 'gold' },
  { orders: 200, name: 'Fera', hint: '200 pedidos', tier: 'gold' },
  { orders: 300, name: 'Lenda', hint: '300 pedidos', tier: 'gold' },
  { orders: 400, name: 'Ídolo', hint: '400 pedidos', tier: 'diamond' },
  { orders: 500, name: 'Hall da fama', hint: '500 pedidos', tier: 'diamond' },
];

export interface WaiterLevel {
  /** Último selo conquistado. */
  seal: WaiterSeal;
  /** Índice do selo em WAITER_SEALS. */
  index: number;
  /** Próximo selo (undefined no último). */
  next?: WaiterSeal;
  /** Quanto falta para o próximo selo. */
  missing: number;
  /** Progresso até o próximo selo, de 0 a 1. */
  progress: number;
}

export function waiterLevel(totalOrders: number): WaiterLevel {
  const total = Math.max(0, Math.floor(totalOrders));
  let index = 0;
  for (let i = 0; i < WAITER_SEALS.length; i++) if (total >= WAITER_SEALS[i]!.orders) index = i;
  const seal = WAITER_SEALS[index]!;
  const next = WAITER_SEALS[index + 1];
  if (!next) return { seal, index, missing: 0, progress: 1 };
  const span = next.orders - seal.orders;
  return {
    seal,
    index,
    next,
    missing: next.orders - total,
    progress: Math.min(1, (total - seal.orders) / span),
  };
}

/** Números do dia do garçom (vindos de GET /waiter/me). */
export interface WaiterDay {
  orders: number;
  /** Mesas/comandas diferentes atendidas hoje. */
  tables: number;
  /** Vendido hoje, em reais ("123.45"). */
  sales: string;
}

export interface WaiterChallenge {
  id: string;
  title: string;
  hint: string;
  metric: keyof WaiterDay;
  /** Meta (em reais quando metric = sales). */
  target: number;
}

/** Desafios do dia: renovam à meia-noite (fuso do restaurante). */
export const WAITER_DAILY_CHALLENGES: readonly WaiterChallenge[] = [
  {
    id: 'orders-5',
    title: 'Lance 5 pedidos hoje',
    hint: 'Cada pedido enviado conta',
    metric: 'orders',
    target: 5,
  },
  {
    id: 'tables-3',
    title: 'Atenda 3 mesas hoje',
    hint: 'Mesas ou comandas diferentes',
    metric: 'tables',
    target: 3,
  },
  {
    id: 'sales-300',
    title: 'Venda R$ 300 hoje',
    hint: 'Soma dos pedidos que você lançou',
    metric: 'sales',
    target: 300,
  },
  {
    id: 'orders-15',
    title: 'Dia cheio: 15 pedidos',
    hint: 'Para os dias de casa lotada',
    metric: 'orders',
    target: 15,
  },
];

export function challengeProgress(c: WaiterChallenge, day: WaiterDay): number {
  const value = c.metric === 'sales' ? Number(day.sales) || 0 : day[c.metric];
  return c.target <= 0 ? 1 : Math.min(1, value / c.target);
}
