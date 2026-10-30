-- 0036: conversa do cliente com o restaurante pelo cardápio online (no lugar do WhatsApp).
--
-- No banco do restaurante (RLS por tenant):
-- 1) tenant_store_settings ganha chat_enabled (liga a conversa no cardápio) e chat_greeting
--    (mensagem de boas-vindas que o cliente vê ao abrir a conversa).
-- 2) store_chats: uma conversa por cliente. Quem tem conta entra pela conta (customer_id); quem
--    não tem informa nome e celular e recebe um cookie próprio (só o hash fica aqui).
--    customer_read_at / staff_read_at marcam até onde cada lado leu.
-- 3) store_chat_files: fotos e vídeos da conversa. Ficam separados das fotos do cardápio (que são
--    públicas): aqui só o cliente da conversa e a equipe abrem. O espaço total por restaurante
--    tem limite; ao passar dele, os arquivos mais antigos saem primeiro (a mensagem fica e mostra
--    "arquivo apagado").
-- 4) store_chat_messages: mensagens (texto, emojis, foto ou vídeo, pedido citado).
-- Somente aditiva.

ALTER TABLE tenant_store_settings
  ADD COLUMN chat_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN chat_greeting text CHECK (length(chat_greeting) <= 300);

CREATE TABLE store_chats (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id       uuid,
  guest_token_hash  bytea,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone             text CHECK (length(phone) <= 20),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at   timestamptz,
  last_preview      text CHECK (length(last_preview) <= 140),
  last_sender       text CHECK (last_sender IN ('customer','staff','system')),
  customer_read_at  timestamptz NOT NULL DEFAULT now(),
  staff_read_at     timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, customer_id),
  UNIQUE (guest_token_hash),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE,
  CHECK (customer_id IS NOT NULL OR guest_token_hash IS NOT NULL)
);
CREATE INDEX store_chats_recent_idx ON store_chats(tenant_id, last_message_at DESC NULLS LAST);
CREATE TRIGGER store_chats_updated_at BEFORE UPDATE ON store_chats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE store_chat_files (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  chat_id       uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('image','video')),
  content_type  text NOT NULL CHECK (content_type IN
                  ('image/webp','image/jpeg','image/png','video/mp4','video/webm','video/quicktime')),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 20971520),
  width         integer CHECK (width BETWEEN 1 AND 8192),
  height        integer CHECK (height BETWEEN 1 AND 8192),
  uploaded_by   text NOT NULL CHECK (uploaded_by IN ('customer','staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, chat_id) REFERENCES store_chats(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX store_chat_files_age_idx ON store_chat_files(tenant_id, created_at);

CREATE TABLE store_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  chat_id     uuid NOT NULL,
  sender      text NOT NULL CHECK (sender IN ('customer','staff','system')),
  author_id   uuid,
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  file_id     uuid,
  -- Fica mesmo depois que o arquivo sai (limite de espaço): a tela mostra "foto apagada".
  file_kind   text CHECK (file_kind IN ('image','video')),
  order_id    uuid,
  order_number integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (sender = 'system' OR deleted_at IS NOT NULL OR length(body) > 0
         OR file_kind IS NOT NULL OR order_number IS NOT NULL),
  FOREIGN KEY (tenant_id, chat_id) REFERENCES store_chats(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id) REFERENCES store_chat_files(tenant_id, id) ON DELETE SET NULL (file_id)
);
CREATE INDEX store_chat_messages_chat_idx ON store_chat_messages(tenant_id, chat_id, created_at DESC);
CREATE INDEX store_chat_messages_file_idx ON store_chat_messages(file_id) WHERE file_id IS NOT NULL;

ALTER TABLE store_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_chat_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_chats
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON store_chat_files
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON store_chat_messages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON store_chats TO comandou_app;
GRANT SELECT, INSERT, DELETE ON store_chat_files TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON store_chat_messages TO comandou_app;
