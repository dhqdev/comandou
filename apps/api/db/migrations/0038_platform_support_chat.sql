-- Comandou — 0038: conversa do restaurante com a Comandou (suporte).
--
-- O dono ou o gerente do restaurante fala com a equipe da Comandou pela aba "Suporte" do chat do
-- sistema, e o Super Admin responde em "Conversas". Tudo no banco CENTRAL (a conversa é entre o
-- restaurante e a plataforma, então não vai para o banco do restaurante):
--
--   * platform_support_chats: uma conversa por restaurante. tenant_read_at / admin_read_at marcam
--     até onde cada lado leu (risquinhos e contagem de não lidas).
--   * platform_support_files: fotos e vídeos da conversa (privados: só o restaurante e o painel).
--     Cada restaurante tem um limite de espaço; ao passar, os mais antigos saem primeiro (a
--     mensagem fica e mostra "arquivo apagado").
--   * platform_support_messages: mensagens. O nome de quem escreveu fica gravado (a equipe do
--     restaurante mora no banco dele).
--
-- Só o papel do painel (comandou_platform) lê e grava. Roda em todos os bancos; nos dos
-- restaurantes as tabelas ficam vazias. Somente aditiva.

CREATE TABLE platform_support_chats (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at timestamptz,
  last_preview    text CHECK (length(last_preview) <= 140),
  last_sender     text CHECK (last_sender IN ('tenant','admin','system')),
  -- Começa no passado: a primeira mensagem (mesma transação que cria a conversa) conta como nova.
  tenant_read_at  timestamptz NOT NULL DEFAULT 'epoch',
  admin_read_at   timestamptz NOT NULL DEFAULT 'epoch',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_support_chats_recent_idx
  ON platform_support_chats(last_message_at DESC NULLS LAST);
CREATE TRIGGER platform_support_chats_updated_at BEFORE UPDATE ON platform_support_chats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_support_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform_support_chats(tenant_id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('image','video')),
  content_type  text NOT NULL CHECK (content_type IN
                  ('image/webp','image/jpeg','image/png','video/mp4','video/webm','video/quicktime')),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 20971520),
  width         integer CHECK (width BETWEEN 1 AND 8192),
  height        integer CHECK (height BETWEEN 1 AND 8192),
  uploaded_by   text NOT NULL CHECK (uploaded_by IN ('tenant','admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_support_files_age_idx ON platform_support_files(tenant_id, created_at);

CREATE TABLE platform_support_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform_support_chats(tenant_id) ON DELETE CASCADE,
  sender         text NOT NULL CHECK (sender IN ('tenant','admin','system')),
  -- Quem escreveu: pessoa da equipe do restaurante (id do banco dele) ou administrador.
  author_user_id uuid,
  admin_id       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  author_name    text CHECK (length(author_name) <= 120),
  body           text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  file_id        uuid REFERENCES platform_support_files(id) ON DELETE SET NULL,
  -- Fica mesmo depois que o arquivo sai (limite de espaço): a tela mostra "foto apagada".
  file_kind      text CHECK (file_kind IN ('image','video')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (sender = 'system' OR length(body) > 0 OR file_kind IS NOT NULL)
);
CREATE INDEX platform_support_messages_chat_idx
  ON platform_support_messages(tenant_id, created_at DESC);
CREATE INDEX platform_support_messages_file_idx
  ON platform_support_messages(file_id) WHERE file_id IS NOT NULL;

ALTER TABLE platform_support_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_support_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_support_chats TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_support_files TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_support_messages TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON platform_support_chats TO comandou_platform;
GRANT SELECT, INSERT, DELETE ON platform_support_files TO comandou_platform;
GRANT SELECT, INSERT ON platform_support_messages TO comandou_platform;
