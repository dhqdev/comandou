-- 0020: cadastro do cliente no painel Super Admin e restaurante suspenso com aviso próprio.
-- 1) tenant_profiles: dados de contato e cobrança do restaurante (CPF/CNPJ, responsável, telefone,
--    cidade, observações internas). Só o painel (papel comandou_platform) lê e grava; o
--    restaurante não vê esta tabela.
-- 2) O painel escolhe o fuso horário do restaurante na criação.
-- 3) Restaurante suspenso continua com endereço no Traefik: quem abre vê "restaurante suspenso"
--    (resposta da API) em vez de um erro de página não encontrada. Login e operação seguem
--    bloqueados pela API. Somente aditiva.

CREATE TABLE tenant_profiles (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name    text CHECK (length(legal_name) <= 160),
  document      text CHECK (document ~ '^([0-9]{11}|[0-9]{14})$'),
  contact_name  text CHECK (length(contact_name) <= 120),
  phone         text CHECK (phone ~ '^[0-9]{10,13}$'),
  billing_email text CHECK (length(billing_email) <= 254),
  city          text CHECK (length(city) <= 80),
  state         char(2) CHECK (state ~ '^[A-Z]{2}$'),
  notes         text CHECK (length(notes) <= 1000),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenant_profiles_updated_at BEFORE UPDATE ON tenant_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON tenant_profiles TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON tenant_profiles TO comandou_platform;

GRANT UPDATE (timezone) ON tenants TO comandou_platform;

CREATE OR REPLACE FUNCTION app_tenant_slugs()
  RETURNS TABLE (slug text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.slug::text FROM tenants t WHERE t.status IN ('provisioned', 'suspended') ORDER BY t.slug
  $$;
