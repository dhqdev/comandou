-- 0030: chat interno da equipe e assistente de IA.
--
-- No banco do restaurante (RLS por tenant, como o resto da operação):
-- 1) chat_conversations: conversa direta (duas pessoas), grupo (quem foi convidado) ou canal
--    (assunto aberto: qualquer um da equipe entra). A conversa direta tem uma chave única com os
--    dois ids em ordem, para não nascer duas vezes.
-- 2) chat_members: quem está em cada conversa, até onde leu, se silenciou ou fixou.
-- 3) chat_messages: mensagens (texto e/ou foto), resposta a outra mensagem e reações.
-- 4) chat_posts: Mural da equipe (recados para todo mundo, que o gestor pode fixar).
-- 5) chat_notices: Avisos de cada pessoa (menção, novo grupo, recado no mural, limite da IA).
-- 6) ai_messages: a conversa de cada pessoa com o assistente.
--
-- No banco central (a plataforma soma o uso de todos os restaurantes):
-- 7) platform_ai_settings: chave do OpenRouter (cifrada com a INTEGRATIONS_KEY, contexto
--    "ai:openrouter"), modelo, nome do assistente e limite mensal padrão. Só o painel grava.
-- 8) tenant_ai_settings: limite próprio de um restaurante e o botão de desligar a IA dele.
-- 9) ai_usage: cada resposta do assistente (tokens e custo informados pelo OpenRouter).
--    A API do restaurante grava e lê só as linhas dele (RLS); o painel lê todas.
-- A API do restaurante lê a configuração pela função app_ai_config(), que devolve só o que
-- ela precisa para o restaurante da transação. Somente aditiva.

CREATE TABLE chat_conversations (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('direct','group','channel')),
  name             text CHECK (length(name) BETWEEN 1 AND 60),
  description      text CHECK (length(description) <= 200),
  direct_key       text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direct_key),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK (kind = 'direct' OR name IS NOT NULL)
);
CREATE INDEX chat_conversations_kind_idx ON chat_conversations(tenant_id, kind, last_message_at DESC);
CREATE TRIGGER chat_conversations_updated_at BEFORE UPDATE ON chat_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_members (
  tenant_id        uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  user_id          uuid NOT NULL,
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  muted            boolean NOT NULL DEFAULT false,
  pinned           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES chat_conversations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX chat_members_user_idx ON chat_members(tenant_id, user_id);

CREATE TABLE chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  author_id        uuid,
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  image_id         uuid,
  reply_to         uuid,
  -- Reações: {"❤️": ["id do usuário", ...]}.
  reactions        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Mensagem do sistema (ex.: "Ana criou o grupo").
  system           boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  CHECK (system OR deleted_at IS NOT NULL OR length(body) > 0 OR image_id IS NOT NULL),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES chat_conversations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX chat_messages_conv_idx ON chat_messages(tenant_id, conversation_id, created_at DESC);

CREATE TABLE chat_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  author_id   uuid,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  image_id    uuid,
  pinned      boolean NOT NULL DEFAULT false,
  reactions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX chat_posts_tenant_idx ON chat_posts(tenant_id, pinned DESC, created_at DESC);

CREATE TABLE chat_notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('mention','group','post','ai','system')),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body             text CHECK (length(body) <= 300),
  conversation_id  uuid,
  post_id          uuid,
  actor_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz
);
CREATE INDEX chat_notices_user_idx ON chat_notices(tenant_id, user_id, created_at DESC);

CREATE TABLE ai_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant')),
  content     text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
  tokens      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_user_idx ON ai_messages(tenant_id, user_id, created_at DESC);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_conversations
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON chat_members
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON chat_messages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON chat_posts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON chat_notices
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON ai_messages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON chat_conversations TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_members TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON chat_messages TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON chat_posts TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON chat_notices TO comandou_app;
GRANT SELECT, INSERT, DELETE ON ai_messages TO comandou_app;

-- ----- Banco central: assistente de IA -----

CREATE TABLE platform_ai_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled                 boolean NOT NULL DEFAULT false,
  api_key_enc             bytea,
  -- Modelo do OpenRouter (ex.: google/gemini-2.5-flash-lite).
  model                   text NOT NULL DEFAULT 'google/gemini-2.5-flash-lite'
                            CHECK (model ~ '^[A-Za-z0-9._:/-]{3,120}$'),
  assistant_name          text NOT NULL DEFAULT 'Comandinho' CHECK (length(assistant_name) BETWEEN 1 AND 30),
  -- Tokens por mês para cada restaurante (0 = sem limite).
  default_monthly_tokens  integer NOT NULL DEFAULT 300000 CHECK (default_monthly_tokens >= 0),
  -- Aviso no painel quando o saldo do OpenRouter fica abaixo disso (US$).
  low_balance_usd         numeric(10,2) NOT NULL DEFAULT 2 CHECK (low_balance_usd >= 0),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_ai_settings (id) VALUES (true);

CREATE TABLE tenant_ai_settings (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT true,
  -- Vazio = usa o limite padrão; 0 = sem limite.
  monthly_tokens  integer CHECK (monthly_tokens >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            uuid,
  model              text NOT NULL,
  prompt_tokens      integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens  integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_tenant_idx ON ai_usage(tenant_id, created_at DESC);
CREATE INDEX ai_usage_created_idx ON ai_usage(created_at);

ALTER TABLE platform_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_ai_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_ai_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON ai_usage TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation ON ai_usage TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT ON platform_ai_settings TO comandou_platform;
GRANT UPDATE (enabled, api_key_enc, model, assistant_name, default_monthly_tokens, low_balance_usd,
              updated_at, updated_by)
  ON platform_ai_settings TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON tenant_ai_settings TO comandou_platform;
GRANT SELECT ON ai_usage TO comandou_platform;
GRANT SELECT, INSERT ON ai_usage TO comandou_app;
GRANT USAGE ON SEQUENCE ai_usage_id_seq TO comandou_app;

-- O que a API do restaurante precisa saber para atender: ligado (plataforma e restaurante),
-- modelo, nome, a chave cifrada e o limite do mês já resolvido (0 = sem limite).
CREATE FUNCTION app_ai_config()
  RETURNS TABLE (enabled boolean, tenant_enabled boolean, model text, assistant_name text,
                 api_key_enc bytea, monthly_tokens integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.enabled AND s.api_key_enc IS NOT NULL, coalesce(t.enabled, true), s.model,
           s.assistant_name, s.api_key_enc, coalesce(t.monthly_tokens, s.default_monthly_tokens)
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = app_current_tenant()
     WHERE s.id
  $$;
REVOKE ALL ON FUNCTION app_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_config() TO comandou_app;
