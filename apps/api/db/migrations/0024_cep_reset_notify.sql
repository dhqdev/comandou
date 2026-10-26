-- 0024: endereço por CEP, "esqueci minha senha" do cliente final e mais avisos no WhatsApp.
-- 1) tenant_store_settings.city/state: cidade da loja, usada para achar o CEP pelo nome da rua.
--    customer_addresses ganha CEP, cidade e UF (opcionais: endereços antigos seguem valendo).
-- 2) customer_password_resets: código de 6 dígitos (guardado só o hash), válido por 15 minutos,
--    no máximo 5 tentativas. Enviado pelo WhatsApp da loja ou gerado pela equipe.
-- 3) Avisos ao cliente: pedido aceito, entregue e cancelado (além de pronto e saiu para entrega).
--    Modelo da Meta para o código de redefinição de senha.
-- Somente aditiva (os CHECK de eventos só ficam mais largos).

ALTER TABLE tenant_store_settings
  ADD COLUMN city  text CHECK (length(city) BETWEEN 1 AND 80),
  ADD COLUMN state char(2) CHECK (state ~ '^[A-Z]{2}$');

ALTER TABLE customer_addresses
  ADD COLUMN cep   char(8) CHECK (cep ~ '^[0-9]{8}$'),
  ADD COLUMN city  text CHECK (length(city) BETWEEN 1 AND 80),
  ADD COLUMN state char(2) CHECK (state ~ '^[A-Z]{2}$');

CREATE TABLE customer_password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id  uuid NOT NULL,
  code_hash    bytea NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('whatsapp','staff')),
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_password_resets_customer_idx
  ON customer_password_resets(tenant_id, customer_id, created_at DESC);
ALTER TABLE customer_password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_password_resets
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON customer_password_resets TO comandou_app;
GRANT UPDATE (attempts, used_at) ON customer_password_resets TO comandou_app;

ALTER TABLE tenant_messaging_settings
  ADD COLUMN text_accepted      text NOT NULL
    DEFAULT 'Olá, {cliente}! O {restaurante} aceitou seu pedido #{pedido} e já está preparando.'
    CHECK (length(text_accepted) BETWEEN 1 AND 1000),
  ADD COLUMN text_delivered     text NOT NULL
    DEFAULT 'Pedido #{pedido} entregue. Obrigado por pedir no {restaurante}, {cliente}! Bom apetite.'
    CHECK (length(text_delivered) BETWEEN 1 AND 1000),
  ADD COLUMN text_cancelled     text NOT NULL
    DEFAULT 'Olá, {cliente}. Seu pedido #{pedido} no {restaurante} foi cancelado. Se tiver dúvidas, responda esta mensagem.'
    CHECK (length(text_cancelled) BETWEEN 1 AND 1000),
  ADD COLUMN notify_accepted    boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_delivered   boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_cancelled   boolean NOT NULL DEFAULT true,
  ADD COLUMN template_accepted  text CHECK (template_accepted IS NULL OR (template_accepted ~ '^[a-z0-9_]+$' AND length(template_accepted) <= 512)),
  ADD COLUMN template_delivered text CHECK (template_delivered IS NULL OR (template_delivered ~ '^[a-z0-9_]+$' AND length(template_delivered) <= 512)),
  ADD COLUMN template_cancelled text CHECK (template_cancelled IS NULL OR (template_cancelled ~ '^[a-z0-9_]+$' AND length(template_cancelled) <= 512)),
  -- Modelo de autenticação da Meta com o código em {{1}} (botão "copiar código").
  ADD COLUMN template_reset     text CHECK (template_reset IS NULL OR (template_reset ~ '^[a-z0-9_]+$' AND length(template_reset) <= 512));

ALTER TABLE message_outbox DROP CONSTRAINT message_outbox_event_check;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_event_check
  CHECK (event IN ('order.accepted','order.ready','order.dispatched','order.delivered','order.cancelled','test'));
