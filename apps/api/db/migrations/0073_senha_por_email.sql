-- 0073: esqueci minha senha do cliente também por e-mail.
--
-- 1) platform_site_settings: webhook (n8n) que manda os e-mails para os clientes dos restaurantes
--    (hoje, o código para criar uma nova senha). Separado do e-mail de boas-vindas: o remetente
--    é o nome do restaurante, não o Comandou.
-- 2) customer_password_resets: o código também pode sair pelo e-mail da conta do cliente.
-- Somente aditiva (o CHECK do canal só fica mais largo).

ALTER TABLE platform_site_settings
  ADD COLUMN customer_email_webhook_url text NOT NULL DEFAULT ''
    CHECK (length(customer_email_webhook_url) <= 500),
  -- Segredo enviado no cabeçalho X-Comandou-Token (cifrado com a INTEGRATIONS_KEY).
  ADD COLUMN customer_email_token_enc bytea;

ALTER TABLE customer_password_resets DROP CONSTRAINT IF EXISTS customer_password_resets_channel_check;
ALTER TABLE customer_password_resets
  ADD CONSTRAINT customer_password_resets_channel_check
  CHECK (channel IN ('whatsapp', 'email', 'staff'));
