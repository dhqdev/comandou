-- 0062: versão do sistema por restaurante.
--
-- O Super Admin fica sempre na versão mais nova; cada restaurante com banco próprio fica na
-- versão em que está até alguém atualizar ele no painel (na hora ou agendado).
-- 1) tenants.app_version: versão em que o restaurante roda (NULL = a do sistema principal).
--    app_update_to / app_update_at: atualização agendada.
-- 2) tenant_db_jobs.kind 'upgrade': o serviço de backup aplica as migrações só no banco do
--    restaurante e grava a versão nova.
-- 3) app_tenant_routes(): endereço de cada restaurante com a versão dele, para o provider do
--    Traefik mandar o restaurante para os serviços daquela versão.
-- Somente aditiva.

ALTER TABLE tenants
  ADD COLUMN app_version   text CHECK (app_version ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
  ADD COLUMN app_update_to text CHECK (app_update_to ~ '^v[0-9]+\.[0-9]+\.[0-9]+$'),
  ADD COLUMN app_update_at timestamptz,
  ADD CONSTRAINT tenants_app_update_pair CHECK ((app_update_to IS NULL) = (app_update_at IS NULL));
GRANT UPDATE (app_version, app_update_to, app_update_at) ON tenants TO comandou_platform;

ALTER TABLE tenant_db_jobs DROP CONSTRAINT tenant_db_jobs_kind_check;
ALTER TABLE tenant_db_jobs ADD CONSTRAINT tenant_db_jobs_kind_check
  CHECK (kind IN ('create','move','delete','transfer','migrate','receive','upgrade'));

-- Endereços com a versão: subdomínio de cada restaurante ativo ou suspenso e os domínios
-- próprios verificados. Só hostnames (já públicos no DNS) e o número da versão.
CREATE FUNCTION app_tenant_routes()
  RETURNS TABLE (hostname text, app_version text, custom boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.hostname::text, t.app_version, true FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
     WHERE d.verified_at IS NOT NULL AND d.removed_at IS NULL AND t.status = 'provisioned'
    UNION ALL
    SELECT t.slug::text, t.app_version, false FROM tenants t
     WHERE t.status IN ('provisioned', 'suspended')
  $$;
REVOKE ALL ON FUNCTION app_tenant_routes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_routes() TO comandou_app;
