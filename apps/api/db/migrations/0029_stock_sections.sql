-- 0029: Estoque com seções próprias (no estilo do PedidoJá). Somente aditiva.
-- 1) Insumo ganha código (IN-000001, automático), código de barras para bipar, validade padrão
--    em dias e ficha de preparo (insumo produzido na casa a partir de outros: molho, massa…).
-- 2) Lotes: cada entrada (recebimento ou produção) pode virar um lote com fabricação e validade,
--    para saber o que vence primeiro. O lote é controle de validade; o saldo continua no insumo.
-- 3) Recebimento: a mercadoria que chegou do fornecedor (nota, data e várias linhas de uma vez),
--    cada linha vira uma entrada (movimento "purchase") ligada ao recebimento.
-- 4) Produção: fabricar um preparo baixa os insumos da ficha de preparo e dá entrada no preparo
--    com o custo do que foi gasto (movimentos "production", negativos e positivos).
-- 5) Saída avulsa (consumo interno, doação…): movimento "withdrawal", sempre negativo.
-- 6) Fatores de conversão: unidades de compra (Caixa com 12, Saco 25 kg) convertidas para a
--    unidade de controle do insumo no recebimento.

/** Código sequencial por restaurante (PREFIXO-000001) quando a linha chega sem código. */
CREATE FUNCTION stock_fill_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || NEW.tenant_id::text));
    EXECUTE format(
      'SELECT coalesce(max(substring(code from %L)::int), 0) + 1 FROM %I WHERE tenant_id = $1 AND code ~ %L',
      '^' || TG_ARGV[0] || '-(\d+)$', TG_TABLE_NAME, '^' || TG_ARGV[0] || '-\d+$')
      INTO n USING NEW.tenant_id;
    NEW.code := TG_ARGV[0] || '-' || lpad(n::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE stock_items
  ADD COLUMN code            text CHECK (code IS NULL OR length(code) BETWEEN 1 AND 30),
  ADD COLUMN barcode         text CHECK (barcode IS NULL OR length(barcode) BETWEEN 1 AND 40),
  ADD COLUMN shelf_life_days integer CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 3650),
  -- Rendimento da ficha de preparo: as quantidades da ficha produzem isso (na unidade do insumo).
  ADD COLUMN recipe_yield    numeric(14,3) NOT NULL DEFAULT 1 CHECK (recipe_yield > 0);
UPDATE stock_items s SET code = 'IN-' || lpad(x.n::text, 6, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, name) AS n
          FROM stock_items) x
 WHERE x.id = s.id AND s.code IS NULL;
ALTER TABLE stock_items ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX stock_items_code_uq ON stock_items(tenant_id, upper(code));
CREATE UNIQUE INDEX stock_items_barcode_uq ON stock_items(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE TRIGGER stock_items_code BEFORE INSERT ON stock_items
  FOR EACH ROW EXECUTE FUNCTION stock_fill_code('IN');

-- Ficha de preparo: o que um insumo produzido na casa consome para render `recipe_yield`.
CREATE TABLE stock_item_recipes (
  tenant_id      uuid NOT NULL,
  stock_item_id  uuid NOT NULL,
  ingredient_id  uuid NOT NULL,
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, stock_item_id, ingredient_id),
  CHECK (stock_item_id <> ingredient_id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, ingredient_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE stock_receipts (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code         text NOT NULL,
  supplier     text CHECK (supplier IS NULL OR length(supplier) BETWEEN 1 AND 80),
  invoice      text CHECK (invoice IS NULL OR length(invoice) BETWEEN 1 AND 60),
  received_on  date NOT NULL DEFAULT current_date,
  note         text CHECK (note IS NULL OR length(note) <= 300),
  total        numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX stock_receipts_recent_idx ON stock_receipts(tenant_id, received_on DESC, created_at DESC);
CREATE TRIGGER stock_receipts_code BEFORE INSERT ON stock_receipts
  FOR EACH ROW EXECUTE FUNCTION stock_fill_code('REC');

CREATE TABLE stock_productions (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code           text NOT NULL,
  stock_item_id  uuid NOT NULL,
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  -- Custo do que a produção gastou (NULL = preparo sem ficha, custo desconhecido).
  total_cost     numeric(14,2) CHECK (total_cost IS NULL OR total_cost >= 0),
  note           text CHECK (note IS NULL OR length(note) <= 300),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_productions_recent_idx ON stock_productions(tenant_id, created_at DESC);
CREATE TRIGGER stock_productions_code BEFORE INSERT ON stock_productions
  FOR EACH ROW EXECUTE FUNCTION stock_fill_code('PRD');

CREATE TABLE stock_lots (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stock_item_id  uuid NOT NULL,
  -- Código do lote (o do fornecedor ou LOTE-000001 automático); pode repetir entre fornecedores.
  code           text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  made_on        date NOT NULL DEFAULT current_date,
  expires_on     date,
  status         text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','discarded')),
  origin         text NOT NULL CHECK (origin IN ('receipt','production','manual')),
  receipt_id     uuid,
  production_id  uuid,
  note           text CHECK (note IS NULL OR length(note) <= 300),
  closed_at      timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (expires_on IS NULL OR expires_on >= made_on),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES stock_receipts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, production_id) REFERENCES stock_productions(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_lots_item_idx ON stock_lots(tenant_id, stock_item_id, expires_on);
CREATE INDEX stock_lots_open_idx ON stock_lots(tenant_id, expires_on) WHERE status = 'available';
CREATE TRIGGER stock_lots_code BEFORE INSERT ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION stock_fill_code('LOTE');

CREATE TABLE stock_receipt_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  receipt_id        uuid NOT NULL,
  stock_item_id     uuid NOT NULL,
  -- Na unidade de controle do insumo (já convertida).
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost         numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  -- Como veio na nota: "2 CX12" = entered_quantity 2, entered_unit CX12, factor 12.
  entered_quantity  numeric(14,3) NOT NULL CHECK (entered_quantity > 0),
  entered_unit      text NOT NULL CHECK (length(entered_unit) BETWEEN 1 AND 12),
  factor            numeric(14,6) NOT NULL CHECK (factor > 0),
  lot_id            uuid,
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES stock_receipts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, lot_id) REFERENCES stock_lots(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX stock_receipt_lines_receipt_idx ON stock_receipt_lines(tenant_id, receipt_id);

CREATE TABLE stock_unit_factors (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Sigla que aparece no recebimento (CX12, FD6, SC25).
  code           text NOT NULL CHECK (code ~ '^[A-Za-z0-9.-]{1,12}$'),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  unit           text NOT NULL CHECK (unit IN ('un','kg','g','l','ml')),
  -- 1 <code> = factor <unit>.
  factor         numeric(14,4) NOT NULL CHECK (factor > 0),
  -- NULL = vale para todo insumo controlado nessa unidade.
  stock_item_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX stock_unit_factors_code_uq
  ON stock_unit_factors(tenant_id, upper(code), coalesce(stock_item_id, '00000000-0000-0000-0000-000000000000'));

-- Movimentos: novos tipos e de onde vieram.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_kind_check
    CHECK (kind IN ('purchase','adjustment','sale','sale_reversal','loss','production','withdrawal')),
  ADD CONSTRAINT stock_movements_check
    CHECK ((kind IN ('purchase','sale_reversal') AND quantity > 0)
        OR (kind IN ('sale','loss','withdrawal') AND quantity < 0)
        OR kind IN ('adjustment','production')),
  ADD COLUMN receipt_id    uuid,
  ADD COLUMN production_id uuid,
  ADD COLUMN lot_id        uuid,
  ADD CONSTRAINT stock_movements_receipt_fk FOREIGN KEY (tenant_id, receipt_id)
    REFERENCES stock_receipts(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT stock_movements_production_fk FOREIGN KEY (tenant_id, production_id)
    REFERENCES stock_productions(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT stock_movements_lot_fk FOREIGN KEY (tenant_id, lot_id)
    REFERENCES stock_lots(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_recent_idx ON stock_movements(tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_item_recipes','stock_receipts','stock_productions','stock_lots',
                           'stock_receipt_lines','stock_unit_factors']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, DELETE ON stock_item_recipes TO comandou_app;
GRANT SELECT, INSERT ON stock_productions, stock_receipt_lines TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON stock_receipts TO comandou_app; -- total é gravado ao fim do recebimento
GRANT SELECT, INSERT, UPDATE ON stock_lots TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_unit_factors TO comandou_app;
