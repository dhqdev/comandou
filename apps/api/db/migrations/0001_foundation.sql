-- PedeMais — 0001 Fundação: tenants, identidade, sessões, auditoria e RLS.
--
-- Papéis de banco (criados fora das migrações, ver infrastructure/docker/postgres-init):
--   pedemais_owner : dono das tabelas; executa migrações e provisionamento. Nunca usado pela API em runtime.
--   pedemais_app   : usado pela API. NÃO é dono das tabelas, NÃO tem BYPASSRLS. Sujeito a RLS.
--
-- Contexto de tenant: cada transação da API executa
--   SELECT set_config('app.tenant_id', '<uuid>', true)   -- true = local à transação
-- e as políticas comparam tenant_id com app_current_tenant(). Sem contexto => nenhuma linha.

CREATE EXTENSION IF NOT EXISTS citext;

-- Funções de contexto -----------------------------------------------------------------------
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Tenants (global) --------------------------------------------------------------------------
CREATE TABLE tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$'),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested','provisioning','provisioned','failed','recovering','suspended')),
  timezone     text NOT NULL DEFAULT 'America/Sao_Paulo',
  currency     char(3) NOT NULL DEFAULT 'BRL',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Domínios: subdomínio <slug>.<base> é implícito; aqui ficam domínios personalizados verificados.
CREATE TABLE tenant_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  hostname     citext NOT NULL UNIQUE CHECK (hostname ~ '^[a-z0-9.-]{3,253}$'),
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_domains_tenant_idx ON tenant_domains(tenant_id);

-- Etapas de provisionamento (idempotente e retomável).
CREATE TABLE tenant_provisioning_steps (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  step         text NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, step)
);

-- Identidade (global) -----------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  name               text NOT NULL,
  password_hash      text NOT NULL,
  is_platform_admin  boolean NOT NULL DEFAULT false,
  disabled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role        text NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','kitchen','driver','attendant','stock','finance','fiscal')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX sessions_tenant_user_idx ON sessions(tenant_id, user_id);

-- Auditoria (somente inserção para a aplicação).
CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id  uuid,
  action         text NOT NULL,
  entity         text NOT NULL,
  entity_id      text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_created_idx ON audit_log(tenant_id, created_at DESC);

-- RLS ---------------------------------------------------------------------------------------
-- Não usamos FORCE ROW LEVEL SECURITY: o dono (pedemais_owner) precisa ignorar RLS para
-- migrações, provisionamento e as funções SECURITY DEFINER abaixo. A API nunca conecta como dono.
ALTER TABLE tenants                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_provisioning_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_self ON tenants
  USING (id = app_current_tenant());
CREATE POLICY tenant_isolation ON tenant_domains
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON tenant_provisioning_steps
  USING (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
-- Usuários: visíveis apenas se forem membros do tenant corrente (sem enumeração global).
CREATE POLICY member_of_current_tenant ON users
  USING (EXISTS (SELECT 1 FROM memberships m
                 WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()));

-- Funções privilegiadas e estreitas (pré-autenticação) ---------------------------------------
-- Resolve o tenant a partir do Host já normalizado. Retorna só o necessário.
CREATE FUNCTION app_resolve_tenant(p_slug text, p_hostname text)
  RETURNS TABLE (id uuid, slug text, name text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, t.status FROM tenants t
     WHERE p_slug IS NOT NULL AND t.slug = p_slug
    UNION ALL
    SELECT t.id, t.slug, t.name, t.status FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
     WHERE p_slug IS NULL AND d.hostname = p_hostname AND d.verified_at IS NOT NULL
    LIMIT 1
  $$;

-- Busca credenciais SOMENTE de membros ativos do tenant informado.
CREATE FUNCTION app_find_login(p_tenant uuid, p_email text)
  RETURNS TABLE (user_id uuid, name text, password_hash text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.name, u.password_hash, m.role
      FROM users u JOIN memberships m ON m.user_id = u.id
     WHERE m.tenant_id = p_tenant AND u.email = p_email::citext
       AND m.status = 'active' AND u.disabled_at IS NULL
  $$;

REVOKE ALL ON FUNCTION app_resolve_tenant(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_login(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_tenant(text, text) TO pedemais_app;
GRANT EXECUTE ON FUNCTION app_find_login(uuid, text) TO pedemais_app;

-- Privilégios da aplicação ------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO pedemais_app;
GRANT SELECT ON tenants, tenant_domains, tenant_provisioning_steps, users, memberships TO pedemais_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO pedemais_app;
GRANT SELECT, INSERT ON audit_log TO pedemais_app;
