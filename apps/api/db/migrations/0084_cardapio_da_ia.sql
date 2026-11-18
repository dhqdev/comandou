-- 0084: o cardápio que a IA manda no WhatsApp é o arquivo que o próprio restaurante sobe (PDF ou
-- fotos), não um PDF gerado pelo sistema.
--
-- ai_menu_files: os arquivos, na ordem em que são mandados (position). PDF até 10 MB, foto até
-- 3 MB; a API limita a quantidade e o total por restaurante. Somente aditiva.

CREATE TABLE ai_menu_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 80),
  content_type  text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX ai_menu_files_tenant_idx ON ai_menu_files(tenant_id, position, created_at);

ALTER TABLE ai_menu_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_menu_files
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_menu_files TO comandou_app;
