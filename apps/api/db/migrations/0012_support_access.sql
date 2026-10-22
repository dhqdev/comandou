-- 0012: painel Super Admin com controle por restaurante.
-- 1) "Abrir a base do cliente": o painel gera um link de uso único (2 min) que vira uma sessão
--    no restaurante, marcada como acesso de suporte e auditada nos dois lados.
-- 2) Equipe do restaurante: encerrar sessões e redefinir a senha de um membro.

CREATE TABLE support_access_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL,
  admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  -- Só o SHA-256 do token; o token em si só existe no link entregue ao Super Admin.
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX support_access_tokens_tenant_idx ON support_access_tokens(tenant_id, created_at DESC);
ALTER TABLE support_access_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON support_access_tokens TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON support_access_tokens TO comandou_platform;
-- comandou_app não lê a tabela: só troca o token pela função abaixo.

-- Sessão aberta pelo suporte: guarda o nome de quem entrou (aparece num aviso no sistema).
ALTER TABLE sessions ADD COLUMN support_admin_name text;

/**
 * Troca um token de suporte por (usuário, nome do Super Admin). Uso único: marca used_at na
 * mesma instrução. Só vale no restaurante do token, dentro do prazo, com o Super Admin ativo e o
 * membro ativo.
 */
CREATE FUNCTION app_consume_support_token(p_tenant uuid, p_hash bytea)
RETURNS TABLE (user_id uuid, admin_name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE support_access_tokens t SET used_at = now()
    FROM platform_admins a, memberships m, users u
   WHERE t.token_hash = p_hash AND t.tenant_id = p_tenant
     AND t.used_at IS NULL AND t.expires_at > now()
     AND a.id = t.admin_id AND a.disabled_at IS NULL
     AND m.tenant_id = t.tenant_id AND m.user_id = t.user_id AND m.status = 'active'
     AND u.id = t.user_id AND u.disabled_at IS NULL
  RETURNING t.user_id, a.name::text
$$;
REVOKE ALL ON FUNCTION app_consume_support_token(uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_consume_support_token(uuid, bytea) TO comandou_app;

-- Sessões dos restaurantes: o painel vê quando cada um usou o sistema e pode encerrar sessões.
CREATE POLICY platform_all ON sessions TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT (id, tenant_id, user_id, created_at, expires_at, revoked_at, last_seen_at,
              support_admin_name) ON sessions TO comandou_platform;
GRANT UPDATE (revoked_at) ON sessions TO comandou_platform;

-- Redefinir senha de um membro (o hash é gerado na API; a senha nunca vai para o log).
GRANT UPDATE (password_hash) ON users TO comandou_platform;
