import type { ClientBase } from 'pg';

/**
 * Cópia dos dados de UM restaurante entre bancos com o mesmo esquema (mesmas migrações), usada
 * para mover um restaurante antigo do banco central para um banco só dele. Roda com o papel
 * dono nos dois bancos.
 *
 * Tabelas que ficam sempre no banco central e não são copiadas: cadastro do restaurante na
 * plataforma (domínios, etapas de cadastro, assinatura), registro de bancos, trabalhos, backups
 * e tudo do painel (platform_*). Tokens de acesso de suporte (vencem em 2 min) também não.
 */
const CENTRAL_ONLY = new Set([
  'tenants',
  'tenant_domains',
  'tenant_provisioning_steps',
  'subscriptions',
  'tenant_databases',
  'tenant_db_jobs',
  'backup_runs',
]);
const NOT_COPIED = new Set(['support_access_tokens']);

const isCentralOnly = (t: string) => CENTRAL_ONLY.has(t) || t.startsWith('platform_');

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`nome inválido: ${s}`);
  return `"${s}"`;
};

/** Tabelas com tenant_id, em ordem de dependência (quem é referenciado vem antes). */
export async function tenantTables(c: ClientBase): Promise<string[]> {
  const { rows: tables } = await c.query<{ t: string }>(
    `SELECT c.table_name::text AS t
       FROM information_schema.columns c
       JOIN information_schema.tables x
         ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      ORDER BY 1`,
  );
  const names = tables.map((r) => r.t).filter((t) => !isCentralOnly(t));
  const set = new Set(names);
  const { rows: fks } = await c.query<{ child: string; parent: string }>(
    `SELECT cl.relname::text AS child, pl.relname::text AS parent
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class pl ON pl.oid = k.confrelid
      WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`,
  );
  const deps = new Map(names.map((n) => [n, new Set<string>()]));
  for (const f of fks)
    if (set.has(f.child) && set.has(f.parent) && f.child !== f.parent)
      deps.get(f.child)!.add(f.parent);
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < names.length) {
    const next = names.find((n) => !done.has(n) && [...deps.get(n)!].every((d) => done.has(d)));
    if (!next) throw new Error('Dependência circular entre tabelas; cópia cancelada');
    order.push(next);
    done.add(next);
  }
  return order;
}

async function columns(c: ClientBase, table: string): Promise<string[]> {
  const { rows } = await c.query<{ a: string }>(
    `SELECT attname::text AS a FROM pg_attribute
      WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
      ORDER BY attnum`,
    [`public.${table}`],
  );
  return rows.map((r) => r.a);
}

async function copyRows(
  src: ClientBase,
  dst: ClientBase,
  table: string,
  where: string,
  params: unknown[],
  batch: number,
): Promise<number> {
  const cols = (await columns(dst, table)).map(ident).join(', ');
  const cursor = `cm_copy_${table}`;
  await src.query(
    `DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT row_to_json(x)::text AS j FROM ${ident(table)} x WHERE ${where}`,
    params,
  );
  let n = 0;
  for (;;) {
    const { rows } = await src.query<{ j: string }>(`FETCH ${batch} FROM ${cursor}`);
    if (!rows.length) break;
    await dst.query(
      `INSERT INTO ${ident(table)} (${cols}) OVERRIDING SYSTEM VALUE
       SELECT ${cols} FROM json_populate_recordset(NULL::${ident(table)}, $1::json)`,
      [`[${rows.map((r) => r.j).join(',')}]`],
    );
    n += rows.length;
  }
  await src.query(`CLOSE ${cursor}`);
  return n;
}

async function count(c: ClientBase, table: string, where: string, params: unknown[]) {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${ident(table)} WHERE ${where}`,
    params,
  );
  return Number(rows[0].n);
}

/** Sequências (identity/serial) continuam depois do maior id copiado. */
async function fixSequences(dst: ClientBase, tables: string[]) {
  const { rows } = await dst.query<{ t: string; col: string }>(
    `SELECT c.relname::text AS t, a.attname::text AS col
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
        AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_get_serial_sequence(format('public.%I', c.relname), a.attname) IS NOT NULL`,
    [tables],
  );
  for (const r of rows)
    await dst.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), coalesce(max(${ident(r.col)}), 1), max(${ident(r.col)}) IS NOT NULL)
         FROM ${ident(r.t)}`,
      [`public.${r.t}`, r.col],
    );
}

export interface CopyReport {
  tables: Record<string, number>;
  rows: number;
}

/**
 * Copia o restaurante de `src` para `dst` (banco novo, vazio, já migrado). Lê tudo de uma
 * fotografia consistente (REPEATABLE READ) e grava numa transação só: ou copia tudo, ou nada.
 * Confere a contagem de cada tabela antes de confirmar.
 */
export async function copyTenant(
  src: ClientBase,
  dst: ClientBase,
  tenantId: string,
  log: (m: string) => void = () => undefined,
): Promise<CopyReport> {
  const versions = async (c: ClientBase) =>
    (await c.query<{ v: string }>(`SELECT version AS v FROM schema_migrations ORDER BY 1`)).rows
      .map((r) => r.v)
      .join(',');
  if ((await versions(src)) !== (await versions(dst)))
    throw new Error('Os dois bancos não estão na mesma versão das migrações');

  await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await dst.query('BEGIN');
  try {
    const tables = await tenantTables(src);
    const report: CopyReport = { tables: {}, rows: 0 };
    // Banco novo e fora de uso: gatilhos desligados durante a cópia (só os do usuário).
    for (const t of tables) await dst.query(`ALTER TABLE ${ident(t)} DISABLE TRIGGER USER`);
    await dst.query(`ALTER TABLE tenants DISABLE TRIGGER USER`);
    await dst.query(`ALTER TABLE users DISABLE TRIGGER USER`);

    report.tables.tenants = await copyRows(src, dst, 'tenants', 'id = $1', [tenantId], 1);
    if (report.tables.tenants !== 1)
      throw new Error('Restaurante não encontrado no banco de origem');
    const usersWhere = `id IN (SELECT user_id FROM memberships WHERE tenant_id = $1)`;
    report.tables.users = await copyRows(src, dst, 'users', usersWhere, [tenantId], 500);

    for (const t of tables) {
      if (NOT_COPIED.has(t)) continue;
      const batch = t === 'media' ? 10 : 500;
      const n = await copyRows(src, dst, t, 'tenant_id = $1', [tenantId], batch);
      const expected = await count(src, t, 'tenant_id = $1', [tenantId]);
      if (n !== expected || (await count(dst, t, 'tenant_id = $1', [tenantId])) !== expected)
        throw new Error(`Contagem diferente em ${t}`);
      report.tables[t] = n;
      if (n) log(`  ${t}: ${n}`);
    }
    if ((await count(dst, 'users', usersWhere, [tenantId])) !== report.tables.users)
      throw new Error('Contagem diferente em users');

    for (const t of tables) await dst.query(`ALTER TABLE ${ident(t)} ENABLE TRIGGER USER`);
    await dst.query(`ALTER TABLE tenants ENABLE TRIGGER USER`);
    await dst.query(`ALTER TABLE users ENABLE TRIGGER USER`);
    await fixSequences(dst, [...tables, 'tenants', 'users']);
    report.rows = Object.values(report.tables).reduce((a, b) => a + b, 0);
    await dst.query('COMMIT');
    await src.query('COMMIT');
    return report;
  } catch (e) {
    await dst.query('ROLLBACK').catch(() => undefined);
    await src.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/**
 * Apaga do banco central as linhas de um restaurante que já está em outro banco (depois da
 * mudança) ou que está sendo excluído. Uma transação só, na ordem inversa das dependências.
 * `everything` também apaga o cadastro na plataforma (domínios, assinatura, etapas) e o próprio
 * restaurante: usado na exclusão. Contas de pessoas sem outro restaurante também saem.
 */
export async function purgeTenantRows(
  c: ClientBase,
  tenantId: string,
  everything = false,
): Promise<Record<string, number>> {
  const tables = await tenantTables(c);
  const out: Record<string, number> = {};
  await c.query('BEGIN');
  try {
    const { rows: members } = await c.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE tenant_id = $1`,
      [tenantId],
    );
    for (const t of [...tables].reverse()) {
      const r = await c.query(`DELETE FROM ${ident(t)} WHERE tenant_id = $1`, [tenantId]);
      if (r.rowCount) out[t] = r.rowCount;
    }
    if (members.length) {
      // Contas que só existiam por causa deste restaurante (sem outro vínculo).
      await c.query('SAVEPOINT users_cleanup');
      try {
        const r = await c.query(
          `DELETE FROM users u WHERE u.id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)`,
          [members.map((m) => m.user_id)],
        );
        if (r.rowCount) out.users = r.rowCount;
        await c.query('RELEASE SAVEPOINT users_cleanup');
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT users_cleanup');
      }
    }
    if (everything) {
      for (const t of ['tenant_domains', 'tenant_provisioning_steps', 'subscriptions']) {
        const r = await c.query(`DELETE FROM ${ident(t)} WHERE tenant_id = $1`, [tenantId]);
        if (r.rowCount) out[t] = r.rowCount;
      }
      const r = await c.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      out.tenants = r.rowCount ?? 0;
    }
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}
