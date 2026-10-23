-- Navegador confiável do painel: depois de entrar uma vez com o código do autenticador,
-- aquele navegador (cookie próprio, só o hash fica aqui) entra só com e-mail e senha.
CREATE TABLE platform_trusted_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  user_agent    text
);
CREATE INDEX platform_trusted_devices_admin_idx ON platform_trusted_devices(admin_id);

ALTER TABLE platform_trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_trusted_devices TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON platform_trusted_devices TO comandou_platform;
GRANT UPDATE (last_used_at, revoked_at) ON platform_trusted_devices TO comandou_platform;
