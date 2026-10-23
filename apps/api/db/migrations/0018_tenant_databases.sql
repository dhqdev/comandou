-- Comandou — 0018: banco de dados próprio para cada restaurante (ADR 0011).
--
-- Como fica:
--   * Banco central (comandou): cadastro dos restaurantes, domínios, planos e assinaturas, painel
--     Super Admin, backups e o REGISTRO de onde fica cada restaurante (tenant_databases).
--   * Banco de cada restaurante (comandou_<endereço>): todas as tabelas, com os dados de UM
--     restaurante só (equipe, pedidos, caixa, cardápio, clientes, fotos...).
--   * Restaurante sem linha em tenant_databases continua no banco central (como era até a 0.18).
--
-- Esta migração roda em TODOS os bancos (central e de cada restaurante). Nos bancos dos
-- restaurantes as tabelas novas ficam vazias. Criar, mover e excluir bancos é feito pelo serviço
-- de backup (papel dono), a partir de pedidos do painel (tenant_db_jobs).

-- 1) Situações novas do restaurante: mudando de banco e sendo excluído (sem acesso nos dois casos).
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('requested','provisioning','provisioned','failed','recovering','suspended',
                    'moving','deleting'));

-- 2) Registro: restaurante → banco. Sem linha = banco central.
CREATE TABLE tenant_databases (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  db_name     text NOT NULL UNIQUE CHECK (db_name ~ '^comandou_[a-z0-9_]{1,54}$'),
  -- creating: sendo criado | ready: em uso | failed: a criação falhou
  -- moving: dados sendo copiados do banco central | deleting: sendo excluído
  status      text NOT NULL CHECK (status IN ('creating','ready','failed','moving','deleting')),
  last_error  text CHECK (length(last_error) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  ready_at    timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenant_databases_updated_at BEFORE UPDATE ON tenant_databases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Fila de trabalhos de banco (criar, mover, excluir), executada pelo serviço de backup.
--    Sem chave estrangeira para tenants: o histórico de bases excluídas continua aqui.
CREATE TABLE tenant_db_jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  tenant_slug   text NOT NULL,
  tenant_name   text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('create','move','delete')),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed')),
  step          text CHECK (length(step) <= 200),
  -- create: dados do primeiro administrador (hash da senha, nunca a senha). Apagado ao concluir.
  -- O painel não lê esta coluna.
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Resultado sem segredos: banco, contagens, arquivo do backup final.
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text CHECK (length(error) <= 1000),
  reason        text CHECK (length(reason) <= 500),
  requested_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenant_db_jobs_one_active ON tenant_db_jobs(tenant_id)
  WHERE status IN ('queued','running');
CREATE INDEX tenant_db_jobs_created_idx ON tenant_db_jobs(created_at DESC);
CREATE INDEX tenant_db_jobs_tenant_idx ON tenant_db_jobs(tenant_id, created_at DESC);
CREATE TRIGGER tenant_db_jobs_updated_at BEFORE UPDATE ON tenant_db_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_db_jobs   ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON tenant_databases TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_db_jobs   TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON tenant_databases TO comandou_platform;
GRANT UPDATE (status, last_error) ON tenant_databases TO comandou_platform;
GRANT SELECT (id, tenant_id, tenant_slug, tenant_name, kind, status, step, result, error, reason,
              requested_by, created_at, started_at, finished_at, updated_at)
  ON tenant_db_jobs TO comandou_platform;
GRANT INSERT (tenant_id, tenant_slug, tenant_name, kind, payload, reason, requested_by)
  ON tenant_db_jobs TO comandou_platform;
-- comandou_app não lê nenhuma das duas: usa as funções abaixo.

-- Onde fica o banco de um restaurante (sem linha = central). Só o nome do banco e a situação.
CREATE FUNCTION app_tenant_database(p_tenant uuid)
  RETURNS TABLE (db_name text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT d.db_name, d.status FROM tenant_databases d WHERE d.tenant_id = p_tenant $$;
REVOKE ALL ON FUNCTION app_tenant_database(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_database(uuid) TO comandou_app;

-- Bancos de restaurante em uso (limpeza periódica roda em cada um).
CREATE FUNCTION app_tenant_databases_ready()
  RETURNS TABLE (tenant_id uuid, db_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT d.tenant_id, d.db_name FROM tenant_databases d WHERE d.status = 'ready' ORDER BY d.db_name $$;
REVOKE ALL ON FUNCTION app_tenant_databases_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_databases_ready() TO comandou_app;

-- 4) Backups: uma execução por banco. tenant_id vazio = banco central.
ALTER TABLE backup_runs
  ADD COLUMN tenant_id uuid,
  ADD COLUMN database text CHECK (database ~ '^comandou[a-z0-9_]*$');
CREATE INDEX backup_runs_tenant_idx ON backup_runs(tenant_id, kind, started_at DESC)
  WHERE tenant_id IS NOT NULL;

-- 5) Acesso de suporte: o token passa a ser gravado no banco do restaurante, onde não existe
--    platform_admins. Guarda o nome de quem gerou; a checagem de administrador ativo continua
--    valendo no banco central.
ALTER TABLE support_access_tokens DROP CONSTRAINT support_access_tokens_admin_id_fkey;
ALTER TABLE support_access_tokens ADD COLUMN admin_name text CHECK (length(admin_name) <= 120);
GRANT INSERT (admin_name) ON support_access_tokens TO comandou_platform;

CREATE OR REPLACE FUNCTION app_consume_support_token(p_tenant uuid, p_hash bytea)
RETURNS TABLE (user_id uuid, admin_name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE support_access_tokens t SET used_at = now()
    FROM memberships m, users u
   WHERE t.token_hash = p_hash AND t.tenant_id = p_tenant
     AND t.used_at IS NULL AND t.expires_at > now()
     AND NOT EXISTS (SELECT 1 FROM platform_admins a
                      WHERE a.id = t.admin_id AND a.disabled_at IS NOT NULL)
     AND m.tenant_id = t.tenant_id AND m.user_id = t.user_id AND m.status = 'active'
     AND u.id = t.user_id AND u.disabled_at IS NULL
  RETURNING t.user_id,
            coalesce(t.admin_name, (SELECT a.name::text FROM platform_admins a WHERE a.id = t.admin_id),
                     'Suporte Comandou')
$$;

-- 6) Auditoria da plataforma sobrevive à exclusão do restaurante (o vínculo vira vazio; o
--    endereço e o nome ficam nos dados do registro e em tenant_db_jobs).
ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_tenant_id_fkey;
ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
