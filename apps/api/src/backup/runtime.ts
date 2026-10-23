import { tmpdir } from 'node:os';
import { Pool, PoolClient } from 'pg';
import { resolveFileSecrets } from '../config/env';
import { BackupSettingsRow, s3ConfigFrom, SETTINGS_SQL } from './backup-settings';
import { JobContext } from './jobs';
import { S3Client } from './s3-client';

/** Ambiente do serviço de backup (aceita VAR_FILE, como os Docker secrets). */
export function backupEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = resolveFileSecrets(source);
  const ownerUrl = env.DATABASE_OWNER_URL;
  const integrationsKey = env.INTEGRATIONS_KEY;
  if (!ownerUrl) throw new Error('Defina DATABASE_OWNER_URL (ou DATABASE_OWNER_URL_FILE)');
  if (!integrationsKey || Buffer.from(integrationsKey, 'base64').length !== 32)
    throw new Error('Defina INTEGRATIONS_KEY (32 bytes em base64; a mesma da API)');
  return {
    ownerUrl,
    // Opcional: superusuário do Postgres, só para dar ao dono a permissão de criar bancos.
    adminUrl: env.DATABASE_ADMIN_URL || adminUrlFrom(ownerUrl, env.POSTGRES_PASSWORD),
    integrationsKey,
    workDir: env.WORK_DIR || tmpdir(),
    pgBin: env.PG_BIN || undefined,
  };
}

/** Mesmo servidor do dono, com o usuário postgres (senha do contêiner do banco). */
export function adminUrlFrom(ownerUrl: string, password?: string): string | undefined {
  if (!password) return undefined;
  const u = new URL(ownerUrl);
  u.username = 'postgres';
  u.password = encodeURIComponent(password);
  u.pathname = '/postgres';
  return u.toString();
}

export type BackupEnv = ReturnType<typeof backupEnv>;

export async function loadSettings(db: Pool | PoolClient): Promise<BackupSettingsRow> {
  const { rows } = await db.query<BackupSettingsRow>(SETTINGS_SQL);
  if (!rows[0]) throw new Error('Tabela platform_backup_settings vazia (rode as migrações)');
  return rows[0];
}

export function jobContext(
  pool: Pool,
  env: BackupEnv,
  s: BackupSettingsRow,
  trigger: JobContext['trigger'],
  log?: (m: string) => void,
): JobContext {
  return {
    pool,
    ownerUrl: env.ownerUrl,
    integrationsKey: env.integrationsKey,
    s3: new S3Client(s3ConfigFrom(s, env.integrationsKey)),
    prefix: s.prefix.replace(/^\/+|\/+$/g, ''),
    retentionDays: s.retention_days,
    workDir: env.workDir,
    pgBin: env.pgBin,
    trigger,
    log,
  };
}

/** Uma execução por vez no servidor inteiro (serviço agendado + linha de comando). */
const LOCK_ID = 7_417_001;

export async function withJobLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T | 'busy'> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
      LOCK_ID,
    ]);
    if (!rows[0].ok) return 'busy';
    try {
      return await fn();
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
}
