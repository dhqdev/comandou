-- 0016: conta do cliente no cardápio online e personalização da loja.
-- 1) customers / customer_addresses / customer_sessions: o cliente final cria conta no cardápio
--    de UM restaurante (telefone + senha), salva endereços e vê o histórico de pedidos.
--    Sessão opaca em cookie próprio (cm_cid); o banco guarda só o SHA-256 do token.
-- 2) orders.customer_id: pedido feito com a conta aberta fica ligado ao cliente.
-- 3) store_banners: banners/promoções do topo do cardápio.
-- 4) products.featured/badge e novos campos de aparência da loja.

CREATE TABLE customers (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- Só dígitos (DDD + número, com ou sem 55): é o login do cliente.
  phone            text NOT NULL CHECK (phone ~ '^[0-9]{10,13}$'),
  email            text CHECK (length(email) <= 254),
  password_hash    text NOT NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  -- Anotação interna da equipe (o cliente não vê).
  staff_notes      text CHECK (length(staff_notes) <= 500),
  blocked_at       timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone)
);
CREATE UNIQUE INDEX customers_email_idx ON customers(tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_tenant_created_idx ON customers(tenant_id, created_at DESC);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id  uuid NOT NULL,
  label        text CHECK (length(label) <= 30),
  street       text NOT NULL CHECK (length(street) BETWEEN 1 AND 120),
  number       text NOT NULL CHECK (length(number) BETWEEN 1 AND 20),
  district     text NOT NULL CHECK (length(district) BETWEEN 1 AND 80),
  complement   text CHECK (length(complement) <= 80),
  reference    text CHECK (length(reference) <= 120),
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses(tenant_id, customer_id);

CREATE TABLE customer_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id  uuid NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  user_agent   text CHECK (length(user_agent) <= 300),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(tenant_id, customer_id);

ALTER TABLE orders ADD COLUMN customer_id uuid,
  ADD FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE SET NULL (customer_id);
CREATE INDEX orders_tenant_customer_idx ON orders(tenant_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE TABLE store_banners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  subtitle     text CHECK (length(subtitle) <= 120),
  -- Selo pequeno acima do título (ex.: "Só hoje", "20% OFF").
  tag          text CHECK (length(tag) <= 24),
  cta          text CHECK (length(cta) <= 24),
  image_id     uuid,
  -- Ao tocar: abre um produto, filtra uma categoria ou nada.
  target_type  text NOT NULL DEFAULT 'none' CHECK (target_type IN ('none','product','category')),
  target_id    uuid,
  active       boolean NOT NULL DEFAULT true,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_type = 'none') = (target_id IS NULL)),
  FOREIGN KEY (tenant_id, image_id) REFERENCES media(tenant_id, id) ON DELETE SET NULL (image_id)
);
CREATE INDEX store_banners_tenant_idx ON store_banners(tenant_id, position);
CREATE TRIGGER store_banners_updated_at BEFORE UPDATE ON store_banners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE products
  ADD COLUMN featured boolean NOT NULL DEFAULT false,
  ADD COLUMN badge    text CHECK (length(badge) <= 20);

ALTER TABLE tenant_store_settings
  ADD COLUMN theme            text NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto','light','dark')),
  ADD COLUMN headline         text CHECK (length(headline) <= 60),
  ADD COLUMN featured_title   text CHECK (length(featured_title) <= 40),
  ADD COLUMN accounts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN show_popular     boolean NOT NULL DEFAULT true;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON customer_addresses
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON customer_sessions
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON store_banners
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON customers, customer_sessions TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_addresses, store_banners TO comandou_app;
