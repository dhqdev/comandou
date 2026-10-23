import { open } from '../common/secret-box';
import { regionFor, S3Config } from './s3-client';

/** Linha de platform_backup_settings (ver migração 0017). */
export interface BackupSettingsRow {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  key_id: string;
  secret_enc: Buffer | null;
  run_at: string;
  retention_days: number;
  restore_test_weekday: number;
  backup_requested_at: Date | null;
  restore_requested_at: Date | null;
  last_scheduled_backup: string | null;
  last_scheduled_restore: string | null;
  worker_seen_at: Date | null;
}

export const SECRET_CONTEXT = 'backup:s3';

export const SETTINGS_SQL = `SELECT enabled, endpoint, region, bucket, prefix, key_id, secret_enc, run_at,
  retention_days, restore_test_weekday, backup_requested_at, restore_requested_at,
  last_scheduled_backup::text AS last_scheduled_backup,
  last_scheduled_restore::text AS last_scheduled_restore, worker_seen_at
  FROM platform_backup_settings WHERE id`;

export function isConfigured(
  s: Pick<BackupSettingsRow, 'endpoint' | 'bucket' | 'key_id' | 'secret_enc'>,
) {
  return !!(s.endpoint && s.bucket && s.key_id && s.secret_enc);
}

export function s3ConfigFrom(s: BackupSettingsRow, integrationsKey: string): S3Config {
  if (!isConfigured(s)) throw new Error('Backup sem bucket configurado (painel → Backups)');
  return {
    endpoint: s.endpoint,
    region: regionFor(s.endpoint, s.region),
    bucket: s.bucket,
    keyId: s.key_id,
    secret: open(integrationsKey, s.secret_enc!, SECRET_CONTEXT),
  };
}

/**
 * Horários do backup são de Brasília (UTC−3, sem horário de verão desde 2019).
 * Devolve data (AAAA-MM-DD), hora (HH:MM) e dia da semana (1 = segunda … 7 = domingo).
 */
export function brasilia(now: Date) {
  const t = new Date(now.getTime() - 3 * 3_600_000);
  const iso = t.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: t.getUTCDay() || 7 };
}

/**
 * O que o serviço deve rodar agora (agendado ou pedido pelo painel). Com `local` (pasta do
 * servidor disponível), o backup roda mesmo sem o bucket configurado e fica nessa pasta.
 */
export function dueJobs(s: BackupSettingsRow, now: Date, local = false) {
  const b = brasilia(now);
  const ready = (s.enabled && isConfigured(s)) || local;
  return {
    backup:
      ready &&
      (!!s.backup_requested_at || (b.time >= s.run_at && s.last_scheduled_backup !== b.date)),
    backupScheduled: !s.backup_requested_at,
    restore:
      ready &&
      (!!s.restore_requested_at ||
        (s.restore_test_weekday > 0 &&
          b.weekday === s.restore_test_weekday &&
          b.time >= addHours(s.run_at, 2) &&
          s.last_scheduled_restore !== b.date)),
    restoreScheduled: !s.restore_requested_at,
    today: b.date,
  };
}

/** HH:MM + n horas, sem passar de 23:59 (o teste roda depois do backup do mesmo dia). */
export function addHours(hhmm: string, n: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + n * 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
