import { Client, Pool } from 'pg';
import { BackupSettingsRow, dueJobs } from './backup-settings';
import {
  claimJob,
  databasePrivileges,
  DbJobContext,
  grantDatabasePrivileges,
  requeueJob,
  runDbJob,
} from './db-jobs';
import { JobContext, runBackup, runRestoreTest } from './jobs';
import {
  BackupEnv,
  backupDestination,
  backupEnv,
  jobContext,
  loadSettings,
  usableLocalDir,
  withJobLock,
} from './runtime';
import { LocalStore, localSpace, localUsage } from './store';

/**
 * Serviço de backup (imagem comandou-backup). A cada 15 s:
 *  - avisa o painel que está vivo (worker_seen_at);
 *  - lê a configuração feita no painel Super Admin → Backups;
 *  - roda o backup diário no horário escolhido (Brasília), o teste de restauração semanal e os
 *    pedidos de "fazer agora" do painel.
 * Usa a conexão do dono (lê todos os restaurantes) e a INTEGRATIONS_KEY (abre a applicationKey
 * e cifra os arquivos). Nunca registra segredos no log.
 */
const TICK_MS = 15_000;
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function main() {
  const env = backupEnv();
  const wanted = env.localDir;
  env.localDir = await usableLocalDir(wanted);
  if (wanted && !env.localDir)
    log(`pasta do backup local indisponível (${wanted}): sem Backblaze, não há backup`);
  const pool = new Pool({ connectionString: env.ownerUrl, max: 3 });
  pool.on('error', (e) => log(`banco: ${e.message}`));
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  if (env.adminUrl) {
    const owner = decodeURIComponent(new URL(env.ownerUrl).username);
    await grantDatabasePrivileges(env.adminUrl, owner)
      .then(() => log(`permissão para criar bancos de restaurantes garantida (${owner})`))
      .catch((e: Error) => log(`não foi possível dar a permissão de criar bancos: ${e.message}`));
  }

  const heartbeat = async () => {
    const priv = await databasePrivileges(pool).catch(() => null);
    await pool
      .query(
        `UPDATE platform_backup_settings SET worker_seen_at = now(), worker_info = $1 WHERE id`,
        [
          {
            version: process.env.COMANDOU_VERSION ?? null,
            node: process.version,
            canCreateDatabases: priv?.canCreateDatabases ?? null,
            canTerminate: priv?.canTerminate ?? null,
            local: await localInfo(pool, env),
          },
        ],
      )
      .catch((e: Error) => log(`banco indisponível: ${e.message}`));
  };
  const beat = setInterval(heartbeat, 30_000);
  log('serviço de backup iniciado; configuração no painel Super Admin → Backups');

  const jobs = dbJobsLoop(pool, env, () => stopping);

  while (!stopping) {
    await heartbeat();
    try {
      await tick(pool, env);
    } catch (e) {
      log(`erro: ${(e as Error).message}`);
    }
    for (let i = 0; i < TICK_MS / 500 && !stopping; i++)
      await new Promise((r) => setTimeout(r, 500));
  }
  clearInterval(beat);
  await jobs;
  await pool.end();
}

/**
 * Trabalhos de banco pedidos pelo painel (criar, mover, excluir). Acorda na hora pelo
 * LISTEN comandou_db_jobs e, de qualquer forma, confere a fila a cada 5 s. Mover e excluir
 * esperam um backup em andamento terminar (mesma trava do backup).
 */
async function dbJobsLoop(pool: Pool, env: BackupEnv, stopping: () => boolean) {
  // Serviço reiniciado no meio de um trabalho: volta para a fila (as etapas são retomáveis).
  await pool
    .query(
      `UPDATE tenant_db_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`,
    )
    .catch(() => undefined);
  let wake: () => void = () => undefined;
  let listener: Client | null = null;
  const listen = async () => {
    try {
      listener = new Client({ connectionString: env.ownerUrl });
      listener.on('error', () => (listener = null));
      listener.on('notification', () => wake());
      await listener.connect();
      await listener.query('LISTEN comandou_db_jobs');
    } catch {
      listener = null;
    }
  };
  await listen();
  const context = async (): Promise<DbJobContext> => {
    const s = await loadSettings(pool);
    return {
      pool,
      ownerUrl: env.ownerUrl,
      log,
      backup: backupDestination(s, env.localDir)
        ? () => jobContext(pool, env, s, 'painel', log)
        : undefined,
    };
  };
  while (!stopping()) {
    try {
      if (!listener) await listen();
      for (let job = await claimJob(pool); job && !stopping(); job = await claimJob(pool)) {
        const ctx = await context();
        if (job.kind === 'create') {
          await runDbJob(ctx, job);
          continue;
        }
        const current = job;
        const r = await withJobLock(pool, () => runDbJob(ctx, current));
        if (r === 'busy') {
          await requeueJob(pool, job.id, 'Aguardando o backup em andamento terminar');
          break;
        }
      }
    } catch (e) {
      log(`trabalhos de banco: ${(e as Error).message}`);
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5_000);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }
  await (listener as Client | null)?.end().catch(() => undefined);
}

/** Pasta local para o painel: onde fica, espaço livre e quanto os backups ocupam. */
let usageCache: { at: number; files: number; bytes: number } | null = null;
async function localInfo(pool: Pool, env: BackupEnv) {
  if (!env.localDir) return null;
  if (!usageCache || Date.now() - usageCache.at > 5 * 60_000) {
    const s = await loadSettings(pool).catch(() => null);
    const u = await localUsage(new LocalStore(env.localDir), s?.prefix ?? 'comandou').catch(() => ({
      files: 0,
      bytes: 0,
    }));
    usageCache = { at: Date.now(), ...u };
  }
  return {
    dir: env.localDir,
    files: usageCache.files,
    bytes: usageCache.bytes,
    ...(await localSpace(env.localDir)),
  };
}

async function tick(pool: Pool, env: BackupEnv) {
  const s = await loadSettings(pool);
  const due = dueJobs(s, new Date(), !!env.localDir);
  if (!due.backup && !due.restore) return;
  await withJobLock(pool, async () => {
    if (due.backup) {
      // Marca antes de rodar: uma falha não vira repetição a cada 15 s (aparece no painel).
      await pool.query(
        due.backupScheduled
          ? `UPDATE platform_backup_settings SET last_scheduled_backup = $1::date WHERE id`
          : `UPDATE platform_backup_settings SET backup_requested_at = NULL WHERE id AND $1::text IS NOT NULL`,
        [due.today],
      );
      const trigger = due.backupScheduled ? 'agendado' : 'painel';
      const ctx = await contextOrFail(pool, env, s, 'backup', trigger);
      if (ctx) await runBackup(ctx).catch(() => undefined); // erro já fica em backup_runs
      usageCache = null;
    }
    if (due.restore) {
      await pool.query(
        due.restoreScheduled
          ? `UPDATE platform_backup_settings SET last_scheduled_restore = $1::date WHERE id`
          : `UPDATE platform_backup_settings SET restore_requested_at = NULL WHERE id AND $1::text IS NOT NULL`,
        [due.today],
      );
      const trigger = due.restoreScheduled ? 'agendado' : 'painel';
      const ctx = await contextOrFail(pool, env, s, 'restore_test', trigger);
      if (ctx) await runRestoreTest(ctx).catch(() => undefined);
    }
  });
}

/**
 * Monta o contexto (abre a applicationKey). Se falhar antes de o trabalho começar (ex.: a
 * INTEGRATIONS_KEY mudou e a chave não abre), registra a falha para aparecer no painel.
 */
async function contextOrFail(
  pool: Pool,
  env: BackupEnv,
  s: BackupSettingsRow,
  kind: 'backup' | 'restore_test',
  trigger: JobContext['trigger'],
): Promise<JobContext | null> {
  try {
    return jobContext(pool, env, s, trigger, log);
  } catch (e) {
    const msg = /auth|decrypt/i.test((e as Error).message)
      ? 'Não foi possível abrir a applicationKey salva: a INTEGRATIONS_KEY do serviço de backup é diferente da API. Salve a chave de novo no painel.'
      : (e as Error).message;
    log(`erro: ${msg}`);
    await pool
      .query(
        `INSERT INTO backup_runs (kind, status, finished_at, details, error)
         VALUES ($1, 'failed', now(), $2, $3)`,
        [kind, { trigger }, msg],
      )
      .catch(() => undefined);
    return null;
  }
}

main().catch((e) => {
  console.error(`serviço de backup parou: ${(e as Error).message}`);
  process.exit(1);
});
