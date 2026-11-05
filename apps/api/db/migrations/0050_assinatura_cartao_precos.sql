-- 0050: assinatura com cartão automático, troca para plano menor e página pública de preços.
-- 1) plans ganha o que aparece em /precos: frase curta, destaques (lista), "mais escolhido",
--    se aparece na página e a ordem. Tudo editado no Super Admin → Planos.
-- 2) subscriptions ganha a forma de pagamento preferida (pix | boleto | card) e a troca agendada
--    para um plano menor (vale no próximo período).
-- 3) billing_cards: cartão salvo do restaurante no Asaas (só o token cifrado, a bandeira e os 4
--    últimos números; o número do cartão nunca é guardado). Só a plataforma lê.
-- 4) platform_billing_settings: liga o cartão automático (precisa da tokenização liberada no
--    Asaas) e o contato de vendas mostrado em /precos.
-- Somente aditiva.

ALTER TABLE plans
  ADD COLUMN tagline     text NOT NULL DEFAULT '' CHECK (length(tagline) <= 160),
  ADD COLUMN highlights  jsonb NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(highlights) = 'array' AND jsonb_array_length(highlights) <= 8),
  ADD COLUMN featured    boolean NOT NULL DEFAULT false,
  ADD COLUMN show_public boolean NOT NULL DEFAULT true,
  ADD COLUMN sort_order  int NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999);

ALTER TABLE subscriptions
  ADD COLUMN pay_method        text CHECK (pay_method IN ('pix', 'boleto', 'card')),
  ADD COLUMN scheduled_plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  ADD COLUMN scheduled_at      timestamptz;

CREATE TABLE billing_cards (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment   text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  token_enc     bytea NOT NULL,
  brand         text NOT NULL CHECK (length(brand) <= 30),
  last4         text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  holder_name   text NOT NULL CHECK (length(holder_name) <= 120),
  -- IP de quem cadastrou (o Asaas pede o IP do cliente nas cobranças com o token).
  remote_ip     text NOT NULL CHECK (length(remote_ip) <= 64),
  created_by    text CHECK (length(created_by) <= 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, environment)
);

ALTER TABLE platform_billing_settings
  ADD COLUMN card_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN sales_contact text NOT NULL DEFAULT '' CHECK (length(sales_contact) <= 200);

ALTER TABLE billing_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON billing_cards TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_cards TO comandou_platform;
GRANT UPDATE (card_enabled, sales_contact) ON platform_billing_settings TO comandou_platform;
GRANT UPDATE (pay_method, scheduled_plan_id, scheduled_at) ON subscriptions TO comandou_platform;
