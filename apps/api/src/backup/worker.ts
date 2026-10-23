import { Pool } from 'pg';
import { BackupSettingsRow, dueJobs } from './backup-settings';
import { JobContext, runBackup, runRestoreTest } from './jobs';
import { BackupEnv, backupEnv, jobContext, loadSettings, withJobLock } from './runtime';

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
  const pool = new Pool({ connectionString: env.ownerUrl, max: 3 });
  pool.on('error', (e) => log(`banco: ${e.message}`));
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const heartbeat = async () => {
    await pool
      .query(
        `UPDATE platform_backup_settings SET worker_seen_at = now(), worker_info = $1 WHERE id`,
        [{ version: process.env.COMANDOU_VERSION ?? null, node: process.version }],
      )
      .catch((e: Error) => log(`banco indisponível: ${e.message}`));
  };
  const beat = setInterval(heartbeat, 30_000);
  log('serviço de backup iniciado; configuração no painel Super Admin → Backups');

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
  await pool.end();
}

async function tick(pool: Pool, env: BackupEnv) {
  const s = await loadSettings(pool);
  const due = dueJobs(s, new Date());
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
