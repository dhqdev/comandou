-- 0067: primeiros passos pelo cardápio usam os dados do cadastro.
--
-- O restaurante não lê tenant_profiles (só o painel). Esta função devolve, para o restaurante
-- da sessão (app.tenant_id), só o que serve para montar a loja: nome, razão social, CPF/CNPJ,
-- responsável, telefone, e-mail de cobrança, cidade e UF. Observações internas ficam de fora.
-- Somente aditiva.

CREATE OR REPLACE FUNCTION app_tenant_signup_profile()
  RETURNS TABLE (
    "name" text,
    "legalName" text,
    "document" text,
    "contactName" text,
    "phone" text,
    "email" text,
    "city" text,
    "state" text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.name::text, p.legal_name, p.document, p.contact_name, p.phone,
           p.billing_email::text, p.city, p.state
      FROM tenants t
      LEFT JOIN tenant_profiles p ON p.tenant_id = t.id
     WHERE t.id = app_current_tenant()
  $$;

REVOKE ALL ON FUNCTION app_tenant_signup_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_signup_profile() TO comandou_app;
