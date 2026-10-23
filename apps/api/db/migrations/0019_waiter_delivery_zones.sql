-- 0019: garçom, entregador por link e áreas de entrega no mapa.
-- 1) tabs.bill_requested_at: o garçom marca "pediu a conta"; o salão mostra a mesa "em pagamento".
-- 2) couriers.access_token_hash: link do entregador (sem login). O banco guarda só o SHA-256.
-- 3) delivery_zones: áreas de entrega desenhadas no mapa (polígono ou raio a partir da loja),
--    cada uma com taxa, pedido mínimo e tempo próprios.
-- 4) Coordenadas da loja, dos endereços salvos e do pedido (rota do entregador e cálculo da área).

ALTER TABLE tabs
  ADD COLUMN bill_requested_at timestamptz,
  ADD COLUMN bill_requested_by uuid;

ALTER TABLE couriers
  ADD COLUMN access_token_hash bytea UNIQUE,
  ADD COLUMN access_created_at timestamptz;

ALTER TABLE tenant_store_settings
  ADD COLUMN store_lat numeric(9,6) CHECK (store_lat BETWEEN -90 AND 90),
  ADD COLUMN store_lng numeric(9,6) CHECK (store_lng BETWEEN -180 AND 180);

ALTER TABLE customer_addresses
  ADD COLUMN lat numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng numeric(9,6) CHECK (lng BETWEEN -180 AND 180);

ALTER TABLE orders
  ADD COLUMN delivery_lat numeric(9,6) CHECK (delivery_lat BETWEEN -90 AND 90),
  ADD COLUMN delivery_lng numeric(9,6) CHECK (delivery_lng BETWEEN -180 AND 180);

CREATE TABLE delivery_zones (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color      text NOT NULL DEFAULT '#ea8a0b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  kind       text NOT NULL CHECK (kind IN ('polygon','radius')),
  -- Polígono: [[lat, lng], ...] (3 a 200 pontos). Raio: centro + metros.
  polygon    jsonb,
  center_lat numeric(9,6),
  center_lng numeric(9,6),
  radius_m   integer CHECK (radius_m BETWEEN 50 AND 100000),
  fee        numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  min_order  numeric(14,2) CHECK (min_order >= 0),
  eta_min    integer CHECK (eta_min BETWEEN 1 AND 600),
  eta_max    integer CHECK (eta_max BETWEEN 1 AND 600),
  active     boolean NOT NULL DEFAULT true,
  -- Áreas sobrepostas: vale a de menor posição (desenhe a mais perto da loja primeiro).
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (kind <> 'polygon' OR (jsonb_typeof(polygon) = 'array' AND jsonb_array_length(polygon) BETWEEN 3 AND 200)),
  CHECK (kind <> 'radius' OR (center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_m IS NOT NULL)),
  CHECK (eta_max IS NULL OR eta_min IS NULL OR eta_max >= eta_min)
);
CREATE INDEX delivery_zones_tenant_idx ON delivery_zones(tenant_id, position);
CREATE TRIGGER delivery_zones_updated_at BEFORE UPDATE ON delivery_zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_zones
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_zones TO comandou_app;
