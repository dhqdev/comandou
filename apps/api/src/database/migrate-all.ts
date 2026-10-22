import { migrate, MigrationResult } from './migrator';

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
