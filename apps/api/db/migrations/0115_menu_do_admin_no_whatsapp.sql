-- 0115: Menu do Super Admin pelo WhatsApp do painel. Os números cadastrados aqui (e só eles)
-- recebem o menu de opções ao escrever para o número do painel (escolher um restaurante, ver
-- situação, varredura, backups, bancos) e os avisos automáticos (backup que falhou, restaurante
-- novo, banco que não ficou pronto...) e o resumo do dia. Só o painel lê e grava. Somente aditiva.

-- Ajustes do menu (uma linha só).
CREATE TABLE platform_wa_bot_settings (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- desligado: ninguém recebe o menu nem avisos (as conversas seguem no painel)
  enabled          boolean NOT NULL DEFAULT true,
  -- hora (de Brasília) do resumo do dia; NULL = sem resumo
  summary_hour     smallint DEFAULT 8 CHECK (summary_hour BETWEEN 0 AND 23),
  -- último dia em que o resumo saiu (trava entre réplicas da API)
  last_summary_on  date,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_wa_bot_settings (id) VALUES (true);

-- Números que usam o menu. Cada um pertence a um Super Admin (ações feitas pelo WhatsApp entram
-- no histórico do painel no nome dele).
CREATE TABLE platform_wa_operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{10,15}$'),
  label       text CHECK (length(label) <= 60),
  admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  alerts      boolean NOT NULL DEFAULT true,
  summary     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Onde a conversa do menu de cada número parou: restaurante escolhido, lista numerada da última
-- tela e a ação esperando o SIM. Vence sozinha (o serviço volta ao menu depois de 30 min parado).
CREATE TABLE platform_wa_bot_state (
  operator_id  uuid PRIMARY KEY REFERENCES platform_wa_operators(id) ON DELETE CASCADE,
  screen       text NOT NULL DEFAULT 'main' CHECK (length(screen) <= 40),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE SET NULL,
  choices      jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending      text CHECK (length(pending) <= 40),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Avisos já mandados: a chave (ex.: backup-failed:123) entra uma vez só, em qualquer réplica.
CREATE TABLE platform_wa_alerts (
  key      text PRIMARY KEY CHECK (length(key) <= 120),
  sent_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_wa_alerts_sent ON platform_wa_alerts (sent_at);

ALTER TABLE platform_wa_bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_bot_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON platform_wa_bot_settings TO comandou_platform;

ALTER TABLE platform_wa_operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_operators TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_wa_operators TO comandou_platform;

ALTER TABLE platform_wa_bot_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_bot_state TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_wa_bot_state TO comandou_platform;

ALTER TABLE platform_wa_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_alerts TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON platform_wa_alerts TO comandou_platform;
