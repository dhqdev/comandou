import { unlink } from 'node:fs/promises';
import { Pool } from 'pg';
import { resolveFileSecrets } from '../config/env';
import { decryptFile } from './backup-crypto';
import { BACKUP_KEY_RE, runBackup, runRestoreTest } from './jobs';
import {
  backupDestination,
  backupEnv,
  jobContext,
  loadSettings,
  usableLocalDir,
  withJobLock,
} from './runtime';

/**
 * Backup pela linha de comando (dentro do contêiner do serviço de backup):
 *
 *   node dist/backup/backup-cli.js run [--deploy]   faz um backup agora (o instalador usa --deploy)
 *   node dist/backup/backup-cli.js restore-test     testa a restauração do último backup
 *   node dist/backup/backup-cli.js list             lista os backups (bucket ou pasta local)
 *   node dist/backup/backup-cli.js download <chave> <arquivo.dump>
 *                                                   baixa e decifra (restauração de desastre)
 *   node dist/backup/backup-cli.js decrypt <arquivo.dump.enc> <arquivo.dump>
 *                                                   decifra um arquivo já baixado (só INTEGRATIONS_KEY)
 *
 * Usa DATABASE_OWNER_URL e INTEGRATIONS_KEY (ou *_FILE). O bucket vem do painel Super Admin;
 * sem ele, os backups ficam na pasta BACKUP_LOCAL_DIR (padrão /backups, volume da stack).
 */
const log = (m: string) => console.log(m);

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'decrypt') {
    if (!a || !b) throw new Error('uso: decrypt <entrada.dump.enc> <saida.dump>');
    const key = resolveFileSecrets(process.env).INTEGRATIONS_KEY;
    if (!key) throw new Error('Defina INTEGRATIONS_KEY (a mesma da stack)');
    await decryptFile(key, a, b);
    log(`ok: ${b}`);
    return;
  }

  const env = backupEnv();
  env.localDir = await usableLocalDir(env.localDir);
  const pool = new Pool({ connectionString: env.ownerUrl, max: 2 });
  try {
    const s = await loadSettings(pool);
    const dest = backupDestination(s, env.localDir);
    if (!dest) {
      log('Backup sem destino: configure o Backblaze no painel (Backups) ou a pasta local.');
      return;
    }
    log(
      dest === 'local'
        ? `Destino: pasta do servidor ${env.localDir} (Backblaze não configurado ou desligado)`
        : `Destino: bucket ${s.bucket}`,
    );
    switch (cmd) {
      case 'run': {
        const ctx = jobContext(pool, env, s, a === '--deploy' ? 'deploy' : 'manual', log);
        const r = await withJobLock(pool, () => runBackup(ctx));
        if (r === 'busy') throw new Error('Já há um backup ou teste rodando; tente em instantes');
        return;
      }
      case 'restore-test': {
        const ctx = jobContext(pool, env, s, 'manual', log);
        const r = await withJobLock(pool, () => runRestoreTest({ ...ctx, key: a }));
        if (r === 'busy') throw new Error('Já há um backup ou teste rodando; tente em instantes');
        return;
      }
      case 'list': {
        const ctx = jobContext(pool, env, s, 'manual');
        for (const o of await ctx.store.list(`${ctx.prefix}/`))
          if (BACKUP_KEY_RE.test(o.key))
            log(`${o.lastModified.toISOString()}  ${String(o.size).padStart(12)}  ${o.key}`);
        return;
      }
      case 'download': {
        if (!a || !b) throw new Error('uso: download <chave> <saida.dump>');
        const ctx = jobContext(pool, env, s, 'manual');
        const enc = `${b}.enc`;
        await ctx.store.getToFile(a, enc);
        await decryptFile(env.integrationsKey, enc, b);
        await unlink(enc);
        log(`ok: ${b} (restaure com pg_restore num banco NOVO; ver docs/backups.md)`);
        return;
      }
      default:
        throw new Error(
          'uso: backup-cli run [--deploy] | restore-test | list | download | decrypt',
        );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`ERRO: ${(e as Error).message}`);
  process.exit(1);
});
