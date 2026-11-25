import { Client } from 'pg';
import { migrate, MigrationResult } from './migrator';
import { databaseUrl, serverOf } from './tenant-database';

export interface DatabaseMigrationReport {
  /** Banco sem credenciais (host:porta/nome), seguro para log. */
  database: string;
  status: 'ok' | 'failed' | 'not-run';
  applied: string[];
  skipped: string[];
  error?: string;
}

/**
 * Lista de bancos a migrar: primeiro o central (DATABASE_OWNER_URL), depois os dedicados
 * (TENANT_DATABASE_OWNER_URLS, separados por vírgula ou quebra de linha). Repetidos são ignorados.
 * Hoje a lista costuma ter um só banco (o compartilhado).
 */
export function databaseList(central: string, dedicated?: string): string[] {
  const extra = (dedicated ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([central, ...extra])];
}

/** host:porta/nome do banco, sem usuário nem senha. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(endereço inválido)';
  }
}

/**
 * Aplica as migrações em cada banco, um por vez. Cada banco tem o seu registro de versões
 * (schema_migrations) e cada arquivo roda na sua transação, então uma falha nunca deixa um banco
 * pela metade nem desfaz o que já foi aplicado em outro.
 * - Se o banco central falhar, os demais não são tocados (o central define a versão da plataforma).
 * - Se um dedicado falhar, os outros dedicados seguem e a falha aparece no relatório.
 */
export async function migrateAll(
  urls: string[],
  run: (url: string) => Promise<MigrationResult> = (url) =>
    migrate(url, undefined, (m) => console.log(`${describeDatabase(url)}: ${m}`)),
): Promise<DatabaseMigrationReport[]> {
  const reports: DatabaseMigrationReport[] = [];
  let centralFailed = false;
  for (const [i, url] of urls.entries()) {
    const database = describeDatabase(url);
    if (centralFailed) {
      reports.push({ database, status: 'not-run', applied: [], skipped: [] });
      continue;
    }
    try {
      const r = await run(url);
      reports.push({ database, status: 'ok', applied: r.applied, skipped: r.skipped });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Nunca repassa a URL completa (com senha) para o log.
      const error = urls.reduce((m, u) => m.split(u).join(describeDatabase(u)), message);
      reports.push({ database, status: 'failed', applied: [], skipped: [], error });
      if (i === 0) centralFailed = true;
    }
  }
  return reports;
}

/**
 * Bancos próprios dos restaurantes, pelo registro do banco central (ler DEPOIS de migrar o
 * central: aí o registro tem todas as colunas). Com a versão desta imagem conhecida, ficam de fora
 * os restaurantes presos a outra versão: eles só migram quando o Super Admin atualiza cada um
 * (trabalho "upgrade"). Erro ao ler o registro é erro do migrate: antes virava lista vazia e os
 * bancos dos restaurantes ficavam sem a migração, em silêncio.
 */
export async function registeredDatabases(
  centralUrl: string,
  version = process.env.COMANDOU_VERSION,
): Promise<string[]> {
  const c = new Client({ connectionString: centralUrl });
  await c.connect();
  try {
    const v = version?.trim().replace(/^v?/, 'v');
    const pinned = v && /^v\d+\.\d+\.\d+$/.test(v) ? v : null;
    const { rows } = await c.query<{
      db_name: string;
      host: string | null;
      port: number | null;
      ssl: string | null;
    }>(
      `SELECT d.db_name, s.host, s.port, s.ssl FROM tenant_databases d
         JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN platform_db_servers s ON s.id = d.server_id
        WHERE d.status IN ('ready', 'deleting', 'transferring')
          AND ($1::text IS NULL OR t.app_version IS NULL OR t.app_version = $1)
        ORDER BY d.db_name`,
      [pinned],
    );
    return rows.map((r) => databaseUrl(centralUrl, r.db_name, serverOf(r)));
  } finally {
    await c.end();
  }
}
