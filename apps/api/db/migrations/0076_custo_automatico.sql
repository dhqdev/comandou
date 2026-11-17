-- 0076: custo automático das fichas. Somente aditiva.
-- Quando o custo de um insumo muda (entrada com preço, recebimento, produção ou "Mudar preço"),
-- tudo o que depende dele é recalculado na hora:
-- 1) Preparos da casa (molho, massa…) que levam o insumo: o custo vira o da ficha de preparo
--    (soma de quantidade × custo de cada ingrediente ÷ rendimento), em cascata — preparo que leva
--    preparo também muda. Feito por gatilho no banco, então vale para qualquer caminho.
-- 2) Itens do cardápio e complementos: o custo da ficha técnica já é lido do custo atual dos
--    insumos, então muda junto, sem cópia desatualizada.
-- 3) Histórico (stock_cost_changes): cada mudança guarda quais insumos e quais itens do cardápio
--    mudaram, com o custo antes e depois e o preço de venda, para a tela e o assistente
--    mostrarem o impacto na margem.
-- 4) Último preço pago (last_cost): o valor da última compra, ao lado do custo médio.

ALTER TABLE stock_items
  ADD COLUMN last_cost       numeric(14,4) CHECK (last_cost IS NULL OR last_cost >= 0),
  ADD COLUMN cost_changed_at timestamptz;

-- O último preço pago de quem já comprou com custo informado.
UPDATE stock_items s SET last_cost = m.unit_cost, cost_changed_at = m.created_at
  FROM (SELECT DISTINCT ON (stock_item_id) stock_item_id, unit_cost, created_at
          FROM stock_movements
         WHERE kind = 'purchase' AND unit_cost IS NOT NULL
         ORDER BY stock_item_id, id DESC) m
 WHERE m.stock_item_id = s.id;

/** Custo de uma unidade do preparo pela ficha de preparo (NULL se não tem ficha). */
CREATE FUNCTION stock_prep_cost(p_item uuid) RETURNS numeric
  LANGUAGE sql STABLE AS $$
  SELECT round(sum(r.quantity * i.avg_cost) / max(s.recipe_yield), 4)
    FROM stock_item_recipes r
    JOIN stock_items i ON i.id = r.ingredient_id
    JOIN stock_items s ON s.id = r.stock_item_id
   WHERE r.stock_item_id = p_item
$$;

/**
 * Custo do insumo mudou: recalcula os preparos que o usam. O UPDATE dispara o gatilho de novo
 * para cada preparo que mudou (cascata); para quando nada mais muda. O limite de profundidade
 * protege contra ficha circular (A leva B e B leva A), que a tela também bloqueia.
 */
CREATE FUNCTION stock_cost_cascade() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 16 THEN
    RETURN NULL;
  END IF;
  UPDATE stock_items s
     SET avg_cost = c.cost, cost_changed_at = now()
    FROM (SELECT DISTINCT r.stock_item_id AS id, stock_prep_cost(r.stock_item_id) AS cost
            FROM stock_item_recipes r
           WHERE r.ingredient_id = NEW.id AND r.tenant_id = NEW.tenant_id) c
   WHERE s.id = c.id AND c.cost IS NOT NULL AND s.avg_cost IS DISTINCT FROM c.cost;
  RETURN NULL;
END $$;

CREATE TRIGGER stock_items_cost_cascade
  AFTER UPDATE OF avg_cost ON stock_items
  FOR EACH ROW WHEN (OLD.avg_cost IS DISTINCT FROM NEW.avg_cost)
  EXECUTE FUNCTION stock_cost_cascade();

CREATE TABLE stock_cost_changes (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- O que mudou o custo: entrada, recebimento, produção, mudança manual ou ficha de preparo.
  source      text NOT NULL CHECK (source IN ('purchase','receipt','production','manual','prep_recipe')),
  -- Referência legível (REC-000012, PRD-000003) ou o motivo da mudança manual.
  label       text CHECK (label IS NULL OR length(label) <= 300),
  -- [{ id, name, unit, oldCost, newCost }]: insumos e preparos que mudaram.
  items       jsonb NOT NULL DEFAULT '[]',
  -- [{ kind: product|option, id, name, price, oldCost, newCost }]: o que o cardápio sentiu.
  products    jsonb NOT NULL DEFAULT '[]',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX stock_cost_changes_recent_idx ON stock_cost_changes(tenant_id, created_at DESC);

ALTER TABLE stock_cost_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_cost_changes
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON stock_cost_changes TO comandou_app;
