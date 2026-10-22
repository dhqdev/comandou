-- Comandou — 0003 Etapa 3: adicionais, setores de produção, salão (mesas/comandas), pedidos completos,
-- cozinha, pagamentos, caixa e idempotência.
--
-- Convenções (iguais à 0002): tenant_id NOT NULL, UNIQUE (tenant_id, id), FKs compostas,
-- RLS tenant_isolation, GRANT mínimo. Registros financeiros são IMUTÁVEIS para a aplicação
-- (sem UPDATE/DELETE em cash_movements, payment_refunds, order_status_history).

-- Contadores por tenant (numeração de pedidos/comandas sem colisão) ---------------------------
CREATE TABLE tenant_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL CHECK (name IN ('order', 'tab', 'cash_session')),
  value      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

-- Setores de produção (KDS) ----------------------------------------------------------------
CREATE TABLE production_sectors (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  channels        text[] NOT NULL DEFAULT ARRAY['counter','table','delivery','pickup']
                  CHECK (channels <@ ARRAY['counter','table','delivery','pickup']::text[]),
  warn_after_min  integer NOT NULL DEFAULT 10 CHECK (warn_after_min BETWEEN 0 AND 600),
  late_after_min  integer NOT NULL DEFAULT 20 CHECK (late_after_min BETWEEN 0 AND 600),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

ALTER TABLE products ADD COLUMN sector_id uuid;
ALTER TABLE products ADD FOREIGN KEY (tenant_id, sector_id) REFERENCES production_sectors(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE products ADD COLUMN position integer NOT NULL DEFAULT 0;

-- Adicionais e variações -----------------------------------------------------------------
-- Variação (ex.: Tamanho P/M/G) = grupo com min_select = max_select = 1.
CREATE TABLE option_groups (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  min_select  integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select  integer NOT NULL DEFAULT 1 CHECK (max_select >= 1 AND max_select <= 50),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (min_select <= max_select)
);

CREATE TABLE options (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  group_id     uuid NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  price_delta  numeric(14,2) NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  position     integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES option_groups(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX options_group_idx ON options(tenant_id, group_id);

CREATE TABLE product_option_groups (
  tenant_id   uuid NOT NULL,
  product_id  uuid NOT NULL,
  group_id    uuid NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, product_id, group_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, group_id)   REFERENCES option_groups(tenant_id, id) ON DELETE RESTRICT
);

-- Salão ------------------------------------------------------------------------------------
CREATE TABLE dining_tables (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 20),
  seats       integer NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 100),
  area        text,
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, label)
);

-- Comanda/atendimento: agrupa pedidos de uma mesa (ou balcão) até o fechamento da conta.
CREATE TABLE tabs (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  number         integer NOT NULL,
  table_id       uuid,
  customer_name  text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  opened_by      uuid,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_by      uuid,
  closed_at      timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, table_id) REFERENCES dining_tables(tenant_id, id) ON DELETE RESTRICT
);
-- Uma mesa tem no máximo uma comanda aberta.
CREATE UNIQUE INDEX tabs_one_open_per_table ON tabs(tenant_id, table_id) WHERE status = 'open' AND table_id IS NOT NULL;

-- Pedidos: colunas da Etapa 3 -------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN tab_id          uuid,
  ADD COLUMN customer_name   text,
  ADD COLUMN customer_phone  text,
  ADD COLUMN delivery_address text,
  ADD COLUMN notes           text,
  ADD COLUMN subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  ADD COLUMN discount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  ADD COLUMN surcharge       numeric(14,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  ADD COLUMN delivery_fee    numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  ADD COLUMN paid_amount     numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  ADD COLUMN payment_status  text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  ADD COLUMN cancel_reason   text,
  ADD COLUMN created_by      uuid,
  ADD COLUMN version         integer NOT NULL DEFAULT 1;
-- Backfill: pedidos da Etapa 2 não tinham subtotal; o total passa a ser o subtotal.
UPDATE orders SET subtotal = total;
ALTER TABLE orders
  ADD CONSTRAINT orders_total_consistent CHECK (total = subtotal - discount + surcharge + delivery_fee),
  ADD CONSTRAINT orders_discount_le_subtotal CHECK (discount <= subtotal + surcharge + delivery_fee),
  ADD FOREIGN KEY (tenant_id, tab_id) REFERENCES tabs(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX orders_tenant_status_idx ON orders(tenant_id, status, created_at DESC);
CREATE INDEX orders_tenant_tab_idx ON orders(tenant_id, tab_id);

ALTER TABLE order_items
  ADD COLUMN name        text NOT NULL DEFAULT '',
  ADD COLUMN notes       text,
  ADD COLUMN sector_id   uuid,
  ADD COLUMN total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  ADD COLUMN status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','cancelled')),
  ADD COLUMN started_at  timestamptz,
  ADD COLUMN ready_at    timestamptz,
  ADD UNIQUE (tenant_id, id),
  ADD FOREIGN KEY (tenant_id, sector_id) REFERENCES production_sectors(tenant_id, id) ON DELETE RESTRICT;
-- Backfill dos itens antigos (nome e total congelados a partir do produto/preço gravado).
UPDATE order_items i SET name = p.name, total = round(i.unit_price * i.quantity, 2)
  FROM products p WHERE p.id = i.product_id AND p.tenant_id = i.tenant_id;
CREATE INDEX order_items_sector_status_idx ON order_items(tenant_id, sector_id, status);

CREATE TABLE order_item_options (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  order_item_id  uuid NOT NULL,
  option_id      uuid NOT NULL,
  name           text NOT NULL,
  price_delta    numeric(14,2) NOT NULL CHECK (price_delta >= 0),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, order_item_id) REFERENCES order_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, option_id)     REFERENCES options(tenant_id, id)     ON DELETE RESTRICT
);
CREATE INDEX order_item_options_item_idx ON order_item_options(tenant_id, order_item_id);

CREATE TABLE order_status_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  order_id     uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  actor_id     uuid,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX order_status_history_order_idx ON order_status_history(tenant_id, order_id, id);

-- Caixa ------------------------------------------------------------------------------------
CREATE TABLE cash_registers (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE cash_sessions (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  register_id     uuid NOT NULL,
  number          integer NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_amount  numeric(14,2) NOT NULL CHECK (opening_amount >= 0),
  opened_by       uuid NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_by       uuid,
  closed_at       timestamptz,
  expected        jsonb,
  counted         jsonb,
  difference      numeric(14,2),
  closing_note    text,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
-- Um terminal tem no máximo uma sessão aberta.
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions(tenant_id, register_id) WHERE status = 'open';

-- Pagamentos ------------------------------------------------------------------------------
CREATE TABLE payments (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  order_id         uuid NOT NULL,
  cash_session_id  uuid NOT NULL,
  method           text NOT NULL CHECK (method IN ('cash','credit','debit','pix','voucher','other')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  tendered         numeric(14,2) CHECK (tendered IS NULL OR tendered >= amount),
  refunded_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)        REFERENCES orders(tenant_id, id)        ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_order_idx ON payments(tenant_id, order_id);

CREATE TABLE payment_refunds (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  payment_id       uuid NOT NULL,
  cash_session_id  uuid NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  reason           text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, payment_id)      REFERENCES payments(tenant_id, id)      ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT
);

-- Movimentos de caixa: livro-razão imutável da sessão.
CREATE TABLE cash_movements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  cash_session_id  uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('opening','sale','supply','withdrawal','refund')),
  method           text NOT NULL CHECK (method IN ('cash','credit','debit','pix','voucher','other')),
  -- Valor com sinal: entradas positivas (abertura, venda, suprimento), saídas negativas (sangria, estorno).
  amount           numeric(14,2) NOT NULL CHECK (amount <> 0),
  payment_id       uuid,
  order_id         uuid,
  note             text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_id)      REFERENCES payments(tenant_id, id)      ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, order_id)        REFERENCES orders(tenant_id, id)        ON DELETE RESTRICT,
  CHECK ((kind IN ('opening','sale','supply') AND amount > 0) OR (kind IN ('withdrawal','refund') AND amount < 0))
);
CREATE INDEX cash_movements_session_idx ON cash_movements(tenant_id, cash_session_id, id);

-- Idempotência ----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scope          text NOT NULL,
  key            text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  request_hash   text NOT NULL,
  response       jsonb,
  status_code    integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);

-- RLS ---------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_counters','production_sectors','option_groups','options',
    'product_option_groups','dining_tables','tabs','order_item_options','order_status_history',
    'cash_registers','cash_sessions','payments','payment_refunds','cash_movements','idempotency_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Privilégios (mínimos) ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON tenant_counters, production_sectors, option_groups, options,
  dining_tables, tabs, cash_registers, cash_sessions, idempotency_keys TO comandou_app;
GRANT SELECT, INSERT, DELETE ON product_option_groups TO comandou_app; -- vínculo, não é registro financeiro
GRANT SELECT, INSERT ON order_item_options, order_status_history, payment_refunds, cash_movements TO comandou_app;
-- payments: UPDATE apenas da coluna refunded_amount (estornos); valor e método nunca mudam.
GRANT SELECT, INSERT ON payments TO comandou_app;
GRANT UPDATE (refunded_amount) ON payments TO comandou_app;
-- order_items: a app altera status/tempos de preparo; preço e produto são fixos após criação.
REVOKE UPDATE ON order_items FROM comandou_app;
GRANT UPDATE (status, started_at, ready_at) ON order_items TO comandou_app;
