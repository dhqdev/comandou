-- 0043: NFC-e em contingência offline e modelos de impressão. Somente aditiva.
-- 1) fiscal_documents.contingency*: a Focus emitiu a NFC-e sem a SEFAZ (fora do ar) e transmite
--    depois. A nota vale para o cliente, mas fica "pendente" até a SEFAZ confirmar.
-- 2) tenant_fiscal_settings.contingency_offline: liga a contingência no cadastro da Focus.
-- 3) print_templates: modelo (Liquid) da conferência de conta, da comanda da cozinha e do rodapé
--    do cupom fiscal, por restaurante.

ALTER TABLE fiscal_documents
  ADD COLUMN contingency            boolean NOT NULL DEFAULT false,
  ADD COLUMN contingency_settled_at timestamptz;
GRANT UPDATE (contingency, contingency_settled_at) ON fiscal_documents TO comandou_app;
CREATE INDEX fiscal_documents_contingency_pending_idx ON fiscal_documents(tenant_id, created_at)
  WHERE contingency AND contingency_settled_at IS NULL;

ALTER TABLE tenant_fiscal_settings
  ADD COLUMN contingency_offline boolean NOT NULL DEFAULT true;

CREATE TABLE print_templates (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('receipt','kitchen_ticket','fiscal_footer')),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind)
);
CREATE TRIGGER print_templates_updated_at BEFORE UPDATE ON print_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE print_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON print_templates
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON print_templates TO comandou_app;
