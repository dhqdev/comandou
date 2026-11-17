-- 0077: fechamento do caixa no financeiro, conciliação bancária e DRE. Somente aditiva.
--
-- finance_settings.payment_terms: taxa (%) e prazo (dias) de cada forma de pagamento, por
--   restaurante. NULL: padrão de mercado (regra em @comandou/shared, DEFAULT_PAYMENT_TERMS).
-- finance_settlements: o que cada forma de pagamento de um caixa fechado vai render na conta.
--   Nasce no fechamento do caixa (uma linha por sessão e forma): bruto, taxa, líquido e o dia
--   previsto. Fica "a receber" até ser conciliado (com o extrato ou à mão).
-- bank_accounts / bank_statement_lines: contas do banco e as linhas do extrato importado (OFX).
--   fit_key evita importar a mesma linha duas vezes.
-- bank_reconciliations: cada conciliação junta linhas do extrato com recebíveis do caixa, com
--   uma conta do financeiro, ou marca a linha como transferência/ignorada. A diferença entre o
--   que caiu e o previsto é o acerto da taxa da maquininha (entra no DRE).

ALTER TABLE finance_settings ADD COLUMN payment_terms jsonb;

CREATE TABLE bank_accounts (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  bank_id      text CHECK (bank_id IS NULL OR length(bank_id) <= 20),
  account_ref  text CHECK (account_ref IS NULL OR length(account_ref) <= 40),
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE bank_reconciliations (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind           text NOT NULL CHECK (kind IN ('settlement','entry','transfer','ignored','manual')),
  -- Dia em que o dinheiro entrou ou saiu.
  day            date NOT NULL,
  lines_total    numeric(14,2) NOT NULL DEFAULT 0,
  target_total   numeric(14,2) NOT NULL DEFAULT 0,
  difference     numeric(14,2) NOT NULL DEFAULT 0,
  entry_id       uuid,
  -- A conta foi baixada por esta conciliação (ou criada a partir da linha): não dá para desfazer.
  entry_settled  boolean NOT NULL DEFAULT false,
  auto           boolean NOT NULL DEFAULT false,
  note           text CHECK (note IS NULL OR length(note) <= 300),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES finance_entries(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'entry') = (entry_id IS NOT NULL)),
  CHECK (difference = lines_total - target_total OR kind IN ('transfer','ignored'))
);
CREATE INDEX bank_reconciliations_entry_idx ON bank_reconciliations(tenant_id, entry_id)
  WHERE entry_id IS NOT NULL;

CREATE TABLE bank_statement_lines (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  account_id         uuid NOT NULL,
  posted_at          date NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount <> 0),
  description        text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  fit_key            text NOT NULL CHECK (length(fit_key) BETWEEN 1 AND 300),
  reconciliation_id  uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, account_id, fit_key),
  FOREIGN KEY (tenant_id, account_id) REFERENCES bank_accounts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_id) REFERENCES bank_reconciliations(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX bank_statement_lines_day_idx ON bank_statement_lines(tenant_id, account_id, posted_at);
CREATE INDEX bank_statement_lines_open_idx ON bank_statement_lines(tenant_id, posted_at)
  WHERE reconciliation_id IS NULL;

CREATE TABLE finance_settlements (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  cash_session_id    uuid NOT NULL,
  -- Dia do movimento: o dia (no fuso do restaurante) em que o caixa abriu.
  day                date NOT NULL,
  method             text NOT NULL CHECK (method IN ('cash','credit','debit','pix','voucher','other')),
  gross              numeric(14,2) NOT NULL,
  fee_percent        numeric(5,2) NOT NULL CHECK (fee_percent >= 0 AND fee_percent <= 20),
  fee                numeric(14,2) NOT NULL CHECK (fee >= 0),
  net                numeric(14,2) NOT NULL,
  expected_date      date NOT NULL,
  reconciliation_id  uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cash_session_id, method),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_id) REFERENCES bank_reconciliations(tenant_id, id) ON DELETE RESTRICT,
  CHECK (net = gross - fee)
);
CREATE INDEX finance_settlements_day_idx ON finance_settlements(tenant_id, day);
CREATE INDEX finance_settlements_open_idx ON finance_settlements(tenant_id, expected_date)
  WHERE reconciliation_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts','bank_reconciliations','bank_statement_lines','finance_settlements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Valores não mudam depois de gravados: só o vínculo com a conciliação (que pode ser desfeita).
GRANT SELECT, INSERT, UPDATE (name, active) ON bank_accounts TO comandou_app;
GRANT SELECT, INSERT, DELETE ON bank_reconciliations TO comandou_app;
GRANT SELECT, INSERT, DELETE ON bank_statement_lines TO comandou_app;
GRANT UPDATE (reconciliation_id) ON bank_statement_lines TO comandou_app;
GRANT SELECT, INSERT ON finance_settlements TO comandou_app;
GRANT UPDATE (reconciliation_id) ON finance_settlements TO comandou_app;
