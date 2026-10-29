-- 0033: cobrança automática da assinatura pelo Asaas (docs/cobranca.md).
-- 1) platform_billing_settings: conta do Asaas (chave e token do webhook cifrados com a
--    INTEGRATIONS_KEY, nunca voltam ao navegador) e as regras: dias antes do fim para gerar a
--    fatura, tolerância antes do bloqueio, renovação anual do contrato.
-- 2) subscriptions ganha o modo de cobrança (manual | asaas) e o bloqueio automático
--    (blocked_at + motivo). Assinaturas que já existem continuam "manual": nada muda para elas
--    até o painel ligar a cobrança automática do cliente.
-- 3) billing_customers: cliente no Asaas de cada restaurante (por ambiente).
-- 4) billing_invoices: cada fatura (mensalidade, troca de plano, avulsa) e o estado no Asaas.
-- 5) billing_events: avisos do webhook do Asaas, guardados uma vez só (id do evento único).
-- 6) tenant_contracts.valid_until: fim da vigência (o contrato é reassinado todo ano).
-- 7) Teste grátis padrão passa de 14 para 7 dias nos planos que vieram com o sistema.
-- Somente aditiva.

CREATE TABLE platform_billing_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled                boolean NOT NULL DEFAULT false,
  environment            text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  api_key_enc            bytea,
  webhook_token_enc      bytea,
  -- A fatura do próximo período sai estes dias antes do fim do acesso (aviso prévio).
  invoice_days_before    int NOT NULL DEFAULT 5 CHECK (invoice_days_before BETWEEN 1 AND 20),
  -- Dias depois do fim do acesso sem pagamento até bloquear (0 = no dia seguinte ao vencimento).
  block_after_days       int NOT NULL DEFAULT 0 CHECK (block_after_days BETWEEN 0 AND 15),
  -- Prazo para pagar a diferença de uma troca de plano.
  upgrade_due_days       int NOT NULL DEFAULT 3 CHECK (upgrade_due_days BETWEEN 1 AND 10),
  -- Contrato: aviso de renovação antes do fim e tolerância depois do fim até bloquear.
  contract_renewal_days  int NOT NULL DEFAULT 30 CHECK (contract_renewal_days BETWEEN 7 AND 90),
  contract_grace_days    int NOT NULL DEFAULT 15 CHECK (contract_grace_days BETWEEN 0 AND 60),
  account_name           text CHECK (length(account_name) <= 160),
  webhook_id             text CHECK (length(webhook_id) <= 80),
  last_cycle_at          timestamptz,
  last_cycle_error       text CHECK (length(last_cycle_error) <= 500),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_billing_settings (id) VALUES (true);

ALTER TABLE subscriptions
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'manual' CHECK (billing_mode IN ('manual', 'asaas')),
  ADD COLUMN blocked_at   timestamptz,
  ADD COLUMN block_reason text CHECK (block_reason IN ('payment', 'contract')),
  ADD CONSTRAINT subscriptions_block_check CHECK ((blocked_at IS NULL) = (block_reason IS NULL));

-- Assinatura nova: cobrança automática se o Asaas estiver ligado no painel.
CREATE FUNCTION subscriptions_default_billing() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.billing_mode = 'manual' AND EXISTS (SELECT 1 FROM platform_billing_settings WHERE enabled) THEN
    NEW.billing_mode := 'asaas';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_default_billing BEFORE INSERT ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_default_billing();

CREATE TABLE billing_customers (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment   text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  customer_id   text NOT NULL CHECK (length(customer_id) <= 80),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, environment)
);

CREATE TABLE billing_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('monthly', 'upgrade', 'manual')),
  plan_id          uuid REFERENCES plans(id) ON DELETE RESTRICT,
  description      text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Mensalidade: início do período que ela libera (fim do acesso atual). Única por assinatura.
  period_start     timestamptz,
  due_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled', 'refunded')),
  environment      text CHECK (environment IN ('sandbox', 'production')),
  provider_id      text UNIQUE CHECK (length(provider_id) <= 80),
  invoice_url      text CHECK (length(invoice_url) <= 500),
  bank_slip_url    text CHECK (length(bank_slip_url) <= 500),
  billing_type     text CHECK (length(billing_type) <= 30),
  paid_at          timestamptz,
  net_amount       numeric(14,2),
  -- Já somou os 30 dias (ou trocou o plano) na assinatura: o mesmo pagamento nunca soma duas vezes.
  applied_at       timestamptz,
  last_error       text CHECK (length(last_error) <= 300),
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'monthly' OR period_start IS NOT NULL),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE UNIQUE INDEX billing_invoices_one_per_period ON billing_invoices (subscription_id, period_start)
  WHERE kind = 'monthly' AND status NOT IN ('cancelled', 'refunded');
CREATE INDEX billing_invoices_tenant ON billing_invoices (tenant_id, created_at DESC);
CREATE INDEX billing_invoices_open ON billing_invoices (status, due_date) WHERE status IN ('pending', 'overdue');
CREATE TRIGGER billing_invoices_updated_at BEFORE UPDATE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_events (
  id            bigserial PRIMARY KEY,
  event_id      text NOT NULL UNIQUE CHECK (length(event_id) <= 120),
  event         text NOT NULL CHECK (length(event) <= 80),
  payment_id    text CHECK (length(payment_id) <= 80),
  invoice_id    uuid REFERENCES billing_invoices(id) ON DELETE SET NULL,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text CHECK (length(error) <= 300)
);
CREATE INDEX billing_events_received ON billing_events (received_at DESC);

ALTER TABLE tenant_contracts ADD COLUMN valid_until date;
UPDATE tenant_contracts
   SET valid_until = ((content::jsonb #>> '{terms,startDate}')::date
                      + make_interval(months => (content::jsonb #>> '{terms,termMonths}')::int)
                      - interval '1 day')::date
 WHERE content::jsonb #>> '{terms,startDate}' IS NOT NULL;

UPDATE plans SET trial_days = 7
 WHERE code IN ('essencial', 'profissional', 'premium') AND trial_days = 14;

ALTER TABLE platform_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_billing_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON billing_customers TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON billing_invoices TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON billing_events TO comandou_platform USING (true) WITH CHECK (true);
-- O restaurante só lê as próprias faturas (tela Assinatura).
CREATE POLICY tenant_isolation ON billing_invoices TO comandou_app USING (tenant_id = app_current_tenant());
GRANT SELECT ON billing_invoices TO comandou_app;

GRANT SELECT ON platform_billing_settings TO comandou_platform;
GRANT UPDATE (enabled, environment, api_key_enc, webhook_token_enc, invoice_days_before,
              block_after_days, upgrade_due_days, contract_renewal_days, contract_grace_days,
              account_name, webhook_id, last_cycle_at, last_cycle_error, updated_at, updated_by)
  ON platform_billing_settings TO comandou_platform;
GRANT SELECT, INSERT ON billing_customers TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON billing_invoices TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON billing_events TO comandou_platform;
GRANT USAGE ON SEQUENCE billing_events_id_seq TO comandou_platform;
GRANT UPDATE (valid_until) ON tenant_contracts TO comandou_platform;
