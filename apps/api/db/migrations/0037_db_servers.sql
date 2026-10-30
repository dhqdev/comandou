-- Comandou — 0037: servidores de banco (ADR 0011, nível 2).
--
-- Até aqui todo banco de restaurante ficava no mesmo servidor Postgres do banco central. Agora o
-- painel cadastra outros servidores Postgres (outra VM, outro nó do Swarm ou um Postgres
-- gerenciado) e muda um restaurante, ou todos, de um servidor para outro.
--
--   * platform_db_servers: servidores extras. Só endereço, porta e SSL: os papéis (comandou_owner,
--     comandou_app, comandou_platform) e as senhas são os MESMOS do servidor principal, então
--     nenhuma senha fica gravada no banco.
--   * tenant_databases.server_id: em qual servidor fica o banco do restaurante (vazio = principal).
--   * Novo trabalho "transfer": copia o banco para o outro servidor, confere e troca.
--
-- Roda em todos os bancos (central e de cada restaurante); nos dos restaurantes fica vazio.

CREATE TABLE platform_db_servers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 60),
  host          text NOT NULL CHECK (host ~ '^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$'),
  port          integer NOT NULL DEFAULT 5432 CHECK (port BETWEEN 1 AND 65535),
  -- disable: rede interna (Swarm) | require: pela internet, conexão cifrada
  ssl           text NOT NULL DEFAULT 'disable' CHECK (ssl IN ('disable','require')),
  -- Restaurantes novos são criados aqui (no máximo um; nenhum = servidor principal).
  accepts_new   boolean NOT NULL DEFAULT false,
  -- active: em uso | retired: não recebe restaurantes (para esvaziar e desligar)
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  note          text CHECK (length(note) <= 300),
  -- Conferência feita pelo serviço de backup (papel dono): versão, permissões, bancos, tamanho.
  check_result  jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at    timestamptz,
  -- Conferência feita pela API (papéis da aplicação e do painel entram com as mesmas senhas).
  api_check     jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_checked_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host, port)
);
CREATE UNIQUE INDEX platform_db_servers_one_default ON platform_db_servers((true)) WHERE accepts_new;
CREATE TRIGGER platform_db_servers_updated_at BEFORE UPDATE ON platform_db_servers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE platform_db_servers ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_db_servers TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON platform_db_servers TO comandou_platform;
GRANT INSERT (name, host, port, ssl, accepts_new, note) ON platform_db_servers TO comandou_platform;
GRANT UPDATE (name, host, port, ssl, accepts_new, status, note, api_check, api_checked_at, checked_at)
  ON platform_db_servers TO comandou_platform;

-- Onde fica o banco de cada restaurante. Só o serviço de backup (dono) troca de servidor.
ALTER TABLE tenant_databases
  ADD COLUMN server_id uuid REFERENCES platform_db_servers(id) ON DELETE RESTRICT;
CREATE INDEX tenant_databases_server_idx ON tenant_databases(server_id);
GRANT INSERT (server_id) ON tenant_databases TO comandou_platform;

-- transferring: banco sendo copiado para outro servidor (sem acesso até terminar).
ALTER TABLE tenant_databases DROP CONSTRAINT tenant_databases_status_check;
ALTER TABLE tenant_databases ADD CONSTRAINT tenant_databases_status_check
  CHECK (status IN ('creating','ready','failed','moving','deleting','transferring'));

ALTER TABLE tenant_db_jobs DROP CONSTRAINT tenant_db_jobs_kind_check;
ALTER TABLE tenant_db_jobs ADD CONSTRAINT tenant_db_jobs_kind_check
  CHECK (kind IN ('create','move','delete','transfer'));

-- A API passa a saber também o servidor (endereço, porta e SSL; nunca senha).
DROP FUNCTION app_tenant_database(uuid);
CREATE FUNCTION app_tenant_database(p_tenant uuid)
  RETURNS TABLE (db_name text, status text, host text, port integer, ssl text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT d.db_name, d.status, s.host, s.port, s.ssl
          FROM tenant_databases d LEFT JOIN platform_db_servers s ON s.id = d.server_id
         WHERE d.tenant_id = p_tenant $$;
REVOKE ALL ON FUNCTION app_tenant_database(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_database(uuid) TO comandou_app;

DROP FUNCTION app_tenant_databases_ready();
CREATE FUNCTION app_tenant_databases_ready()
  RETURNS TABLE (tenant_id uuid, db_name text, host text, port integer, ssl text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT d.tenant_id, d.db_name, s.host, s.port, s.ssl
          FROM tenant_databases d LEFT JOIN platform_db_servers s ON s.id = d.server_id
         WHERE d.status = 'ready' ORDER BY d.db_name $$;
REVOKE ALL ON FUNCTION app_tenant_databases_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_databases_ready() TO comandou_app;
