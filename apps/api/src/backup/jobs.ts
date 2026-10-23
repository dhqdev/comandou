import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Pool } from 'pg';
import { decryptFile, encryptFile } from './backup-crypto';
import { S3Client } from './s3-client';

/**
 * Trabalhos do serviço de backup:
 *  - backup: pg_dump (formato custom) → cifra (AES-256-GCM) → envia ao bucket → confere tamanho
 *    → apaga do bucket os backups mais velhos que a retenção (guardando sempre os 3 últimos);
 *  - teste de restauração: baixa o último backup bom, confere o sha256, decifra e restaura num
 *    Postgres TEMPORÁRIO dentro do contêiner (nunca toca o banco de produção), conferindo
 *    migrações e contagens contra as anotadas na hora do backup.
 * Cada execução vira uma linha em backup_runs (painel Super Admin). Nada aqui imprime segredos.
 *
 * O banco inteiro é salvo: todos os restaurantes, pedidos, clientes, cadastros e as fotos
 * (a tabela media guarda as imagens no próprio banco).
 */
export interface JobContext {
  pool: Pool; // papel dono
  ownerUrl: string;
  integrationsKey: string;
  s3: S3Client;
  prefix: string;
  retentionDays: number;
  workDir: string;
  pgBin?: string;
  trigger: 'agendado' | 'painel' | 'deploy' | 'manual';
  log?: (msg: string) => void;
}

export const BACKUP_KEY_RE = /comandou-\d{8}T\d{6}Z\.dump\.(enc|age)$/;
const KEEP_AT_LEAST = 3;

const STATS_SQL = `SELECT json_build_object(
  'tenants', (SELECT count(*) FROM tenants),
  'orders', (SELECT count(*) FROM orders),
  'payments', (SELECT count(*) FROM payments),
  'media', (SELECT count(*) FROM media),
  'migrations', (SELECT count(*) FROM schema_migrations),
  'lastMigration', (SELECT max(version) FROM schema_migrations)) AS s`;

type Stats = Record<'tenants' | 'orders' | 'payments' | 'media' | 'migrations', number> & {
  lastMigration: string;
};

function bin(ctx: Pick<JobContext, 'pgBin'>, name: string) {
  return ctx.pgBin ? join(ctx.pgBin, name) : name;
}

/** Roda um programa; em erro, devolve as últimas linhas da saída de erro (sem a URL do banco). */
function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out = (out + d).slice(-20_000)));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4_000)));
    p.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `${cmd.split('/').pop()} saiu com código ${code}: ${err
                .replace(/postgres(ql)?:\/\/[^\s"']+/g, '<banco>')
                .trim()
                .split('\n')
                .slice(-3)
                .join(' ')}`,
            ),
          ),
    );
  });
}

async function sha256File(file: string) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function stats(pool: Pool): Promise<Stats> {
  const { rows } = await pool.query<{ s: Stats }>(STATS_SQL);
  return rows[0].s;
}

async function startRun(pool: Pool, kind: 'backup' | 'restore_test', trigger: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO backup_runs (kind, status, details) VALUES ($1, 'running', $2) RETURNING id`,
    [kind, { trigger }],
  );
  return rows[0].id;
}

async function finishRun(
  pool: Pool,
  id: string,
  r: {
    status: 'ok' | 'failed';
    details?: Record<string, unknown>;
    error?: string;
    key?: string;
    size?: number;
    sha?: string;
  },
) {
  await pool.query(
    `UPDATE backup_runs SET status = $2, finished_at = now(), details = details || $3::jsonb,
            error = $4, object_key = coalesce($5, object_key),
            size_bytes = coalesce($6, size_bytes), sha256 = coalesce($7, sha256)
      WHERE id = $1`,
    [
      id,
      r.status,
      r.details ?? {},
      r.error?.slice(0, 1000) ?? null,
      r.key ?? null,
      r.size ?? null,
      r.sha ?? null,
    ],
  );
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export async function runBackup(ctx: JobContext): Promise<{ key: string; size: number }> {
  const log = ctx.log ?? (() => undefined);
  const id = await startRun(ctx.pool, 'backup', ctx.trigger);
  const tmp = await mkdtemp(join(ctx.workDir, 'cm-backup-'));
  const now = new Date();
  const key = `${ctx.prefix}/${now.toISOString().slice(0, 4)}/${now.toISOString().slice(5, 7)}/comandou-${stamp(now)}.dump.enc`;
  try {
    log(`backup: início (registro ${id})`);
    const before = await stats(ctx.pool);
    const dump = join(tmp, 'db.dump');
    await run(bin(ctx, 'pg_dump'), [
      '--format=custom',
      '--compress=6',
      '--no-comments',
      `--file=${dump}`,
      `--dbname=${ctx.ownerUrl}`,
    ]);
    const after = await stats(ctx.pool);
    await run(bin(ctx, 'pg_restore'), ['--list', dump]);
    const enc = join(tmp, 'db.dump.enc');
    await encryptFile(ctx.integrationsKey, dump, enc);
    await unlink(dump);
    const { size } = await stat(enc);
    const sha = await sha256File(enc);
    await ctx.s3.putFile(key, enc, { sha256: sha });
    const remote = await ctx.s3.head(key);
    if (!remote) throw new Error('O arquivo não apareceu no bucket depois do envio');
    if (remote.size !== size)
      throw new Error(`Tamanho no bucket (${remote.size}) difere do local (${size})`);
    const retention = await applyRetention(ctx).catch((e: Error) => ({ error: e.message }));
    await finishRun(ctx.pool, id, {
      status: 'ok',
      details: { before, after, retention },
      key,
      size,
      sha,
    });
    log(`backup: ok ${key} (${size} bytes)`);
    return { key, size };
  } catch (e) {
    const msg = (e as Error).message;
    log(`backup: ERRO ${msg}`);
    await finishRun(ctx.pool, id, { status: 'failed', error: msg }).catch(() => undefined);
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Apaga do bucket os backups com mais de N dias. Guarda sempre os 3 mais novos, mesmo velhos
 * (se o backup parar de rodar, os últimos bons não somem). retention 0 = nunca apaga.
 */
export async function applyRetention(ctx: Pick<JobContext, 's3' | 'prefix' | 'retentionDays'>) {
  if (ctx.retentionDays <= 0) return { deleted: 0 };
  const all = (await ctx.s3.list(`${ctx.prefix}/`))
    .filter((o) => BACKUP_KEY_RE.test(o.key))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  const limit = Date.now() - ctx.retentionDays * 86_400_000;
  const old = all.slice(KEEP_AT_LEAST).filter((o) => o.lastModified.getTime() < limit);
  for (const o of old) await ctx.s3.delete(o.key);
  return { deleted: old.length, kept: all.length - old.length };
}

export async function runRestoreTest(ctx: JobContext & { key?: string; port?: number }) {
  const log = ctx.log ?? (() => undefined);
  const id = await startRun(ctx.pool, 'restore_test', ctx.trigger);
  const tmp = await mkdtemp(join(ctx.workDir, 'cm-restore-'));
  const pgdata = join(tmp, 'pg');
  const port = String(ctx.port ?? 55432);
  let started = false;
  let key: string | undefined;
  const t0 = Date.now();
  try {
    const { rows } = await ctx.pool.query<{
      object_key: string;
      sha256: string;
      details: { before: Stats; after: Stats };
    }>(
      `SELECT object_key, sha256, details FROM backup_runs
        WHERE kind = 'backup' AND status = 'ok' AND object_key LIKE '%.dump.enc'
          AND ($1::text IS NULL OR object_key = $1)
        ORDER BY finished_at DESC LIMIT 1`,
      [ctx.key ?? null],
    );
    if (!rows[0]) throw new Error('Nenhum backup bem-sucedido registrado');
    key = rows[0].object_key;
    const { sha256, details } = rows[0];
    log(`restauração: testando ${key}`);
    const enc = join(tmp, 'db.dump.enc');
    await ctx.s3.getToFile(key, enc);
    if ((await sha256File(enc)) !== sha256)
      throw new Error('sha256 do arquivo baixado não confere');
    const dump = join(tmp, 'db.dump');
    await decryptFile(ctx.integrationsKey, enc, dump);
    await unlink(enc);

    await run(bin(ctx, 'initdb'), [
      '-D',
      pgdata,
      '-U',
      'postgres',
      '--auth=trust',
      '-E',
      'UTF8',
      '--no-instructions',
    ]);
    await run(bin(ctx, 'pg_ctl'), [
      '-D',
      pgdata,
      '-o',
      `-p ${port} -k ${tmp} -c listen_addresses=''`,
      '-w',
      '-l',
      join(tmp, 'pg.log'),
      'start',
    ]);
    started = true;
    const psql = (db: string, sql: string) =>
      run(bin(ctx, 'psql'), [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-h',
        tmp,
        '-p',
        port,
        '-U',
        'postgres',
        '-d',
        db,
        '-c',
        sql,
      ]);
    for (const sql of [
      'CREATE ROLE comandou_owner NOLOGIN',
      'CREATE ROLE comandou_app NOLOGIN',
      'CREATE ROLE comandou_platform NOLOGIN',
      'CREATE DATABASE restore_test',
    ])
      await psql('postgres', sql);
    await run(bin(ctx, 'pg_restore'), [
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '-h',
      tmp,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      'restore_test',
      dump,
    ]);
    const got = JSON.parse(
      (
        await psql(
          'restore_test',
          `${STATS_SQL.replace(/ AS s$/, '')}::jsonb || jsonb_build_object('policies', (SELECT count(*) FROM pg_policies))`,
        )
      ).trim(),
    ) as Stats & { policies: number };
    const wrong = (['tenants', 'orders', 'payments', 'media', 'migrations'] as const).filter(
      (k) => {
        const lo = details.before?.[k];
        const hi = details.after?.[k];
        if (lo === undefined || hi === undefined) return false; // backup antigo sem essa contagem
        return got[k] < lo || got[k] > hi;
      },
    );
    if (wrong.length) throw new Error(`Contagens fora do esperado: ${wrong.join(', ')}`);
    if (!(got.policies > 0)) throw new Error('Nenhuma política de RLS restaurada');
    const seconds = Math.round((Date.now() - t0) / 1000);
    await finishRun(ctx.pool, id, { status: 'ok', details: { restored: got, seconds }, key });
    log(`restauração: ok em ${seconds}s`);
    return got;
  } catch (e) {
    const msg = (e as Error).message;
    log(`restauração: ERRO ${msg}`);
    await finishRun(ctx.pool, id, { status: 'failed', error: msg, key }).catch(() => undefined);
    throw e;
  } finally {
    if (started)
      await run(bin(ctx, 'pg_ctl'), ['-D', pgdata, '-m', 'immediate', 'stop']).catch(
        () => undefined,
      );
    await rm(tmp, { recursive: true, force: true });
  }
}
