-- 0024: central de ganhos do entregador e repasses.
-- 1) courier_pay_settings: regra de pagamento por entrega e impostos da loja (uma linha por loja).
--    A regra e os impostos são JSON validados pela API (formatos em packages/shared/courier-pay.ts).
-- 2) couriers: regime fiscal (MEI, autônomo, CLT), regra própria (NULL = a da loja) e chave Pix.
-- 3) deliveries: distância estimada da corrida e quanto o entregador ganhou, gravados ao encerrar
--    (mudar a regra depois não altera corridas já fechadas), e o repasse que pagou a corrida.
-- 4) courier_payouts: cada pagamento ao entregador, com bruto, retenções, líquido e custo da loja.
-- Corridas antigas: o entregador fica com a taxa de entrega (a regra padrão), como os relatórios
-- já consideravam, e não entram em repasse pendente. Somente aditiva.

CREATE TABLE courier_pay_settings (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rule       jsonb NOT NULL,
  taxes      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id),
  CHECK (jsonb_typeof(rule) = 'object' AND jsonb_typeof(taxes) = 'object')
);
ALTER TABLE courier_pay_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON courier_pay_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON courier_pay_settings TO comandou_app;

ALTER TABLE couriers
  ADD COLUMN tax_regime text NOT NULL DEFAULT 'mei' CHECK (tax_regime IN ('mei','autonomo','clt')),
  ADD COLUMN pay_rule   jsonb CHECK (pay_rule IS NULL OR jsonb_typeof(pay_rule) = 'object'),
  ADD COLUMN pix_key    text CHECK (pix_key IS NULL OR length(pix_key) BETWEEN 1 AND 140);

CREATE TABLE courier_payouts (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  courier_id    uuid NOT NULL,
  -- Corridas encerradas até este dia (no fuso da loja) entram no repasse.
  period_from   date,
  period_to     date NOT NULL,
  deliveries    integer NOT NULL CHECK (deliveries >= 0),
  days_worked   integer NOT NULL CHECK (days_worked >= 0),
  distance_m    integer NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
  rides         numeric(14,2) NOT NULL CHECK (rides >= 0),   -- soma das corridas
  daily         numeric(14,2) NOT NULL CHECK (daily >= 0),   -- diárias
  adjustments   numeric(14,2) NOT NULL DEFAULT 0,            -- bônus (+) ou vale/desconto (−)
  gross         numeric(14,2) NOT NULL CHECK (gross >= 0),
  inss          numeric(14,2) NOT NULL DEFAULT 0 CHECK (inss >= 0),
  irrf          numeric(14,2) NOT NULL DEFAULT 0 CHECK (irrf >= 0),
  iss           numeric(14,2) NOT NULL DEFAULT 0 CHECK (iss >= 0),
  net           numeric(14,2) NOT NULL,
  employer      numeric(14,2) NOT NULL DEFAULT 0 CHECK (employer >= 0),
  tax_regime    text NOT NULL CHECK (tax_regime IN ('mei','autonomo','clt')),
  method        text NOT NULL CHECK (method IN ('cash','pix','transfer','other')),
  notes         text CHECK (notes IS NULL OR length(notes) <= 300),
  paid_at       timestamptz NOT NULL DEFAULT now(),
  finance_entry_id uuid,
  created_by    uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers(tenant_id, id) ON DELETE RESTRICT,
  CHECK (gross = rides + daily + adjustments),
  CHECK (net = gross - inss - irrf - iss)
);
CREATE INDEX courier_payouts_courier_idx ON courier_payouts(tenant_id, courier_id, paid_at DESC);
CREATE INDEX courier_payouts_paid_idx ON courier_payouts(tenant_id, paid_at);
ALTER TABLE courier_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON courier_payouts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON courier_payouts TO comandou_app;

ALTER TABLE deliveries
  ADD COLUMN distance_m  integer CHECK (distance_m >= 0),
  ADD COLUMN courier_pay numeric(14,2) CHECK (courier_pay >= 0),
  ADD COLUMN payout_id   uuid,
  -- Encerrada e ainda não paga ao entregador. As corridas de antes desta versão ficam de fora
  -- (já foram acertadas por fora do sistema).
  ADD COLUMN payout_pending boolean NOT NULL DEFAULT false,
  ADD FOREIGN KEY (tenant_id, payout_id) REFERENCES courier_payouts(tenant_id, id) ON DELETE RESTRICT,
  ADD CHECK (NOT (payout_pending AND payout_id IS NOT NULL));
CREATE INDEX deliveries_unpaid_idx ON deliveries(tenant_id, courier_id, finished_at)
  WHERE payout_pending;

UPDATE deliveries d SET courier_pay = CASE WHEN d.status = 'delivered' THEN o.delivery_fee ELSE 0 END
  FROM orders o
 WHERE o.tenant_id = d.tenant_id AND o.id = d.order_id AND d.status <> 'out';
