import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptFile } from '../src/backup/backup-crypto';
import { applyRetention, JobContext, runBackup, runRestoreTest } from '../src/backup/jobs';
import { S3Client } from '../src/backup/s3-client';
import { withJobLock } from '../src/backup/runtime';
import { OWNER_URL } from './env';
import { FakeS3, startFakeS3 } from './fake-s3';

/**
 * Backup de verdade contra o banco de teste e um bucket S3 falso: pg_dump → cifra → envio →
 * teste de restauração num Postgres temporário (initdb). Precisa dos programas do Postgres 16
 * (PG_BIN ou /usr/lib/postgresql/16/bin).
 */
const PG_BIN =
  process.env.TEST_PG_BIN ??
  ['/usr/lib/postgresql/16/bin', '/usr/libexec/postgresql16'].find((d) =>
    existsSync(`${d}/initdb`),
  );
const KEY = randomBytes(32).toString('base64');
const S3 = { keyId: 'chave-b2', secret: 'segredo-b2', bucket: 'comandou-backups' };

let pool: Pool;
let s3: FakeS3;
let ctx: JobContext;

beforeAll(async () => {
  pool = new Pool({ connectionString: OWNER_URL, max: 3 });
  s3 = await startFakeS3(S3);
  ctx = {
    pool,
    ownerUrl: OWNER_URL,
    integrationsKey: KEY,
    s3: new S3Client({ endpoint: s3.url, region: 'us-west-004', ...S3 }),
    prefix: 'comandou',
    retentionDays: 30,
    workDir: await mkdtemp(join(tmpdir(), 'cm-bk-')),
    pgBin: PG_BIN,
    trigger: 'manual',
  };
});
afterAll(async () => {
  await s3?.close();
  await pool?.end();
});

// initdb não roda como root (contêineres de desenvolvimento): aí só o teste de restauração pula.
const ROOT = process.getuid?.() === 0;

describe.skipIf(!PG_BIN)('serviço de backup (banco real, bucket falso)', () => {
  it('faz o backup cifrado, envia ao bucket e registra em backup_runs', async () => {
    const { key, size } = await runBackup(ctx);
    expect(key).toMatch(/^comandou\/plataforma\/\d{4}\/\d{2}\/comandou-\d{8}T\d{6}Z\.dump\.enc$/);
    const obj = s3.objects.get(key)!;
    expect(obj.body.length).toBe(size);
    expect(obj.body.subarray(0, 6).toString()).toBe('CMBK1\n');
    expect(obj.body.includes(Buffer.from('PGDMP'))).toBe(false); // nada em claro no bucket
    const [run] = (await pool.query(`SELECT * FROM backup_runs WHERE object_key = $1`, [key])).rows;
    expect(run).toMatchObject({ kind: 'backup', status: 'ok', size_bytes: String(size) });
    expect(run.sha256).toBe(obj.meta.sha256);
    expect(run.details.trigger).toBe('manual');
    expect(run.details.before.migrations).toBeGreaterThan(10);

    // Só a INTEGRATIONS_KEY abre o arquivo: vira um dump legível do Postgres.
    const dir = await mkdtemp(join(tmpdir(), 'cm-bk-'));
    await writeFile(join(dir, 'x.enc'), obj.body);
    await decryptFile(KEY, join(dir, 'x.enc'), join(dir, 'x.dump'));
    expect((await readFile(join(dir, 'x.dump'))).subarray(0, 5).toString()).toBe('PGDMP');
  });

  it.skipIf(ROOT)(
    'teste de restauração num Postgres temporário confere migrações e contagens',
    async () => {
      const got = await runRestoreTest({ ...ctx, port: 55433 });
      expect(got.policies).toBeGreaterThan(0);
      const [run] = (
        await pool.query(
          `SELECT status, details FROM backup_runs WHERE kind = 'restore_test' ORDER BY id DESC LIMIT 1`,
        )
      ).rows;
      expect(run.status).toBe('ok');
      expect(run.details.restored.migrations).toBeGreaterThan(10);
    },
  );

  it.skipIf(ROOT)(
    'arquivo adulterado no bucket: teste de restauração falha e fica registrado',
    async () => {
      const [last] = [...s3.objects.entries()].slice(-1);
      last[1].body[100] ^= 1;
      await expect(runRestoreTest({ ...ctx, port: 55433 })).rejects.toThrow(/sha256/);
      const [run] = (
        await pool.query(
          `SELECT status, error FROM backup_runs WHERE kind = 'restore_test' ORDER BY id DESC LIMIT 1`,
        )
      ).rows;
      expect(run).toMatchObject({ status: 'failed' });
      last[1].body[100] ^= 1;
    },
  );

  it('bucket recusando a chave: backup falha com mensagem clara, sem segredo', async () => {
    const bad = { ...ctx, s3: new S3Client({ endpoint: s3.url, region: 'x', ...S3, secret: 'x' }) };
    await expect(runBackup(bad)).rejects.toThrow(/Chave recusada/);
    const [run] = (
      await pool.query(`SELECT status, error FROM backup_runs ORDER BY id DESC LIMIT 1`)
    ).rows;
    expect(run.status).toBe('failed');
    expect(run.error).not.toContain(OWNER_URL);
  });

  it('um trabalho por vez no servidor', async () => {
    const inner = await withJobLock(pool, () => withJobLock(pool, async () => 'rodou'));
    expect(inner).toBe('busy');
  });
});

describe('retenção', () => {
  it('apaga só backups mais velhos que o prazo e guarda sempre os 3 últimos', async () => {
    const r = await startFakeS3({ ...S3, bucket: 'ret' });
    const c = new S3Client({ endpoint: r.url, region: 'x', ...S3, bucket: 'ret' });
    const old = (days: number) => new Date(Date.now() - days * 86_400_000);
    const put = (key: string, days: number) =>
      r.objects.set(key, { body: Buffer.from('x'), meta: {}, modified: old(days) });
    put('comandou/2026/01/comandou-20260101T030000Z.dump.enc', 90);
    put('comandou/2026/02/comandou-20260201T030000Z.dump.enc', 60);
    put('comandou/2026/03/comandou-20260301T030000Z.dump.enc', 50);
    put('comandou/2026/04/comandou-20260401T030000Z.dump.enc', 40);
    put('comandou/2026/05/comandou-20260501T030000Z.dump.enc', 35);
    put('comandou/outro-arquivo.txt', 400); // não é backup: nunca apaga
    expect(await applyRetention({ s3: c, prefix: 'comandou', retentionDays: 30 })).toEqual({
      deleted: 2,
      kept: 3,
    });
    expect([...r.objects.keys()].sort()).toEqual([
      'comandou/2026/03/comandou-20260301T030000Z.dump.enc',
      'comandou/2026/04/comandou-20260401T030000Z.dump.enc',
      'comandou/2026/05/comandou-20260501T030000Z.dump.enc',
      'comandou/outro-arquivo.txt',
    ]);
    expect(await applyRetention({ s3: c, prefix: 'comandou', retentionDays: 0 })).toEqual({
      deleted: 0,
    });
    await r.close();
  });
});
