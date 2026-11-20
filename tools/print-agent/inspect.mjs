// Tudo o que dá para saber de uma impressora de rede sem imprimir nada: pergunta pelo IPP
// (porta 631) e pelo SNMP (UDP 161) ao mesmo tempo e junta as respostas.
import { ippPrinter } from './ipp.mjs';
import { printerType, typeFromCommandSet } from './kinds.mjs';
import { snmpPrinter } from './snmp.mjs';

/**
 * @typedef {{ name: string, level: number|null, color?: string|null, some?: boolean }} Supply
 * @typedef {{ type?: string, model?: string|null, serial?: string|null, location?: string|null,
 *   status?: string|null, problems?: string[], supplies?: Supply[], pages?: number|null,
 *   color?: boolean|null, duplex?: boolean|null, paper?: string[], resolution?: string|null,
 *   firmware?: string|null, web?: string|null, jobs?: number|null, ipp?: string|null,
 *   commandSet?: string|null, description?: string|null }} Details
 */

/** Junta IPP e SNMP: o que um não sabe o outro completa. */
export function mergeDetails(ipp, snmp) {
  if (!ipp && !snmp) return null;
  const a = ipp ?? {};
  const b = snmp ?? {};
  const supplies = a.supplies?.length ? a.supplies : (b.supplies ?? []);
  return {
    model: a.model || b.model || null,
    serial: b.serial || null,
    location: a.location || b.location || null,
    status: a.status || b.status || null,
    message: a.message || null,
    problems: [...new Set([...(a.problems ?? []), ...(b.problems ?? [])])],
    supplies,
    pages: b.pages ?? null,
    color: a.color ?? (supplies.length > 1 ? true : null),
    duplex: a.duplex ?? null,
    paper: a.paper ?? [],
    resolution: a.resolution ?? null,
    firmware: a.firmware ?? null,
    web: a.web ?? null,
    jobs: a.jobs ?? null,
    ipp: ipp ? a.path : null,
    commandSet: a.commandSet ?? null,
    description: b.description ?? null,
  };
}

/** Tipo pelo que a impressora contou (linguagem primeiro, depois o modelo). */
export function typeOfDetails(d, ...names) {
  return typeFromCommandSet(d?.commandSet) ?? printerType(d?.model, d?.description, ...names);
}

/** Pergunta à impressora de rede tudo o que ela conta. */
export async function inspectHost(host, { ippPaths = [], timeoutMs = 2500 } = {}) {
  const [ipp, snmp] = await Promise.all([
    ippPrinter(host, { paths: ippPaths, timeoutMs }).catch(() => null),
    snmpPrinter(host, { timeoutMs: Math.min(timeoutMs, 1500) }).catch(() => null),
  ]);
  return mergeDetails(ipp, snmp);
}

/** Roda `fn` em cada item, no máximo `n` de cada vez. */
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
