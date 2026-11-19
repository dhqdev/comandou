-- 0091: Super Admin › WhatsApp. O painel conecta um número próprio pelo QR Code (o mesmo gateway
-- Baileys dos restaurantes, numa sessão reservada) e conversa com quem escreve para ele.
-- Só o painel (papel comandou_platform) lê e grava. Somente aditiva.

-- Uma linha por conversa (JID do WhatsApp). O restaurante é achado na hora pelo telefone do
-- cadastro (tenant_profiles.phone), não fica gravado aqui.
CREATE TABLE platform_wa_chats (
  jid           text PRIMARY KEY CHECK (jid ~ '^[0-9]{5,20}@(s\.whatsapp\.net|lid)$'),
  phone         text CHECK (phone ~ '^[0-9]{5,20}$'),
  name          text CHECK (length(name) <= 100),
  last_at       timestamptz NOT NULL DEFAULT now(),
  last_preview  text NOT NULL DEFAULT '' CHECK (length(last_preview) <= 200),
  last_dir      text CHECK (last_dir IN ('in', 'out')),
  unread        integer NOT NULL DEFAULT 0 CHECK (unread >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_wa_chats_last ON platform_wa_chats (last_at DESC);
CREATE INDEX platform_wa_chats_phone ON platform_wa_chats (phone);

CREATE TABLE platform_wa_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jid         text NOT NULL REFERENCES platform_wa_chats(jid) ON DELETE CASCADE,
  direction   text NOT NULL CHECK (direction IN ('in', 'out')),
  kind        text NOT NULL DEFAULT 'text'
              CHECK (kind IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'other')),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  -- id da mensagem no WhatsApp (recebida: não grava duas vezes; enviada: para conferir)
  wa_id       text CHECK (length(wa_id) <= 128),
  admin_id    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  status      text NOT NULL CHECK (status IN ('received', 'sent', 'failed')),
  error       text CHECK (length(error) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_wa_messages_in ON platform_wa_messages (jid, wa_id)
  WHERE direction = 'in' AND wa_id IS NOT NULL;
CREATE INDEX platform_wa_messages_chat ON platform_wa_messages (jid, created_at DESC);

ALTER TABLE platform_wa_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_chats TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_wa_chats TO comandou_platform;

ALTER TABLE platform_wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_wa_messages TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_wa_messages TO comandou_platform;
