-- Comandou — 0006 Etapa 5: WhatsApp e avisos automáticos ao cliente.
-- Provedor padrão: Baileys (QR Code), num serviço separado (whatsapp-gateway) com a sessão de
-- cada restaurante cifrada em disco. Alternativa: API oficial da Meta (Cloud API), cujo token é
-- guardado CIFRADO pela aplicação (AES-256-GCM, chave fora do banco).
-- Cada aviso vira uma linha na caixa de saída (message_outbox) antes de ir para a fila.

CREATE TABLE tenant_messaging_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  provider             text NOT NULL DEFAULT 'baileys' CHECK (provider IN ('baileys','meta_cloud')),
  enabled              boolean NOT NULL DEFAULT false,
  phone_number_id      text CHECK (phone_number_id IS NULL OR phone_number_id ~ '^[0-9]{5,30}$'),
  token_enc            bytea,          -- token de acesso cifrado (iv|tag|dados)
  token_last4          text,
  language             text NOT NULL DEFAULT 'pt_BR' CHECK (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  template_ready       text CHECK (template_ready IS NULL OR (template_ready ~ '^[a-z0-9_]+$' AND length(template_ready) <= 512)),
  template_dispatched  text CHECK (template_dispatched IS NULL OR (template_dispatched ~ '^[a-z0-9_]+$' AND length(template_dispatched) <= 512)),
  -- Textos usados no Baileys; {cliente}, {pedido} e {restaurante} são trocados no envio.
  text_ready           text NOT NULL DEFAULT 'Olá, {cliente}! Seu pedido #{pedido} no {restaurante} está pronto para retirada.'
                       CHECK (length(text_ready) BETWEEN 1 AND 1000),
  text_dispatched      text NOT NULL DEFAULT 'Olá, {cliente}! Seu pedido #{pedido} do {restaurante} saiu para entrega.'
                       CHECK (length(text_dispatched) BETWEEN 1 AND 1000),
  notify_ready         boolean NOT NULL DEFAULT true,
  notify_dispatched    boolean NOT NULL DEFAULT true,
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR provider = 'baileys' OR (phone_number_id IS NOT NULL AND token_enc IS NOT NULL))
);

CREATE TABLE message_outbox (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  order_id             uuid,
  event                text NOT NULL CHECK (event IN ('order.ready','order.dispatched','test')),
  provider             text NOT NULL CHECK (provider IN ('baileys','meta_cloud')),
  to_phone             text NOT NULL CHECK (to_phone ~ '^[0-9]{10,15}$'),
  -- Meta: nome do modelo + idioma + parâmetros. Baileys: texto pronto em "body".
  template             text,
  language             text,
  params               jsonb NOT NULL DEFAULT '[]',
  body                 text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 4000),
  CHECK (template IS NOT NULL OR body IS NOT NULL),
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts             integer NOT NULL DEFAULT 0,
  provider_message_id  text,
  last_error           text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT
);
-- O mesmo aviso de um pedido nunca entra duas vezes (ex.: pronto → reaberto → pronto).
CREATE UNIQUE INDEX message_outbox_once ON message_outbox(tenant_id, order_id, event) WHERE order_id IS NOT NULL;
CREATE INDEX message_outbox_created_idx ON message_outbox(tenant_id, created_at DESC);
CREATE TRIGGER message_outbox_updated_at BEFORE UPDATE ON message_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_messaging_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_messaging_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON message_outbox
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON tenant_messaging_settings TO comandou_app;
GRANT SELECT, INSERT ON message_outbox TO comandou_app;
GRANT UPDATE (status, attempts, provider_message_id, last_error, sent_at, updated_at) ON message_outbox TO comandou_app;
