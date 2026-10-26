-- 0022: estoque mais completo e precificação profissional. Somente aditiva.
-- 1) Insumo ganha categoria (Carnes, Hortifrúti, Bebidas…), fornecedor e a data da última
--    contagem, para filtrar, contar por setor e saber o que está há muito tempo sem conferência.
-- 2) Contagem em lote (inventário): uma sessão de contagem ajusta vários insumos de uma vez,
--    numa só transação; cada ajuste aponta para a sessão (stock_movements.count_id).
-- 3) Precificação: parâmetros do restaurante (impostos, taxas, despesas fixas e lucro desejado,
--    todos em % do preço de venda) e, por produto, um lucro desejado próprio. O preço sugerido
--    é custo da ficha técnica ÷ (1 − soma dos percentuais) — o "markup divisor".

ALTER TABLE stock_items
  ADD COLUMN category   text CHECK (length(category) BETWEEN 1 AND 40),
  ADD COLUMN supplier   text CHECK (length(supplier) BETWEEN 1 AND 80),
  ADD COLUMN counted_at timestamptz;

CREATE TABLE stock_counts (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  note          text NOT NULL CHECK (length(note) BETWEEN 3 AND 300),
  items_counted integer NOT NULL CHECK (items_counted > 0),
  items_changed integer NOT NULL CHECK (items_changed >= 0),
  -- Diferença valorizada pelo custo médio do momento (negativo = faltou mercadoria).
  value_delta   numeric(14,2) NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX stock_counts_recent_idx ON stock_counts(tenant_id, created_at DESC);

ALTER TABLE stock_movements ADD COLUMN count_id uuid;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_count_fk FOREIGN KEY (tenant_id, count_id)
  REFERENCES stock_counts(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_sale_recent_idx ON stock_movements(tenant_id, stock_item_id, created_at)
  WHERE kind = 'sale';

CREATE TABLE pricing_settings (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  tax_percent    numeric(5,2) NOT NULL DEFAULT 6  CHECK (tax_percent BETWEEN 0 AND 60),
  fee_percent    numeric(5,2) NOT NULL DEFAULT 4  CHECK (fee_percent BETWEEN 0 AND 30),
  fixed_percent  numeric(5,2) NOT NULL DEFAULT 30 CHECK (fixed_percent BETWEEN 0 AND 80),
  target_margin  numeric(5,2) NOT NULL DEFAULT 15 CHECK (target_margin BETWEEN 0 AND 80),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (tax_percent + fee_percent + fixed_percent + target_margin <= 90)
);
CREATE TRIGGER pricing_settings_updated_at BEFORE UPDATE ON pricing_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_pricing (
  tenant_id      uuid NOT NULL,
  product_id     uuid NOT NULL,
  target_margin  numeric(5,2) NOT NULL CHECK (target_margin BETWEEN 0 AND 80),
  PRIMARY KEY (tenant_id, product_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_counts','pricing_settings','product_pricing']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON stock_counts TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON pricing_settings TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_pricing TO comandou_app;
