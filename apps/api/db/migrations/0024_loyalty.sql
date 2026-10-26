-- 0024: programa de fidelidade do cardápio online.
-- 1) loyalty_programs: o restaurante liga o programa e escolhe a regra: pontos por real gasto ou
--    um carimbo por pedido (com valor mínimo). Validade opcional: os pontos vencem quando o
--    cliente passa N dias sem comprar.
-- 2) loyalty_rewards: o que o cliente troca pelos pontos: desconto em reais ou um produto grátis.
-- 3) loyalty_entries: extrato de cada cliente (ganhou, trocou, devolvido, venceu, ajuste).
--    O saldo é a soma do extrato. Cada pedido gera no máximo um crédito, um resgate e uma
--    devolução (índices únicos), então repetir uma transição não duplica pontos.
-- Somente aditiva.

CREATE TABLE loyalty_programs (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  enabled          boolean NOT NULL DEFAULT false,
  mode             text NOT NULL DEFAULT 'points' CHECK (mode IN ('points','stamps')),
  -- Modo pontos: quantos pontos cada R$ 1,00 gasto (sem a taxa de entrega) rende.
  points_per_real  numeric(6,2) NOT NULL DEFAULT 1 CHECK (points_per_real > 0 AND points_per_real <= 100),
  -- Modo carimbos: valor mínimo do pedido para ganhar o carimbo.
  stamp_min_order  numeric(14,2) NOT NULL DEFAULT 0 CHECK (stamp_min_order >= 0),
  -- Vazio = os pontos não vencem.
  expiry_days      integer CHECK (expiry_days BETWEEN 7 AND 1095),
  -- Pedidos do balcão/PDV com o celular de um cliente cadastrado também pontuam.
  count_staff_orders boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER loyalty_programs_updated_at BEFORE UPDATE ON loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_rewards (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  cost        integer NOT NULL CHECK (cost BETWEEN 1 AND 100000),
  kind        text NOT NULL CHECK (kind IN ('discount','product')),
  -- Desconto em reais (kind = discount).
  amount      numeric(14,2) CHECK (amount > 0),
  -- Produto grátis (kind = product): precisa estar na sacola; sai o preço base dele.
  product_id  uuid,
  active      boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK ((kind = 'discount') = (amount IS NOT NULL)),
  CHECK ((kind = 'product') = (product_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX loyalty_rewards_tenant_idx ON loyalty_rewards(tenant_id, position);
CREATE TRIGGER loyalty_rewards_updated_at BEFORE UPDATE ON loyalty_rewards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id  uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('earn','redeem','refund','expire','adjust')),
  points       integer NOT NULL CHECK (points <> 0),
  order_id     uuid,
  reward_id    uuid,
  -- Resgate: quanto saiu de desconto no pedido.
  discount     numeric(14,2),
  note         text CHECK (length(note) <= 120),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE SET NULL (order_id),
  FOREIGN KEY (tenant_id, reward_id) REFERENCES loyalty_rewards(tenant_id, id) ON DELETE SET NULL (reward_id)
);
CREATE INDEX loyalty_entries_customer_idx ON loyalty_entries(tenant_id, customer_id, created_at DESC);
CREATE INDEX loyalty_entries_tenant_created_idx ON loyalty_entries(tenant_id, created_at DESC);
CREATE UNIQUE INDEX loyalty_entries_order_kind_idx ON loyalty_entries(order_id, kind)
  WHERE order_id IS NOT NULL AND kind IN ('earn','redeem','refund');

ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty_programs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON loyalty_rewards
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON loyalty_entries
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON loyalty_programs TO comandou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_rewards TO comandou_app;
GRANT SELECT, INSERT ON loyalty_entries TO comandou_app;
