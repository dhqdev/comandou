import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Executor de migrações SQL versionadas (db/migrations/NNNN_nome.sql).
 * - Cada arquivo roda em sua própria transação.
 * - Advisory lock impede execuções concorrentes (ex.: duas réplicas subindo).
 * - Checksum detecta alteração de migração já aplicada (falha em vez de divergir silenciosamente).
 * Deve ser executado com a conexão do DONO (DATABASE_OWNER_URL).
 */
export async function migrate(
  ownerUrl: string,
  dir = MIGRATIONS_DIR,
  log = console.log,
): Promise<MigrationResult> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migração ${file} foi alterada depois de aplicada`);
        result.skipped.push(file);
        continue;
      }
      log(`aplicando ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha em ${file}: ${(err as Error).message}`);
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    await client.end();
  }
}
