-- 0039: chamados dos clientes e a esteira de desenvolvimento do painel Super Admin.
--
-- Tudo no banco central (prefixo platform_: nunca sai do central ao mover um restaurante para
-- banco próprio). Só o papel da plataforma (comandou_platform) lê e grava: a API do restaurante
-- abre e acompanha os chamados pelo mesmo pool que a cobrança usa, sempre filtrando o tenant.
--
-- 1) platform_pipeline_settings: GitHub (repositório, branch base, token cifrado com a
--    INTEGRATIONS_KEY, contexto "pipeline:github"), modelo dos agentes e regras da esteira.
-- 2) platform_tickets: o chamado, em qual etapa da esteira está, a análise de cada agente,
--    branch e PR. Etapas: inicio, priorizacao, desenvolvimento, code_review, pr, testes,
--    concluido. Estado: running (agente trabalhando), approval (esperando a sua decisão),
--    waiting (esperando você), done, rejected, cancelled.
-- 3) platform_ticket_events: conversa com o cliente, atividade dos agentes e histórico.
--    public = o cliente vê.
-- 4) platform_ticket_files: fotos e vídeos do problema (até 20 MB cada).
-- Somente aditiva.

CREATE TABLE platform_pipeline_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Agentes ligados (sem isso o chamado só entra e espera você).
  enabled             boolean NOT NULL DEFAULT true,
  -- Modelo dos agentes no OpenRouter; vazio = o mesmo do assistente (Super Admin › IA).
  model               text NOT NULL DEFAULT '' CHECK (model = '' OR model ~ '^[A-Za-z0-9._:/-]{3,120}$'),
  github_repo         text NOT NULL DEFAULT 'dhqdev/comandou' CHECK (github_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  github_base         text NOT NULL DEFAULT 'main' CHECK (length(github_base) BETWEEN 1 AND 100),
  github_token_enc    bytea,
  branch_prefix       text NOT NULL DEFAULT 'chamado' CHECK (branch_prefix ~ '^[a-z0-9][a-z0-9._-]{0,20}$'),
  -- O agente de desenvolvimento pode propor mudanças no código (sempre num PR em rascunho).
  allow_code_changes  boolean NOT NULL DEFAULT true,
  -- Chamado aprovado anda sozinho de etapa em etapa (cada chamado pode mudar).
  auto_advance        boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_pipeline_settings (id) VALUES (true);

CREATE SEQUENCE platform_ticket_number_seq;

CREATE TABLE platform_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           integer NOT NULL UNIQUE DEFAULT nextval('platform_ticket_number_seq'),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_by_id     uuid,
  opened_by_name   text NOT NULL DEFAULT '' CHECK (length(opened_by_name) <= 120),
  opened_by_email  text NOT NULL DEFAULT '' CHECK (length(opened_by_email) <= 200),
  -- 'client' (aberto pelo restaurante) ou 'admin' (aberto por você no painel).
  source           text NOT NULL DEFAULT 'client' CHECK (source IN ('client','admin')),
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 8000),
  kind             text NOT NULL DEFAULT 'bug' CHECK (kind IN ('bug','improvement','question','other')),
  -- Urgência dita pelo cliente.
  urgency          text NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
  page             text CHECK (length(page) <= 300),
  stage            text NOT NULL DEFAULT 'inicio'
                     CHECK (stage IN ('inicio','priorizacao','desenvolvimento','code_review','pr','testes','concluido')),
  state            text NOT NULL DEFAULT 'running'
                     CHECK (state IN ('running','approval','waiting','done','rejected','cancelled')),
  -- Por que está esperando você (mostrado no cartão).
  waiting_reason   text CHECK (length(waiting_reason) <= 500),
  priority         text CHECK (priority IN ('low','medium','high','critical')),
  priority_score   integer CHECK (priority_score BETWEEN 0 AND 100),
  -- A dor do cliente em uma ou duas frases (resumo do agente da triagem).
  pain             text CHECK (length(pain) <= 1000),
  -- Saída de cada agente: {"inicio": {...}, "priorizacao": {...}, ...}.
  analysis         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Pendências abertas (lista de textos).
  pending          jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_advance     boolean NOT NULL DEFAULT true,
  decided_at       timestamptz,
  decided_by       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  decision_note    text CHECK (length(decision_note) <= 1000),
  branch           text CHECK (length(branch) <= 200),
  head_sha         text CHECK (length(head_sha) <= 64),
  pr_number        integer,
  pr_url           text CHECK (length(pr_url) <= 300),
  -- Uso de IA da esteira com este chamado (não conta no limite do restaurante).
  ai_tokens        integer NOT NULL DEFAULT 0,
  ai_cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  -- Fila dos agentes: quando rodar, trava entre réplicas e tentativas.
  run_after        timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text CHECK (length(last_error) <= 1000),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  -- Novidades não lidas de cada lado.
  client_unread    integer NOT NULL DEFAULT 0,
  admin_unread     integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);
CREATE INDEX platform_tickets_tenant_idx ON platform_tickets(tenant_id, created_at DESC);
CREATE INDEX platform_tickets_queue_idx ON platform_tickets(run_after) WHERE state = 'running';
CREATE INDEX platform_tickets_board_idx ON platform_tickets(stage, updated_at DESC);
CREATE TRIGGER platform_tickets_updated_at BEFORE UPDATE ON platform_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_ticket_events (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES platform_tickets(id) ON DELETE CASCADE,
  -- message: conversa; activity: o que um agente fez; stage/status/decision: histórico.
  kind        text NOT NULL CHECK (kind IN ('message','note','activity','stage','status','decision')),
  actor       text NOT NULL CHECK (actor IN ('client','admin','agent','system')),
  actor_name  text NOT NULL DEFAULT '' CHECK (length(actor_name) <= 120),
  stage       text,
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 8000),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- O cliente vê este registro na tela dele.
  public      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ticket_events_idx ON platform_ticket_events(ticket_id, id);

CREATE TABLE platform_ticket_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES platform_tickets(id) ON DELETE CASCADE,
  event_id      bigint REFERENCES platform_ticket_events(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('image','video')),
  content_type  text NOT NULL CHECK (content_type IN
                  ('image/webp','image/jpeg','image/png','video/mp4','video/webm','video/quicktime')),
  name          text NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 20971520),
  uploaded_by   text NOT NULL CHECK (uploaded_by IN ('client','admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ticket_files_idx ON platform_ticket_files(ticket_id, created_at);

ALTER TABLE platform_pipeline_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ticket_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_pipeline_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_tickets TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_ticket_events TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_ticket_files TO comandou_platform USING (true) WITH CHECK (true);

GRANT SELECT ON platform_pipeline_settings TO comandou_platform;
GRANT UPDATE (enabled, model, github_repo, github_base, github_token_enc, branch_prefix,
              allow_code_changes, auto_advance, updated_at, updated_by)
  ON platform_pipeline_settings TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON platform_tickets TO comandou_platform;
GRANT SELECT, INSERT ON platform_ticket_events TO comandou_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ticket_files TO comandou_platform;
GRANT USAGE ON SEQUENCE platform_ticket_number_seq TO comandou_platform;
GRANT USAGE ON SEQUENCE platform_ticket_events_id_seq TO comandou_platform;
