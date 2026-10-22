-- Comandou — 0007 Etapa 6: plataforma SaaS.
-- Super Admin com identidade, sessão e auditoria próprias (papel de banco comandou_platform),
-- planos e assinaturas com limites, domínios personalizados verificados por DNS TXT e registro
-- dos backups. Somente aditiva: nenhuma linha existente é apagada ou reescrita.
--
-- O papel comandou_platform é criado FORA das migrações (o dono não tem CREATEROLE), como os
-- outros papéis: infrastructure/docker/postgres-init/01-roles.sh. Ele NÃO tem BYPASSRLS: cada
-- tabela que o painel usa tem uma política própria "TO comandou_platform" e GRANTs mínimos.
-- A API do restaurante (comandou_app) não recebe nada das tabelas da plataforma.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'comandou_platform') THEN
    RAISE EXCEPTION 'papel comandou_platform ausente: crie-o antes desta migração (docs/deploy.md, seção Etapa 6)';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO comandou_platform;

-- Planos (catálogo global, sem dados de restaurante) ------------------------------------------
-- Limite NULL = ilimitado. Preços e limites são definidos no painel; nenhum plano é criado aqui.
CREATE TABLE plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name                   text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  price_monthly          numeric(14,2) NOT NULL DEFAULT 0 CHECK (price_monthly >= 0),
  max_users              integer CHECK (max_users > 0),
  max_products           integer CHECK (max_products > 0),
  max_orders_month       integer CHECK (max_orders_month > 0),
  feature_fiscal         boolean NOT NULL DEFAULT false,
  feature_whatsapp       boolean NOT NULL DEFAULT false,
  feature_custom_domain  boolean NOT NULL DEFAULT false,
  trial_days             integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 90),
  is_default             boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_default OR active)
);
CREATE UNIQUE INDEX plans_one_default ON plans ((true)) WHERE is_default;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Assinaturas: no máximo uma "viva" (não cancelada) por restaurante. Troca de plano altera a
-- linha viva; cancelar grava cancelled_at. O histórico fica na auditoria da plataforma.
CREATE TABLE subscriptions (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id             uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status              text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled')),
  started_at          timestamptz NOT NULL DEFAULT now(),
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,
  cancelled_at        timestamptz,
  notes               text CHECK (length(notes) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL)
);
CREATE UNIQUE INDEX subscriptions_one_live ON subscriptions(tenant_id) WHERE status <> 'cancelled';
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Domínios personalizados ----------------------------------------------------------------------
-- O hostname deixa de ser único globalmente: vários restaurantes podem PEDIR o mesmo domínio,
-- mas só um consegue verificá-lo (índice único parcial). Assim ninguém "segura" um domínio alheio
-- só cadastrando. Remover grava removed_at (a app não tem DELETE).
ALTER TABLE tenant_domains
  ADD COLUMN verification_token text CHECK (verification_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN last_error text CHECK (length(last_error) <= 300),
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN created_by uuid;
ALTER TABLE tenant_domains DROP CONSTRAINT tenant_domains_hostname_key;
CREATE UNIQUE INDEX tenant_domains_verified_host ON tenant_domains(hostname)
  WHERE verified_at IS NOT NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX tenant_domains_tenant_host ON tenant_domains(tenant_id, hostname)
  WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION app_resolve_tenant(p_slug text, p_hostname text)
  RETURNS TABLE (id uuid, slug text, name text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name, t.status FROM tenants t
     WHERE p_slug IS NOT NULL AND t.slug = p_slug
    UNION ALL
    SELECT t.id, t.slug, t.name, t.status FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
     WHERE p_slug IS NULL AND d.hostname = p_hostname
       AND d.verified_at IS NOT NULL AND d.removed_at IS NULL
    LIMIT 1
  $$;

-- Lista os domínios verificados para o roteador (Traefik). Só hostnames, que já são públicos no DNS.
CREATE FUNCTION app_verified_domains()
  RETURNS TABLE (hostname text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.hostname::text FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
     WHERE d.verified_at IS NOT NULL AND d.removed_at IS NULL AND t.status = 'provisioned'
     ORDER BY d.hostname
  $$;
REVOKE ALL ON FUNCTION app_verified_domains() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_verified_domains() TO comandou_app;

GRANT INSERT (tenant_id, hostname, verification_token, created_by) ON tenant_domains TO comandou_app;
GRANT UPDATE (verified_at, last_checked_at, last_error, removed_at) ON tenant_domains TO comandou_app;

-- Identidade da plataforma (separada dos usuários dos restaurantes) ----------------------------
-- Criada só pela CLI com a conexão do dono; o painel não cria administradores.
CREATE TABLE platform_admins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash    text NOT NULL,
  -- Segredo TOTP cifrado (AES-256-GCM com INTEGRATIONS_KEY; contexto platform-totp:<id>).
  totp_secret_enc  bytea NOT NULL,
  -- Último passo de 30 s aceito: o mesmo código não serve duas vezes.
  totp_last_step   bigint NOT NULL DEFAULT 0,
  disabled_at      timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER platform_admins_updated_at BEFORE UPDATE ON platform_admins FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      uuid NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  token_hash    bytea NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);
CREATE INDEX platform_sessions_admin_idx ON platform_sessions(admin_id);

-- Auditoria da plataforma: só inserção. Toda ação do painel grava aqui, inclusive falhas de login.
CREATE TABLE platform_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    uuid REFERENCES platform_admins(id) ON DELETE RESTRICT,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_created_idx ON platform_audit_log(created_at DESC);
CREATE INDEX platform_audit_tenant_idx ON platform_audit_log(tenant_id, created_at DESC);

-- Backups: gravado pelo serviço de backup (conexão do dono); o painel só lê.
CREATE TABLE backup_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('backup','restore_test')),
  status       text NOT NULL CHECK (status IN ('running','ok','failed')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  object_key   text,
  size_bytes   bigint,
  sha256       text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text
);
CREATE INDEX backup_runs_kind_started_idx ON backup_runs(kind, started_at DESC);

-- RLS -------------------------------------------------------------------------------------------
ALTER TABLE plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_runs         ENABLE ROW LEVEL SECURITY;

-- Restaurante: vê os planos (para mostrar o próprio) e só a própria assinatura.
CREATE POLICY app_read ON plans TO comandou_app USING (true);
CREATE POLICY tenant_isolation ON subscriptions TO comandou_app USING (tenant_id = app_current_tenant());
GRANT SELECT ON plans, subscriptions TO comandou_app;

-- Plataforma: políticas explícitas, tabela por tabela.
CREATE POLICY platform_all ON plans               TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON subscriptions       TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_admins     TO comandou_platform USING (true);
CREATE POLICY platform_all ON platform_sessions   TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_audit_log  TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_read ON backup_runs        TO comandou_platform USING (true);
CREATE POLICY platform_all ON tenants                   TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_domains            TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_provisioning_steps TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON users                     TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON memberships               TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON categories                TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_insert ON audit_log TO comandou_platform WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON plans, subscriptions TO comandou_platform;
GRANT SELECT ON platform_admins TO comandou_platform;
GRANT UPDATE (totp_last_step, last_login_at) ON platform_admins TO comandou_platform;
GRANT SELECT, INSERT ON platform_sessions TO comandou_platform;
GRANT UPDATE (revoked_at, last_seen_at) ON platform_sessions TO comandou_platform;
GRANT SELECT, INSERT ON platform_audit_log TO comandou_platform;
GRANT SELECT ON backup_runs TO comandou_platform;
-- Provisionamento pelo painel e suspensão/reativação.
GRANT SELECT, INSERT ON tenants TO comandou_platform;
GRANT UPDATE (name, status) ON tenants TO comandou_platform;
GRANT SELECT ON tenant_domains TO comandou_platform;
GRANT UPDATE (removed_at) ON tenant_domains TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON tenant_provisioning_steps TO comandou_platform;
-- Usuários: nunca o hash da senha de volta (SELECT só em colunas sem segredo).
GRANT SELECT (id, email, name, disabled_at, created_at) ON users TO comandou_platform;
GRANT INSERT (email, name, password_hash) ON users TO comandou_platform;
GRANT SELECT, INSERT ON memberships TO comandou_platform;
GRANT SELECT, INSERT ON categories TO comandou_platform;
GRANT INSERT ON audit_log TO comandou_platform;

-- Uso por restaurante (painel): números agregados, sem dados de clientes ou pedidos.
CREATE FUNCTION platform_tenant_usage()
  RETURNS TABLE (tenant_id uuid, users bigint, products bigint, orders_month bigint,
                 last_order_at timestamptz, fiscal_errors bigint, message_failures bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id,
      (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
      (SELECT count(*) FROM products p WHERE p.tenant_id = t.id AND p.active),
      (SELECT count(*) FROM orders o WHERE o.tenant_id = t.id
          AND o.created_at >= (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone)),
      (SELECT max(o.created_at) FROM orders o WHERE o.tenant_id = t.id),
      (SELECT count(*) FROM fiscal_documents f WHERE f.tenant_id = t.id AND f.status IN ('error','rejected')
          AND f.created_at > now() - interval '7 days'),
      (SELECT count(*) FROM message_outbox x WHERE x.tenant_id = t.id AND x.status = 'failed'
          AND x.created_at > now() - interval '7 days')
    FROM tenants t
  $$;
REVOKE ALL ON FUNCTION platform_tenant_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_usage() TO comandou_platform;
