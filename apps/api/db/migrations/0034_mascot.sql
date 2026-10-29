-- 0034: roupinha do panda de cada pessoa da equipe.
-- mascot_prefs: o que a pessoa vestiu no panda (cabeça e pescoço) e se ele passeia pela tela.
-- Fica no banco do restaurante (RLS por tenant). Somente aditiva.

CREATE TABLE mascot_prefs (
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  outfit      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(outfit) = 'object' AND length(outfit::text) <= 200),
  stroll      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE mascot_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mascot_prefs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON mascot_prefs TO comandou_app;
