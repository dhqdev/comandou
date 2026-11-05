-- Comandou — 0052: migrar um restaurante inteiro para outra instalação (outra stack/servidor).
--
-- Nível 3 do ADR 0011 ("stack inteira própria"), na ideia do "Movimento de Site" do Frappe: o
-- painel de ORIGEM escolhe o restaurante e a stack de DESTINO (outra instalação do Comandou, em
-- outro servidor), e o serviço de backup faz as fases preparar → enviar → criar → restaurar →
-- virar → encerrar. O painel de DESTINO só aceita pacotes com o token que ele mesmo gerou.
--
--   Na origem:
--   * platform_stacks: as outras instalações (endereço do painel + token de recebimento cifrado
--     com a INTEGRATIONS_KEY).
--   * tenant_migrations: cada migração, com as fases, o pacote (tamanho e sha256) e o resultado.
--   * tenants.moved_to: depois de "virar", o endereço novo; o site antigo manda para lá.
--   No destino:
--   * platform_receiver: liga/desliga o recebimento e guarda o hash do token (nunca o token).
--   * tenant_receptions + tenant_reception_chunks: o pacote chegando em blocos e a instalação.
--
-- Roda em todos os bancos (central e de cada restaurante); nos dos restaurantes fica vazio.

-- 1) migrated: o restaurante foi para outra instalação (o site antigo só redireciona).
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('requested','provisioning','provisioned','failed','recovering','suspended',
                    'moving','deleting','migrated'));
ALTER TABLE tenants
  ADD COLUMN moved_to text CHECK (moved_to ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$');

-- receiving: banco chegando de outra instalação (sem acesso até a virada).
ALTER TABLE tenant_databases DROP CONSTRAINT tenant_databases_status_check;
ALTER TABLE tenant_databases ADD CONSTRAINT tenant_databases_status_check
  CHECK (status IN ('creating','ready','failed','moving','deleting','transferring','receiving'));

ALTER TABLE tenant_db_jobs DROP CONSTRAINT tenant_db_jobs_kind_check;
ALTER TABLE tenant_db_jobs ADD CONSTRAINT tenant_db_jobs_kind_check
  CHECK (kind IN ('create','move','delete','transfer','migrate','receive'));

-- 2) Origem: stacks de destino.
CREATE TABLE platform_stacks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 60),
  -- Endereço do painel Super Admin da outra instalação (https://admin.<domínio>).
  url           text NOT NULL UNIQUE CHECK (url ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  -- Token de recebimento gerado pelo painel de lá, cifrado com a INTEGRATIONS_KEY daqui.
  token_enc     bytea NOT NULL,
  token_hint    text CHECK (length(token_hint) <= 12),
  note          text CHECK (length(note) <= 300),
  -- Última conferência (versão, domínio, migrações, chave igual, serviço de backup vivo).
  check_result  jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER platform_stacks_updated_at BEFORE UPDATE ON platform_stacks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Origem: migrações. As fases e o pacote são gravados pelo serviço de backup.
CREATE TABLE tenant_migrations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^MOV-[0-9]{4}-[0-9]{5}$'),
  -- Sem chave estrangeira: o histórico continua depois que o restaurante sai daqui.
  tenant_id     uuid NOT NULL,
  tenant_slug   text NOT NULL,
  tenant_name   text NOT NULL,
  stack_id      uuid REFERENCES platform_stacks(id) ON DELETE SET NULL,
  stack_name    text NOT NULL,
  -- move: o restaurante passa a rodar no destino | copy: só uma cópia lá (sem virar)
  mode          text NOT NULL CHECK (mode IN ('move','copy')),
  -- backupBefore, keepSuspended, dropAtOrigin
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  phase         text CHECK (phase IN ('preparar','enviar','criar','restaurar','virar','encerrar')),
  -- [{name, status: pendente|rodando|ok|falhou|pulada|desfeita, startedAt, finishedAt, detail}]
  phases        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {size, sha256, chunkSize, chunks, sent, migrations, counts}
  package       jsonb NOT NULL DEFAULT '{}'::jsonb,
  remote_id     text CHECK (length(remote_id) <= 64),
  -- Endereço do restaurante no destino (https://<endereço>.<domínio de lá>).
  remote_url    text CHECK (length(remote_url) <= 300),
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text CHECK (length(error) <= 1000),
  requested_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_migrations_created_idx ON tenant_migrations(created_at DESC);
CREATE INDEX tenant_migrations_tenant_idx ON tenant_migrations(tenant_id, created_at DESC);
CREATE TRIGGER tenant_migrations_updated_at BEFORE UPDATE ON tenant_migrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) Destino: recebimento ligado e o hash do token (o token só aparece uma vez no painel).
CREATE TABLE platform_receiver (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled       boolean NOT NULL DEFAULT false,
  token_hash    bytea,
  token_hint    text CHECK (length(token_hint) <= 12),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_receiver (id) VALUES (true);
CREATE TRIGGER platform_receiver_updated_at BEFORE UPDATE ON platform_receiver
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5) Destino: restaurantes chegando. O pacote fica em blocos aqui até a restauração.
CREATE TABLE tenant_receptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  tenant_slug   text NOT NULL,
  tenant_name   text NOT NULL,
  -- De onde veio (código da migração e painel de origem), só para o histórico.
  source        jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode          text NOT NULL CHECK (mode IN ('move','copy')),
  -- receiving: chegando os blocos | installing: serviço de backup instalando | restored: pronto,
  -- esperando a virada | active: em uso aqui | failed | discarded: desfeito
  status        text NOT NULL DEFAULT 'receiving'
                CHECK (status IN ('receiving','installing','restored','active','failed','discarded')),
  step          text CHECK (length(step) <= 200),
  -- {size, sha256, chunkSize, chunks, migrations, counts, central, keepSuspended}. Sem segredos.
  manifest      jsonb NOT NULL,
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text CHECK (length(error) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenant_receptions_one_open ON tenant_receptions(tenant_id)
  WHERE status IN ('receiving','installing','restored');
CREATE INDEX tenant_receptions_created_idx ON tenant_receptions(created_at DESC);
CREATE TRIGGER tenant_receptions_updated_at BEFORE UPDATE ON tenant_receptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tenant_reception_chunks (
  reception_id  uuid NOT NULL REFERENCES tenant_receptions(id) ON DELETE CASCADE,
  idx           integer NOT NULL CHECK (idx >= 0),
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reception_id, idx)
);

ALTER TABLE platform_stacks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_receiver        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_receptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_reception_chunks  ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_stacks         TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_migrations       TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_receiver       TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_receptions       TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_reception_chunks TO comandou_platform USING (true) WITH CHECK (true);

GRANT SELECT, DELETE ON platform_stacks TO comandou_platform;
GRANT INSERT (name, url, token_enc, token_hint, note) ON platform_stacks TO comandou_platform;
GRANT UPDATE (name, url, token_enc, token_hint, note, check_result, checked_at)
  ON platform_stacks TO comandou_platform;

GRANT SELECT ON tenant_migrations TO comandou_platform;
GRANT INSERT (code, tenant_id, tenant_slug, tenant_name, stack_id, stack_name, mode, options,
              phases, requested_by) ON tenant_migrations TO comandou_platform;
GRANT UPDATE (status, error, finished_at) ON tenant_migrations TO comandou_platform;

GRANT SELECT ON platform_receiver TO comandou_platform;
GRANT UPDATE (enabled, token_hash, token_hint) ON platform_receiver TO comandou_platform;

GRANT SELECT ON tenant_receptions TO comandou_platform;
GRANT INSERT (tenant_id, tenant_slug, tenant_name, source, mode, manifest)
  ON tenant_receptions TO comandou_platform;
GRANT UPDATE (status, step, error, finished_at) ON tenant_receptions TO comandou_platform;
GRANT SELECT (reception_id, idx, created_at), INSERT, DELETE ON tenant_reception_chunks TO comandou_platform;

-- Para onde foi um restaurante migrado (a API manda o site antigo para lá).
CREATE FUNCTION app_tenant_moved_to(p_tenant uuid)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT t.moved_to FROM tenants t WHERE t.id = p_tenant AND t.status = 'migrated' $$;
REVOKE ALL ON FUNCTION app_tenant_moved_to(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_moved_to(uuid) TO comandou_platform, comandou_app;
