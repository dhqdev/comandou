-- 0075: e-mail próprio do Comandou (Super Admin › E-mail). Substitui os webhooks do n8n.
--
-- 1) mail_settings: por onde o sistema envia (Cloudflare, Resend ou SMTP), o remetente padrão e
--    o segredo que o Worker da Cloudflare usa para entregar o que chega. Uma linha só; chaves
--    cifradas com a INTEGRATIONS_KEY e nunca devolvidas ao navegador.
-- 2) mail_outbox: fila de saída. Todo e-mail do sistema (boas-vindas do teste, código de nova
--    senha, contrato, convite da agenda) entra aqui NA MESMA transação de quem o pediu e sai em
--    seguida, com novas tentativas. E-mail com senha ou código fica cifrado e é apagado ao sair.
-- 3) mail_domains, mail_mailboxes, mail_messages, mail_attachments, mail_rules, mail_contacts:
--    as caixas de e-mail do domínio (ler, responder, anexos, regras e contatos).
-- 4) mail_events e mail_booking_pages: agenda com convite por e-mail e página pública para
--    marcar horário.
-- Só o painel (comandou_platform) lê e grava; a API dos restaurantes não enxerga nada daqui.
-- Somente aditiva: as colunas dos webhooks antigos ficam, sem uso.

CREATE TABLE mail_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider            text NOT NULL DEFAULT 'none'
                        CHECK (provider IN ('none', 'cloudflare', 'resend', 'smtp')),
  -- Remetente dos e-mails do sistema (ex.: nao-responda@comandou.com).
  from_address        citext NOT NULL DEFAULT '' CHECK (length(from_address::text) <= 254),
  from_name           text NOT NULL DEFAULT 'Comandou' CHECK (length(from_name) <= 80),
  reply_to            citext NOT NULL DEFAULT '' CHECK (length(reply_to::text) <= 254),
  cf_account_id       text NOT NULL DEFAULT '' CHECK (length(cf_account_id) <= 64),
  cf_token_enc        bytea,
  resend_key_enc      bytea,
  smtp_host           text NOT NULL DEFAULT '' CHECK (length(smtp_host) <= 255),
  smtp_port           int NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  -- true: TLS desde o início (porta 465). false: STARTTLS quando o servidor oferece.
  smtp_secure         boolean NOT NULL DEFAULT false,
  smtp_user           text NOT NULL DEFAULT '' CHECK (length(smtp_user) <= 255),
  smtp_pass_enc       bytea,
  -- Segredo do Worker de recebimento (assina cada mensagem com HMAC-SHA256).
  inbound_secret_enc  bytea,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);
INSERT INTO mail_settings (id) VALUES (true);
ALTER TABLE mail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON mail_settings TO comandou_platform;

CREATE TABLE mail_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      citext NOT NULL UNIQUE
                CHECK (domain::text ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mail_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_domains TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON mail_domains TO comandou_platform;

CREATE TABLE mail_mailboxes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id           uuid NOT NULL REFERENCES mail_domains(id) ON DELETE RESTRICT,
  address             citext NOT NULL UNIQUE CHECK (length(address::text) <= 254),
  display_name        text NOT NULL DEFAULT '' CHECK (length(display_name) <= 80),
  signature           text NOT NULL DEFAULT '' CHECK (length(signature) <= 2000),
  -- Recebe o que chegar para qualquer endereço do domínio que não tenha caixa.
  catch_all           boolean NOT NULL DEFAULT false,
  auto_reply          boolean NOT NULL DEFAULT false,
  auto_reply_subject  text NOT NULL DEFAULT '' CHECK (length(auto_reply_subject) <= 200),
  auto_reply_body     text NOT NULL DEFAULT '' CHECK (length(auto_reply_body) <= 4000),
  -- Cópia de tudo o que chega (o Worker encaminha; o destino precisa estar verificado na Cloudflare).
  forward_to          citext NOT NULL DEFAULT '' CHECK (length(forward_to::text) <= 254),
  created_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz
);
CREATE UNIQUE INDEX mail_mailboxes_catch_all_idx ON mail_mailboxes(domain_id)
  WHERE catch_all AND archived_at IS NULL;
ALTER TABLE mail_mailboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_mailboxes TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON mail_mailboxes TO comandou_platform;

CREATE TABLE mail_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id       uuid NOT NULL REFERENCES mail_mailboxes(id) ON DELETE CASCADE,
  -- Conversa: a resposta herda o thread_id da mensagem respondida.
  thread_id        uuid NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  folder           text NOT NULL
                     CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash')),
  -- Só de saída: rascunho, na fila, enviado ou falhou.
  send_status      text CHECK (send_status IN ('draft', 'queued', 'sent', 'failed')),
  send_error       text CHECK (length(send_error) <= 500),
  -- Message-ID do e-mail (com os < >), para encadear respostas.
  rfc_id           text CHECK (length(rfc_id) <= 998),
  in_reply_to      text CHECK (length(in_reply_to) <= 998),
  refs             text CHECK (length(refs) <= 8000),
  from_address     citext NOT NULL CHECK (length(from_address::text) <= 254),
  from_name        text NOT NULL DEFAULT '' CHECK (length(from_name) <= 200),
  -- Listas de { email, name }.
  to_list          jsonb NOT NULL DEFAULT '[]',
  cc_list          jsonb NOT NULL DEFAULT '[]',
  bcc_list         jsonb NOT NULL DEFAULT '[]',
  reply_to         text NOT NULL DEFAULT '' CHECK (length(reply_to) <= 254),
  subject          text NOT NULL DEFAULT '' CHECK (length(subject) <= 998),
  snippet          text NOT NULL DEFAULT '' CHECK (length(snippet) <= 300),
  body_text        text NOT NULL DEFAULT '',
  body_html        text NOT NULL DEFAULT '',
  -- Resultado do SPF/DKIM/DMARC informado por quem recebeu (Cloudflare), para avisar na tela.
  auth_results     text NOT NULL DEFAULT '' CHECK (length(auth_results) <= 2000),
  is_read          boolean NOT NULL DEFAULT false,
  is_starred       boolean NOT NULL DEFAULT false,
  has_attachments  boolean NOT NULL DEFAULT false,
  size_bytes       int NOT NULL DEFAULT 0,
  -- Data do e-mail: recebido, enviado ou (rascunho) última alteração.
  sent_at          timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  search           tsvector GENERATED ALWAYS AS (
                     to_tsvector('simple',
                       coalesce(subject, '') || ' ' || coalesce(from_address::text, '') || ' ' ||
                       coalesce(from_name, '') || ' ' || left(coalesce(body_text, ''), 20000))
                   ) STORED
);
CREATE INDEX mail_messages_list_idx ON mail_messages(mailbox_id, folder, sent_at DESC);
CREATE INDEX mail_messages_thread_idx ON mail_messages(thread_id, sent_at);
CREATE INDEX mail_messages_rfc_idx ON mail_messages(mailbox_id, rfc_id) WHERE rfc_id IS NOT NULL;
CREATE INDEX mail_messages_search_idx ON mail_messages USING gin(search);
ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_messages TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_messages TO comandou_platform;

CREATE TABLE mail_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- O que é: trial.welcome, customer.password_reset, contract.send, mailbox, calendar.invite...
  kind             text NOT NULL CHECK (length(kind) BETWEEN 1 AND 60),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE SET NULL,
  -- Mensagem da caixa que originou o envio (respostas e e-mails escritos no painel).
  message_id       uuid REFERENCES mail_messages(id) ON DELETE SET NULL,
  -- Vazio: o remetente padrão de mail_settings.
  from_address     citext NOT NULL DEFAULT '' CHECK (length(from_address::text) <= 254),
  from_name        text NOT NULL DEFAULT '' CHECK (length(from_name) <= 200),
  reply_to         text NOT NULL DEFAULT '' CHECK (length(reply_to) <= 254),
  -- { to: [{ email, name }], cc: [...], bcc: [...] }
  recipients       jsonb NOT NULL,
  subject          text NOT NULL CHECK (length(subject) <= 998),
  html             text,
  body_text        text,
  -- E-mail com senha ou código: { html, text } cifrado; apagado depois de enviado.
  body_enc         bytea,
  sensitive        boolean NOT NULL DEFAULT false,
  headers          jsonb NOT NULL DEFAULT '{}',
  rfc_id           text CHECK (length(rfc_id) <= 998),
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  -- Quando uma réplica pegou para enviar (pegada há muito tempo volta para a fila).
  locked_at        timestamptz,
  last_error       text CHECK (length(last_error) <= 500),
  provider         text CHECK (length(provider) <= 20),
  provider_id      text CHECK (length(provider_id) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX mail_outbox_due_idx ON mail_outbox(next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX mail_outbox_created_idx ON mail_outbox(created_at DESC);
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_outbox TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_outbox TO comandou_platform;

-- Anexo de uma mensagem da caixa (message_id) ou de um e-mail do sistema (outbox_id).
CREATE TABLE mail_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid REFERENCES mail_messages(id) ON DELETE CASCADE,
  outbox_id     uuid REFERENCES mail_outbox(id) ON DELETE CASCADE,
  filename      text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  content_type  text NOT NULL CHECK (length(content_type) <= 255),
  -- Imagem usada dentro do corpo (cid:).
  content_id    text CHECK (length(content_id) <= 255),
  size_bytes    int NOT NULL,
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (message_id IS NOT NULL OR outbox_id IS NOT NULL)
);
CREATE INDEX mail_attachments_message_idx ON mail_attachments(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX mail_attachments_outbox_idx ON mail_attachments(outbox_id) WHERE outbox_id IS NOT NULL;
ALTER TABLE mail_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_attachments TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_attachments TO comandou_platform;

-- Regras do que chega: a primeira que combinar decide (pasta, estrela, lida ou recusar).
CREATE TABLE mail_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL: vale para todas as caixas.
  mailbox_id    uuid REFERENCES mail_mailboxes(id) ON DELETE CASCADE,
  position      int NOT NULL DEFAULT 0,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  enabled       boolean NOT NULL DEFAULT true,
  field         text NOT NULL CHECK (field IN ('from', 'to', 'subject')),
  op            text NOT NULL CHECK (op IN ('contains', 'equals', 'ends_with')),
  value         text NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  action        text NOT NULL CHECK (action IN ('archive', 'spam', 'trash', 'star', 'read', 'reject')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mail_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_rules TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_rules TO comandou_platform;

CREATE TABLE mail_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE CHECK (length(email::text) <= 254),
  name          text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  company       text NOT NULL DEFAULT '' CHECK (length(company) <= 120),
  phone         text NOT NULL DEFAULT '' CHECK (length(phone) <= 30),
  notes         text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  -- Guardado sozinho ao enviar ou receber; false quando alguém cadastrou ou editou.
  auto          boolean NOT NULL DEFAULT true,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mail_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_contacts TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_contacts TO comandou_platform;

-- Página pública para marcar horário (https://<site>/agendar/<slug>).
CREATE TABLE mail_booking_pages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              citext NOT NULL UNIQUE CHECK (slug::text ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description       text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  location          text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  duration_min      int NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  -- Folga depois de cada horário marcado.
  buffer_min        int NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 240),
  min_notice_hours  int NOT NULL DEFAULT 2 CHECK (min_notice_hours BETWEEN 0 AND 720),
  days_ahead        int NOT NULL DEFAULT 30 CHECK (days_ahead BETWEEN 1 AND 180),
  -- { "1": [["09:00","12:00"],["13:30","18:00"]], ... } com 0 = domingo.
  availability      jsonb NOT NULL DEFAULT '{}',
  time_zone         text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (length(time_zone) <= 64),
  -- Caixa que envia a confirmação e recebe as respostas.
  mailbox_id        uuid REFERENCES mail_mailboxes(id) ON DELETE SET NULL,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mail_booking_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_booking_pages TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_booking_pages TO comandou_platform;

CREATE TABLE mail_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UID do convite (.ics): o mesmo em todas as atualizações e no cancelamento.
  uid               text NOT NULL UNIQUE CHECK (length(uid) <= 255),
  -- Caixa que organiza (envia os convites). NULL: evento só da agenda, sem convite.
  mailbox_id        uuid REFERENCES mail_mailboxes(id) ON DELETE SET NULL,
  booking_page_id   uuid REFERENCES mail_booking_pages(id) ON DELETE SET NULL,
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description       text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  location          text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  all_day           boolean NOT NULL DEFAULT false,
  time_zone         text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (length(time_zone) <= 64),
  color             text NOT NULL DEFAULT 'brand' CHECK (length(color) <= 20),
  repeat            text NOT NULL DEFAULT 'none'
                      CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  repeat_until      date,
  -- [{ email, name, status: needs-action | accepted | declined | tentative }]
  attendees         jsonb NOT NULL DEFAULT '[]',
  -- Sobe a cada mudança enviada (o programa de agenda de quem recebe troca a versão antiga).
  sequence          int NOT NULL DEFAULT 0,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX mail_events_when_idx ON mail_events(starts_at) WHERE cancelled_at IS NULL;
ALTER TABLE mail_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON mail_events TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_events TO comandou_platform;
