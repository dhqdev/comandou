-- 0047: mês financeiro do restaurante. Somente aditiva, no banco do restaurante.
-- finance_settings.month_start_day: dia em que o mês financeiro começa (ex.: 5 = do dia 5 até o
-- dia 4 do mês seguinte). Uma linha por restaurante; sem linha, vale o dia 1 (mês do calendário).
-- Em meses mais curtos que o dia escolhido, o mês começa no último dia (regra em @comandou/shared).

CREATE TABLE finance_settings (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  month_start_day  smallint NOT NULL DEFAULT 1 CHECK (month_start_day BETWEEN 1 AND 31),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
CREATE TRIGGER finance_settings_updated_at BEFORE UPDATE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE finance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON finance_settings TO comandou_app;
