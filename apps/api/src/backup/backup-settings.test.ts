import { describe, expect, it } from 'vitest';
import { addHours, BackupSettingsRow, brasilia, dueJobs } from './backup-settings';

const base: BackupSettingsRow = {
  enabled: true,
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: '',
  bucket: 'b',
  prefix: 'comandou',
  key_id: 'k',
  secret_enc: Buffer.from('x'),
  run_at: '03:00',
  retention_days: 30,
  restore_test_weekday: 7,
  backup_requested_at: null,
  restore_requested_at: null,
  last_scheduled_backup: null,
  last_scheduled_restore: null,
  worker_seen_at: null,
};
// 2026-10-25 é domingo. 06:30 UTC = 03:30 em Brasília.
const at = (iso: string) => new Date(iso);

describe('agenda do backup (horário de Brasília)', () => {
  it('converte para Brasília', () => {
    expect(brasilia(at('2026-10-25T02:30:00Z'))).toEqual({
      date: '2026-10-24',
      time: '23:30',
      weekday: 6,
    });
    expect(addHours('03:00', 2)).toBe('05:00');
    expect(addHours('23:00', 2)).toBe('23:59');
  });

  it('roda uma vez por dia depois do horário', () => {
    expect(dueJobs(base, at('2026-10-24T05:59:00Z')).backup).toBe(false);
    expect(dueJobs(base, at('2026-10-24T06:30:00Z')).backup).toBe(true);
    expect(
      dueJobs({ ...base, last_scheduled_backup: '2026-10-24' }, at('2026-10-24T20:00:00Z')).backup,
    ).toBe(false);
  });

  it('desligado ou sem bucket não roda nem quando pedido', () => {
    const now = new Date();
    expect(dueJobs({ ...base, enabled: false, backup_requested_at: now }, now).backup).toBe(false);
    expect(dueJobs({ ...base, secret_enc: null, backup_requested_at: now }, now).backup).toBe(
      false,
    );
  });

  it('pedido do painel roda na hora', () => {
    const r = dueJobs(
      { ...base, last_scheduled_backup: '2026-10-24', backup_requested_at: new Date() },
      at('2026-10-24T01:00:00Z'),
    );
    expect(r.backup).toBe(true);
    expect(r.backupScheduled).toBe(false);
  });

  it('teste de restauração no dia da semana, 2 h depois do backup', () => {
    expect(dueJobs(base, at('2026-10-25T07:30:00Z')).restore).toBe(false); // 04:30
    expect(dueJobs(base, at('2026-10-25T08:00:00Z')).restore).toBe(true); // 05:00 domingo
    expect(dueJobs(base, at('2026-10-24T08:00:00Z')).restore).toBe(false); // sábado
    expect(dueJobs({ ...base, restore_test_weekday: 0 }, at('2026-10-25T08:00:00Z')).restore).toBe(
      false,
    );
  });
});
