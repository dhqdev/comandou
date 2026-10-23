import { mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRetention } from './jobs';
import { backupDestination } from './runtime';
import { dueJobs, type BackupSettingsRow } from './backup-settings';
import { LocalStore } from './store';

const settings = (over: Partial<BackupSettingsRow> = {}): BackupSettingsRow => ({
  enabled: false,
  endpoint: '',
  region: '',
  bucket: '',
  prefix: 'comandou',
  key_id: '',
  secret_enc: null,
  run_at: '03:00',
  retention_days: 30,
  restore_test_weekday: 7,
  backup_requested_at: null,
  restore_requested_at: null,
  last_scheduled_backup: null,
  last_scheduled_restore: null,
  worker_seen_at: null,
  ...over,
});

describe('pasta local do backup', () => {
  it('grava, confere, lista, baixa e apaga com as mesmas chaves do bucket', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cm-store-'));
    const s = new LocalStore(root);
    const src = join(root, '..', `src-${Date.now()}`);
    await writeFile(src, 'conteudo');
    const key = 'comandou/restaurantes/okalu/2026/10/okalu-20261023T030000Z.dump.enc';
    await s.putFile(key, src);
    expect(await s.head(key)).toEqual({ size: 8, meta: {} });
    await s.putBuffer(
      'comandou/plataforma/2026/10/comandou-20261023T030000Z.dump.enc',
      Buffer.from('x'),
    );
    expect((await s.list('comandou/')).map((o) => o.key)).toEqual([
      'comandou/plataforma/2026/10/comandou-20261023T030000Z.dump.enc',
      key,
    ]);
    expect(await s.list('comandou/restaurantes/okalu/')).toHaveLength(1);
    const out = join(root, '..', `out-${Date.now()}`);
    await s.getToFile(key, out);
    expect(await readFile(out, 'utf8')).toBe('conteudo');
    await s.delete(key);
    expect(await s.head(key)).toBeNull();
    // A pasta do restaurante, que ficou vazia, sai junto.
    expect(await readdir(join(root, 'comandou'))).toEqual(['plataforma']);
  });

  it('recusa chaves que sairiam da pasta', async () => {
    const s = new LocalStore(await mkdtemp(join(tmpdir(), 'cm-store-')));
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'a//b', ''])
      await expect(s.putBuffer(bad, Buffer.from('x'))).rejects.toThrow(/inválida/);
  });

  it('a retenção funciona igual na pasta local', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cm-store-'));
    const s = new LocalStore(root);
    const put = async (key: string, days: number) => {
      await s.putBuffer(key, Buffer.from('x'));
      const t = new Date(Date.now() - days * 86_400_000);
      await utimes(join(root, key), t, t);
    };
    for (const [m, d] of [
      ['01', 90],
      ['02', 60],
      ['03', 50],
      ['04', 40],
    ] as const)
      await put(`comandou/plataforma/2026/${m}/comandou-2026${m}01T030000Z.dump.enc`, d);
    expect(await applyRetention({ store: s, prefix: 'comandou', retentionDays: 30 })).toEqual({
      deleted: 1,
      kept: 3,
    });
  });
});

describe('destino do backup', () => {
  const b2 = { endpoint: 'https://s3.x', bucket: 'b', key_id: 'k', secret_enc: Buffer.from('x') };
  it('Backblaze configurado e ligado vai para o bucket; senão, para a pasta do servidor', () => {
    expect(backupDestination(settings({ enabled: true, ...b2 }), '/backups')).toBe('b2');
    expect(backupDestination(settings({ enabled: false, ...b2 }), '/backups')).toBe('local');
    expect(backupDestination(settings(), '/backups')).toBe('local');
    expect(backupDestination(settings(), null)).toBeNull();
  });

  it('sem bucket, o backup diário roda mesmo assim quando há pasta local', () => {
    const now = new Date('2026-10-23T09:00:00Z'); // 06:00 em Brasília
    expect(dueJobs(settings(), now).backup).toBe(false);
    expect(dueJobs(settings(), now, true).backup).toBe(true);
    expect(dueJobs(settings({ last_scheduled_backup: '2026-10-23' }), now, true).backup).toBe(
      false,
    );
  });
});
