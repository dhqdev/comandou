-- 0112: pagamento da equipe (fora os entregadores, que seguem no Acerto de Entregas). Somente aditiva.
--
-- staff_workdays:      dia em que a pessoa usou o sistema (no fuso do restaurante), com a primeira e
--                      a última vez que apareceu. Gravado pela sessão (no máximo 1x por minuto).
--                      É a base das diárias; o gerente ainda pode corrigir os dias ao pagar.
-- staff_pay_profiles:  como a pessoa ganha (salário do mês, diária, % das vendas, % da taxa de
--                      serviço; JSON validado pela API, formato em packages/shared/staff-pay.ts) e
--                      a chave Pix.
-- staff_payouts:       cada pagamento, com a conta (salário, diárias, comissão, taxa de serviço,
--                      ajuste) e o lançamento no Financeiro, que é sempre criado (pago na hora ou
--                      agendado). Lançamento cancelado no Financeiro = pagamento desfeito: o período
--                      volta a ficar em aberto.
CREATE TABLE staff_workdays (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id   uuid NOT NULL,
  day       date NOT NULL,
  first_at  timestamptz NOT NULL DEFAULT now(),
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, day),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
ALTER TABLE staff_workdays ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_workdays
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON staff_workdays TO comandou_app;
GRANT UPDATE (last_at) ON staff_workdays TO comandou_app;

CREATE TABLE staff_pay_profiles (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id    uuid NOT NULL,
  rule       jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  pix_key    text CHECK (pix_key IS NULL OR length(pix_key) BETWEEN 1 AND 140),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
ALTER TABLE staff_pay_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_pay_profiles
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON staff_pay_profiles TO comandou_app;
GRANT UPDATE (rule, pix_key, updated_at, updated_by) ON staff_pay_profiles TO comandou_app;

CREATE TABLE staff_payouts (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id          uuid NOT NULL,
  role             text NOT NULL,
  period_from      date NOT NULL,
  period_to        date NOT NULL,
  days_worked      integer NOT NULL CHECK (days_worked >= 0),
  orders           integer NOT NULL DEFAULT 0 CHECK (orders >= 0),
  sales            numeric(14,2) NOT NULL DEFAULT 0 CHECK (sales >= 0),
  service          numeric(14,2) NOT NULL DEFAULT 0 CHECK (service >= 0),
  salary           numeric(14,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  daily            numeric(14,2) NOT NULL DEFAULT 0 CHECK (daily >= 0),
  commission       numeric(14,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  service_share    numeric(14,2) NOT NULL DEFAULT 0 CHECK (service_share >= 0),
  adjustments      numeric(14,2) NOT NULL DEFAULT 0,          -- bônus (+) ou vale/desconto (−)
  gross            numeric(14,2) NOT NULL CHECK (gross > 0),
  rule             jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'), -- regra usada na conta
  method           text NOT NULL CHECK (method IN ('cash','pix','transfer','other')),
  notes            text CHECK (notes IS NULL OR length(notes) <= 300),
  paid_at          timestamptz NOT NULL DEFAULT now(),
  finance_entry_id uuid NOT NULL,
  created_by       uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, finance_entry_id) REFERENCES finance_entries(tenant_id, id) ON DELETE RESTRICT,
  CHECK (period_to >= period_from),
  CHECK (gross = salary + daily + commission + service_share + adjustments)
);
CREATE INDEX staff_payouts_user_idx ON staff_payouts(tenant_id, user_id, period_to DESC);
CREATE INDEX staff_payouts_paid_idx ON staff_payouts(tenant_id, paid_at);
ALTER TABLE staff_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_payouts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON staff_payouts TO comandou_app;
