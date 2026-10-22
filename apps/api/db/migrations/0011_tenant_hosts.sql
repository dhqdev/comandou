-- Comandou — 0011: lista de slugs dos restaurantes ativos para o provider HTTP do Traefik
-- (alternativa ao certificado coringa: cada <slug>.<domínio base> recebe o próprio certificado).
-- Só slugs, que já são públicos no DNS e na URL. Somente aditiva.
CREATE FUNCTION app_tenant_slugs()
  RETURNS TABLE (slug text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.slug::text FROM tenants t WHERE t.status = 'provisioned' ORDER BY t.slug
  $$;
REVOKE ALL ON FUNCTION app_tenant_slugs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_slugs() TO comandou_app;
