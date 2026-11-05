import type { ClientBase } from 'pg';
import { CENTRAL_TABLES, type CentralRows } from './protocol';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`nome inválido: ${s}`);
  return `"${s}"`;
};

async function columns(c: ClientBase, table: string): Promise<Set<string>> {
  const { rows } = await c.query<{ c: string }>(
    `SELECT column_name::text AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'`,
    [table],
  );
  return new Set(rows.map((r) => r.c));
}

/**
 * Linhas do restaurante no banco central que vão junto: o cadastro, domínios, perfil, assinatura
 * (com os planos dela, para achar o mesmo plano lá pelo código), IA e cobrança. Histórico da
 * plataforma (faturas, contratos, chamados, auditoria) fica na origem.
 */
export async function exportCentralRows(c: ClientBase, tenantId: string): Promise<CentralRows> {
  const out: CentralRows = {};
  for (const t of CENTRAL_TABLES) {
    const exists = (await columns(c, t)).size > 0;
    if (!exists) continue;
    const where = t === 'tenants' ? 'id = $1' : 'tenant_id = $1';
    const { rows } = await c.query<{ r: object }>(
      `SELECT to_jsonb(x) AS r FROM ${ident(t)} x WHERE ${where}`,
      [tenantId],
    );
    out[t] = rows.map((r) => r.r);
  }
  const planIds = new Set<string>();
  for (const s of (out.subscriptions ?? []) as { plan_id?: string; scheduled_plan_id?: string }[]) {
    if (s.plan_id) planIds.add(s.plan_id);
    if (s.scheduled_plan_id) planIds.add(s.scheduled_plan_id);
  }
  if (planIds.size) {
    const { rows } = await c.query<{ r: object }>(
      `SELECT to_jsonb(p) AS r FROM plans p WHERE id = ANY($1::uuid[])`,
      [[...planIds]],
    );
    out.plans = rows.map((r) => r.r);
  }
  return out;
}

/** Insere linhas JSON numa tabela, só com as colunas que existem nos dois lados. */
async function insertRows(c: ClientBase, table: string, rows: object[]) {
  if (!rows.length) return 0;
  const have = await columns(c, table);
  const cols = Object.keys(rows[0]!).filter((k) => have.has(k));
  if (!cols.length) return 0;
  const list = cols.map(ident).join(', ');
  const r = await c.query(
    `INSERT INTO ${ident(table)} (${list}) OVERRIDING SYSTEM VALUE
     SELECT ${list} FROM jsonb_populate_recordset(NULL::${ident(table)}, $1::jsonb)`,
    [JSON.stringify(rows)],
  );
  return r.rowCount ?? 0;
}

/**
 * Grava no banco central do destino o que veio da origem, numa transação já aberta. O restaurante
 * entra como "moving" (sem acesso) e com o endereço escolhido; planos são achados pelo código (se
 * o destino não tem o plano, ele é criado igual ao da origem).
 */
export async function importCentralRows(
  c: ClientBase,
  central: CentralRows,
  over: { slug: string; status: string },
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const tenant = (central.tenants ?? [])[0] as Record<string, unknown> | undefined;
  if (!tenant) throw new Error('O pacote não tem o cadastro do restaurante');
  out.tenants = await insertRows(c, 'tenants', [
    { ...tenant, slug: over.slug, status: over.status, moved_to: null },
  ]);

  // Planos: mesmo código = mesmo plano. Sem ele aqui, cria igual (mesmo id, se estiver livre).
  const planMap = new Map<string, string>();
  for (const p of (central.plans ?? []) as Record<string, unknown>[]) {
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM plans WHERE code = $1`, [
      p.code,
    ]);
    if (rows[0]) {
      planMap.set(String(p.id), rows[0].id);
      continue;
    }
    const taken = await c.query(`SELECT 1 FROM plans WHERE id = $1`, [p.id]);
    const row = taken.rowCount ? { ...p, id: undefined } : p;
    const have = await columns(c, 'plans');
    const cols = Object.keys(row).filter((k) => have.has(k) && row[k] !== undefined);
    const list = cols.map(ident).join(', ');
    const ins = await c.query<{ id: string }>(
      `INSERT INTO plans (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::plans, $1::jsonb)
       RETURNING id`,
      [JSON.stringify(row)],
    );
    planMap.set(String(p.id), ins.rows[0]!.id);
    out.plans = (out.plans ?? 0) + 1;
  }
  const subs = ((central.subscriptions ?? []) as Record<string, unknown>[]).map((s) => ({
    ...s,
    plan_id: planMap.get(String(s.plan_id)) ?? s.plan_id,
    scheduled_plan_id: s.scheduled_plan_id
      ? (planMap.get(String(s.scheduled_plan_id)) ?? null)
      : null,
  }));

  for (const t of CENTRAL_TABLES) {
    if (t === 'tenants') continue;
    const rows = t === 'subscriptions' ? subs : ((central[t] ?? []) as object[]);
    if (!rows.length) continue;
    try {
      out[t] = await insertRows(c, t, rows);
    } catch (e) {
      const msg = (e as Error).message;
      if (t === 'tenant_domains' && /duplicate|unique/i.test(msg))
        throw new Error('Um domínio próprio deste restaurante já está cadastrado no destino');
      throw new Error(`${t}: ${msg}`);
    }
  }
  return out;
}

/** Linhas por tabela (exatas) no banco do restaurante, para conferir depois de restaurar. */
export async function tableCounts(c: ClientBase): Promise<Record<string, number>> {
  const { rows: tables } = await c.query<{ t: string }>(
    `SELECT table_name::text AS t FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'
      ORDER BY 1`,
  );
  if (!tables.length) return {};
  const sql = tables
    .map((r) => `SELECT '${r.t}'::text AS t, count(*)::bigint AS n FROM ${ident(r.t)}`)
    .join(' UNION ALL ');
  const { rows } = await c.query<{ t: string; n: string }>(sql);
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
}

/**
 * Tabelas que chegaram com MENOS linhas que na origem. Mais linhas é normal: migrações mais novas
 * do destino podem criar registros padrão.
 */
export function countDiff(want: Record<string, number>, got: Record<string, number>): string[] {
  return Object.keys(want)
    .filter((t) => t in got && got[t]! < want[t]!)
    .map((t) => `${t} (${want[t]} → ${got[t]})`);
}
