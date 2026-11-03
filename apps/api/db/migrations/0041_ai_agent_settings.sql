-- 0041: o gerente configura a IA do restaurante. Somente aditiva, no banco do restaurante.
-- 1) ai_agent_settings: como a IA atende o cliente (nome, jeito de falar, saudação, sobre a casa,
--    regras, o que ela pode fazer e se responde no WhatsApp). Uma linha por restaurante; sem
--    linha, valem os padrões (atendimento no WhatsApp desligado).
-- 2) products.ai_visible: o item aparece para a IA. Começa ligado em todos; o gerente desmarca o
--    que a IA não deve oferecer. Item inativo nunca aparece, esgotado aparece como esgotado.
-- 3) ai_customer_chats / ai_customer_messages: memória curta da IA com cada cliente (telefone) e
--    a pausa quando ela passa a conversa para alguém da equipe.

CREATE TABLE ai_agent_settings (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Responder clientes no WhatsApp (precisa do WhatsApp conectado e da IA ligada pelo Comandou).
  whatsapp_enabled  boolean NOT NULL DEFAULT false,
  -- Vazio = usa o nome do assistente definido pelo Comandou.
  agent_name        text CHECK (length(agent_name) BETWEEN 1 AND 30),
  tone              text NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly','formal','fun')),
  greeting          text CHECK (length(greeting) <= 300),
  about             text CHECK (length(about) <= 1500),
  rules             text CHECK (length(rules) <= 1000),
  handoff_message   text CHECK (length(handoff_message) <= 300),
  suggest_items     boolean NOT NULL DEFAULT true,
  show_prices       boolean NOT NULL DEFAULT true,
  send_store_link   boolean NOT NULL DEFAULT true,
  -- always = responde a qualquer hora; open = só com a loja online aberta.
  reply_when        text NOT NULL DEFAULT 'always' CHECK (reply_when IN ('always','open')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);
CREATE TRIGGER ai_agent_settings_updated_at BEFORE UPDATE ON ai_agent_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE ai_agent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_agent_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON ai_agent_settings TO comandou_app;

ALTER TABLE products ADD COLUMN ai_visible boolean NOT NULL DEFAULT true;

CREATE TABLE ai_customer_chats (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  phone         text NOT NULL CHECK (phone ~ '^[0-9]{8,20}$'),
  name          text CHECK (length(name) <= 80),
  -- Até quando a IA fica quieta nesta conversa (alguém da equipe assumiu).
  paused_until  timestamptz,
  last_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone)
);
CREATE INDEX ai_customer_chats_last_idx ON ai_customer_chats(tenant_id, last_at DESC);

CREATE TABLE ai_customer_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  phone       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant')),
  content     text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  tokens      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, phone) REFERENCES ai_customer_chats(tenant_id, phone) ON DELETE CASCADE
);
CREATE INDEX ai_customer_messages_phone_idx ON ai_customer_messages(tenant_id, phone, created_at DESC);

ALTER TABLE ai_customer_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_customer_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_customer_chats
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON ai_customer_messages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON ai_customer_chats TO comandou_app;
GRANT SELECT, INSERT ON ai_customer_messages TO comandou_app;
