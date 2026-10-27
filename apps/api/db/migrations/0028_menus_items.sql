-- 0028: cadastro de itens completo, famílias de itens, grupos de complementos mais ricos e
-- vários cardápios (Principal e Delivery). Somente aditiva: sem cardápio ativo para um canal,
-- tudo continua como antes (todos os produtos, preço base).

-- Famílias: agrupam os itens nos relatórios (Bebidas, Lanches, Sobremesas…), independentes da
-- categoria que aparece no cardápio.
CREATE TABLE item_families (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  active             boolean NOT NULL DEFAULT true,
  -- Sabores de pizza: vendido como complemento, conta como o produto na análise de cardápio.
  counts_as_product  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER item_families_updated_at BEFORE UPDATE ON item_families
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Item: código interno, família, custo informado (quando não há ficha técnica), venda por peso
-- e código de barras. A unidade de medida é a fiscal_unit que já existia (UN, KG, L…).
ALTER TABLE products
  ADD COLUMN code           text CHECK (code IS NULL OR length(code) BETWEEN 1 AND 30),
  ADD COLUMN family_id      uuid,
  ADD COLUMN cost           numeric(14,2) CHECK (cost IS NULL OR cost >= 0),
  ADD COLUMN sold_by_weight boolean NOT NULL DEFAULT false,
  ADD COLUMN barcode        text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{4,14}$'),
  ADD COLUMN barcode_type   text NOT NULL DEFAULT 'fixed' CHECK (barcode_type IN ('fixed','weight','value')),
  ADD FOREIGN KEY (tenant_id, family_id) REFERENCES item_families(tenant_id, id) ON DELETE SET NULL (family_id);
CREATE UNIQUE INDEX products_code_uq ON products(tenant_id, upper(code)) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX products_barcode_uq ON products(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_family_idx ON products(tenant_id, family_id) WHERE family_id IS NOT NULL;

-- Códigos para os itens que já existem: IT-000001, IT-000002… por restaurante, na ordem de cadastro.
UPDATE products p SET code = 'IT-' || lpad(x.n::text, 6, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS n FROM products) x
 WHERE x.id = p.id AND p.code IS NULL;

-- Grupos de complementos: tipo (só rótulo e padrões da tela) e regra de cobrança.
-- sum = soma as opções; max = cobra a opção mais cara; average = média das escolhidas (pizza).
ALTER TABLE option_groups
  ADD COLUMN kind   text NOT NULL DEFAULT 'additional' CHECK (kind IN ('additional','variation','flavor','remove')),
  ADD COLUMN charge text NOT NULL DEFAULT 'sum' CHECK (charge IN ('sum','max','average'));
UPDATE option_groups SET kind = 'variation' WHERE min_select = 1 AND max_select = 1;

-- Opção já marcada ao abrir o item; opção removida do grupo (fica guardada por causa dos pedidos).
ALTER TABLE options
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN archived   boolean NOT NULL DEFAULT false;

-- Cardápios: o Principal vale no balcão e no salão (PDV, garçom, mesa); o Delivery vale na entrega
-- e na retirada (cardápio online e PDV). Um ativo por tipo. Cada item pode ter preço próprio.
CREATE TABLE menus (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind        text NOT NULL CHECK (kind IN ('principal','delivery')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX menus_active_kind_uq ON menus(tenant_id, kind) WHERE active;
CREATE TRIGGER menus_updated_at BEFORE UPDATE ON menus FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_items (
  tenant_id   uuid NOT NULL,
  menu_id     uuid NOT NULL,
  product_id  uuid NOT NULL,
  -- NULL = usa o preço base do item.
  price       numeric(14,2) CHECK (price IS NULL OR price >= 0),
  PRIMARY KEY (tenant_id, menu_id, product_id),
  FOREIGN KEY (tenant_id, menu_id)    REFERENCES menus(tenant_id, id)    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX menu_items_product_idx ON menu_items(tenant_id, product_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_families','menus','menu_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON item_families TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON menus, menu_items TO comandou_app;
