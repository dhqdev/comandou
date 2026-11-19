import { findReport, type ReportDoc } from '@comandou/shared';
import type { Tx } from '../../database/database.service';
import { aplicativos } from './apps';
import { type Built, type Period, resolvePeriod } from './kit';
import { bairros, clientes, engenharia, equipe, frete, horarios, motoboys, produtos } from './more';
import { garcons } from './waiters';
import { cancelamentos, evolucao, extrato, fechamentos, perdas, resultado, ticket } from './sales';

/** Cada relatório do catálogo (REPORT_GROUPS) e quem o monta. */
const BUILDERS: Record<string, (p: Period) => Promise<Built>> = {
  resultado,
  extrato,
  evolucao,
  ticket,
  perdas,
  cancelamentos,
  fechamentos,
  produtos,
  engenharia,
  horarios,
  equipe,
  garcons,
  bairros,
  motoboys,
  frete,
  aplicativos,
  clientes,
};

export const hasReport = (id: string) => id in BUILDERS && !!findReport(id);

export async function buildReport(
  tx: Tx,
  id: string,
  from: string,
  to: string,
  labels: Record<string, string> = {},
): Promise<ReportDoc> {
  const info = findReport(id)!;
  const p = { ...(await resolvePeriod(tx, from, to)), labels };
  const built = await BUILDERS[id]!(p);
  return {
    id,
    group: info.group,
    title: info.title,
    description: info.description,
    restaurant: p.restaurant,
    from: p.from,
    to: p.to,
    prevFrom: p.prevFrom,
    prevTo: p.prevTo,
    generatedAt: new Date().toISOString(),
    ...built,
  };
}
