-- 0106: Ícone de cada restaurante no Super Admin. Somente aditiva.
--
-- O painel mostra, na lista e no detalhe do restaurante, o ícone que o próprio restaurante pôs na
-- Loja online (o favicon; sem ele, o logo). O papel da plataforma não lê as tabelas do
-- restaurante, então lê por duas funções estreitas:
--   platform_tenant_icons()          qual imagem é o ícone de cada restaurante deste banco;
--   platform_tenant_icon(tenant, id) a imagem, só se ela for o ícone (ou o logo) ATUAL dele.
-- Nenhuma outra foto do restaurante passa por aqui.

CREATE FUNCTION platform_tenant_icons()
  RETURNS TABLE (tenant_id uuid, icon_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.tenant_id, COALESCE(s.favicon_image_id, s.logo_image_id)
      FROM tenant_store_settings s
     WHERE COALESCE(s.favicon_image_id, s.logo_image_id) IS NOT NULL
  $$;
REVOKE ALL ON FUNCTION platform_tenant_icons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_icons() TO comandou_platform;

CREATE FUNCTION platform_tenant_icon(p_tenant uuid, p_id uuid)
  RETURNS TABLE (content_type text, bytes bytea)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT m.content_type, m.bytes
      FROM tenant_store_settings s
      JOIN media m ON m.tenant_id = s.tenant_id AND m.id = p_id
     WHERE s.tenant_id = p_tenant
       AND p_id IN (s.favicon_image_id, s.logo_image_id)
  $$;
REVOKE ALL ON FUNCTION platform_tenant_icon(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_icon(uuid, uuid) TO comandou_platform;
