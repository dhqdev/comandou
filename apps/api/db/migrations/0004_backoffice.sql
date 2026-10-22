-- Comandou — 0004 Etapa 4: equipe, estoque, entregas, impressão e financeiro.
-- Convenções iguais às anteriores: tenant_id NOT NULL, UNIQUE (tenant_id, id), FKs compostas,
-- RLS tenant_isolation e GRANT mínimo. Livros-razão (estoque, conciliação) são só INSERT.

-- Equipe ------------------------------------------------------------------------------------
-- A app só altera papel e situação do vínculo; criação passa pela função abaixo.
GRANT UPDATE (role, status) ON memberships TO comandou_app;

-- Adiciona um membro ao restaurante CORRENTE. Se o e-mail já tem conta (em outro restaurante),
-- só cria o vínculo: a senha existente continua valendo e não é revelada nem alterada.
CREATE FUNCTION app_add_member(p_email text, p_name text, p_password_hash text, p_role text)
  RETURNS TABLE (user_id uuid, created boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_user uuid;
    v_created boolean := false;
  BEGIN
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'sem contexto de restaurante' USING ERRCODE = '42501';
    END IF;
    SELECT u.id INTO v_user FROM users u WHERE u.email = p_email::citext;
    IF v_user IS NULL THEN
      INSERT INTO users (email, name, password_hash) VALUES (p_email, p_name, p_password_hash)
      RETURNING id INTO v_user;
      v_created := true;
    END IF;
    IF EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_user) THEN
      RAISE EXCEPTION 'usuário já faz parte da equipe' USING ERRCODE = '23505';
    END IF;
    INSERT INTO memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, p_role);
    RETURN QUERY SELECT v_user, v_created;
  END $$;

-- Troca a senha do PRÓPRIO usuário (app.user_id), que precisa ser membro ativo do restaurante.
CREATE FUNCTION app_set_own_password(p_password_hash text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.user_id = app_current_user() AND m.tenant_id = app_current_tenant() AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
    END IF;
    UPDATE users SET password_hash = p_password_hash WHERE id = app_current_user();
  END $$;

-- Hash da senha do próprio usuário, para conferir a senha atual antes de trocar.
CREATE FUNCTION app_own_password_hash()
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.password_hash FROM users u JOIN memberships m ON m.user_id = u.id
     WHERE u.id = app_current_user() AND m.tenant_id = app_current_tenant() AND m.status = 'active'
  $$;

REVOKE ALL ON FUNCTION app_add_member(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_set_own_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_own_password_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_add_member(text, text, text, text) TO comandou_app;
GRANT EXECUTE ON FUNCTION app_set_own_password(text) TO comandou_app;
GRANT EXECUTE ON FUNCTION app_own_password_hash() TO comandou_app;

-- Estoque -----------------------------------------------------------------------------------
CREATE TABLE stock_items (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  unit            text NOT NULL CHECK (unit IN ('un','kg','g','l','ml')),
  quantity        numeric(14,3) NOT NULL DEFAULT 0,
  min_quantity    numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  avg_cost        numeric(14,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  -- Sem negativo involuntário: só fica abaixo de zero se o item permitir explicitamente.
  allow_negative  boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  CHECK (allow_negative OR quantity >= 0)
);

-- Ficha técnica: quanto de cada insumo sai por unidade vendida do produto / da opção.
CREATE TABLE product_recipes (
  tenant_id      uuid NOT NULL,
  product_id     uuid NOT NULL,
  stock_item_id  uuid NOT NULL,
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, product_id, stock_item_id),
  FOREIGN KEY (tenant_id, product_id)    REFERENCES products(tenant_id, id)    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE option_recipes (
  tenant_id      uuid NOT NULL,
  option_id      uuid NOT NULL,
  stock_item_id  uuid NOT NULL,
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, option_id, stock_item_id),
  FOREIGN KEY (tenant_id, option_id)     REFERENCES options(tenant_id, id)     ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE stock_movements (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  stock_item_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('purchase','adjustment','sale','sale_reversal','loss')),
  quantity       numeric(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost      numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  balance_after  numeric(14,3) NOT NULL,
  order_id       uuid,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, order_id)      REFERENCES orders(tenant_id, id)      ON DELETE RESTRICT,
  CHECK ((kind IN ('purchase','sale_reversal') AND quantity > 0)
      OR (kind IN ('sale','loss') AND quantity < 0)
      OR kind = 'adjustment')
);
CREATE INDEX stock_movements_item_idx ON stock_movements(tenant_id, stock_item_id, id DESC);
CREATE INDEX stock_movements_order_idx ON stock_movements(tenant_id, order_id) WHERE order_id IS NOT NULL;

-- Entregas ----------------------------------------------------------------------------------
CREATE TABLE couriers (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone       text,
  user_id     uuid, -- login do entregador (papel "driver"), opcional
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX couriers_user_uniq ON couriers(tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE deliveries (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  order_id             uuid NOT NULL,
  courier_id           uuid NOT NULL,
  status               text NOT NULL DEFAULT 'out' CHECK (status IN ('out','delivered','failed')),
  -- Link público de rastreio: só o hash é guardado; expira.
  tracking_hash        bytea NOT NULL UNIQUE,
  tracking_expires_at  timestamptz NOT NULL,
  dispatched_at        timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  failure_reason       text,
  last_lat             numeric(9,6) CHECK (last_lat BETWEEN -90 AND 90),
  last_lng             numeric(9,6) CHECK (last_lng BETWEEN -180 AND 180),
  last_location_at     timestamptz,
  created_by           uuid,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id)   ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers(tenant_id, id) ON DELETE RESTRICT
);
-- Um pedido tem no máximo uma entrega em andamento.
CREATE UNIQUE INDEX deliveries_one_out ON deliveries(tenant_id, order_id) WHERE status = 'out';
CREATE INDEX deliveries_courier_idx ON deliveries(tenant_id, courier_id, status);

-- Impressão ---------------------------------------------------------------------------------
CREATE TABLE print_agents (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  token_hash    bytea NOT NULL UNIQUE,
  active        boolean NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  last_ip       inet,
  version       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE print_jobs (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  -- Chave única por trabalho: a mesma comanda nunca é enfileirada duas vezes por engano.
  dedupe_key   text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  kind         text NOT NULL CHECK (kind IN ('kitchen_ticket','receipt','test')),
  target       text NOT NULL CHECK (length(target) BETWEEN 1 AND 60),
  order_id     uuid,
  payload      text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  claimed_by   uuid,
  claimed_at   timestamptz,
  done_at      timestamptz,
  last_error   text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id)       ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, claimed_by) REFERENCES print_agents(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX print_jobs_queue_idx ON print_jobs(tenant_id, status, created_at);

-- Financeiro --------------------------------------------------------------------------------
CREATE TABLE finance_entries (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind           text NOT NULL CHECK (kind IN ('payable','receivable')),
  description    text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  category       text,
  counterparty   text,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  due_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  paid_at        date,
  paid_method    text CHECK (paid_method IS NULL OR paid_method IN ('cash','credit','debit','pix','voucher','other','transfer','boleto')),
  settled_by     uuid,
  cancel_reason  text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX finance_entries_due_idx ON finance_entries(tenant_id, status, due_date);

CREATE TABLE finance_reconciliations (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  day              date NOT NULL,
  method           text NOT NULL CHECK (method IN ('cash','credit','debit','pix','voucher','other')),
  system_amount    numeric(14,2) NOT NULL,
  informed_amount  numeric(14,2) NOT NULL,
  difference       numeric(14,2) NOT NULL,
  note             text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, day, method),
  CHECK (difference = informed_amount - system_amount),
  CHECK (difference = 0 OR note IS NOT NULL)
);

-- RLS ---------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_items','product_recipes','option_recipes','stock_movements',
    'couriers','deliveries','print_agents','print_jobs','finance_entries','finance_reconciliations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Privilégios -------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON stock_items, couriers, deliveries, print_agents, print_jobs TO comandou_app;
GRANT SELECT, INSERT, DELETE ON product_recipes, option_recipes TO comandou_app; -- vínculos de ficha técnica
GRANT SELECT, INSERT ON stock_movements, finance_reconciliations TO comandou_app;
-- Lançamento financeiro: valor e vencimento não mudam; só a baixa ou o cancelamento.
GRANT SELECT, INSERT ON finance_entries TO comandou_app;
GRANT UPDATE (status, paid_at, paid_method, settled_by, cancel_reason) ON finance_entries TO comandou_app;
