-- 0080: Agenda pessoal de cada pessoa da equipe (menu, ao lado de Novidades), no jeito do Google
-- Agenda: compromissos e tarefas por dia, com tags que a própria pessoa cria e, se ela permitir,
-- lembrete pelo WhatsApp do restaurante no horário que ela escolher.
--
-- 1) agenda_tags: tags da pessoa (nome + cor).
-- 2) agenda_events: o que ela anotou. remind_at = quando sai o lembrete (NULL = sem lembrete);
--    reminded_at marca que já saiu (ou que não deu, com remind_error).
-- 3) agenda_settings: a permissão (liga/desliga) e o número de WhatsApp que recebe os lembretes.
-- Tudo é de uma pessoa só: a API sempre filtra por user_id. Somente aditiva.

CREATE TABLE agenda_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color       text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agenda_tags_name_idx ON agenda_tags(tenant_id, user_id, lower(name));

CREATE TABLE agenda_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes         text CHECK (length(notes) <= 2000),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  tag_id        uuid,
  done          boolean NOT NULL DEFAULT false,
  remind_at     timestamptz,
  reminded_at   timestamptz,
  remind_error  text CHECK (length(remind_error) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, tag_id) REFERENCES agenda_tags(tenant_id, id) ON DELETE SET NULL (tag_id)
);
CREATE INDEX agenda_events_user_idx ON agenda_events(tenant_id, user_id, starts_at);
-- Lembretes que ainda vão sair (a varredura de minuto em minuto lê só estes).
CREATE INDEX agenda_events_due_idx ON agenda_events(remind_at)
  WHERE remind_at IS NOT NULL AND reminded_at IS NULL;
CREATE TRIGGER agenda_events_updated_at BEFORE UPDATE ON agenda_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agenda_settings (
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  whatsapp_enabled  boolean NOT NULL DEFAULT false,
  phone             text CHECK (phone ~ '^[0-9]{10,15}$'),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (NOT whatsapp_enabled OR phone IS NOT NULL),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE TRIGGER agenda_settings_updated_at BEFORE UPDATE ON agenda_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agenda_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agenda_tags TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON agenda_events TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON agenda_settings TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_tags TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_events TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON agenda_settings TO comandou_app;

-- Varredura dos lembretes: o painel só descobre QUAIS restaurantes têm lembrete vencido (sem ler
-- o conteúdo); o envio roda dentro do restaurante, com o RLS dele.
CREATE POLICY platform_read ON agenda_events TO comandou_platform USING (true);
GRANT SELECT (tenant_id, remind_at, reminded_at) ON agenda_events TO comandou_platform;
