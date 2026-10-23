-- 0017: backup configurado pelo painel Super Admin (Backblaze B2 ou outro S3).
-- Uma linha só. A applicationKey fica cifrada com a INTEGRATIONS_KEY (AES-256-GCM, contexto
-- "backup:s3"); o painel nunca a devolve. O serviço de backup (papel dono) lê esta linha,
-- marca o horário em que está vivo e atende os pedidos de "fazer agora". Somente aditiva.
CREATE TABLE platform_backup_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled                 boolean NOT NULL DEFAULT false,
  endpoint                text NOT NULL DEFAULT '' CHECK (endpoint = '' OR endpoint ~ '^https?://'),
  region                  text NOT NULL DEFAULT '',
  bucket                  text NOT NULL DEFAULT '',
  prefix                  text NOT NULL DEFAULT 'comandou' CHECK (prefix ~ '^[A-Za-z0-9._/-]{1,100}$'),
  key_id                  text NOT NULL DEFAULT '',
  secret_enc              bytea,
  run_at                  text NOT NULL DEFAULT '03:00' CHECK (run_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  retention_days          int NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 0 AND 3650),
  restore_test_weekday    int NOT NULL DEFAULT 7 CHECK (restore_test_weekday BETWEEN 0 AND 7),
  backup_requested_at     timestamptz,
  restore_requested_at    timestamptz,
  last_scheduled_backup   date,
  last_scheduled_restore  date,
  worker_seen_at          timestamptz,
  worker_info             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_backup_settings (id) VALUES (true);

ALTER TABLE platform_backup_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_backup_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT ON platform_backup_settings TO comandou_platform;
GRANT UPDATE (enabled, endpoint, region, bucket, prefix, key_id, secret_enc, run_at, retention_days,
              restore_test_weekday, backup_requested_at, restore_requested_at, updated_at, updated_by)
  ON platform_backup_settings TO comandou_platform;

-- Quem disparou cada execução (agendado, painel, deploy) e o aviso de retenção ficam em details.
