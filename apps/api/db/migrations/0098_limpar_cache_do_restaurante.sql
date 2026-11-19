-- 0098: Limpar o cache de um restaurante pelo Super Admin. Somente aditiva.
--
-- tenants.cache_cleared_at guarda quando o painel mandou limpar. Toda tela aberta recebe o aviso
-- na hora pelo tempo real; o aparelho que estava fechado ou sem internet confere esta data ao
-- conectar de novo (app_tenant_cache_epoch) e limpa também.

ALTER TABLE tenants ADD COLUMN cache_cleared_at timestamptz;
GRANT UPDATE (cache_cleared_at) ON tenants TO comandou_platform;

CREATE FUNCTION app_tenant_cache_epoch(p_tenant uuid)
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT t.cache_cleared_at FROM tenants t WHERE t.id = p_tenant $$;
REVOKE ALL ON FUNCTION app_tenant_cache_epoch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_cache_epoch(uuid) TO comandou_platform, comandou_app;
