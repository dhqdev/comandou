-- 0061: pagamento pelo app com PagBank e split (docs/pagamento-online.md, ADR 0013).
--
-- Plataforma (só o papel comandou_platform):
-- 1) platform_online_pay_settings: liga o pagamento pelo app, ambiente, token da conta PagBank
--    da Comandou e a aplicação do Connect (client_secret cifrado), a conta que recebe a taxa e a
--    taxa padrão (percentual + fixo).
-- 2) tenant_online_pay_fees: taxa diferente para um restaurante.
--
-- Restaurante (RLS por tenant; o painel só lê, para o relatório):
-- 3) online_pay_accounts: a conta PagBank conectada (tokens cifrados, chave pública do cartão), o
--    que a loja aceita pelo app e o caixa onde os pagamentos entram.
-- 4) online_pay_states: o "state" do Connect, de uso único (só o hash).
-- 5) online_charges: cada tentativa de pagamento de um pedido (cartão ou Pix), com a taxa da
--    Comandou congelada e a situação no PagBank.
-- 6) orders.pay_online: o pedido é pago pelo app (card | pix) e espera o pagamento.
-- Somente aditiva.

CREATE TABLE platform_online_pay_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled             boolean NOT NULL DEFAULT false,
  environment         text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  platform_token_enc  bytea,
  client_id           text CHECK (length(client_id) <= 80),
  client_secret_enc   bytea,
  receiver_account_id text CHECK (receiver_account_id ~ '^ACCO_[A-Za-z0-9-]{4,60}$'),
  fee_percent         numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (fee_percent BETWEEN 0 AND 20),
  fee_fixed           numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_fixed BETWEEN 0 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_online_pay_settings (id) VALUES (true);

CREATE TABLE tenant_online_pay_fees (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  fee_percent  numeric(4,2) NOT NULL CHECK (fee_percent BETWEEN 0 AND 20),
  fee_fixed    numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_fixed BETWEEN 0 AND 100),
  note         text CHECK (length(note) <= 200),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);

ALTER TABLE platform_online_pay_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_online_pay_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_online_pay_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_online_pay_fees TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON platform_online_pay_settings TO comandou_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_online_pay_fees TO comandou_platform;

CREATE TABLE online_pay_accounts (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  environment        text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  seller_account_id  text CHECK (seller_account_id ~ '^ACCO_[A-Za-z0-9-]{4,60}$'),
  access_token_enc   bytea,
  refresh_token_enc  bytea,
  token_expires_at   timestamptz,
  public_key         text CHECK (length(public_key) <= 2000),
  card_enabled       boolean NOT NULL DEFAULT true,
  pix_enabled        boolean NOT NULL DEFAULT true,
  -- Caixa que recebe os pagamentos do app (sem escolha: o caixa aberto há mais tempo).
  cash_register_id   uuid,
  connected_by       uuid,
  connected_at       timestamptz,
  last_error         text CHECK (length(last_error) <= 300),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment),
  FOREIGN KEY (tenant_id, cash_register_id) REFERENCES cash_registers(tenant_id, id) ON DELETE SET NULL (cash_register_id)
);

CREATE TABLE online_pay_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  state_hash  bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  user_id     uuid NOT NULL,
  -- Endereço do restaurante onde o Connect começou (a volta do PagBank leva de novo para lá).
  return_host text NOT NULL CHECK (length(return_host) BETWEEN 3 AND 253),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD COLUMN pay_online text CHECK (pay_online IN ('card', 'pix'));
CREATE INDEX orders_pay_online_idx ON orders(tenant_id, created_at)
  WHERE pay_online IS NOT NULL AND payment_status <> 'paid';

CREATE TABLE online_charges (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id           uuid NOT NULL,
  method             text NOT NULL CHECK (method IN ('card', 'pix')),
  environment        text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','declined','expired','refund_due','refunded')),
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Taxa da Comandou neste pagamento (congelada) e a regra que a gerou.
  fee_amount         numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0 AND fee_amount <= amount),
  fee_percent        numeric(4,2) NOT NULL DEFAULT 0,
  fee_fixed          numeric(14,2) NOT NULL DEFAULT 0,
  receiver_account_id text,
  pagbank_order_id   text CHECK (length(pagbank_order_id) <= 80),
  pagbank_charge_id  text CHECK (length(pagbank_charge_id) <= 80),
  pagbank_status     text CHECK (length(pagbank_status) <= 40),
  card_brand         text CHECK (length(card_brand) <= 30),
  card_last4         text CHECK (card_last4 ~ '^[0-9]{4}$'),
  decline_reason     text CHECK (length(decline_reason) <= 300),
  pix_text           text CHECK (length(pix_text) <= 600),
  pix_expires_at     timestamptz,
  -- Pagamento do caixa criado com esta cobrança (NULL enquanto não entrou no caixa).
  payment_id         uuid,
  refunded_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  last_error         text CHECK (length(last_error) <= 300),
  checked_at         timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id)   ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('paid','refund_due','refunded')) = (paid_at IS NOT NULL))
);
CREATE INDEX online_charges_order_idx ON online_charges(tenant_id, order_id, created_at DESC);
CREATE INDEX online_charges_open_idx ON online_charges(tenant_id, created_at)
  WHERE status IN ('pending','refund_due') OR (status = 'paid' AND payment_id IS NULL);
CREATE UNIQUE INDEX online_charges_payment_idx ON online_charges(payment_id) WHERE payment_id IS NOT NULL;
-- No máximo uma cobrança esperando por pedido, e um pagamento valendo por pedido (outro que
-- chegue pago vira "a devolver").
CREATE UNIQUE INDEX online_charges_one_pending ON online_charges(order_id) WHERE status = 'pending';
CREATE UNIQUE INDEX online_charges_one_paid ON online_charges(order_id) WHERE status = 'paid';
CREATE TRIGGER online_charges_updated_at BEFORE UPDATE ON online_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER online_pay_accounts_updated_at BEFORE UPDATE ON online_pay_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE online_pay_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_pay_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_pay_accounts TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON online_pay_states TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON online_charges TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON online_pay_accounts TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON online_pay_states TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON online_charges TO comandou_app;

-- Painel: lê situação da conexão (sem os tokens) e as cobranças, para o relatório da taxa.
CREATE POLICY platform_read ON online_pay_accounts TO comandou_platform USING (true);
CREATE POLICY platform_read ON online_charges TO comandou_platform USING (true);
CREATE POLICY platform_read ON online_pay_states TO comandou_platform USING (true);
GRANT SELECT (tenant_id, state_hash, return_host, expires_at, used_at) ON online_pay_states TO comandou_platform;
GRANT SELECT (tenant_id, environment, seller_account_id, card_enabled, pix_enabled, connected_at,
              last_error, updated_at) ON online_pay_accounts TO comandou_platform;
GRANT SELECT (tenant_id, method, environment, status, amount, fee_amount, refunded_amount, payment_id, paid_at,
              created_at) ON online_charges TO comandou_platform;
