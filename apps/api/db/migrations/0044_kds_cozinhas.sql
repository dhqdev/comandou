-- 0044: KDS com várias cozinhas. Somente aditiva.
-- 1) production_sectors.color/position: cor que identifica cada cozinha (Bar, Chapa...) na tela
--    e a ordem em que aparecem na escolha do aparelho.
-- 2) kitchen_settings: o que as telas da cozinha mostram (cronômetro, fotos, abas por tipo de
--    pedido, impressão...). Quem grava é o Super Admin; o sistema do restaurante só lê.
-- 3) O Super Admin cadastra e ajusta as cozinhas do restaurante (production_sectors).

ALTER TABLE production_sectors
  ADD COLUMN color    text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000);

CREATE TABLE kitchen_settings (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  display    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(display) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER kitchen_settings_updated_at BEFORE UPDATE ON kitchen_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE kitchen_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT ON kitchen_settings TO comandou_app;

CREATE POLICY platform_all ON kitchen_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON kitchen_settings TO comandou_platform;
CREATE POLICY platform_all ON production_sectors TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON production_sectors TO comandou_platform;
