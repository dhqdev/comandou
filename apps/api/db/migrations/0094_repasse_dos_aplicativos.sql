-- 0094: Repasse dos aplicativos de delivery (ADR 0015, Fase 7). Somente aditiva.
--
-- channel_orders ganha o que o aplicativo diz que a venda rende: valor bruto (itens + entrega),
-- o que fica com o restaurante (saldo da venda, só quando o aplicativo fecha a conta), o que foi
-- descontado e a lista curta dos descontos (tipo e valor, sem dado pessoal).
-- channel_stores ganha a hora da última leitura do financeiro (no máximo a cada 6 horas por loja).
-- channel_payouts guarda cada repasse do aplicativo (período, quando cai, valor, taxa da
-- antecipação, situação) SEM os dados da conta bancária, ligado à conta a receber do Financeiro
-- (categoria "Repasse de vendas": fora do DRE, conferida pela Conciliação bancária).

ALTER TABLE channel_orders
  ADD COLUMN fin_gross   numeric(14,2) CHECK (fin_gross >= 0),
  ADD COLUMN fin_net     numeric(14,2),
  ADD COLUMN fin_fees    numeric(14,2),
  ADD COLUMN fin_entries jsonb CHECK (fin_entries IS NULL OR (jsonb_typeof(fin_entries) = 'array'
                                      AND jsonb_array_length(fin_entries) <= 20)),
  ADD COLUMN fin_at      timestamptz;

GRANT UPDATE (fin_gross, fin_net, fin_fees, fin_entries, fin_at) ON channel_orders TO comandou_app;

ALTER TABLE channel_stores
  ADD COLUMN finance_at    timestamptz,
  ADD COLUMN finance_error text CHECK (length(finance_error) <= 300);

GRANT UPDATE (finance_at, finance_error) ON channel_stores TO comandou_app;

CREATE TABLE channel_payouts (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel         text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_ref       uuid,
  store_id        text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  -- Id estável do repasse (o aplicativo não dá um): resumo do período, tipo e data original.
  external_id     text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  kind            text NOT NULL CHECK (length(kind) BETWEEN 1 AND 60),
  period_start    date,
  period_end      date,
  -- Quando cai (a data antecipada, se houve antecipação) e o valor que cai.
  expected_date   date NOT NULL,
  amount          numeric(14,2) NOT NULL,
  original_amount numeric(14,2),
  original_date   date,
  anticipation_fee numeric(14,2) CHECK (anticipation_fee >= 0),
  status          text NOT NULL CHECK (status IN ('scheduled','paid','failed')),
  channel_status  text CHECK (length(channel_status) <= 60),
  entry_id        uuid,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, external_id),
  FOREIGN KEY (tenant_id, store_ref) REFERENCES channel_stores(tenant_id, id) ON DELETE SET NULL (store_ref),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES finance_entries(tenant_id, id) ON DELETE SET NULL (entry_id)
);
CREATE INDEX channel_payouts_date_idx ON channel_payouts(tenant_id, expected_date);
CREATE INDEX channel_orders_fin_idx ON channel_orders(tenant_id, fin_at) WHERE fin_at IS NOT NULL;

ALTER TABLE channel_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_payouts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- A API não apaga repasses: só grava, atualiza o andamento e liga à conta a receber.
GRANT SELECT, INSERT ON channel_payouts TO comandou_app;
GRANT UPDATE (kind, period_start, period_end, expected_date, amount, original_amount, original_date,
              anticipation_fee, status, channel_status, entry_id, fetched_at, store_ref)
  ON channel_payouts TO comandou_app;
