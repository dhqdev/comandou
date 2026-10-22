-- 0014: cardápio online (loja do cliente final), fotos e pedidos com aprovação.
-- 1) media: fotos do restaurante (produtos, categorias, capa e logo). O navegador já envia a
--    imagem reduzida em WebP; o banco guarda os bytes e a API serve com cache imutável.
-- 2) tenant_store_settings: loja online (aberta/fechada, aceite automático, taxa, pedido mínimo…).
-- 3) Pedido online: status novo "awaiting" (Em análise) antes de "new". Nada vai para a cozinha,
--    estoque ou impressora até alguém aceitar (ou o aceite automático estar ligado).

CREATE TABLE media (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  content_type  text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png')),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 3145728),
  width         integer CHECK (width BETWEEN 1 AND 4096),
  height        integer CHECK (height BETWEEN 1 AND 4096),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX media_tenant_idx ON media(tenant_id, created_at DESC);

ALTER TABLE products   ADD COLUMN image_id uuid,
  ADD FOREIGN KEY (tenant_id, image_id) REFERENCES media(tenant_id, id) ON DELETE SET NULL (image_id);
ALTER TABLE categories ADD COLUMN image_id uuid,
  ADD FOREIGN KEY (tenant_id, image_id) REFERENCES media(tenant_id, id) ON DELETE SET NULL (image_id);

CREATE TABLE tenant_store_settings (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  enabled          boolean NOT NULL DEFAULT true,
  is_open          boolean NOT NULL DEFAULT true,
  auto_accept      boolean NOT NULL DEFAULT false,
  accepts_delivery boolean NOT NULL DEFAULT true,
  accepts_pickup   boolean NOT NULL DEFAULT true,
  delivery_fee     numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  min_order        numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  eta_min          integer NOT NULL DEFAULT 30 CHECK (eta_min BETWEEN 1 AND 600),
  eta_max          integer NOT NULL DEFAULT 50 CHECK (eta_max BETWEEN 1 AND 600),
  about            text CHECK (length(about) <= 500),
  address          text CHECK (length(address) <= 300),
  whatsapp         text CHECK (length(whatsapp) <= 30),
  cover_image_id   uuid,
  logo_image_id    uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (eta_max >= eta_min),
  FOREIGN KEY (tenant_id, cover_image_id) REFERENCES media(tenant_id, id) ON DELETE SET NULL (cover_image_id),
  FOREIGN KEY (tenant_id, logo_image_id)  REFERENCES media(tenant_id, id) ON DELETE SET NULL (logo_image_id)
);
CREATE TRIGGER tenant_store_settings_updated_at BEFORE UPDATE ON tenant_store_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('awaiting','new','in_production','ready','dispatched','completed','cancel_requested','cancelled'));
ALTER TABLE orders
  ADD COLUMN source         text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','online')),
  -- SHA-256 do token do link de acompanhamento do cliente; o token só existe no navegador dele.
  ADD COLUMN public_token_hash bytea,
  ADD COLUMN payment_hint   text CHECK (payment_hint IN ('cash','credit','debit','pix','voucher','other')),
  ADD COLUMN change_for     numeric(14,2) CHECK (change_for >= 0),
  ADD COLUMN accepted_at    timestamptz;
CREATE UNIQUE INDEX orders_public_token_idx ON orders(tenant_id, public_token_hash)
  WHERE public_token_hash IS NOT NULL;

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON media
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON tenant_store_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, DELETE ON media TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON tenant_store_settings TO comandou_app;
